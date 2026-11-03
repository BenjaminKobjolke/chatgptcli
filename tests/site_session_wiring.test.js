import { afterEach, describe, expect, test } from 'bun:test';
import { __resetAskDepsForTest, __setAskDepsForTest, __test__ as askTest } from '../src/commands/ask.js';
import { __resetReadDepsForTest, __setReadDepsForTest, __test__ as readTest } from '../src/commands/read.js';

describe('ChatGPT site session wiring', () => {
  const calls = [];
  const withSitePage = async (options) => {
    calls.push(options);
    return {};
  };

  afterEach(() => {
    calls.length = 0;
    __resetAskDepsForTest();
    __resetReadDepsForTest();
  });

  test('read uses the chatgptcli ChatGPT site session', async () => {
    __setReadDepsForTest({ withSitePage });

    await readTest.withOpenChat({ url: 'https://chatgpt.com/c/example' }, async () => {});

    expect(calls[0]).toMatchObject({ appName: 'chatgptcli', session: 'site:chatgpt' });
  });

  test('ask uses the chatgptcli ChatGPT site session', async () => {
    __setAskDepsForTest({ withSitePage });

    await askTest.runBrowserAsk({ prompt: 'hello', timeoutSeconds: 45, newChat: false });

    expect(calls[0]).toMatchObject({ appName: 'chatgptcli', session: 'site:chatgpt' });
  });
});
