import { readdirSync, readFileSync } from 'node:fs';
import { test, expect } from 'bun:test';
import { checkToolsBatFiles } from '../.omx/reference/opencli-app-kit/src/testing/tools_bat_check.js';

const TOOLS_DIR = new URL('../tools/', import.meta.url);

for (const name of readdirSync(TOOLS_DIR).filter((entry) => !entry.startsWith('.') && /\.(bat|cmd)$/i.test(entry))) {
  test(`${name} is safe as a Tickets Watcher command`, () => {
    const result = checkToolsBatFiles(TOOLS_DIR).find(({ filePath }) => filePath.endsWith(`/${name}`));
    const content = readFileSync(new URL(name, TOOLS_DIR), 'ascii');
    const commands = content.split(/\r\n/).map((line) => line.trim()).filter((line) => line && !/^(rem\b|::)/i.test(line));

    expect(result?.issues).toEqual([]);
    expect(commands.some((line) => /^@?start(?:\s|$)/i.test(line) && !/\s\/wait(?:\s|$)/i.test(line))).toBe(false);
  });
}
