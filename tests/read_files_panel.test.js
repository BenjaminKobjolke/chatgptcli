import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runCli } from '../src/cli.js';
import { __resetReadDepsForTest, __setReadDepsForTest } from '../src/commands/read.js';
import { bindOriginalStdio, captureStdout, fakeFilesPanelExtras, fakeReadPage, restoreStdio } from './test_helpers.js';

const originalStdio = bindOriginalStdio();

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

describe('read: Files-in-chat report resolution', () => {
  test('read resolves a deep research report via the Files-in-chat panel', async () => {
    const evaluateResult = {
      url: 'https://chatgpt.com/c/abc',
      messages: [{ role: 'user', text: 'Research X', title: '' }]
    };
    __setReadDepsForTest({
      openChat: async () => fakeReadPage(
        evaluateResult,
        fakeFilesPanelExtras(evaluateResult, {
          fileButtonCount: 1,
          fileEntries: [
            {
              downloadUrl: 'https://chatgpt.com/backend-api/files/download/file_abc',
              contentUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file_abc&sig=xyz',
              authHeader: 'Bearer test-token',
              metaJson: { status: 'success', download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_abc&sig=xyz' },
              contentJson: {
                title: 'Report Title',
                widget_state: { report_message: { content: { parts: ['# Report Title\n\nBody text.'] } } }
              }
            }
          ]
        })
      )
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.count).toBe(2);
    expect(output.messages[1]).toEqual({
      role: 'report',
      title: 'Report Title',
      text: '# Report Title\n\nBody text.'
    });
  });

  test('read finds no report when the chat has no Files-in-chat panel', async () => {
    const evaluateResult = {
      url: 'https://chatgpt.com/c/abc',
      messages: [{ role: 'user', text: 'hi', title: '' }]
    };
    __setReadDepsForTest({
      openChat: async () => fakeReadPage(
        evaluateResult,
        fakeFilesPanelExtras(evaluateResult, { menuButtonPresent: false })
      )
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages).toEqual([{ role: 'user', text: 'hi' }]);
  });

  test('read resolves multiple report files from the Files-in-chat panel', async () => {
    const evaluateResult = { url: 'https://chatgpt.com/c/abc', messages: [] };
    __setReadDepsForTest({
      openChat: async () => fakeReadPage(
        evaluateResult,
        fakeFilesPanelExtras(evaluateResult, {
          fileButtonCount: 2,
          fileEntries: [
            {
              downloadUrl: 'https://chatgpt.com/backend-api/files/download/file_one',
              contentUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file_one',
              metaJson: { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_one' },
              contentJson: { title: 'First', widget_state: { report_message: { content: { parts: ['# First'] } } } }
            },
            {
              downloadUrl: 'https://chatgpt.com/backend-api/files/download/file_two',
              contentUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file_two',
              metaJson: { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_two' },
              contentJson: { title: 'Second', widget_state: { report_message: { content: { parts: ['# Second'] } } } }
            }
          ]
        })
      )
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages).toEqual([
      { role: 'report', title: 'First', text: '# First' },
      { role: 'report', title: 'Second', text: '# Second' }
    ]);
  });

  test('read ignores a Files-in-chat entry whose content is not a report', async () => {
    const evaluateResult = {
      url: 'https://chatgpt.com/c/abc',
      messages: [{ role: 'user', text: 'hi', title: '' }]
    };
    __setReadDepsForTest({
      openChat: async () => fakeReadPage(
        evaluateResult,
        fakeFilesPanelExtras(evaluateResult, {
          fileButtonCount: 1,
          fileEntries: [
            {
              downloadUrl: 'https://chatgpt.com/backend-api/files/download/file_plain',
              contentUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file_plain',
              metaJson: { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_plain' },
              contentJson: { name: 'notes.txt', content: 'just a plain uploaded file' }
            }
          ]
        })
      )
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages).toEqual([{ role: 'user', text: 'hi' }]);
  });

  test('read resolves a code-interpreter generated file whose content is plain text, not JSON', async () => {
    const evaluateResult = {
      url: 'https://chatgpt.com/c/abc',
      messages: [{ role: 'user', text: 'erstelle mir eine markdown test datei', title: '' }]
    };
    __setReadDepsForTest({
      openChat: async () => fakeReadPage(
        evaluateResult,
        fakeFilesPanelExtras(evaluateResult, {
          fileButtonCount: 1,
          fileEntries: [
            {
              downloadUrl: 'https://chatgpt.com/backend-api/files/download/file_gen',
              contentUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file_gen&fn=markdown-test.md&sig=xyz',
              authHeader: 'Bearer test-token',
              metaJson: { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_gen&fn=markdown-test.md&sig=xyz' },
              contentText: '# Markdown Testdatei\n\nDies ist eine Testdatei.\n'
            }
          ]
        })
      )
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.count).toBe(2);
    expect(output.messages[1]).toEqual({
      role: 'file',
      title: 'markdown-test.md',
      text: '# Markdown Testdatei\n\nDies ist eine Testdatei.'
    });
  });
});
