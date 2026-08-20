import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { __resetAskDepsForTest, __setAskDepsForTest, __test__ as askHelpers } from '../src/commands/ask.js';
import { __resetExecRunnerForTest, __setExecRunnerForTest } from '../src/core/opencli.js';
import { __resetSetupDepsForTest, __setSetupDepsForTest } from '../src/commands/setup.js';

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  __resetAskDepsForTest();
  __resetExecRunnerForTest();
  __resetSetupDepsForTest();
  __resetReadDepsForTest();
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  __resetAskDepsForTest();
  __resetExecRunnerForTest();
  __resetSetupDepsForTest();
  __resetReadDepsForTest();
});

function fakeReadPage(evaluateResult) {
  return {
    bridge: { close: async () => {} },
    page: { evaluate: async () => evaluateResult }
  };
}

function captureStdout() {
  const chunks = [];
  process.stdout.write = (data) => {
    chunks.push(String(data));
    return true;
  };
  return chunks;
}

function captureStderr() {
  const chunks = [];
  process.stderr.write = (data) => {
    chunks.push(String(data));
    return true;
  };
  return chunks;
}

describe('cli', () => {
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

  test('read includes a deep research report entry as markdown', async () => {
    __setReadDepsForTest({
      openChat: async () => fakeReadPage({
        url: 'https://chatgpt.com/c/abc',
        messages: [
          { role: 'user', text: 'Research X', title: '' },
          { role: 'assistant', text: 'One moment.', title: '' },
          { role: 'report', text: '# Report Title\n\nBody text.', title: 'Report Title' }
        ]
      })
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.count).toBe(3);
    expect(output.messages[2]).toEqual({
      role: 'report',
      title: 'Report Title',
      text: '# Report Title\n\nBody text.'
    });
  });

  test('read text format renders a [report] block', async () => {
    __setReadDepsForTest({
      openChat: async () => fakeReadPage({
        url: 'https://chatgpt.com/c/abc',
        messages: [{ role: 'report', text: '# T\n\nBody', title: 'T' }]
      })
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'text']);

    expect(code).toBe(0);
    expect(stdout.join('')).toBe('[report]\n# T\n\nBody\n');
  });

  test('read without a report stays byte-identical to the plain message shape', async () => {
    __setReadDepsForTest({
      openChat: async () => fakeReadPage({
        url: 'https://chatgpt.com/c/abc',
        messages: [
          { role: 'user', text: 'hi', title: '' },
          { role: 'assistant', text: 'hello', title: '' }
        ]
      })
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' }
    ]);
  });

  test('doctor forwards to opencli doctor', async () => {
    const calls = [];
    __setExecRunnerForTest((cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0 };
    });

    const code = await runCli(['doctor', '--sessions', '--no-live']);

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.slice(-3)).toEqual(['doctor', '--sessions', '--no-live']);
  });

  test('setup checks prerequisites and prints guidance', async () => {
    __setSetupDepsForTest({
      runProcess: () => ({ status: 0, stdout: '1.3.5' }),
      pathExists: () => true
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('[OK] Bun available (1.3.5)');
    expect(stdout.join('')).toContain('chatgptcli launch');
  });

  test('setup rejects unknown options', async () => {
    const stderr = captureStderr();
    const code = await runCli(['setup', '--bad']);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('setup does not take options');
  });

  test('missing prompt returns exit 2', async () => {
    const stderr = captureStderr();
    const code = await runCli(['ask']);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('INPUT_INVALID');
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

  async function withStaleMinVersion(fn) {
    const dir = mkdtempSync(join(tmpdir(), 'chatgptcli-minver-cli-'));
    writeFileSync(join(dir, 'min_exe_version.txt'), '9.9.9');
    const savedEnvFile = process.env.CHATGPTCLI_MIN_VERSION_FILE;
    process.env.CHATGPTCLI_MIN_VERSION_FILE = join(dir, 'min_exe_version.txt');

    try {
      await fn();
    } finally {
      if (savedEnvFile === undefined) {
        delete process.env.CHATGPTCLI_MIN_VERSION_FILE;
      } else {
        process.env.CHATGPTCLI_MIN_VERSION_FILE = savedEnvFile;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('command exits 7 with UPDATE_REQUIRED when exe is older than required minimum', async () => {
    await withStaleMinVersion(async () => {
      const stderr = captureStderr();
      const code = await runCli(['ask', 'hello']);

      expect(code).toBe(7);
      expect(stderr.join('')).toContain('UPDATE_REQUIRED');
    });
  });

  test('--version still works when exe is older than required minimum', async () => {
    await withStaleMinVersion(async () => {
      const stdout = captureStdout();
      const code = await runCli(['--version']);

      expect(code).toBe(0);
      expect(stdout.join('')).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});

describe('ask helpers', () => {
  test('recognizes chatgpt hostnames', async () => {
    const fakePage = (url) => ({ evaluate: () => Promise.resolve(url) });
    expect(await askHelpers.isOnChatGpt(fakePage('https://chatgpt.com/'))).toBe(true);
    expect(await askHelpers.isOnChatGpt(fakePage('https://chat.openai.com/'))).toBe(true);
    expect(await askHelpers.isOnChatGpt(fakePage('https://example.com/'))).toBe(false);
  });

  test('picks latest assistant candidate after the baseline', () => {
    const candidate = askHelpers.pickLatestAssistantCandidate(['older', 'Prompt text', 'Assistant final'], 1, 'Prompt text');
    expect(candidate).toBe('Assistant final');
  });

  test('summarizes the strongest surface issue', () => {
    expect(askHelpers.summarizeSurfaceIssue(askHelpers.normalizeSurfaceState({ challengeLike: true }))).toContain('verification');
    expect(askHelpers.summarizeSurfaceIssue(askHelpers.normalizeSurfaceState({ loginLike: true }))).toContain('logged-in ready state');
    expect(askHelpers.summarizeSurfaceIssue(askHelpers.normalizeSurfaceState({ editorFound: false, sendFound: false }))).toContain('editor');
  });
});
