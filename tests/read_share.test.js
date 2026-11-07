import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runCli } from '../src/cli.js';
import { __resetReadDepsForTest, __setReadDepsForTest } from '../src/commands/read.js';
import { __test__ as conversationHelpers } from '../src/commands/read_conversation.js';
import { readScrapeScript } from '../src/commands/read_scrape.js';
import { conversationFetchFailure, FETCH_FAILURE } from '../src/commands/read_failure.js';
import {
  bindOriginalStdio,
  captureStderr,
  captureStdout,
  chain,
  fakeConversationExtras,
  fakeReadPage,
  message,
  restoreStdio
} from './test_helpers.js';

const SHARE_URL = 'https://chatgpt.com/share/abc-123?ogimg=plain';
const originalStdio = bindOriginalStdio();

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

function stubShare(conversation, options = {}) {
  __setReadDepsForTest({
    openChat: async () => fakeReadPage(null, fakeConversationExtras(conversation, {
      shared: true,
      url: SHARE_URL,
      ...options
    }))
  });
}

describe('read public shared conversations', () => {
  test('prints the visible shared conversation in text format', async () => {
    stubShare(chain([
      message('system', ['hidden prompt'], { metadata: { is_visually_hidden_from_conversation: true } }),
      message('user', ['question']),
      { ...message('assistant', ['private thoughts']), content: { content_type: 'thoughts', parts: ['private thoughts'] } },
      message('assistant', ['answer'])
    ]));

    const stdout = captureStdout();
    const code = await runCli(['read', SHARE_URL, '-f', 'text']);

    expect(code).toBe(0);
    expect(stdout.join('')).toBe('[user]\nquestion\n\n[assistant]\nanswer\n');
  });

  test('reads a share whose answer follows hidden context, thoughts and a reasoning recap', async () => {
    stubShare(chain([
      message('system', [''], { metadata: { is_visually_hidden_from_conversation: true } }),
      message('user', ['question']),
      message('user', ['hidden context'], { metadata: { is_visually_hidden_from_conversation: true } }),
      {
        ...message('assistant', ['']),
        content: { content_type: 'model_editable_context', model_set_context: '' },
        metadata: { is_visually_hidden_from_conversation: true }
      },
      { ...message('assistant', ['']), content: { content_type: 'thoughts', thoughts: [] } },
      {
        ...message('assistant', ['']),
        content: { content_type: 'reasoning_recap', content: 'Thought for 5s' }
      },
      message('assistant', ['## Heading\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'])
    ]));

    const stdout = captureStdout();
    const code = await runCli(['read', SHARE_URL, '-f', 'text']);

    expect(code).toBe(0);
    expect(stdout.join('')).toBe('[user]\nquestion\n\n[assistant]\n## Heading\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
  });

  test('returns JSON transcript and preserves a query-string share URL', async () => {
    stubShare(chain([message('user', ['question']), message('assistant', ['answer'])]));

    const stdout = captureStdout();
    const code = await runCli(['read', SHARE_URL, '-f', 'json']);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join(''))).toEqual({
      ok: true,
      url: SHARE_URL,
      count: 2,
      messages: [{ role: 'user', text: 'question' }, { role: 'assistant', text: 'answer' }]
    });
  });

  test.each([
    ['a not-found share', { status: 404 }],
    ['an empty share mapping', { conversation: { current_node: null, mapping: {} } }]
  ])('%s reports a share-specific error', async (_label, options) => {
    const conversation = options.conversation ?? chain([message('user', ['question'])]);
    stubShare(conversation, options);

    captureStdout();
    const stderr = captureStderr();
    const code = await runCli(['read', SHARE_URL, '-f', 'json']);

    expect(code).toBe(5);
    expect(stderr.join('')).toContain('No messages found on this shared ChatGPT link');
    expect(stderr.join('')).not.toContain('not on a chat');
  });

  test('keeps a redirected dead share on the share-specific error', async () => {
    stubShare({}, { redirectedHome: true });

    captureStdout();
    const stderr = captureStderr();
    const code = await runCli(['read', SHARE_URL, '-f', 'text']);

    expect(code).toBe(5);
    expect(stderr.join('')).toContain('No messages found on this shared ChatGPT link');
    expect(stderr.join('')).not.toContain('bridge browser tab is not on a chat');
  });
});

describe('public share DOM transcript fallback', () => {
  const originalLocation = globalThis.location;
  const originalDocument = globalThis.document;
  const OriginalHTMLElement = globalThis.HTMLElement;
  const BaseHTMLElement = OriginalHTMLElement || class {};

  afterEach(() => {
    globalThis.location = originalLocation;
    globalThis.document = originalDocument;
    globalThis.HTMLElement = OriginalHTMLElement;
  });

  test('scrapes user and assistant list items with data-message-role', () => {
    class FakeMessage extends BaseHTMLElement {
      constructor(role, text) {
        super();
        this.role = role;
        this.innerText = text;
        this.tagName = 'LI';
      }

      hasAttribute(name) {
        return name === 'data-message-role';
      }

      getAttribute(name) {
        return name === 'data-message-role' ? this.role : null;
      }

      querySelectorAll() {
        return [];
      }
    }

    const messages = [new FakeMessage('user', 'question'), new FakeMessage('assistant', 'answer')];
    globalThis.location = { href: SHARE_URL };
    globalThis.HTMLElement = FakeMessage;
    globalThis.document = {
      querySelector: () => null,
      querySelectorAll: (selector) => selector.includes('[data-message-role]') ? messages : []
    };

    const result = (0, eval)(readScrapeScript(0));

    expect(result.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'question' },
      { role: 'assistant', text: 'answer' }
    ]);
  });
});

describe('conversationFetchScript', () => {
  const originalLocation = globalThis.location;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.location = originalLocation;
    globalThis.fetch = originalFetch;
  });

  test('fetches public share data without requesting the account session', async () => {
    const urls = [];
    const fetchOptions = [];
    globalThis.location = { pathname: '/share/abc-123', href: SHARE_URL };
    globalThis.fetch = async (url, options) => {
      urls.push(url);
      fetchOptions.push(options);
      return { status: 200, text: async () => JSON.stringify(chain([message('user', ['hi'])])) };
    };

    const result = await (0, eval)(conversationHelpers.conversationFetchScript());

    expect(urls).toEqual(['/backend-api/share/abc-123']);
    expect(fetchOptions).toEqual([{ credentials: 'omit' }]);
    expect(result).toMatchObject({ shared: true, offChat: false, authHeader: '', status: 200 });
  });

  test('keeps account chats on the session and conversation endpoints', async () => {
    const urls = [];
    globalThis.location = { pathname: '/c/xyz', href: 'https://chatgpt.com/c/xyz' };
    globalThis.fetch = async (url) => {
      urls.push(url);
      if (url === '/api/auth/session') return { json: async () => ({ accessToken: 'token' }) };
      return { status: 200, text: async () => JSON.stringify(chain([message('user', ['hi'])])) };
    };

    const result = await (0, eval)(conversationHelpers.conversationFetchScript());

    expect(urls).toEqual(['/api/auth/session', '/backend-api/conversation/xyz']);
    expect(result).toMatchObject({ shared: false, authHeader: 'Bearer token', status: 200 });
  });
});

describe('conversationFetchFailure', () => {
  test('classifies any unreadable share before account-specific failures', () => {
    expect(conversationFetchFailure({ shared: true, status: 404 })).toBe('share-unreadable');
    expect(conversationFetchFailure({ shared: true, offChat: true })).toBe('share-unreadable');
    expect(conversationFetchFailure({ status: 404 })).toBe('not-found');
    expect(conversationFetchFailure({ offChat: true })).toBe('off-chat');
    expect(FETCH_FAILURE.SHARE_UNREADABLE).toBe('share-unreadable');
  });
});

test('uses the open tab share URL for the unreadable-link error', async () => {
  __setReadDepsForTest({
    openChat: async () => {
      const fake = fakeReadPage(null, fakeConversationExtras({}, { redirectedHome: true }));
      fake.page.evaluate = async (script) => script === 'window.location.href'
        ? 'https://chatgpt.com/share/deleted?ogimg=plain'
        : null;
      return fake;
    }
  });

  captureStdout();
  const stderr = captureStderr();
  const code = await runCli(['read', '-f', 'text']);

  expect(code).toBe(5);
  expect(stderr.join('')).toContain('No messages found on this shared ChatGPT link');
  expect(stderr.join('')).not.toContain('bridge browser tab is not on a chat');
});
