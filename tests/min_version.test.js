import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMinVersion, __test__ } from '../src/core/min_version.js';

const { compareSemver } = __test__;

const ENV_VAR = 'CHATGPTCLI_MIN_VERSION_FILE';
let tempDir;
let savedEnvFile;
let savedPluginRoot;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'chatgptcli-minver-'));
  savedEnvFile = process.env[ENV_VAR];
  savedPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  delete process.env.CLAUDE_PLUGIN_ROOT;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  if (savedEnvFile === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = savedEnvFile;
  }
  if (savedPluginRoot === undefined) {
    delete process.env.CLAUDE_PLUGIN_ROOT;
  } else {
    process.env.CLAUDE_PLUGIN_ROOT = savedPluginRoot;
  }
});

function writeMinVersionFile(content) {
  const filePath = join(tempDir, 'min_exe_version.txt');
  writeFileSync(filePath, content);
  process.env[ENV_VAR] = filePath;
  return filePath;
}

describe('compareSemver', () => {
  test('orders older, equal, and newer versions', () => {
    expect(compareSemver('0.1.0', '0.1.1')).toBeLessThan(0);
    expect(compareSemver('0.1.1', '0.1.1')).toBe(0);
    expect(compareSemver('0.2.0', '0.1.9')).toBeGreaterThan(0);
  });

  test('compares segments numerically, not lexically', () => {
    expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });
});

describe('checkMinVersion', () => {
  test('returns update message when current version is older', () => {
    writeMinVersionFile('9.9.9\n');

    const message = checkMinVersion('0.1.1');

    expect(message).toContain('UPDATE_REQUIRED');
    expect(message).toContain('0.1.1');
    expect(message).toContain('9.9.9');
    expect(message).toContain('taskkill /im chatgptcli.exe /f');
    expect(message).toContain('releases/latest/download/chatgptcli.exe');
  });

  test('returns null when current version equals the minimum', () => {
    writeMinVersionFile('0.1.1');
    expect(checkMinVersion('0.1.1')).toBeNull();
  });

  test('returns null when current version is newer than the minimum', () => {
    writeMinVersionFile('0.1.1');
    expect(checkMinVersion('0.2.0')).toBeNull();
  });

  test('fails open when the override file is missing', () => {
    process.env[ENV_VAR] = join(tempDir, 'does-not-exist.txt');
    expect(checkMinVersion('0.0.1')).toBeNull();
  });

  test('fails open when the file content is not a semver', () => {
    writeMinVersionFile('not a version');
    expect(checkMinVersion('0.0.1')).toBeNull();
  });
});
