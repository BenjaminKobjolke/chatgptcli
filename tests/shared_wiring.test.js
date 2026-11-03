import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { settingsPath } from '../src/core/settings.js';

describe('shared app kit wiring', () => {
  test('keeps the chatgptcli settings file path', () => {
    expect(settingsPath()).toBe(join(homedir(), '.chatgptcli', 'settings.json'));
  });
});
