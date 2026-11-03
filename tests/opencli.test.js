import { describe, expect, test } from 'bun:test';
import { OPENCLI_ENV, openCliEnvNames, resolveOpenCliPaths } from '../src/core/opencli.js';

describe('opencli shared kit boundary', () => {
  test('binds the shared OpenCLI API to chatgptcli environment names', () => {
    expect(openCliEnvNames('chatgptcli')).toEqual({
      root: 'CHATGPTCLI_OPENCLI_ROOT',
      main: 'CHATGPTCLI_OPENCLI_MAIN'
    });
    expect(OPENCLI_ENV).toEqual({
      ROOT: 'CHATGPTCLI_OPENCLI_ROOT',
      MAIN: 'CHATGPTCLI_OPENCLI_MAIN'
    });
  });

  test('resolves both app-specific environment overrides', () => {
    const originalRoot = process.env.CHATGPTCLI_OPENCLI_ROOT;
    const originalMain = process.env.CHATGPTCLI_OPENCLI_MAIN;
    process.env.CHATGPTCLI_OPENCLI_ROOT = 'C:\\opencli-test';
    process.env.CHATGPTCLI_OPENCLI_MAIN = 'D:\\custom\\main.js';

    try {
      const paths = resolveOpenCliPaths();
      expect(paths.root).toBe('C:\\opencli-test');
      expect(paths.mainPath).toBe('D:\\custom\\main.js');
    } finally {
      if (originalRoot === undefined) delete process.env.CHATGPTCLI_OPENCLI_ROOT;
      else process.env.CHATGPTCLI_OPENCLI_ROOT = originalRoot;
      if (originalMain === undefined) delete process.env.CHATGPTCLI_OPENCLI_MAIN;
      else process.env.CHATGPTCLI_OPENCLI_MAIN = originalMain;
    }
  });
});
