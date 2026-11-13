import { afterEach, describe, expect, test } from 'bun:test';
import { askOnPage } from '../src/commands/ask_page.js';
import { CHATGPT_ROOT_URL } from '../src/core/chatgpt_site.js';

const CHAT_URL = 'https://chatgpt.com/c/current-chat';
const originalNow = Date.now;

afterEach(() => {
  Date.now = originalNow;
});

function fakePage({ busy = true, clearBusyOnReload = true, url = CHAT_URL } = {}) {
  let currentUrl = url;
  let isBusy = busy;
  let insertedPrompt = '';
  let sent = false;
  const calls = { goto: [], attach: 0, insertText: 0 };

  return {
    calls,
    goto: async (url) => {
      calls.goto.push(url);
      currentUrl = url;
      if (url === CHAT_URL && clearBusyOnReload) isBusy = false;
    },
    wait: async () => {},
    insertText: async (prompt) => {
      insertedPrompt = prompt;
      calls.insertText += 1;
    },
    setFileInput: async () => { calls.attach += 1; },
    evaluate: async (script) => {
      if (script.includes('__chatgptcliIdleProbe')) return isBusy;
      if (script.includes('const tiles = form ? Array.from')) {
        return {
          url: currentUrl,
          stop: isBusy,
          stopLabel: isBusy ? 'Stop generating' : '',
          stopTestId: isBusy ? 'stop-button' : '',
          stopInForm: isBusy,
          stopVisible: isBusy,
          stopMatches: isBusy ? 1 : 0
        };
      }
      if (script.includes('/api/auth/session')) {
        return { url: currentUrl, editorFound: true, sendFound: true, sendDisabled: false, loggedIn: true };
      }
      if (script.includes('const assistants')) {
        return {
          assistants: sent ? [{ key: 'answer', text: 'ready' }] : [],
          streaming: false,
          userMessageCount: sent ? 1 : 0,
          lastUserText: sent ? insertedPrompt : ''
        };
      }
      if (script.includes('url: window.location.href') && script.includes('userMessageCount')) {
        return { url: currentUrl, userMessageCount: 0 };
      }
      if (script.includes('sendReady')) {
        return { editorText: insertedPrompt || 'prompt', sendReady: true, userMessageCount: 0 };
      }
      if (script.includes('send.click()')) {
        sent = true;
        return { ok: true };
      }
      if (script.includes('userMessageCount')) {
        return { editorFound: true, editorText: '', stopPresent: true, userMessageCount: 1, url: currentUrl };
      }
      if (script.includes('editor.focus()')) return { ok: true };
      if (script.includes('window.location.href')) return currentUrl;
      return [];
    }
  };
}

function accelerateTime() {
  let now = 0;
  Date.now = () => now++ * 1000;
}

describe('same-chat composer recovery', () => {
  test('reloads root then chat once when the composer stays busy for the first wait', async () => {
    accelerateTime();
    const page = fakePage();

    const result = await askOnPage(page, { prompt: 'hello', timeoutMs: 10_000, newChat: false });

    expect(page.calls.goto).toEqual([CHATGPT_ROOT_URL, CHAT_URL]);
    expect(result.response).not.toStartWith('[SEND FAILED]');
    expect(page.calls.insertText).toBe(1);
  });

  test('returns a composer snapshot after one reload when the chat remains busy', async () => {
    accelerateTime();
    const page = fakePage({ clearBusyOnReload: false });

    const result = await askOnPage(page, {
      prompt: 'Review these', images: ['one.png'], timeoutMs: 1000, newChat: false
    });

    expect(page.calls.goto).toEqual([CHATGPT_ROOT_URL, CHAT_URL]);
    expect(result.response).toContain('[SEND FAILED] previous reply is still generating after reloading the chat');
    expect(result.response).toContain('stopTestId="stop-button"');
    expect(page.calls.attach).toBe(0);
    expect(page.calls.insertText).toBe(0);
  });

  test('does not reload an idle fresh chat', async () => {
    accelerateTime();
    const page = fakePage({ busy: false, url: CHATGPT_ROOT_URL });

    const result = await askOnPage(page, { prompt: 'hello', timeoutMs: 10_000, newChat: true });

    expect(page.calls.goto).toEqual([CHATGPT_ROOT_URL]);
    expect(result.response).not.toStartWith('[SEND FAILED]');
    expect(page.calls.insertText).toBe(1);
  });
});
