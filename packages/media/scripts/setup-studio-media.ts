import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { prepareStudioMedia } from '../src/media-upload.js';
import { curatedMediaEntrySchema } from '../src/curated-media.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.chdir(root);
const directory = path.resolve(process.env.STUDIO_MEDIA_ROOT ?? '.data/studio-media');
const sourcesDir = path.join(directory, 'sources');
await mkdir(sourcesDir, { recursive: true });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const filename = z.string().regex(/^[a-z0-9-]+\.(zip|mp3|ogg|wav|png)$/);
const plan = z.object({ version: z.literal(1), license: z.literal('CC0-1.0'), licenseUrl: z.literal('https://creativecommons.org/publicdomain/zero/1.0/'), verifiedAt: z.string().date(),
  sources: z.array(z.object({ key: filename, url: z.string().url().startsWith('https://opengameart.org/sites/default/files/'), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  assets: z.array(z.object({ key: z.string().regex(/^[a-z0-9-]+$/), kind: z.enum(['BACKGROUND', 'MUSIC']), name: z.string(), category: z.string(), artist: z.string(), description: z.string(), sourceUrl: z.string().url(), source: filename, member: z.string().max(250).optional() }).strict()),
}).strict().parse(JSON.parse(await readFile(path.join(root, 'assets/studio-starter/sources.json'), 'utf8')));
const require = createRequire(new URL('../package.json', import.meta.url));
const { RenderInternals } = require('@remotion/renderer') as typeof import('@remotion/renderer');
const ffmpeg = RenderInternals.getExecutablePath({ type: 'ffmpeg', logLevel: 'error', indent: false, binariesDirectory: null });
const python = process.env.TTS_VIENEU_PYTHON ?? (existsSync('.data/tts-vieneu/.venv/Scripts/python.exe') ? path.resolve('.data/tts-vieneu/.venv/Scripts/python.exe') : 'python');
function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 90000 });
  if (result.status !== 0) throw new Error(`MEDIA_SETUP_FAILED: ${result.error?.message ?? result.stderr.slice(-1500)}`);
}
async function animate(input: string, output: string) {
  const image = sharp(await readFile(input)); const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('BACKGROUND_DIMENSIONS_MISSING');
  const child = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', '24', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '25', '-threads', '2', '-movflags', '+faststart', output], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
  const completion = once(child, 'close');
  child.stdin.on('error', () => undefined);
  const timeout = setTimeout(() => child.kill(), 90000);
  try {
    for (let frame = 0; frame < 192; frame++) {
      if (child.exitCode !== null || child.stdin.destroyed) throw new Error('BACKGROUND_ENCODER_STOPPED: ' + stderr);
      const zoom = 1.04 + 0.02 * Math.sin(frame * Math.PI / 96);
      const height = Math.floor(meta.height / zoom), width = Math.floor(height * 9 / 16);
      const bytes = await image.clone().extract({ left: Math.floor((meta.width - width) / 2), top: Math.floor((meta.height - height) / 2), width, height }).resize(720, 1280).removeAlpha().png({ compressionLevel: 1 }).toBuffer();
      if (!child.stdin.write(bytes)) await Promise.race([once(child.stdin, 'drain'), completion.then(() => { throw new Error('BACKGROUND_ENCODER_STOPPED: ' + stderr); })]);
    }
    child.stdin.end(); const [code] = await completion;
    if (code !== 0) throw new Error('BACKGROUND_ENCODING_FAILED: ' + stderr);
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); }
}
function normalizeMusic(bytes: Buffer) {
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw new Error('WAV_CHUNK_INVALID');
    if (bytes.toString('ascii', offset, offset + 4) === 'data') {
      let sum = 0, peak = 0;
      for (let i = start; i + 2 <= start + size; i += 2) { const sample = bytes.readInt16LE(i) / 32768; sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      const gain = peak ? Math.min(0.0794 / Math.sqrt(sum / (size / 2)), 0.75 / peak) : 1;
      for (let i = 0; i + 2 <= size; i += 2) { const fade = Math.min(1, i / (44100 * 4 * 0.35), (size - i) / (44100 * 4 * 0.35)); bytes.writeInt16LE(Math.round(bytes.readInt16LE(start + i) * gain * fade), start + i); }
      return bytes;
    }
    offset = start + size + size % 2;
  }
  throw new Error('WAV_DATA_MISSING');
}
for (const source of plan.sources) {
  const target = path.join(sourcesDir, source.key);
  if (!existsSync(target)) {
    console.log(`Downloading ${source.key}`);
    const response = await fetch(source.url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 120 * 1024 * 1024) throw new Error('MEDIA_SOURCE_DOWNLOAD_FAILED');
    const chunks: Uint8Array[] = []; let size = 0;
    if (!response.body) throw new Error('MEDIA_SOURCE_EMPTY');
    const reader = response.body.getReader();
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 120 * 1024 * 1024) { await reader.cancel(); throw new Error('MEDIA_SOURCE_TOO_LARGE'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    if (hash(bytes) !== source.sha256) throw new Error(`MEDIA_SOURCE_CHANGED: ${source.key}`);
    await writeFile(target + '.tmp', bytes); await rename(target + '.tmp', target);
  }
  if (hash(await readFile(target)) !== source.sha256) throw new Error(`MEDIA_SOURCE_CHANGED: ${source.key}`);
}
const items: z.infer<typeof curatedMediaEntrySchema>[] = [];
const previous = existsSync(path.join(directory, 'catalog.json'))
  ? z.object({ version: z.literal(1), items: z.array(curatedMediaEntrySchema) }).parse(JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'))).items : [];
for (const asset of plan.assets) {
  let input = path.join(sourcesDir, asset.source);
  if (asset.member) {
    input = path.join(sourcesDir, asset.key + '.mp3');
    run(python, ['-c', 'import sys,zipfile,pathlib\nwith zipfile.ZipFile(sys.argv[1]) as z:\n info=z.getinfo(sys.argv[2])\n if info.file_size>20000000: raise ValueError("entry too large")\n pathlib.Path(sys.argv[3]).write_bytes(z.read(info))', path.join(sourcesDir, asset.source), asset.member, input]);
  }
  const file = asset.key + (asset.kind === 'BACKGROUND' ? '.mp4' : '.wav');
  const output = path.join(directory, file);
  const prior = previous.find(item => item.key === asset.key && item.sourceUrl === asset.sourceUrl);
  const cached = Boolean(prior && existsSync(output) && statSync(output).size >= 100 && hash(await readFile(output)) === prior.file.checksum);
  const working = cached ? output : path.join(directory, `${asset.key}-working${path.extname(file)}`);
  if (!cached) {
    if (asset.kind === 'BACKGROUND') await animate(input, working);
    else { run(ffmpeg, ['-y', '-i', input, '-t', '60', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', working]); await writeFile(working, normalizeMusic(await readFile(working))); }
  }
  const bytes = await readFile(working);
  const prepared = await prepareStudioMedia(bytes, asset.kind, asset.kind === 'BACKGROUND' ? 'video/mp4' : 'audio/wav');
  if (!cached) await rename(working, output);
  let thumbnail: { file: string; checksum: string } | undefined;
  if (asset.kind === 'BACKGROUND') {
    const file = asset.key + '-thumb.png';
    await sharp(input).resize(180, 320, { fit: 'cover' }).png().toFile(path.join(directory, file));
    thumbnail = { file, checksum: hash(await readFile(path.join(directory, file))) };
  }
  items.push(curatedMediaEntrySchema.parse({ key: asset.key, kind: asset.kind, name: asset.name, category: asset.category, artist: asset.artist, description: asset.description,
    sourceUrl: asset.sourceUrl, license: plan.license, licenseUrl: plan.licenseUrl, verifiedAt: plan.verifiedAt, mimeType: prepared.mimeType, durationMs: prepared.durationMs,
    file: { file, checksum: hash(bytes) }, ...(thumbnail ? { thumbnail } : {}) }));
  console.log(`Ready: ${asset.name}`);
}
await writeFile(path.join(directory, 'catalog.json.tmp'), JSON.stringify({ version: 1, items }, null, 2) + '\n');
await rename(path.join(directory, 'catalog.json.tmp'), path.join(directory, 'catalog.json'));
console.log(`Studio starter library ready: ${items.filter(i => i.kind === 'BACKGROUND').length} backgrounds, ${items.filter(i => i.kind === 'MUSIC').length} music tracks.`);
