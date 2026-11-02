import { z } from 'zod';
import type { WordTiming } from './alignment.js';

const wordsSchema = z.object({ provider: z.string().min(1).max(200), adjustedWords: z.number().int().nonnegative().max(4000).optional(), words: z.array(z.object({ text: z.string().min(1).max(4000), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict()).min(1).max(4000) }).strict();

/** Private loopback adapter. Raw narration never leaves the local model service. */
export class LocalNarrationProcessor {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private async request(endpoint: 'align' | 'retime' | 'alignment-release', body: Record<string, unknown>) {
    const url = new URL(this.env.TTS_LOCAL_URL ?? 'http://127.0.0.1:3002/speech');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/speech' || url.username || url.password || url.search || url.hash) throw new Error('TTS_LOCAL_URL_INVALID');
    if (!this.env.TTS_LOCAL_TOKEN || this.env.TTS_LOCAL_TOKEN.length < 32) throw new Error('TTS_PROVIDER_NOT_CONFIGURED');
    url.pathname = `/${endpoint}`;
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000), headers: { Authorization: `Bearer ${this.env.TTS_LOCAL_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(endpoint === 'align' ? 'AUDIO_ALIGNMENT_FAILED' : 'AUDIO_RETIME_FAILED');
    return response;
  }

  async retime(audio: Buffer, targetDurationMs: number): Promise<Buffer> {
    const response = await this.request('retime', { audio: audio.toString('base64'), targetDurationMs });
    if (!response.headers.get('content-type')?.startsWith('audio/wav')) throw new Error('TTS_INVALID_WAV');
    const output = Buffer.from(await response.arrayBuffer());
    if (output.length > 50_000_000) throw new Error('TTS_OUTPUT_TOO_LARGE');
    return output;
  }

  async release(): Promise<void> { await this.request('alignment-release', {}); }

  async align(audio: Buffer, text: string, language: string, durationMs: number): Promise<{ provider: string; words: WordTiming[]; adjustedWords?: number }> {
    const response = await this.request('align', { audio: audio.toString('base64'), text, language });
    const result = wordsSchema.parse(await response.json());
    const expected = text.trim().split(/\s+/u);
    if (result.words.length !== expected.length || result.words.some((word, index) => word.text !== expected[index] || word.endMs <= word.startMs || word.endMs > durationMs || word.startMs < (result.words[index - 1]?.endMs ?? 0))) throw new Error('AUDIO_ALIGNMENT_INVALID');
    return result;
  }
}
