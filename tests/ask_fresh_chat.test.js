import { describe, expect, test } from 'bun:test';
import { askOnPage } from '../src/commands/ask_page.js';
import { isChatPath } from '../src/core/chatgpt_site.js';

const OLD_CHAT_URL = 'https://chatgpt.com/c/old-id';
const NEW_CHAT_URL = 'https://chatgpt.com/c/new-id';

function fakePage({ url = 'https://chatgpt.com/', userCount = 0, reply = '', staleReply = false } = {}) {
  let currentUrl = url;
  let sent = false;
  const calls = { goto: 0, insertText: 0, attach: 0 };

  return {
    calls,
    goto: async () => { calls.goto += 1; },
    wait: async () => {},
    insertText: async () => { calls.insertText += 1; },
    setFileInput: async () => { calls.attach += 1; },
    evaluate: async (script) => {
      if (script.includes('/api/auth/session')) {
        return {
          url: currentUrl, editorFound: true, sendFound: true, sendDisabled: false,
          loggedIn: true, challengeLike: false
        };
      }
      if (script.includes('const assistants') && script.includes('return {')) {
        const userMessageCount = sent && !staleReply ? Math.max(userCount, 1) : userCount;
        const assistants = reply && (sent || staleReply) ? [{ key: staleReply ? 'old-reply' : 'answer', text: reply }] : [];
        return { assistants, streaming: false, userMessageCount };
      }
      if (script.includes('data-message-author-role') && script.includes('user')) {
        const userMessageCount = sent && !staleReply ? Math.max(userCount, 1) : userCount;
        if (script.includes('editorText')) {
          return {
            editorText: sent ? '' : 'hello', sendReady: true,
            userMessageCount: sent ? Math.max(userCount, 1) : userCount,
            editorFound: true, stopPresent: false, url: currentUrl
          };
        }
        return { userMessageCount, url: currentUrl };
      }
      if (script.includes('send.click()')) {
        sent = true;
        if (reply) currentUrl = NEW_CHAT_URL;
        return { ok: true };
      }
      if (script.includes('editor.focus()')) return { ok: true };
      if (script.includes('data-chatgpt-selection-message-id')) return [];
      if (script.includes('window.location.href')) return currentUrl;
      return false;
    }
  };
}

describe('ask fresh chat verification', () => {
  test('recognizes chat paths only on ChatGPT hosts', () => {
    expect(isChatPath('https://chatgpt.com/c/chat-id')).toBe(true);
    expect(isChatPath('https://example.com/c/chat-id')).toBe(false);
  });

  test('does not send text or images when navigation stays on an existing chat', async () => {
    const page = fakePage({ url: OLD_CHAT_URL, userCount: 2 });
    const result = await askOnPage(page, {
      prompt: 'count the image', images: ['image.png'], timeoutMs: 30, newChat: true
    });

    expect(result.response).toStartWith('[SEND FAILED] fresh chat did not open');
    expect(result.response).toContain(OLD_CHAT_URL);
    expect(result.url).toBe(OLD_CHAT_URL);
    expect(page.calls.goto).toBe(2);
    expect(page.calls.insertText).toBe(0);
    expect(page.calls.attach).toBe(0);
  });

  test('does not accept an old assistant reply unless our user message appears', async () => {
    const page = fakePage({ reply: 'old answer', userCount: 0, staleReply: true });

    const result = await askOnPage(page, {
      prompt: 'new question', timeoutMs: 30, newChat: true
    });

    expect(result.response).toBe('[NO RESPONSE]');
  });

  test('returns the fresh chat URL with the answer', async () => {
    const page = fakePage({ reply: 'answer' });
    const result = await askOnPage(page, { prompt: 'new question', timeoutMs: 100, newChat: true });

    expect(result).toEqual({ response: 'answer', url: NEW_CHAT_URL });
  });
});
