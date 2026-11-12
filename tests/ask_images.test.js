import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { __resetAskDepsForTest, __setAskDepsForTest } from '../src/commands/ask.js';
import { bindOriginalStdio, captureStderr, restoreStdio } from './test_helpers.js';

const tempDirs = [];
const originalStdio = bindOriginalStdio();

afterEach(() => {
  restoreStdio(originalStdio);
  __resetAskDepsForTest();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function imageFiles(count = 1, extension = '.png') {
  const dir = mkdtempSync(join(tmpdir(), 'chatgptcli-ask-images-'));
  tempDirs.push(dir);
  return Array.from({ length: count }, (_, index) => {
    const path = join(dir, `image-${index}${extension}`);
    writeFileSync(path, 'image');
    return path;
  });
}

async function runAsk(args, runner = async () => ({ response: 'OK' })) {
  const calls = [];
  __setAskDepsForTest({
    browserAskRunner: async (input) => { calls.push(input); return runner(input); },
    sleep: async () => {}
  });
  restoreStdio(originalStdio);
  const chunks = captureStderr();
  try {
    const code = await runCli(['ask', ...args, '-f', 'json']);
    return { code, stderr: chunks.join(''), calls };
  } finally {
    restoreStdio(originalStdio);
  }
}

describe('ask image arguments', () => {
  test('passes repeated image paths to the browser in order', async () => {
    const [first, second] = imageFiles(2);
    const result = await runAsk(['Review these', '--image', first, '--image', second]);
    expect(result.code).toBe(0);
    expect(result.calls[0].images).toEqual([first, second]);
  });

  test('rejects --image without a value', async () => {
    const result = await runAsk(['Review these', '--image']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Missing value for --image');
  });

  test('rejects a missing image', async () => {
    const result = await runAsk(['Review these', '--image', 'missing.png']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('INPUT_INVALID: Image not found: missing.png');
  });

  test('rejects a directory as an image', async () => {
    const [path] = imageFiles();
    const result = await runAsk(['Review these', '--image', tempDirs.at(-1)]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Image not found');
    expect(path).toBeTruthy();
  });

  test('rejects unsupported image extensions with the supported types', async () => {
    for (const extension of ['.bmp', '.svg']) {
      const [path] = imageFiles(1, extension);
      const result = await runAsk(['Review these', '--image', path]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(path);
      expect(result.stderr).toContain('.png');
      expect(result.stderr).toContain('.gif');
    }
  });

  test('rejects more than ten images', async () => {
    const paths = imageFiles(11);
    const result = await runAsk(['Review these', ...paths.flatMap((path) => ['--image', path])]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Too many images');
  });

  test('rejects an image over 20 MB', async () => {
    const [path] = imageFiles();
    writeFileSync(path, Buffer.alloc(20 * 1024 * 1024 + 1));
    const result = await runAsk(['Review these', '--image', path]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Image too large');
  });

  test('rejects an image passed through --file', async () => {
    for (const extension of ['.PNG', '.bmp', '.svg']) {
      const [path] = imageFiles(1, extension);
      const result = await runAsk(['Review these', '--file', path]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('Attach images with --image');
    }
  });

  test('passes an empty image list when no images are provided', async () => {
    const result = await runAsk(['Hello']);
    expect(result.code).toBe(0);
    expect(result.calls[0].images).toEqual([]);
  });
});
