import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (!existsSync('.env')) throw new Error('Configure .env first. See docs/16-LOCAL-EXPORT.md.');
process.loadEnvFile('.env');
for (const name of ['DATABASE_URL', 'REDIS_URL']) if (!process.env[name]) throw new Error(`Missing ${name}.`);
if (process.env.NODE_ENV === 'production') throw new Error('This launcher is for local development only.');
const apiPort = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535 || [3000, 3002, 3003].includes(apiPort)) throw new Error('API_PORT must be an available port distinct from Web (3000), speech (3002) and capture (3003).');

const neuralPython = process.env.TTS_VIENEU_PYTHON ?? path.join(root, '.data', 'tts-vieneu', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const speechProvider = process.env.LOCAL_TTS_PROVIDER ?? (existsSync(neuralPython) ? 'vieneu' : 'local');
if (!['local', 'vieneu'].includes(speechProvider)) throw new Error('LOCAL_TTS_PROVIDER must be local or vieneu.');
const environment = {
  ...process.env, NODE_ENV: 'development', SCRIPT_PROVIDER: 'mock', TTS_PROVIDER: speechProvider,
  HF_HOME: path.join(root, '.data', 'tts-vieneu', 'hf'), HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
  PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
  TTS_LOCAL_TOKEN: process.env.TTS_LOCAL_TOKEN ?? randomBytes(32).toString('hex'),
  LOCAL_CAPTURE_ENABLED: process.env.LOCAL_CAPTURE_ENABLED || (existsSync(path.join(root, '.data', 'source-capture', 'engine.json')) ? '1' : '0'),
  LOCAL_CAPTURE_TOKEN: randomBytes(32).toString('hex'),
  LOCAL_CAPTURE_URL: 'http://127.0.0.1:3003',
  TTS_LOCAL_URL: 'http://127.0.0.1:3002/speech', TTS_LOCAL_PORT: '3002',
  LOCAL_ALIGNMENT_ENABLED: speechProvider === 'vieneu' ? '1' : '0',
  MEDIA_RENDER_CONCURRENCY: process.env.MEDIA_RENDER_CONCURRENCY ?? '1',
  TTS_VIENEU_VOICES_FILE: path.join(root, '.data', 'tts-vieneu', 'voices.json'),
  APP_URL: 'http://127.0.0.1:3000', API_URL: `http://127.0.0.1:${apiPort}`,
  API_HOST: '127.0.0.1', API_PORT: String(apiPort), PORT: String(apiPort),
  PUBLISHER_PROVIDER: 'mock', ANALYTICS_LIVE_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1',
  TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.base.json'),
};
const wsl = process.env.LOCAL_RUNTIME_WSL;
async function portOpen(raw) {
  const url = new URL(raw);
  return new Promise((resolve) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(false));
  });
}
function startWsl(args) {
  const result = spawnSync('wsl.exe', ['--distribution', wsl, '--user', 'root', '--exec', ...args], { windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not start the configured WSL local service. See docs/16-LOCAL-EXPORT.md.');
}
if (wsl && process.platform === 'win32') {
  const database = new URL(environment.DATABASE_URL);
  const redis = new URL(environment.REDIS_URL);
  if (![database.hostname, redis.hostname].every((host) => ['localhost', '127.0.0.1'].includes(host))) throw new Error('WSL service startup requires localhost database/Redis endpoints.');
  if (!await portOpen(environment.DATABASE_URL)) startWsl(['/usr/sbin/service', 'postgresql', 'start']);
  if (!await portOpen(environment.REDIS_URL)) startWsl(['/usr/bin/redis-server', '/var/lib/shorts-factory-local-redis/redis.conf']);
}
if (!await portOpen(environment.DATABASE_URL) || !await portOpen(environment.REDIS_URL)) throw new Error('Start PostgreSQL and Redis before local:export. See docs/16-LOCAL-EXPORT.md.');
if (!existsSync('packages/database/generated/client/index.js')) throw new Error('Run pnpm db:generate first.');

const children = new Set();
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
function launch(label, args, cwd = root, executable = process.execPath) {
  const child = spawn(executable, args, { cwd, env: environment, windowsHide: true, stdio: 'inherit' });
  children.add(child);
  child.once('error', () => { console.error(`${label} could not start.`); stop(1); });
  child.once('exit', (code) => { children.delete(child); if (!stopping) { console.error(`${label} stopped (${code ?? 'signal'}).`); stop(code || 1); } });
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
if (speechProvider === 'vieneu') {
  if (!existsSync(neuralPython)) throw new Error('Run pnpm local:tts:setup first.');
  launch('Local neural speech', [path.join(root, 'scripts', 'local-tts-server.py')], root, neuralPython);
  let ready = false;
  console.log('Loading Vietnamese neural speech locally; the first run downloads model weights.');
  for (let attempt = 0; attempt < 300 && !stopping; attempt++) {
    try { const response = await fetch('http://127.0.0.1:3002/health', { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch { /* Model startup is still in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) { stop(1); throw new Error('Local speech did not become ready. Check the installed model environment.'); }
}
if (environment.LOCAL_CAPTURE_ENABLED === '1') {
  const capturePython = path.join(root, '.data', 'source-capture', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  launch('Source capture', [path.join(root, 'scripts', 'local-capture-server.py')], root, capturePython);
  let ready = false;
  for (let attempt = 0; attempt < 30 && !stopping; attempt++) {
    try { if ((await fetch('http://127.0.0.1:3003/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Private capture process is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) { stop(1); throw new Error('Local capture did not start. Run local:capture:setup.'); }
}
launch('API', ['--import', 'tsx', 'apps/api/src/main.ts']);
launch('Discovery worker', ['--import', 'tsx', 'workers/discovery/src/main.ts']);
launch('Media worker', ['--import', 'tsx', 'workers/media/src/main.ts']);
launch('Web', ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3000'], path.join(root, 'apps/web'));
console.log(`Local export: http://127.0.0.1:3000/studio — ${speechProvider} speech, deterministic script, no paid provider calls. Ctrl+C stops application processes; database data is preserved.`);
