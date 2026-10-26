import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '../packages/database/src/index';

if (existsSync('.env')) process.loadEnvFile('.env');
const databaseUrl = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '');
if (!process.env.TEST_DATABASE_URL) databaseUrl.pathname = '/shorts_factory_test';
if (!databaseUrl.pathname.endsWith('_test')) throw new Error('Integration tests require a dedicated database ending in _test');
const testDatabase = databaseUrl.pathname.slice(1);
if (!/^[a-zA-Z][a-zA-Z0-9_]*_test$/.test(testDatabase)) throw new Error('Invalid test database name');
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString(), log: [] });
try {
  const rows = await admin.$queryRaw<Array<{ datname: string }>>`SELECT datname FROM pg_database WHERE datname = ${testDatabase}`;
  if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${testDatabase}"`);
} finally { await admin.$disconnect(); }
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl.toString(), TEST_DATABASE_URL: databaseUrl.toString(), APP_URL: 'http://localhost:3000' };
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
for (const args of [['db:deploy'], ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts']]) {
  const result = spawnSync(pnpmCommand, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
