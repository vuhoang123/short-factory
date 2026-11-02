import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (!existsSync('.env')) throw new Error('Configure .env first. See docs/16-LOCAL-EXPORT.md.');
process.loadEnvFile('.env');
for (const name of ['DATABASE_URL', 'REDIS_URL']) if (!process.env[name]) throw new Error(`Missing ${name}.`);
if (process.env.NODE_ENV === 'production') throw new Error('This launcher is for local development only.');

const environment = {
  ...process.env, NODE_ENV: 'development', SCRIPT_PROVIDER: 'mock', TTS_PROVIDER: 'local',
  APP_URL: 'http://127.0.0.1:3000', API_URL: 'http://127.0.0.1:3001',
  API_HOST: '127.0.0.1', API_PORT: '3001', PORT: '3001',
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
function launch(label, args, cwd = root) {
  const child = spawn(process.execPath, args, { cwd, env: environment, windowsHide: true, stdio: 'inherit' });
  children.add(child);
  child.once('error', () => { console.error(`${label} could not start.`); stop(1); });
  child.once('exit', (code) => { children.delete(child); if (!stopping) { console.error(`${label} stopped (${code ?? 'signal'}).`); stop(code || 1); } });
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
launch('API', ['--import', 'tsx', 'apps/api/src/main.ts']);
launch('Discovery worker', ['--import', 'tsx', 'workers/discovery/src/main.ts']);
launch('Media worker', ['--import', 'tsx', 'workers/media/src/main.ts']);
launch('Web', ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3000'], path.join(root, 'apps/web'));
console.log('Local export: http://127.0.0.1:3000/export — local speech, deterministic script, no provider API calls. Ctrl+C stops application processes; database data is preserved.');
