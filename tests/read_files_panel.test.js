import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { __resetReadDepsForTest, __setReadDepsForTest } from '../src/commands/read.js';
import { toPosixPath } from '../src/commands/read_attachments.js';
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

const REPORT_BODY = '# Report Title\n\nBody text.';

function stubReportChat() {
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
              widget_state: { report_message: { content: { parts: [REPORT_BODY] } } }
            }
          }
        ]
      })
    )
  });
}

describe('read: Files-in-chat report resolution', () => {
  test('a deep research report resolves to a marker entry by default', async () => {
    stubReportChat();

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.count).toBe(2);
    expect(output.messages[1]).toEqual({
      role: 'report',
      title: 'Report Title',
      text: '[report-01]',
      attachments: [{ id: 'report-01', kind: 'report', name: 'Report Title' }]
    });
  });

  test('--files-inline restores the inlined report body', async () => {
    stubReportChat();

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json', '--files-inline']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages[1].text).toBe(REPORT_BODY);
  });

  test('--files-output writes the report body and links the marker', async () => {
    stubReportChat();
    const outputDir = mkdtempSync(join(tmpdir(), 'chatgptcli-report-'));

    try {
      const stdout = captureStdout();
      const code = await runCli(['read', 'abc', '-f', 'json', '--files-output', outputDir]);

      expect(code).toBe(0);
      const written = join(outputDir, 'report-01.md');
      expect(readFileSync(written, 'utf8')).toBe(REPORT_BODY);

      const output = JSON.parse(stdout.join(''));
      expect(output.messages[1].text).toBe(`![report-01](${toPosixPath(written)})`);
      expect(output.messages[1].attachments[0].file).toBe(toPosixPath(written));
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  // An uploaded screenshot is not rendered as an <img> in its message turn, so
  // the panel is the only place `read` can see it — and its bytes are binary,
  // never text.
  test('an image in the panel becomes an image marker, not a mojibake file body', async () => {
    const evaluateResult = {
      url: 'https://chatgpt.com/c/abc',
      messages: [{ role: 'user', text: 'look at this gui', title: '' }]
    };
    __setReadDepsForTest({
      openChat: async () => fakeReadPage(
        evaluateResult,
        fakeFilesPanelExtras(evaluateResult, {
          fileButtonCount: 1,
          fileEntries: [
            {
              downloadUrl: 'https://chatgpt.com/backend-api/files/download/file_img',
              contentUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file_img&fn=screenshot.png&sig=xyz',
              authHeader: 'Bearer test-token',
              metaJson: { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_img&fn=screenshot.png&sig=xyz' },
              imageMime: 'image/png'
            }
          ]
        })
      )
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages[1].text).toBe('[image-01]');
    expect(output.messages[1].attachments).toEqual([
      {
        id: 'image-01',
        kind: 'image',
        name: 'screenshot.png',
        src: 'https://chatgpt.com/backend-api/estuary/content?id=file_img&fn=screenshot.png&sig=xyz'
      }
    ]);
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
      {
        role: 'report',
        title: 'First',
        text: '[report-01]',
        attachments: [{ id: 'report-01', kind: 'report', name: 'First' }]
      },
      {
        role: 'report',
        title: 'Second',
        text: '[report-02]',
        attachments: [{ id: 'report-02', kind: 'report', name: 'Second' }]
      }
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
      text: '[file-01]',
      attachments: [{ id: 'file-01', kind: 'file', name: 'markdown-test.md' }]
    });
  });
});
