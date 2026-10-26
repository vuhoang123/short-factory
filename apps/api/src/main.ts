import { createApp } from './app.js';

const app = await createApp();
app.enableShutdownHooks();
await app.listen(Number(process.env.API_PORT ?? '3001'), process.env.API_HOST ?? '127.0.0.1');
process.stdout.write(`${JSON.stringify({ level: 'info', service: 'api', port: Number(process.env.API_PORT ?? '3001') })}\n`);
