import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (!existsSync('.env')) {
  const postgresPassword = randomBytes(24).toString('hex');
  const redisPassword = randomBytes(24).toString('hex');
  const values = {
    NODE_ENV: 'development',
    POSTGRES_USER: 'shorts', POSTGRES_DB: 'shorts_factory', POSTGRES_PASSWORD: postgresPassword,
    REDIS_PASSWORD: redisPassword,
    DATABASE_URL: `postgresql://shorts:${postgresPassword}@localhost:5432/shorts_factory?schema=public`,
    REDIS_URL: `redis://:${redisPassword}@localhost:6379`,
    APP_URL: 'http://localhost:3000', API_URL: 'http://localhost:3001', PORT: '3001',
    STORAGE_PROVIDER: 'local', STORAGE_LOCAL_ROOT: '.data/objects',
    AI_PROVIDER: 'mock', TTS_PROVIDER: 'mock', PUBLISHER_PROVIDER: 'mock',
    ALLOW_REGISTRATION: 'true'
  };
  writeFileSync('.env', Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Created ignored .env with fresh local database/Redis secrets.');
}
if (!process.argv.includes('--env-only')) {
  const result = spawnSync('docker', ['compose', '--env-file', '.env', '-f', 'infrastructure/compose.yaml', 'up', '--build', '--wait', '--wait-timeout', '240', '-d'], { stdio: 'inherit', cwd: root });
  if (result.error) console.error('Docker is required. Start Docker Desktop, then run pnpm local:up again.');
  process.exitCode = result.status ?? 1;
  if (result.status === 0) console.log('Shorts Factory ready: http://localhost:3000. Register a local account to begin.');
}
