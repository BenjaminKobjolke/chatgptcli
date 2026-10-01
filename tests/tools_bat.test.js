import { readdirSync, readFileSync } from 'node:fs';
import { test, expect } from 'bun:test';

// These set-only files are included through call, not run as commands.
const CONFIG_INCLUDES = new Set(['analyze_code_config.bat', 'analyze_code_config.example.bat']);
const TOOLS_DIR = new URL('../tools/', import.meta.url);

for (const name of readdirSync(TOOLS_DIR).filter((entry) => !entry.startsWith('.') && /\.(bat|cmd)$/i.test(entry))) {
  test(`${name} is safe as a Tickets Watcher command`, () => {
    const bytes = readFileSync(new URL(name, TOOLS_DIR));
    const content = bytes.toString('ascii');
    const commands = content.split(/\r\n/).map((line) => line.trim()).filter((line) => line && !/^(rem\b|::)/i.test(line));

    expect([...bytes].every((byte) => byte < 128)).toBe(true);
    expect(/(?<!\r)\n|\r(?!\n)/.test(content)).toBe(false);
    expect(commands.some((line) => /^@?pause(?:\s|$)/i.test(line))).toBe(false);
    expect(commands.some((line) => /^@?start(?:\s|$)/i.test(line) && !/\s\/wait(?:\s|$)/i.test(line))).toBe(false);
    if (!CONFIG_INCLUDES.has(name)) {
      expect(commands.at(-1)).toMatch(/(?:^|&\s*)exit\s+\/b\s+(?:\d+|%[a-z_][a-z_0-9]*%)$/i);
    }
  });
}
