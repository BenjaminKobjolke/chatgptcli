import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCli } from '../src/cli.js';
import { __resetReadDepsForTest, __setReadDepsForTest } from '../src/commands/read.js';
import { __resetAttachmentDepsForTest, __setAttachmentDepsForTest, toPosixPath } from '../src/commands/read_attachments.js';
import { bindOriginalStdio, captureStderr, captureStdout, fakeReadPage, restoreStdio } from './test_helpers.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

const originalStdio = bindOriginalStdio();
let outputDir;

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
  __resetAttachmentDepsForTest();
  outputDir = mkdtempSync(join(tmpdir(), 'chatgptcli-attachments-'));
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
  __resetAttachmentDepsForTest();
  rmSync(outputDir, { recursive: true, force: true });
});

// Builds the top-frame scrape result for a chat whose assistant turn already
// carries its image markers, as the in-page scrape would have produced them.
function chatWithImages(attachments) {
  return {
    url: 'https://chatgpt.com/c/abc',
    imageCount: attachments.length,
    messages: [
      {
        role: 'assistant',
        title: '',
        text: `Here:\n\n${attachments.map((attachment) => `[${attachment.id}]`).join('\n\n')}`,
        attachments
      }
    ]
  };
}

function stubChat(evaluateResult, { dataUrl = PNG_DATA_URL } = {}) {
  __setReadDepsForTest({
    openChat: async () => fakeReadPage(evaluateResult, {
      evaluate: async (script) => {
        if (script.includes('MESSAGE_ATTR')) return evaluateResult;
        if (script.includes('readAsDataURL')) return dataUrl;
        return null;
      }
    })
  });
}

describe('read --files-output', () => {
  test('writes an image fetched in-page and rewrites its marker to a link', async () => {
    stubChat(chatWithImages([
      { id: 'image-01', kind: 'image', src: 'https://files.oaiusercontent.com/chart.png', name: 'chart.png' }
    ]));

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json', '--files-output', outputDir]);

    expect(code).toBe(0);
    const written = join(outputDir, 'image-01.png');
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written).toString('base64')).toBe(PNG_BASE64);

    const output = JSON.parse(stdout.join(''));
    const expectedPath = toPosixPath(written);
    expect(output.messages[0].text).toContain(`![image-01](${expectedPath})`);
    expect(output.messages[0].attachments).toEqual([
      {
        id: 'image-01',
        kind: 'image',
        name: 'chart.png',
        src: 'https://files.oaiusercontent.com/chart.png',
        file: expectedPath
      }
    ]);
  });

  test('falls back to a node fetch when the in-page fetch is CORS-blocked', async () => {
    stubChat(chatWithImages([
      { id: 'image-01', kind: 'image', src: 'https://files.oaiusercontent.com/chart.png', name: 'chart.png' }
    ]), { dataUrl: '' });
    __setAttachmentDepsForTest({
      nodeFetch: async () => ({ ok: true, arrayBuffer: async () => Buffer.from(PNG_BASE64, 'base64') })
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json', '--files-output', outputDir]);

    expect(code).toBe(0);
    expect(existsSync(join(outputDir, 'image-01.png'))).toBe(true);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages[0].attachments[0].file).toBe(toPosixPath(join(outputDir, 'image-01.png')));
    // A relative --files-output is otherwise ambiguous: the caller cannot tell
    // which cwd the files landed under.
    expect(output.filesOutputDir).toBe(toPosixPath(resolve(outputDir)));
  });

  test('leaves the bare marker in place when both fetch paths fail', async () => {
    stubChat(chatWithImages([
      { id: 'image-01', kind: 'image', src: 'https://files.oaiusercontent.com/chart.png', name: 'chart.png' }
    ]), { dataUrl: '' });
    __setAttachmentDepsForTest({
      nodeFetch: async () => {
        throw new Error('network down');
      }
    });

    const stdout = captureStdout();
    const stderrChunks = captureStderr();
    const code = await runCli(['read', 'abc', '-f', 'json', '--files-output', outputDir]);

    expect(code).toBe(0);
    expect(existsSync(join(outputDir, 'image-01.png'))).toBe(false);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages[0].text).toContain('[image-01]');
    expect(output.messages[0].attachments[0].file).toBeUndefined();
    // A silent skip is indistinguishable from a chat that had no attachment.
    expect(stderrChunks.join('')).toContain('image-01');
  });

  test('--file-id writes only the requested attachment', async () => {
    stubChat(chatWithImages([
      { id: 'image-01', kind: 'image', src: 'https://files.oaiusercontent.com/one.png', name: 'one.png' },
      { id: 'image-02', kind: 'image', src: 'https://files.oaiusercontent.com/two.png', name: 'two.png' }
    ]));

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json', '--files-output', outputDir, '--file-id', 'image-02']);

    expect(code).toBe(0);
    expect(existsSync(join(outputDir, 'image-01.png'))).toBe(false);
    expect(existsSync(join(outputDir, 'image-02.png'))).toBe(true);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages[0].text).toContain('[image-01]');
    expect(output.messages[0].text).toContain('![image-02](');
  });

  test('an unknown --file-id fails with INPUT_INVALID and lists the known ids', async () => {
    stubChat(chatWithImages([
      { id: 'image-01', kind: 'image', src: 'https://files.oaiusercontent.com/one.png', name: 'one.png' }
    ]));

    captureStdout();
    const stderrChunks = captureStderr();
    const code = await runCli(['read', 'abc', '-f', 'json', '--files-output', outputDir, '--file-id', 'image-99']);

    expect(code).toBe(2);
    expect(stderrChunks.join('')).toContain('image-01');
  });

  test('a message whose only content is an image survives the empty-text filter', async () => {
    stubChat({
      url: 'https://chatgpt.com/c/abc',
      imageCount: 1,
      messages: [
        {
          role: 'user',
          title: '',
          text: '[image-01]',
          attachments: [{ id: 'image-01', kind: 'image', src: 'https://files.oaiusercontent.com/p.png', name: 'p.png' }]
        }
      ]
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    const output = JSON.parse(stdout.join(''));
    expect(output.count).toBe(1);
    expect(output.messages[0].attachments[0].id).toBe('image-01');
  });
});

describe('read attachment argument validation', () => {
  test('--file-id without --files-output is rejected', async () => {
    const stderrChunks = captureStderr();
    const code = await runCli(['read', 'abc', '--file-id', 'image-01']);

    expect(code).toBe(2);
    expect(stderrChunks.join('')).toContain('--files-output');
  });
});
