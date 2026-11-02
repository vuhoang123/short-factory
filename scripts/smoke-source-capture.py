"""Owned synthetic DOM only. Exercises the actual screenshot engine without a social account."""
import asyncio
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / '.data' / 'source-capture'
MANIFEST = json.loads((DATA / 'engine.json').read_text(encoding='utf-8'))
os.environ['COMMENT_DATA_DIR'] = str(DATA / 'test-settings')
os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(DATA / 'browsers')
sys.path.insert(0, MANIFEST['engine'])
from app.importer import BrowserImporter  # noqa: E402
from app.models import Post, Comment  # noqa: E402
from app.source_capture import capture_sources  # noqa: E402
from PIL import Image  # noqa: E402

TEXT = 'Một thư viện nhỏ mở cửa cuối tuần. Mọi người mang sách đến chia sẻ và cùng đọc mỗi ngày.'
COMMENTS = [f'Bình luận thử số {i}: mình rất thích hoạt động đọc sách cùng hàng xóm.' for i in range(1, 6)]
HTML = '<!doctype html><meta charset="utf-8"><style>body{background:#e8e8e8;font:20px Arial;margin:50px}article{background:white;width:650px;margin:20px;padding:16px;box-sizing:border-box}h3{font:700 20px Arial;margin:0;display:flex;gap:12px;align-items:center}h3 img{width:40px;height:40px;background:#315bda}p{line-height:1.5}.reactions{padding:12px;background:#e9eefb;color:#203a72}</style>'
AVATAR = '<img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\'%3E%3Crect width=\'40\' height=\'40\' fill=\'%23315bda\'/%3E%3C/svg%3E">'
HTML += f'<article role="article"><h3>{AVATAR}<a>Thư viện thử nghiệm</a></h3><p data-ad-preview="message">{TEXT}</p><div class="reactions">👍 123 · DỮ LIỆU THỬ DO DỰ ÁN TẠO</div>'
for i, text in enumerate(COMMENTS):
    HTML += f'<article role="article" aria-label="Bình luận của Bạn đọc {i+1}"><h3>{AVATAR}<a role="link"><span dir="auto">Bạn đọc {i+1}</span></a></h3><p dir="auto">{text}</p><div class="reactions" aria-label="{100-i*10} cảm xúc">👍 {100-i*10}</div></article>'
HTML += '</article>'


async def main():
    destination = ROOT / 'test-results' / 'source-capture'
    destination.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='sf-source-capture-') as temporary:
        importer = BrowserImporter(Path(temporary) / 'browser')
        try:
            context = await importer.start()
            await context.route('**/*', lambda route: route.abort())
            page = await context.new_page()
            await page.set_content(HTML)
            post = Post(url='https://www.facebook.com/owned-fixture/posts/synthetic', platform='facebook', author='Thư viện thử nghiệm', text=TEXT, comments=[Comment(author=f'Bạn đọc {i+1}', text=text, reaction_count=100-i*10) for i, text in enumerate(COMMENTS)])
            viewport = page.viewport_size.copy()
            await capture_sources(page, post, destination)
            assert page.viewport_size == viewport, 'Capture must restore the browser layout'
            assert post.source_image_id and post.anonymous_image_id
            for entry in [post] + post.comments:
                assert entry.source_image_id and entry.anonymous_image_id, 'Each selected source needs a real original and masked screenshot'
                with Image.open(destination / f'{entry.source_image_id}.png') as original, Image.open(destination / f'{entry.anonymous_image_id}.png') as masked:
                    assert original.size == masked.size
                    assert original.tobytes() != masked.tobytes(), 'Mask must change header pixels'
            result = post.model_dump()
            (destination / 'capture.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps({'post': True, 'comments': len(post.comments), 'originalAndMasked': 12, 'restoredViewport': True, 'networkRequestsAllowed': 0}))
        finally:
            await importer.close()


if __name__ == '__main__':
    asyncio.run(main())
