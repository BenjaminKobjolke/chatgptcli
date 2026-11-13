import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { __resetExecRunnerForTest, __setExecRunnerForTest } from '../src/core/opencli.js';
import { __resetSetupDepsForTest, __setSetupDepsForTest } from '../src/commands/setup.js';
import { bindOriginalStdio, captureStderr, captureStdout, restoreStdio } from './test_helpers.js';

const originalStdio = bindOriginalStdio();

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetExecRunnerForTest();
  __resetSetupDepsForTest();
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetExecRunnerForTest();
  __resetSetupDepsForTest();
});

describe('cli', () => {
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

  function bridgeStatusSequence(...statuses) {
    let index = 0;
    return async () => statuses[Math.min(index++, statuses.length - 1)];
  }

  const loggedInCheck = async () => ({ loggedIn: true, profile: 'abc' });

  test('setup checks prerequisites and prints guidance', async () => {
    __setSetupDepsForTest({
      runProcess: () => ({ status: 0, stdout: '1.3.5' }),
      pathExists: () => true,
      bridgeStatus: bridgeStatusSequence(
        { stored: '', health: { state: 'stopped', status: null } },
        { stored: '', health: { state: 'ready', status: { profiles: [{ contextId: 'abc', extensionConnected: true }] } } }
      ),
      startBridge: async () => {},
      chatgptLoginCheck: loggedInCheck
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('[OK] Bun available (1.3.5)');
    expect(stdout.join('')).toContain('chatgptcli launch');
  });

  test('setup starts a stopped bridge and reports its connected profile', async () => {
    const startCalls = [];
    __setSetupDepsForTest({
      isCompiled: true,
      bridgeStatus: bridgeStatusSequence(
        { stored: 'abc', health: { state: 'stopped', status: null } },
        { stored: 'abc', health: { state: 'ready', status: { profiles: [{ contextId: 'abc', extensionConnected: true }] } } }
      ),
      startBridge: async (stored) => startCalls.push(stored),
      chatgptLoginCheck: loggedInCheck
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('[OK] Browser Bridge connected: abc');
    expect(startCalls).toEqual(['abc']);
  });

  test('setup reports a missing extension after starting a stopped bridge', async () => {
    __setSetupDepsForTest({
      isCompiled: true,
      bridgeStatus: bridgeStatusSequence(
        { stored: '', health: { state: 'stopped', status: null } },
        { stored: '', health: { state: 'no-extension', status: { profiles: [] } } }
      ),
      startBridge: async () => {}
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(6);
    expect(stdout.join('')).toContain('[FAIL] Browser Bridge: no browser profile connected');
  });

  test('setup reports when the stopped bridge could not be started', async () => {
    __setSetupDepsForTest({
      isCompiled: true,
      bridgeStatus: bridgeStatus('stopped', []),
      startBridge: async () => { throw new Error('bridge start failed'); }
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(6);
    expect(stdout.join('')).toContain('[FAIL] Browser Bridge daemon could not be started');
  });

  test('setup does not start a bridge that is already ready', async () => {
    let startCalls = 0;
    __setSetupDepsForTest({
      isCompiled: true,
      bridgeStatus: bridgeStatus('ready', ['abc']),
      startBridge: async () => { startCalls += 1; },
      chatgptLoginCheck: loggedInCheck
    });

    const code = await runCli(['setup']);

    expect(code).toBe(0);
    expect(startCalls).toBe(0);
  });

  // The compiled exe bundles the bridge and needs no Bun: the on-disk checks
  // resolve into its virtual filesystem and used to print four false [FAIL]s.
  test('setup in the compiled exe skips the on-disk checks and reports the bridge', async () => {
    __setSetupDepsForTest({
      isCompiled: true,
      runProcess: () => ({ status: 1 }),
      pathExists: () => false,
      bridgeStatus: bridgeStatus('ready', ['abc']),
      chatgptLoginCheck: loggedInCheck
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
    __setSetupDepsForTest({ isCompiled: true, bridgeStatus: bridgeStatus('ready', ['abc'], 'old'), chatgptLoginCheck: loggedInCheck });

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

  test('setup reports the ChatGPT login state after the bridge connects', async () => {
    __setSetupDepsForTest({
      isCompiled: true,
      bridgeStatus: bridgeStatus('ready', ['abc'], 'abc'),
      chatgptLoginCheck: async () => ({ loggedIn: true, profile: 'abc' })
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('[OK] ChatGPT logged in (profile abc)');
  });

  test('setup reports when ChatGPT is logged out', async () => {
    __setSetupDepsForTest({
      isCompiled: true,
      bridgeStatus: bridgeStatus('ready', ['abc'], 'abc'),
      chatgptLoginCheck: async () => ({ loggedIn: false, profile: 'abc' })
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(6);
    expect(stdout.join('')).toContain('[FAIL] ChatGPT is not logged in in the bridge browser (profile abc)');
    expect(stdout.join('')).toContain('Log in at https://chatgpt.com/ in the bridge browser window');
  });

  test('setup reports when ChatGPT login state is unknown', async () => {
    __setSetupDepsForTest({
      isCompiled: true,
      bridgeStatus: bridgeStatus('ready', ['abc'], 'abc'),
      chatgptLoginCheck: async () => ({ loggedIn: null, profile: 'abc', reason: 'session fetch failed' })
    });

    const stdout = captureStdout();
    const code = await runCli(['setup']);

    expect(code).toBe(6);
    expect(stdout.join('')).toContain('[FAIL] ChatGPT login state could not be checked: session fetch failed');
    expect(stdout.join('')).toContain('Open https://chatgpt.com/ in the bridge browser and rerun setup');
  });

  test('setup rejects unknown options', async () => {
    const stderr = captureStderr();
    const code = await runCli(['setup', '--bad']);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('setup does not take options');
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
