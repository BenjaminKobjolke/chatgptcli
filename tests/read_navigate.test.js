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

  test('polls until message nodes appear', async () => {
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

    expect(evaluateCalls).toBe(3);
  });
});
