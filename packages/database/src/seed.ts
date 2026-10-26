import { randomBytes, scrypt } from 'node:crypto';
import { PrismaClient } from './index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required. Copy .env.example to .env first.');
let databaseHost: string;
try {
  databaseHost = new URL(databaseUrl).hostname;
} catch {
  throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
}
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(databaseHost)) {
  throw new Error('Demo seed is restricted to a local development database.');
}

const db = new PrismaClient();

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function main(): Promise<void> {
  const email = 'owner@shorts.local';
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.info('Demo account already exists; its password was not changed.');
    return;
  }
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 128) {
    throw new Error('Set a private SEED_DEMO_PASSWORD of at least 12 characters and at most 128 UTF-8 bytes.');
  }

  const hash = await passwordHash(password);
  await db.$transaction(async (tx) => {
    const owner = await tx.user.create({ data: { email, name: 'Local operator', passwordHash: hash } });
    const workspace = await tx.workspace.create({
      data: {
        slug: 'local-studio',
        name: 'Local Studio',
        timezone: 'Asia/Ho_Chi_Minh',
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const channel = await tx.contentChannel.create({
      data: {
        workspaceId: workspace.id,
        name: 'Editorial desk',
        language: 'vi',
        topicConfig: { keywords: [], allow: [], deny: [] },
        automationConfig: { enabled: false },
      },
    });
    await tx.sourceConfig.create({
      data: {
        workspaceId: workspace.id,
        channelId: channel.id,
        platform: 'MANUAL',
        sourceKey: 'local-manual',
        config: {},
        enabled: true,
        capabilityStatus: 'AVAILABLE',
      },
    });
    await tx.auditLog.create({
      data: { workspaceId: workspace.id, actorId: owner.id, action: 'DEMO_SEEDED', resourceType: 'Workspace', resourceId: workspace.id },
    });
  });
  console.info(`Local demo login: ${email}`);
  console.info('Use your supplied SEED_DEMO_PASSWORD. No posts, rights approvals or publications were created.');
}

try {
  await main();
} catch {
  console.error('Demo seed failed. Check the local database, applied migrations and a private SEED_DEMO_PASSWORD of 12 characters to 128 UTF-8 bytes.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
