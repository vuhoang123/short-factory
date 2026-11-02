import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.data', 'tts-vieneu', '.venv');
const python = path.join(directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
mkdirSync(path.dirname(directory), { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Local TTS setup failed. Read the installer error above.');
}
if (!existsSync(python)) run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', directory]);
run(python, ['-m', 'pip', 'install', '-r', path.join(root, 'scripts', 'requirements-tts.txt')]);
console.log('VieNeu installed in an isolated local environment. Run pnpm local:export to load the model and voices. No API subscription is required.');
