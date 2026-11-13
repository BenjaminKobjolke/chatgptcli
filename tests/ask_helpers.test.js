import { describe, expect, test } from 'bun:test';
import { __test__ as askHelpers } from '../src/commands/ask_page.js';
import { __test__ as surfaceHelpers } from '../src/commands/chatgpt_surface.js';
import { USER_SELECTOR } from '../src/commands/chatgpt_surface.js';

describe('ask helpers', () => {
  test('matches redesigned user message markup', () => {
    // ChatGPT replaced data-message-author-role with content-search units.
    expect(USER_SELECTOR).toContain('[data-content-search-unit-key$=":user"]');
  });

  test('recognizes chatgpt hostnames', async () => {
    const fakePage = (url) => ({ evaluate: () => Promise.resolve(url) });
    expect(await askHelpers.isOnChatGpt(fakePage('https://chatgpt.com/'))).toBe(true);
    expect(await askHelpers.isOnChatGpt(fakePage('https://chat.openai.com/'))).toBe(true);
    expect(await askHelpers.isOnChatGpt(fakePage('https://example.com/'))).toBe(false);
  });

  // The chat list is virtualized: an old reply can unmount while the new one
  // mounts, so "everything after the first N nodes" is not the new reply.
  test('picks the latest assistant candidate that was not there before sending', () => {
    const assistants = [
      { key: 'old', text: 'older' },
      { key: 'echo', text: 'Prompt text' },
      { key: 'new', text: 'Assistant final' }
    ];
    const candidate = askHelpers.pickLatestAssistantCandidate(assistants, new Set(['old']), 'Prompt text');
    expect(candidate).toBe('Assistant final');
  });

  // The stop-button selector is the only streaming signal and it has changed
  // before; a reply still growing between polls must not be returned as final.
  test('waits for the response text to stop growing', async () => {
    const probes = [
      { assistants: [{ key: 'new', text: 'partial' }], streaming: false, userMessageCount: 1, lastUserText: 'Prompt text' },
      { assistants: [{ key: 'new', text: 'partial, then complete' }], streaming: false, userMessageCount: 1, lastUserText: 'Prompt text' },
      { assistants: [{ key: 'new', text: 'partial, then complete' }], streaming: false, userMessageCount: 1, lastUserText: 'Prompt text' }
    ];
    let index = 0;
    const page = {
      wait: async () => {},
      evaluate: async () => probes[Math.min(index++, probes.length - 1)]
    };

    const result = await askHelpers.waitForAssistantResponse(page, {
      prompt: 'Prompt text',
      timeoutMs: 60000,
      baselineKeys: new Set(),
      baselineUserCount: 0
    });

    expect(result.response).toBe('partial, then complete');
  });

  test('accepts a stable response when the newest user message starts with this prompt', async () => {
    const probe = {
      assistants: [{ key: 'new', text: 'Assistant answer' }],
      streaming: false,
      userMessageCount: 1,
      lastUserText: '  Prompt   text '
    };
    let calls = 0;
    const page = {
      wait: async () => {},
      evaluate: async () => {
        calls += 1;
        return probe;
      }
    };

    const result = await askHelpers.waitForAssistantResponse(page, {
      prompt: 'Prompt text',
      timeoutMs: 60000,
      baselineKeys: new Set(),
      baselineUserCount: 0
    });

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.response).toBe('Assistant answer');
  });

  test('does not return a stable reply for another session prompt', async () => {
    const probe = {
      assistants: [{ key: 'foreign-reply', text: 'Foreign assistant answer' }],
      streaming: false,
      userMessageCount: 1,
      lastUserText: 'something else'
    };
    const page = {
      wait: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      evaluate: async () => probe
    };

    const result = await askHelpers.waitForAssistantResponse(page, {
      prompt: 'Prompt text',
      timeoutMs: 50,
      baselineKeys: new Set(),
      baselineUserCount: 0
    });

    expect(result.response.startsWith('[SEND FAILED]')).toBe(true);
    expect(result.response).toContain('another session');
    expect(result.response).not.toContain('Foreign assistant answer');
  });

  test('summarizes the strongest surface issue', () => {
    expect(askHelpers.summarizeSurfaceIssue(askHelpers.normalizeSurfaceState({ challengeLike: true }))).toContain('verification');
    expect(askHelpers.summarizeSurfaceIssue(askHelpers.normalizeSurfaceState({ loginLike: true }))).toContain('logged-in ready state');
    expect(askHelpers.summarizeSurfaceIssue(askHelpers.normalizeSurfaceState({ editorFound: false, sendFound: false }))).toContain('editor');
  });

  test('does not treat prompt login hints as a challenge when the composer exists', () => {
    const state = surfaceHelpers.normalizeSurfaceState({
      bodyText: 'Login, sign in, and access denied',
      editorFound: true,
      sendFound: true,
      sendDisabled: false
    });

    expect(state.loginLike).toBe(false);
    expect(state.challengeLike).toBe(false);
  });

  test('does not treat challenge wording in a submitted user message as a page challenge', () => {
    const submittedMessage = `${'x'.repeat(5000)} access denied`;
    const state = surfaceHelpers.normalizeSurfaceState({
      bodyText: submittedMessage,
      userMessageTexts: [submittedMessage],
      editorFound: false,
      sendFound: false
    });

    expect(state.challengeLike).toBe(false);
  });
});
