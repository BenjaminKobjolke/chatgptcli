import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runCli } from '../src/cli.js';
import { __resetReadDepsForTest, __setReadDepsForTest } from '../src/commands/read.js';
import { bindOriginalStdio, captureStdout, fakeReadPage, restoreStdio } from './test_helpers.js';

const originalStdio = bindOriginalStdio();

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

// Report entries as the DOM fallback and the cross-origin iframe path produce them.
describe('read: report entries', () => {
  test('read includes a deep research report entry as markdown', async () => {
    __setReadDepsForTest({
      openChat: async () => fakeReadPage({
        url: 'https://chatgpt.com/c/abc',
        messages: [
          { role: 'user', text: 'Research X', title: '' },
          { role: 'assistant', text: 'One moment.', title: '' },
          { role: 'report', text: '# Report Title\n\nBody text.', title: 'Report Title' }
        ]
      })
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.count).toBe(3);
    expect(output.messages[2]).toEqual({
      role: 'report',
      title: 'Report Title',
      text: '# Report Title\n\nBody text.'
    });
  });

  test('read text format renders a [report] block', async () => {
    __setReadDepsForTest({
      openChat: async () => fakeReadPage({
        url: 'https://chatgpt.com/c/abc',
        messages: [{ role: 'report', text: '# T\n\nBody', title: 'T' }]
      })
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'text']);

    expect(code).toBe(0);
    expect(stdout.join('')).toBe('[report]\n# T\n\nBody\n');
  });

  test('read resolves a deep research report rendered in a cross-origin iframe', async () => {
    const frameCalls = [];
    __setReadDepsForTest({
      openChat: async () => fakeReadPage(
        {
          url: 'https://chatgpt.com/c/abc',
          messages: [
            { role: 'user', text: 'Research X', title: '' },
            {
              role: 'report',
              text: '',
              title: '',
              reportFrameSrc: 'https://connector-openai-deep-research.web-sandbox.oaiusercontent.com/r1'
            }
          ]
        },
        {
          frames: async () => [
            { index: 0, frameId: 'f0', url: 'https://connector-openai-deep-research.web-sandbox.oaiusercontent.com/r1', name: '' }
          ],
          evaluateInFrame: async (script, frameIndex) => {
            frameCalls.push(frameIndex);
            return { title: 'Report Title', text: '# Report Title\n\nBody text.' };
          }
        }
      )
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(frameCalls).toEqual([0]);
    const output = JSON.parse(stdout.join(''));
    expect(output.count).toBe(2);
    expect(output.messages[1]).toEqual({
      role: 'report',
      title: 'Report Title',
      text: '[report-01]',
      attachments: [{ id: 'report-01', kind: 'report', name: 'Report Title' }]
    });
  });

  test('read drops iframe placeholders that resolve to chrome UI, not the report body', async () => {
    __setReadDepsForTest({
      openChat: async () => fakeReadPage(
        {
          url: 'https://chatgpt.com/c/abc',
          messages: [
            { role: 'user', text: 'Research X', title: '' },
            {
              role: 'report',
              text: '',
              title: '',
              reportFrameSrc: 'https://connector-openai-deep-research.web-sandbox.oaiusercontent.com/toolbar'
            }
          ]
        },
        {
          frames: async () => [
            { index: 0, frameId: 'f0', url: 'https://connector-openai-deep-research.web-sandbox.oaiusercontent.com/toolbar', name: '' }
          ],
          // No heading in this frame (it's the title/status chrome, not the report body).
          evaluateInFrame: async () => ({ title: '', text: 'Research completed in 11m' })
        }
      )
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.count).toBe(1);
    expect(output.messages).toEqual([{ role: 'user', text: 'Research X' }]);
  });

  test('read without a report stays byte-identical to the plain message shape', async () => {
    __setReadDepsForTest({
      openChat: async () => fakeReadPage({
        url: 'https://chatgpt.com/c/abc',
        messages: [
          { role: 'user', text: 'hi', title: '' },
          { role: 'assistant', text: 'hello', title: '' }
        ]
      })
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' }
    ]);
  });
});
