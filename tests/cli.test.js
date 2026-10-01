import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { __resetAskDepsForTest, __setAskDepsForTest } from '../src/commands/ask.js';
import { __resetExecRunnerForTest, __setExecRunnerForTest } from '../src/core/opencli.js';
import { __resetSetupDepsForTest, __setSetupDepsForTest } from '../src/commands/setup.js';
import { bindOriginalStdio, captureStderr, captureStdout, restoreStdio } from './test_helpers.js';

const originalStdio = bindOriginalStdio();

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetAskDepsForTest();
  __resetExecRunnerForTest();
  __resetSetupDepsForTest();
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetAskDepsForTest();
  __resetExecRunnerForTest();
  __resetSetupDepsForTest();
});

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

  function bridgeStatus(state, connected, stored) {
    const profiles = connected.map((contextId) => ({ contextId, extensionConnected: true }));
    return async () => ({ stored, health: { state, status: state === 'stopped' ? null : { profiles } } });
  }

  test('setup checks prerequisites and prints guidance', async () => {
    __setSetupDepsForTest({
      runProcess: () => ({ status: 0, stdout: '1.3.5' }),
      pathExists: () => true,
      bridgeStatus: bridgeStatus('stopped', [])
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('[OK] Bun available (1.3.5)');
    expect(stdout.join('')).toContain('chatgptcli launch');
  });

  // The compiled exe bundles the bridge and needs no Bun: the on-disk checks
  // resolve into its virtual filesystem and used to print four false [FAIL]s.
  test('setup in the compiled exe skips the on-disk checks and reports the bridge', async () => {
    __setSetupDepsForTest({
      isCompiled: true,
      runProcess: () => ({ status: 1 }),
      pathExists: () => false,
      bridgeStatus: bridgeStatus('ready', ['abc'])
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('[OK] opencli Browser Bridge: bundled');
    expect(stdout.join('')).toContain('[OK] Browser Bridge connected: abc');
    expect(stdout.join('')).not.toContain('[FAIL]');
    expect(stdout.join('')).not.toContain('Bun available');
    expect(stdout.join('')).not.toContain('bun run');
  });

  test('setup names a stored bridge profile that is no longer connected', async () => {
    __setSetupDepsForTest({ isCompiled: true, bridgeStatus: bridgeStatus('ready', ['abc'], 'old') });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('[OK] Browser Bridge connected: abc (stored default old is not connected)');
    expect(stdout.join('')).toContain('chatgptcli switch-session');
  });

  test('setup fails when the bridge runs but no browser profile is connected', async () => {
    __setSetupDepsForTest({ isCompiled: true, bridgeStatus: bridgeStatus('no-extension', []) });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(6);
    expect(stdout.join('')).toContain('[FAIL] Browser Bridge: no browser profile connected');
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
