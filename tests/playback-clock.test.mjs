import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', b => out += b);
    child.stderr.on('data', b => err += b);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
  });
}

test('concurrent route bundles and workers publish one complete seekable WAV', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'loud-sidecar-'));
  try {
    const uploads = path.join(root, 'uploads');
    await mkdir(uploads);
    const input = path.join(uploads, 'tone.mp3');
    const ffmpeg = path.resolve('node_modules/ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'libmp3lame', input]);
    const moduleUrl = new URL('../lib/playback-clock.ts', import.meta.url).href;
    const worker = `import {seekAccuratePath} from ${JSON.stringify(moduleUrl)}; console.log(await seekAccuratePath(process.argv[1]));`;
    const results = await Promise.all(Array.from({length: 4}, () => run(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', worker, input])));
    const output = input.replace(/\.mp3$/, '.seekable.wav');
    assert.deepEqual(results, Array(4).fill(output));
    const bytes = await readFile(output);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WAV header describes the complete file');
    assert.ok(bytes.length > 400000);
    const [routeA, routeB] = await Promise.all([import(moduleUrl + '?route=A'), import(moduleUrl + '?route=B')]);
    await rm(output);
    assert.deepEqual(await Promise.all([routeA.seekAccuratePath(input), routeB.seekAccuratePath(input)]), [output, output]);
    assert.deepEqual((await readdir(uploads)).sort(), ['tone.mp3','tone.seekable.wav']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
