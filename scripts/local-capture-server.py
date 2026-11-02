"""Private bridge to the user's local ai-comment checkout; never imports its browser data."""
import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / '.data' / 'source-capture'
os.environ['COMMENT_DATA_DIR'] = str(DATA / 'engine-settings')
os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(DATA / 'browsers')
MANIFEST = json.loads((DATA / 'engine.json').read_text(encoding='utf-8'))
ENGINE = Path(MANIFEST['engine'])
for name, expected in MANIFEST['hashes'].items():
    if hashlib.sha256((ENGINE / 'app' / name).read_bytes()).hexdigest() != expected:
        raise RuntimeError('CAPTURE_ENGINE_CHANGED: rerun local:capture:setup after reviewing changes')
sys.path.insert(0, str(ENGINE))
from app.importer import BrowserImporter, validate_url  # noqa: E402
import app.comments as comments  # noqa: E402
# Strict numeric ranking; the upstream default also ranks short low-react replies by length.
comments.STRONG_REACTION_COUNT = 0
TOKEN = os.environ.get('LOCAL_CAPTURE_TOKEN', '')
if len(TOKEN) < 32 or os.environ.get('NODE_ENV') == 'production':
    raise RuntimeError('LOCAL_CAPTURE_CONFIG_INVALID')
LOOP = asyncio.new_event_loop()
PROFILES = {}
CAPTURES = {}
CAPTURE_LOCKS = {}
UUID = re.compile(r'^[a-f0-9-]{36}$')
IMAGE = re.compile(r'^[a-f0-9]{32}$')


def scope(data):
    values = [data.get('workspaceId', ''), data.get('userId', '')]
    if not all(UUID.fullmatch(v) for v in values):
        raise ValueError('CAPTURE_SCOPE_INVALID')
    return '/'.join(values), DATA / 'scopes' / values[0] / values[1]


async def operation(action, data):
    key, directory = scope(data)
    if action == 'image':
        image_id = data.get('imageId', '')
        if not IMAGE.fullmatch(image_id):
            raise ValueError('CAPTURE_IMAGE_INVALID')
        target = directory / 'images' / f'{image_id}.png'
        if target.stat().st_size > 20 * 1024 * 1024:
            raise ValueError('CAPTURE_IMAGE_TOO_LARGE')
        return target.read_bytes()
    job_id = data.get('jobId', '')
    if action != 'open' and not UUID.fullmatch(job_id):
        raise ValueError('CAPTURE_JOB_INVALID')
    result_file = directory / 'results' / f'{job_id}.json'
    if action == 'cancel':
        task = CAPTURES.get((key, job_id))
        if task:
            task.cancel()
        return {'ok': True}
    if action == 'purge':
        if result_file.exists():
            post = json.loads(result_file.read_text(encoding='utf-8'))
            for entry in [post] + post.get('comments', []):
                for field in ['source_image_id', 'anonymous_image_id', 'capture_diagnostic_image_id', 'image_id']:
                    image_id = entry.get(field) or ''
                    if IMAGE.fullmatch(image_id):
                        (directory / 'images' / f'{image_id}.png').unlink(missing_ok=True)
            result_file.unlink(missing_ok=True)
        return {'ok': True}
    url, platform = validate_url(data.get('url', ''))
    if platform not in ('facebook', 'threads'):
        raise ValueError('CAPTURE_PLATFORM_UNSUPPORTED')
    if action == 'capture' and result_file.exists():
        return json.loads(result_file.read_text(encoding='utf-8'))
    importer = PROFILES.get(key)
    if importer is None:
        if len(PROFILES) >= 4:
            raise ValueError('CAPTURE_PROFILE_LIMIT')
        importer = PROFILES[key] = BrowserImporter(directory / 'browser')
    if action == 'open':
        await asyncio.wait_for(importer.login(url), timeout=60)
        return {'ok': True}
    if action != 'capture':
        raise ValueError('CAPTURE_ACTION_INVALID')
    # A capture never opens a hidden login browser; the user opens the visible profile first.
    if not importer.context or not importer.visible:
        raise ValueError('CAPTURE_OPEN_BROWSER_FIRST')
    async with CAPTURE_LOCKS.setdefault(key, asyncio.Lock()):
        if result_file.exists():
            return json.loads(result_file.read_text(encoding='utf-8'))
        CAPTURES[(key, job_id)] = asyncio.current_task()
        images = directory / 'images'
        before = set(images.glob('*.png'))
        keep = set()
        try:
            post = await asyncio.wait_for(importer.read(url, capture_original=True, include_comments=True, comment_order='engagement', scan_depth='standard'), timeout=210)
            result = post.model_dump()
            for entry in [result] + result.get('comments', []):
                for field in ['source_image_id', 'anonymous_image_id']:
                    image_id = entry.get(field) or ''
                    if IMAGE.fullmatch(image_id):
                        keep.add(images / f'{image_id}.png')
            result_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = result_file.with_suffix('.tmp')
            temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            temporary.replace(result_file)
            return result
        finally:
            CAPTURES.pop((key, job_id), None)
            for target in set(images.glob('*.png')) - before - keep:
                target.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.send_response(200 if self.path == '/health' else 404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"status":"ready"}')

    def do_POST(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            self.send_error(401)
            return
        future = None
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 8192:
                raise ValueError('CAPTURE_REQUEST_INVALID')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('CAPTURE_REQUEST_INVALID')
            future = asyncio.run_coroutine_threadsafe(operation(self.path.removeprefix('/'), data), LOOP)
            result = future.result(timeout=220)
            content = result if isinstance(result, bytes) else json.dumps(result, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'image/png' if isinstance(result, bytes) else 'application/json')
        except Exception as exc:
            if future:
                future.cancel()
            message = str(exc)
            code = message if re.fullmatch(r'[A-Z][A-Z0-9_]{1,79}', message) else 'LOCAL_CAPTURE_FAILED'
            content = json.dumps({'code': code}).encode('utf-8')
            self.send_response(409)
            self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == '__main__':
    threading.Thread(target=LOOP.run_forever, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', 3003), Handler).serve_forever()
