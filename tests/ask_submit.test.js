import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPromptWithFile } from '../src/core/prompt_file.js';
import { askOnPage } from '../src/commands/ask_page.js';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function longPromptFromFile() {
  const dir = mkdtempSync(join(tmpdir(), 'chatgptcli-ask-submit-'));
  tempDirs.push(dir);
  const filePath = join(dir, 'brief.md');
  const lines = Array.from({ length: 130 }, (_, index) =>
    `## Section ${index}\nLogin and sign in guidance; access denied is an example.\n\n\`\`\`text\nline ${index} of a long brief\n\`\`\`\n`
  );
  writeFileSync(filePath, lines.join('\n'), 'utf8');
  const prompt = buildPromptWithFile('Please read the attached brief.', filePath);
  expect(Buffer.byteLength(prompt, 'utf8')).toBeGreaterThan(8000);
  return prompt;
}

function fakePage({ loggedIn = true, submitted = true } = {}) {
  let clicked = false;
  let entered = false;
  let insertedPrompt = '';
  const calls = { enter: 0 };

  return {
    calls,
    goto: async () => {},
    wait: async () => {},
    insertText: async (text) => { insertedPrompt = text; },
    pressKey: async (key) => {
      expect(key).toBe('Enter');
      calls.enter += 1;
      entered = true;
    },
    evaluate: async (script) => {
      if (script.includes('/api/auth/session')) {
        return {
          url: 'https://chatgpt.com/', editorFound: true, sendFound: true,
          sendDisabled: false, loggedIn, challengeLike: false
        };
      }
      if (script.includes('const assistants')) {
        if (script.includes('sign in')) {
          return { assistants: [], streaming: false, userMessageCount: 0, loginLike: true, challengeLike: false };
        }
        return {
          assistants: clicked ? [{ key: 'new', text: 'Here is the answer.' }] : [],
          streaming: false,
          userMessageCount: clicked ? 1 : 0,
          lastUserText: clicked ? insertedPrompt : '',
          loginLike: false,
          challengeLike: false
        };
      }
      if (script.includes('data-message-author-role') && script.includes('user')) {
        if (script.includes('sendReady')) {
          return { editorText: 'long prompt remains', sendReady: true, userMessageCount: 0 };
        }
        return {
          editorFound: true,
          editorText: submitted && (clicked || entered) ? '' : 'long prompt remains',
          streaming: false,
          userMessageCount: submitted && (clicked || entered) ? 1 : 0,
          url: 'https://chatgpt.com/'
        };
      }
      if (script.includes('send.click()')) {
        clicked = true;
        return { ok: true };
      }
      if (script.includes('editor.focus()')) return { ok: true };
      if (script.includes('editorText')) {
        return { editorText: 'long prompt remains', sendReady: true };
      }
      if (script.includes('data-chatgpt-selection-message-id')) return [];
      return { url: 'https://chatgpt.com/', editorFound: true, sendFound: true, sendDisabled: false, loggedIn };
    }
  };
}

describe('ask submit verification', () => {
  test('long markdown file containing login hints is sent and returns the answer', async () => {
    const result = await askOnPage(fakePage(), {
      prompt: longPromptFromFile(), timeoutMs: 1000, newChat: true
    });

    expect(result.response).toBe('Here is the answer.');
    expect(result.response).not.toStartWith('[BLOCKED]');
  });

  test('reports a submit failure after click and Enter do not start sending', async () => {
    const page = fakePage({ submitted: false });
    const result = await askOnPage(page, {
      prompt: 'a long prompt', timeoutMs: 1000, newChat: true, profile: 'profile-42'
    });

    expect(result.response).toStartWith('[SUBMIT FAILED]');
    expect(result.response).toContain('composer still holds the prompt');
    expect(result.response).toContain('https://chatgpt.com/');
    expect(result.response).toContain('profile-42');
    expect(result.response).toContain('composer:');
    expect(page.calls.enter).toBe(1);
  });

  test('keeps a missing session token as a logged-out result', async () => {
    const result = await askOnPage(fakePage({ loggedIn: false }), {
      prompt: 'hello', timeoutMs: 1000, newChat: true
    });

    expect(result.response).toBe('[BLOCKED] ChatGPT page is not in a logged-in ready state.');
  });
});
