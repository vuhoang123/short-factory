import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const voiceProfileSchema = z.object({
  id: z.string(), name: z.string(), provider: z.enum(['local', 'openai', 'mock']), language: z.string(), voiceId: z.string(), requiresCredentials: z.boolean(),
}).strict();
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export interface TtsInput { text: string; language: string; voiceId: string; speakingRate: number }
export interface TtsResult { audio: Buffer; mimeType: 'audio/wav'; durationMs: number; provider: string; voiceId: string; usageUnits: number; estimatedCostUsd: number | null; timingPrecision: 'PROVIDER' | 'APPROXIMATE' }
export interface TtsProvider { readonly id: string; synthesize(input: TtsInput): Promise<TtsResult> }

function waveDurationMs(audio: Uint8Array): number {
  const data = Buffer.from(audio);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('TTS_INVALID_WAV');
  let bytesPerSecond = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const size = data.readUInt32LE(offset + 4);
    if (data.toString('ascii', offset, offset + 4) === 'fmt ' && size >= 16) bytesPerSecond = data.readUInt32LE(offset + 12);
    if (data.toString('ascii', offset, offset + 4) === 'data' && bytesPerSecond > 0) return Math.round((size / bytesPerSecond) * 1000);
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
  readonly id = 'mock-tone-v1';
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

function runProcess(command: string, args: string[], input: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timeout = setTimeout(() => child.kill(), 90_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('TTS_LOCAL_PROVIDER_UNAVAILABLE')); });
    child.once('close', (code) => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error('TTS_LOCAL_PROVIDER_FAILED')); });
    child.stdin.end(input, 'utf8');
  });
}

export class LocalTtsProvider implements TtsProvider {
  readonly id = 'local-system-v1';

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-tts-'));
    const outputPath = path.join(directory, 'speech.wav');
    try {
      if (process.platform === 'win32') {
        const rate = Math.max(-10, Math.min(10, Math.round((input.speakingRate - 1) * 10)));
        const command = "$ErrorActionPreference='Stop'; [Console]::InputEncoding = New-Object System.Text.UTF8Encoding; Add-Type -AssemblyName System.Speech; $text=[Console]::In.ReadToEnd(); $synth=New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.SelectVoice($env:SF_TTS_VOICE); $synth.Rate=[int]$env:SF_TTS_RATE; $synth.SetOutputToWaveFile($env:SF_TTS_OUTPUT); $synth.Speak($text); $synth.Dispose()";
        await runProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], input.text, { ...process.env, SF_TTS_OUTPUT: outputPath, SF_TTS_VOICE: input.voiceId, SF_TTS_RATE: String(rate) });
      } else if (process.platform === 'linux') {
        const rate = Math.round(165 * input.speakingRate);
        await runProcess('espeak-ng', ['-v', input.voiceId, '-s', String(rate), '-w', outputPath, '--stdin'], input.text, process.env);
      } else {
        throw new Error('TTS_LOCAL_PROVIDER_UNAVAILABLE');
      }
      const audio = await readFile(outputPath);
      const durationMs = waveDurationMs(audio);
      const costRate = Number(process.env.TTS_COST_PER_1K_CHARS);
      const estimatedCostUsd = Number.isFinite(costRate) && costRate >= 0 ? (input.text.length / 1000) * costRate : null;
      return { audio, mimeType: 'audio/wav', durationMs, provider: this.id, voiceId: input.voiceId, usageUnits: input.text.length, estimatedCostUsd, timingPrecision: 'APPROXIMATE' };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export class OpenAiTtsProvider implements TtsProvider {
  readonly id = 'openai-audio-speech';
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
    return { audio, mimeType: 'audio/wav', durationMs: waveDurationMs(audio), provider: `${this.id}:${this.model}`, voiceId: input.voiceId, usageUnits: input.text.length, estimatedCostUsd: cost, timingPrecision: 'APPROXIMATE' };
  }
}

export function createTtsProvider(env: NodeJS.ProcessEnv = process.env): TtsProvider {
  const provider = env.TTS_PROVIDER ?? 'local';
  if (provider === 'mock') return new MockTtsProvider();
  if (provider === 'local') return new LocalTtsProvider();
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
  if (env.TTS_PROVIDER === 'openai') return ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'marin', 'onyx', 'nova', 'sage', 'shimmer'].map((voiceId) => ({ id: `openai:${voiceId}`, name: `OpenAI ${voiceId}`, provider: 'openai', language: 'multilingual', voiceId, requiresCredentials: true }));
  if (env.TTS_PROVIDER === 'mock') return [{ id: 'mock:default', name: 'Deterministic demo tone', provider: 'mock', language: 'multilingual', voiceId: 'demo-tone', requiresCredentials: false }];
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
  return createHash('sha256').update(JSON.stringify([provider, input.language, input.voiceId, input.speakingRate, input.text])).digest('hex');
}

export { waveDurationMs };
