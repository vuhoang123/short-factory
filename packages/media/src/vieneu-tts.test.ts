import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { MockTtsProvider, VieneuTtsProvider, audioCacheKey, customVoiceProfile, listVoiceProfiles, validateVoiceReference } from './tts.js';

afterEach(() => { vi.unstubAllGlobals(); });
async function audio() { return (await new MockTtsProvider().synthesize({ text: 'Một hai ba bốn năm sáu bảy tám chín mười.', language: 'vi', voiceId: 'demo', speakingRate: 1 })).audio; }

it('validates bounded PCM16 voice references and rejects invalid or too short WAVs', async () => {
  const valid = await audio();
  expect(validateVoiceReference(valid)).toBeGreaterThanOrEqual(3000);
  expect(() => validateVoiceReference(Buffer.from('not wave'))).toThrow();
  const short = (await new MockTtsProvider().synthesize({ text: 'one', language: 'vi', voiceId: 'demo', speakingRate: 1 })).audio;
  expect(() => validateVoiceReference(short)).toThrow();
  const corrupt = Buffer.from(valid); corrupt.writeUInt32LE(0xffffffff, 16);
  expect(() => validateVoiceReference(corrupt)).toThrow();
  const invalidRate = Buffer.from(valid); invalidRate.writeUInt32LE(0, 24);
  expect(() => validateVoiceReference(invalidRate)).toThrow();
});
it('does not expose custom voice profiles without the right media kind and speaker attestation', () => {
  const asset = { id: 'reference', kind: 'VOICE_REFERENCE', metadata: { name: 'My voice', provider: 'vieneu' }, rightsMetadata: { attested: true, approved: true } };
  expect(customVoiceProfile(asset)?.id).toBe('vieneu:custom:reference');
  expect(customVoiceProfile({ ...asset, kind: 'AUDIO' })).toBeUndefined();
  expect(customVoiceProfile({ ...asset, rightsMetadata: {} })).toBeUndefined();
});
it('uses private loopback speech, validates output and keys cached audio by model and reference', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-vieneu-test-'));
  try {
    const manifest = path.join(directory, 'voices.json');
    await writeFile(manifest, JSON.stringify({ version: 'pinned-v3', voices: [{ name: 'Narrator', voiceId: 'narrator' }] }));
    const env = { TTS_PROVIDER: 'vieneu', TTS_VIENEU_VOICES_FILE: manifest, TTS_LOCAL_TOKEN: 'test-only-not-a-secret-0000000000000' };
    expect(listVoiceProfiles(env)[0]?.requiresCredentials).toBe(false);
    const reference = await audio();
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(reference), { headers: { 'Content-Type': 'audio/wav' } }));
    vi.stubGlobal('fetch', fetch);
    const input = { text: 'Xin chào', language: 'vi', voiceId: 'narrator', speakingRate: 1, referenceAudio: reference };
    const provider = new VieneuTtsProvider(env);
    expect((await provider.synthesize(input)).provider).toBe('local-vieneu:wave-v2:pinned-v3');
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ hostname: '127.0.0.1' }), expect.objectContaining({ redirect: 'error' }));
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string).referenceAudio).toBe(reference.toString('base64'));
    expect(audioCacheKey(input, provider.id)).not.toBe(audioCacheKey({ ...input, referenceAudio: undefined }, provider.id));
    await expect(new VieneuTtsProvider({ ...env, TTS_LOCAL_URL: 'https://external.example/speech' }).synthesize(input)).rejects.toThrow('TTS_LOCAL_URL_INVALID');
    fetch.mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    await expect(provider.synthesize(input)).rejects.toThrow('TTS_INVALID_WAV');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
