// `read` on a chat that yields no messages: the error names the cause the
// conversation fetch could tell, instead of one generic "No messages found".
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runCli } from '../src/cli.js';
import { __resetReadDepsForTest, __setReadDepsForTest } from '../src/commands/read.js';
import { conversationFetchFailure } from '../src/commands/read_failure.js';
import {
  bindOriginalStdio,
  captureStderr,
  captureStdout,
  fakeConversationExtras,
  fakeReadPage,
  restoreStdio
} from './test_helpers.js';

const originalStdio = bindOriginalStdio();

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

async function readWith(options) {
  __setReadDepsForTest({ openChat: async () => fakeReadPage(null, fakeConversationExtras({}, options)) });
  captureStdout();
  const stderr = captureStderr();
  const code = await runCli(['read', 'abc', '-f', 'text']);
  return { code, stderr: stderr.join('') };
}

describe('conversationFetchFailure', () => {
  // A fetch that threw (a challenge page, no network) reports nothing: only a
  // session that answered without a token is known to be logged out.
  test('names only the causes the fetch can actually tell apart', () => {
    expect(conversationFetchFailure({ loggedOut: true, status: 0 })).toBe('logged-out');
    expect(conversationFetchFailure({ loggedOut: true, offChat: true })).toBe('logged-out');
    expect(conversationFetchFailure({ offChat: true, status: 0 })).toBe('off-chat');
    expect(conversationFetchFailure({ status: 404 })).toBe('not-found');
    expect(conversationFetchFailure({ status: 500 })).toBe('');
    expect(conversationFetchFailure({ status: 0 })).toBe('');
    expect(conversationFetchFailure(null)).toBe('');
  });
});

describe('read: an empty transcript names its cause', () => {
  test('a logged-out bridge browser fails with AUTH_MISSING', async () => {
    const { code, stderr } = await readWith({ loggedOut: true });

    expect(code).toBe(3);
    expect(stderr).toContain('AUTH_MISSING: Not logged into chatgpt.com');
  });

  // ChatGPT redirects away from a chat the account cannot open, so the tab
  // ends up off any chat URL (confirmed live with an unknown chat id).
  test('a tab that is not on a chat says so', async () => {
    const { code, stderr } = await readWith({ offChat: true });

    expect(code).toBe(5);
    expect(stderr).toContain('API_ERROR: The bridge browser tab is not on a chat');
  });

  test('a chat the logged-in account cannot see fails as not found', async () => {
    const { code, stderr } = await readWith({ status: 404 });

    expect(code).toBe(5);
    expect(stderr).toContain('API_ERROR: Chat not found');
  });
});
