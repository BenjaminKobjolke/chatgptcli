import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { __resetAskDepsForTest, __setAskDepsForTest } from '../src/commands/ask.js';
import { bindOriginalStdio, captureStderr, captureStdout, restoreStdio } from './test_helpers.js';

const originalStdio = bindOriginalStdio();

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetAskDepsForTest();
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetAskDepsForTest();
});

describe('cli ask', () => {
  test('ask returns structured success output', async () => {
    __setAskDepsForTest({
      browserAskRunner: async () => ({ response: 'OK' }),
      sleep: async () => {}
    });

    const stdout = captureStdout();
    const code = await runCli(['ask', 'hello world', '--new', '--timeout', '90', '--max-attempts', '3', '-f', 'json']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('"ok": true');
    expect(stdout.join('')).toContain('"response": "OK"');
    expect(stdout.join('')).toContain('"mode": "fresh-chat"');
  });

  test('ask retries blocked result and succeeds on second attempt', async () => {
    const calls = [];
    __setAskDepsForTest({
      browserAskRunner: async (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return { response: '[BLOCKED] ChatGPT page is not ready.' };
        }
        return { response: 'final answer' };
      },
      sleep: async () => {}
    });

    const stdout = captureStdout();
    const code = await runCli(['ask', 'hello', '--retry-delay-ms', '0', '-f', 'json']);

    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0].newChat).toBe(false);
    expect(calls[1].newChat).toBe(true);
    expect(stdout.join('')).toContain('"attempts": 2');
    expect(stdout.join('')).toContain('"status": "retry"');
    expect(stdout.join('')).toContain('"status": "success"');
  });

  test('missing prompt returns exit 2', async () => {
    const stderr = captureStderr();
    const code = await runCli(['ask']);

    expect(code).toBe(2);
    expect(stderr.join('')).toBe('INPUT_INVALID: Missing prompt\nHint: Usage: chatgptcli ask "your prompt"\n');
  });

  test('ask --file inlines the file content into the prompt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatgptcli-test-'));
    const filePath = join(dir, 'notes.md');
    writeFileSync(filePath, '# My Notes\nSome content here.', 'utf8');

    const prompts = [];
    __setAskDepsForTest({
      browserAskRunner: async (input) => {
        prompts.push(input.prompt);
        return { response: 'OK' };
      },
      sleep: async () => {}
    });

    try {
      const code = await runCli(['ask', 'What do you think?', '--file', filePath, '-f', 'json']);

      expect(code).toBe(0);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('What do you think?');
      expect(prompts[0]).toContain('--- FILE: notes.md ---');
      expect(prompts[0]).toContain('# My Notes\nSome content here.');
      expect(prompts[0]).toContain('--- END FILE ---');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ask --file with missing file returns exit 2', async () => {
    const stderr = captureStderr();
    const code = await runCli(['ask', 'hello', '--file', 'no-such-file.txt']);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('INPUT_INVALID');
    expect(stderr.join('')).toContain('File not found');
  });

  test('invalid format returns exit 2', async () => {
    const stderr = captureStderr();
    const code = await runCli(['ask', 'hello', '-f', 'yaml']);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unsupported format');
  });
});
