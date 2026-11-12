import { describe, expect, test } from 'bun:test';
import { __test__ as askHelpers } from '../src/commands/ask_page.js';
import { __test__ as surfaceHelpers } from '../src/commands/chatgpt_surface.js';

describe('ask helpers', () => {
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
      { assistants: [{ key: 'new', text: 'partial' }], streaming: false },
      { assistants: [{ key: 'new', text: 'partial, then complete' }], streaming: false },
      { assistants: [{ key: 'new', text: 'partial, then complete' }], streaming: false }
    ];
    let index = 0;
    const page = {
      wait: async () => {},
      evaluate: async () => probes[Math.min(index++, probes.length - 1)]
    };

    const result = await askHelpers.waitForAssistantResponse(page, {
      prompt: 'Prompt text',
      timeoutMs: 60000,
      baselineKeys: new Set()
    });

    expect(result.response).toBe('partial, then complete');
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
