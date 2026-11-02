import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { readFileSync } from 'node:fs';

export const voiceProfileSchema = z.object({
  id: z.string(), name: z.string(), provider: z.enum(['local', 'vieneu', 'openai', 'mock']), language: z.string(), voiceId: z.string(), requiresCredentials: z.boolean(),
}).strict();
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export interface TtsInput { text: string; language: string; voiceId: string; speakingRate: number; referenceAudio?: Buffer }
export interface TtsResult { audio: Buffer; mimeType: 'audio/wav'; durationMs: number; provider: string; voiceId: string; usageUnits: number; estimatedCostUsd: number | null; timingPrecision: 'PROVIDER' | 'APPROXIMATE' }
export interface TtsProvider { readonly id: string; synthesize(input: TtsInput): Promise<TtsResult> }

function waveDurationMs(audio: Uint8Array): number {
  const data = Buffer.from(audio);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('TTS_INVALID_WAV');
  let bytesPerSecond = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const size = data.readUInt32LE(offset + 4);
    if (size > data.length - offset - 8) throw new Error('TTS_INVALID_WAV');
    if (data.toString('ascii', offset, offset + 4) === 'fmt ' && size >= 16) bytesPerSecond = data.readUInt32LE(offset + 16);
    if (data.toString('ascii', offset, offset + 4) === 'data' && bytesPerSecond > 0 && size > 0) return Math.round((size / bytesPerSecond) * 1000);
    offset += 8 + size + (size % 2);
  }
  throw new Error('TTS_INVALID_WAV');
}

function wavHeader(payloadLength: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + payloadLength, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(payloadLength, 40);
  return header;
}

export class MockTtsProvider implements TtsProvider {
  readonly id = 'mock-tone-wave-v2';
  async synthesize(input: TtsInput): Promise<TtsResult> {
    const durationMs = Math.max(1000, Math.round((input.text.trim().split(/\s+/u).length / (150 * input.speakingRate)) * 60_000));
    const sampleRate = 16000;
    const sampleCount = Math.ceil((durationMs / 1000) * sampleRate);
    const payload = Buffer.alloc(sampleCount * 2);
    for (let i = 0; i < sampleCount; i += 1) {
      const time = i / sampleRate;
      const syllable = Math.floor(time * 5) % 5;
      const frequency = 170 + syllable * 31;
      const envelope = Math.min(1, (time % 0.2) * 20, (0.18 - (time % 0.2)) * 20);
      payload.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * time) * Math.max(0, envelope) * 2200), i * 2);
    }
    const audio = Buffer.concat([wavHeader(payload.length, sampleRate), payload]);
    return { audio, mimeType: 'audio/wav', durationMs: waveDurationMs(audio), provider: this.id, voiceId: input.voiceId, usageUnits: input.text.length, estimatedCostUsd: null, timingPrecision: 'APPROXIMATE' };
  }
}

function runProcess(command: string, args: string[], input: string, env: NodeJS.ProcessEnv, errorPrefix = 'TTS_LOCAL'): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timeout = setTimeout(() => child.kill(), 90_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error(`${errorPrefix}_PROVIDER_UNAVAILABLE`)); });
    child.once('close', (code) => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`${errorPrefix}_PROVIDER_FAILED`)); });
    child.stdin.end(input, 'utf8');
  });
}

export class LocalTtsProvider implements TtsProvider {
  get id(): string { return process.platform === 'win32' && this.env.TTS_WSL_DISTRO ? `local-espeak-wsl-wave-v2:${this.env.TTS_WSL_DISTRO}` : 'local-system-wave-v2'; }
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-tts-'));
    const outputPath = path.join(directory, 'speech.wav');
    try {
      if (process.platform === 'win32' && this.env.TTS_WSL_DISTRO) {
        const distro = this.env.TTS_WSL_DISTRO;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(distro)) throw new Error('TTS_LOCAL_WSL_DISTRO_INVALID');
        if (!/^[a-zA-Z]:[\\/]/.test(outputPath)) throw new Error('TTS_LOCAL_WSL_PATH_UNSUPPORTED');
        const linuxPath = `/mnt/${outputPath[0]!.toLowerCase()}${outputPath.slice(2).replaceAll('\\', '/')}`;
        await runProcess('wsl.exe', ['--distribution', distro, '--exec', 'espeak-ng', '-v', input.voiceId, '-s', String(Math.round(165 * input.speakingRate)), '-w', linuxPath, '--stdin'], input.text, this.env, 'TTS_LOCAL_WSL');
      } else if (process.platform === 'win32') {
        const rate = Math.max(-10, Math.min(10, Math.round((input.speakingRate - 1) * 10)));
        const command = "$ErrorActionPreference='Stop'; [Console]::InputEncoding = New-Object System.Text.UTF8Encoding; Add-Type -AssemblyName System.Speech; $text=[Console]::In.ReadToEnd(); $synth=New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.SelectVoice($env:SF_TTS_VOICE); $synth.Rate=[int]$env:SF_TTS_RATE; $synth.SetOutputToWaveFile($env:SF_TTS_OUTPUT); $synth.Speak($text); $synth.Dispose()";
        await runProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], input.text, { ...this.env, SF_TTS_OUTPUT: outputPath, SF_TTS_VOICE: input.voiceId, SF_TTS_RATE: String(rate) });
      } else if (process.platform === 'linux') {
        const rate = Math.round(165 * input.speakingRate);
        await runProcess('espeak-ng', ['-v', input.voiceId, '-s', String(rate), '-w', outputPath, '--stdin'], input.text, this.env);
      } else {
        throw new Error('TTS_LOCAL_PROVIDER_UNAVAILABLE');
      }
      const audio = await readFile(outputPath);
      const durationMs = waveDurationMs(audio);
      const costRate = Number(this.env.TTS_COST_PER_1K_CHARS);
      const estimatedCostUsd = Number.isFinite(costRate) && costRate >= 0 ? (input.text.length / 1000) * costRate : null;
      return { audio, mimeType: 'audio/wav', durationMs, provider: this.id, voiceId: input.voiceId, usageUnits: input.text.length, estimatedCostUsd, timingPrecision: 'APPROXIMATE' };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export class OpenAiTtsProvider implements TtsProvider {
  get id(): string { return `openai-audio-speech:wave-v2:${this.model}`; }
  constructor(private readonly apiKey: string, private readonly model: string, private readonly costPer1kChars: number | null) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    if (input.text.length > 4096) throw new Error('TTS_SEGMENT_TOO_LONG');
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: input.text, voice: input.voiceId, response_format: 'wav', speed: input.speakingRate }),
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'TTS_PROVIDER_RATE_LIMITED' : 'TTS_PROVIDER_REQUEST_FAILED');
    const audio = Buffer.from(await response.arrayBuffer());
    const cost = this.costPer1kChars === null ? null : (input.text.length / 1000) * this.costPer1kChars;
    return { audio, mimeType: 'audio/wav', durationMs: waveDurationMs(audio), provider: this.id, voiceId: input.voiceId, usageUnits: input.text.length, estimatedCostUsd: cost, timingPrecision: 'APPROXIMATE' };
  }
}

const voiceManifestSchema = z.object({ version: z.string().min(1).max(100), voices: z.array(z.object({ voiceId: z.string().min(1).max(80), name: z.string().min(1).max(160) })).max(100) });
function voiceManifest(env: NodeJS.ProcessEnv) {
  if (!env.TTS_VIENEU_VOICES_FILE) throw new Error('TTS_VIENEU_NOT_READY');
  return voiceManifestSchema.parse(JSON.parse(readFileSync(env.TTS_VIENEU_VOICES_FILE, 'utf8')));
}
export function customVoiceProfile(asset: { id: string; kind: string; metadata: unknown; rightsMetadata: unknown }): VoiceProfile | undefined {
  const metadata = z.object({ name: z.string().min(1).max(80), provider: z.literal('vieneu') }).safeParse(asset.metadata);
  const rights = z.object({ attested: z.literal(true), approved: z.literal(true) }).safeParse(asset.rightsMetadata);
  if (asset.kind !== 'VOICE_REFERENCE' || !metadata.success || !rights.success) return undefined;
  return { id: `vieneu:custom:${asset.id}`, name: `${metadata.data.name} · giọng riêng`, provider: 'vieneu', language: 'vi', voiceId: asset.id, requiresCredentials: false };
}
export function validateVoiceReference(audio: Buffer): number {
  if (audio.length > 3000000 || audio.length < 44) throw new Error('VOICE_REFERENCE_INVALID');
  let pcm16 = false;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const size = audio.readUInt32LE(offset + 4);
    if (offset + 8 + size > audio.length) throw new Error('VOICE_REFERENCE_INVALID');
    if (audio.toString('ascii', offset, offset + 4) === 'fmt ' && size >= 16) {
      const channels = audio.readUInt16LE(offset + 10);
      const sampleRate = audio.readUInt32LE(offset + 12);
      pcm16 = audio.readUInt16LE(offset + 8) === 1 && [1, 2].includes(channels) && sampleRate >= 8000 && sampleRate <= 96000 && audio.readUInt16LE(offset + 22) === 16 && audio.readUInt16LE(offset + 20) === channels * 2 && audio.readUInt32LE(offset + 16) === sampleRate * channels * 2;
    }
    offset += 8 + size + size % 2;
  }
  const duration = waveDurationMs(audio);
  if (!pcm16 || duration < 3000 || duration > 15000) throw new Error('VOICE_REFERENCE_INVALID');
  return duration;
}
export class VieneuTtsProvider implements TtsProvider {
  get id() { return `local-vieneu:wave-v2:${voiceManifest(this.env).version}`; }
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async synthesize(input: TtsInput): Promise<TtsResult> {
    const url = new URL(this.env.TTS_LOCAL_URL ?? 'http://127.0.0.1:3002/speech');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/speech' || url.search || url.hash) throw new Error('TTS_LOCAL_URL_INVALID');
    const token = this.env.TTS_LOCAL_TOKEN;
    if (!token || token.length < 32) throw new Error('TTS_PROVIDER_NOT_CONFIGURED');
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: input.text, voiceId: input.voiceId, speakingRate: input.speakingRate, ...(input.referenceAudio ? { referenceAudio: input.referenceAudio.toString('base64') } : {}) }) });
    if (!response.ok) throw new Error('TTS_VIENEU_PROVIDER_FAILED');
    if (!response.headers.get('content-type')?.startsWith('audio/wav')) throw new Error('TTS_INVALID_WAV');
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length > 50000000) throw new Error('TTS_OUTPUT_TOO_LARGE');
    return { audio, mimeType: 'audio/wav', durationMs: waveDurationMs(audio), provider: this.id, voiceId: input.voiceId, usageUnits: input.text.length, estimatedCostUsd: 0, timingPrecision: 'APPROXIMATE' };
  }
}

export function createTtsProvider(env: NodeJS.ProcessEnv = process.env): TtsProvider {
  const provider = env.TTS_PROVIDER ?? 'local';
  if (provider === 'mock') return new MockTtsProvider();
  if (provider === 'local') return new LocalTtsProvider(env);
  if (provider === 'vieneu') return new VieneuTtsProvider(env);
  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY;
    const model = env.TTS_MODEL ?? 'gpt-4o-mini-tts';
    if (!apiKey) throw new Error('TTS_PROVIDER_NOT_CONFIGURED');
    const rate = env.TTS_COST_PER_1K_CHARS;
    const costPer1kChars = rate === undefined || rate === '' ? null : Number(rate);
    if (costPer1kChars !== null && (!Number.isFinite(costPer1kChars) || costPer1kChars < 0)) throw new Error('TTS_COST_CONFIG_INVALID');
    return new OpenAiTtsProvider(apiKey, model, costPer1kChars);
  }
  throw new Error('TTS_PROVIDER_UNSUPPORTED');
}

export function listVoiceProfiles(env: NodeJS.ProcessEnv = process.env): VoiceProfile[] {
  if (env.TTS_PROVIDER === 'vieneu') {
    try { return voiceManifest(env).voices.map((voice) => ({ id: `vieneu:${voice.voiceId}`, name: `${voice.name} · VieNeu local`, provider: 'vieneu' as const, language: 'vi', voiceId: voice.voiceId, requiresCredentials: false })); }
    catch { return []; }
  }
  if (env.TTS_PROVIDER === 'openai') return ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'marin', 'onyx', 'nova', 'sage', 'shimmer'].map((voiceId) => ({ id: `openai:${voiceId}`, name: `OpenAI ${voiceId}`, provider: 'openai', language: 'multilingual', voiceId, requiresCredentials: true }));
  if (env.TTS_PROVIDER === 'mock') return [{ id: 'mock:default', name: 'Deterministic demo tone', provider: 'mock', language: 'multilingual', voiceId: 'demo-tone', requiresCredentials: false }];
  if (process.platform === 'win32' && env.TTS_WSL_DISTRO) return [
    { id: 'local:vietnamese', name: `eSpeak NG Vietnamese (WSL ${env.TTS_WSL_DISTRO})`, provider: 'local', language: 'vi', voiceId: 'vi', requiresCredentials: false },
    { id: 'local:english', name: `eSpeak NG English (WSL ${env.TTS_WSL_DISTRO})`, provider: 'local', language: 'en', voiceId: 'en-us', requiresCredentials: false },
  ];
  if (process.platform === 'win32') return [
    { id: 'local:david', name: 'Microsoft David Desktop', provider: 'local', language: 'en', voiceId: 'Microsoft David Desktop', requiresCredentials: false },
    { id: 'local:zira', name: 'Microsoft Zira Desktop', provider: 'local', language: 'en', voiceId: 'Microsoft Zira Desktop', requiresCredentials: false },
  ];
  if (process.platform === 'linux') return [
    { id: 'local:english', name: 'Local English', provider: 'local', language: 'en', voiceId: 'en-us', requiresCredentials: false },
    { id: 'local:vietnamese', name: 'Local Vietnamese', provider: 'local', language: 'vi', voiceId: 'vi', requiresCredentials: false },
  ];
  return [{ id: 'mock:default', name: 'Deterministic demo tone', provider: 'mock', language: 'multilingual', voiceId: 'demo-tone', requiresCredentials: false }];
}

export function audioCacheKey(input: TtsInput, provider: string): string {
  return createHash('sha256').update(JSON.stringify([provider, input.language, input.voiceId, input.speakingRate, input.text, ...(input.referenceAudio ? [createHash('sha256').update(input.referenceAudio).digest('hex')] : [])])).digest('hex');
}

export { waveDurationMs };
