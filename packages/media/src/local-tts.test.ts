import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalTtsProvider, MockTtsProvider, listVoiceProfiles } from './tts.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(), readFile: vi.fn(), rm: vi.fn() }));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let stdin: ReturnType<typeof vi.fn>;
let exitCode = 0;

beforeEach(async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  vi.stubEnv('TTS_WSL_DISTRO', 'Fixture-Linux');
  exitCode = 0;
  vi.mocked(mkdtemp).mockResolvedValue('D:\\Temp Files\\sf-tts-fixture');
  const audio = await new MockTtsProvider().synthesize({ text: 'Xin chào', language: 'vi', voiceId: 'vi', speakingRate: 1 });
  vi.mocked(readFile).mockResolvedValue(Buffer.from(audio.audio));
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(spawn).mockImplementation(() => {
    const child = new EventEmitter();
    stdin = vi.fn(() => { queueMicrotask(() => child.emit('close', exitCode)); });
    return Object.assign(child, { stdin: { end: stdin }, kill: vi.fn() }) as unknown as ReturnType<typeof spawn>;
  });
});

afterEach(() => { Object.defineProperty(process, 'platform', originalPlatform); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

it('offers free Vietnamese speech in the selected WSL distribution and keeps native Windows opt-in', () => {
  const configured = listVoiceProfiles({ TTS_PROVIDER: 'local', TTS_WSL_DISTRO: 'Fixture-Linux' });
  expect(configured.find((profile) => profile.voiceId === 'vi')).toMatchObject({ language: 'vi', provider: 'local', requiresCredentials: false });
  expect(configured[0]?.name).toContain('Fixture-Linux');
  expect(listVoiceProfiles({ TTS_PROVIDER: 'local' }).map((profile) => profile.id)).toEqual(['local:david', 'local:zira']);
});

it('passes narration through stdin and converts a Windows temp drive into one WSL output argument', async () => {
  const provider = new LocalTtsProvider();
  const result = await provider.synthesize({ text: 'Xin chào; $(không chạy lệnh)', language: 'vi', voiceId: 'vi', speakingRate: 1.2 });
  const invocation = vi.mocked(spawn).mock.calls[0];
  expect(invocation?.[0]).toBe('wsl.exe');
  expect(invocation?.[1]).toEqual(['--distribution', 'Fixture-Linux', '--exec', 'espeak-ng', '-v', 'vi', '-s', '198', '-w', '/mnt/d/Temp Files/sf-tts-fixture/speech.wav', '--stdin']);
  expect(stdin).toHaveBeenCalledWith('Xin chào; $(không chạy lệnh)', 'utf8');
  expect(result).toMatchObject({ mimeType: 'audio/wav', voiceId: 'vi', timingPrecision: 'APPROXIMATE' });
  expect(provider.id).toContain('Fixture-Linux');
  expect(rm).toHaveBeenCalledWith('D:\\Temp Files\\sf-tts-fixture', { recursive: true, force: true });
});

it('rejects UNC temporary directories instead of guessing their Linux mount path', async () => {
  vi.mocked(mkdtemp).mockResolvedValue('\\\\server\\share\\sf-tts-fixture');
  const error = await new LocalTtsProvider().synthesize({ text: 'Xin chào', language: 'vi', voiceId: 'vi', speakingRate: 1 }).then(() => null, (failure: Error) => failure.message);
  expect(error).toBe('TTS_LOCAL_WSL_PATH_UNSUPPORTED');
  expect(spawn).not.toHaveBeenCalled();
});

it('reports a WSL provider error when the distribution or espeak-ng is unavailable', async () => {
  exitCode = 127;
  await expect(new LocalTtsProvider().synthesize({ text: 'Xin chào', language: 'vi', voiceId: 'vi', speakingRate: 1 })).rejects.toThrow('TTS_LOCAL_WSL_PROVIDER_FAILED');
});
