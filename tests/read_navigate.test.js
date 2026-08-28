import { describe, expect, test } from 'bun:test';
import { __test__ as readHelpers } from '../src/commands/read.js';

// Regression test for the reload-flakiness fix documented in PLAN.md:
// `page.goto` on an unchanged SPA URL is a no-op, so a stale, already-open
// tab can leave the "Files in chat" panel in a broken DOM state. Navigating
// to a neutral URL first forces a real reload before landing on the target.
describe('navigateAndWaitForMessages', () => {
  test('hard-reloads via a neutral URL before the target URL', async () => {
    const gotoCalls = [];
    const page = {
      goto: async (url) => {
        gotoCalls.push(url);
      },
      evaluate: async () => 1,
      wait: async () => {}
    };

    await readHelpers.navigateAndWaitForMessages(page, 'https://chatgpt.com/c/abc123');

    expect(gotoCalls.length).toBe(2);
    expect(gotoCalls[0]).toBe('https://chatgpt.com/');
    expect(gotoCalls[1]).toBe('https://chatgpt.com/c/abc123');
  });

  test('polls until turns appear and the count holds steady', async () => {
    let evaluateCalls = 0;
    const page = {
      goto: async () => {},
      evaluate: async () => {
        evaluateCalls += 1;
        return evaluateCalls >= 3 ? 2 : 0;
      },
      wait: async () => {}
    };

    await readHelpers.navigateAndWaitForMessages(page, 'https://chatgpt.com/c/abc123');

    // Two zero reads, then 2 twice: a count is only trusted once it repeats.
    expect(evaluateCalls).toBe(4);
  });

  // Regression test for a truncated scrape: the page keeps mounting turns for
  // seconds after the first one appears, so stopping at the first non-zero
  // count silently dropped the rest of the chat.
  test('keeps polling while turns are still mounting', async () => {
    const counts = [2, 4, 6, 8, 8];
    let index = 0;
    const page = {
      goto: async () => {},
      evaluate: async () => counts[Math.min(index++, counts.length - 1)],
      wait: async () => {}
    };

    await readHelpers.navigateAndWaitForMessages(page, 'https://chatgpt.com/c/abc123');

    expect(index).toBe(counts.length);
  });
});

// A bare `read` (no URL) used to skip the reload above entirely and scrape the
// tab as-is — the stale-tab state that leaves the "Files in chat" panel out of
// the DOM, so reports and generated files vanished from the transcript.
describe('chatUrlFromLocation', () => {
  test('accepts a chat URL on every supported host', () => {
    expect(readHelpers.chatUrlFromLocation('https://chatgpt.com/c/abc123')).toBe('https://chatgpt.com/c/abc123');
    expect(readHelpers.chatUrlFromLocation('https://chat.openai.com/c/abc123')).toBe('https://chat.openai.com/c/abc123');
  });

  test('returns null for anything that is not a chat, without throwing', () => {
    expect(readHelpers.chatUrlFromLocation('about:blank')).toBeNull();
    expect(readHelpers.chatUrlFromLocation('https://chatgpt.com/')).toBeNull();
    expect(readHelpers.chatUrlFromLocation('https://example.com/c/abc123')).toBeNull();
    expect(readHelpers.chatUrlFromLocation('')).toBeNull();
    expect(readHelpers.chatUrlFromLocation(null)).toBeNull();
  });
});
