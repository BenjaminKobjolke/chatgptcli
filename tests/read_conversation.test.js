import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { __resetReadDepsForTest, __setReadDepsForTest } from '../src/commands/read.js';
import { __test__ as conversationHelpers } from '../src/commands/read_conversation.js';
import {
  bindOriginalStdio,
  captureStderr,
  captureStdout,
  fakeConversationExtras,
  fakeReadPage,
  restoreStdio
} from './test_helpers.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const CITATION = 'citeturn0search0';

const originalStdio = bindOriginalStdio();
let outputDir;

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
  outputDir = mkdtempSync(join(tmpdir(), 'chatgptcli-conversation-'));
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
  rmSync(outputDir, { recursive: true, force: true });
});

function message(role, parts, extra = {}) {
  return {
    author: { role },
    recipient: 'all',
    content: { content_type: parts.every((part) => typeof part === 'string') ? 'text' : 'multimodal_text', parts },
    metadata: {},
    ...extra
  };
}

function imagePart(fileId) {
  return { content_type: 'image_asset_pointer', asset_pointer: `sediment://${fileId}` };
}

// A linear chat: each message is the child of the one before it.
function chain(messages) {
  const mapping = { root: { parent: null, message: null } };
  let parent = 'root';
  messages.forEach((entry, index) => {
    const id = `node-${index}`;
    mapping[id] = { parent, message: entry };
    parent = id;
  });
  return { current_node: parent, mapping };
}

function stubConversation(conversation, options) {
  __setReadDepsForTest({
    openChat: async () => fakeReadPage(null, fakeConversationExtras(conversation, options))
  });
}

describe('conversationMessages', () => {
  test('keeps only what the chat visibly shows, with citation markup stripped', () => {
    const conversation = chain([
      message('system', ['hidden system prompt'], { metadata: { is_visually_hidden_from_conversation: true } }),
      message('user', ['question']),
      message('assistant', ['search query'], { recipient: 'web.run' }),
      message('tool', ['search results']),
      { ...message('assistant', ['thinking']), content: { content_type: 'thoughts', parts: ['thinking'] } },
      message('assistant', [`answer ${CITATION}done`])
    ]);

    expect(conversationHelpers.conversationMessages(conversation)).toEqual({
      imageCount: 0,
      messages: [
        { role: 'user', text: 'question', title: '', attachments: [] },
        { role: 'assistant', text: 'answer done', title: '', attachments: [] }
      ]
    });
  });

  // Regenerating or editing leaves the abandoned branch in `mapping`; only the
  // path from `current_node` up to the root is the chat the user sees.
  test('follows the active branch and ignores a regenerated sibling', () => {
    const conversation = chain([message('user', ['question']), message('assistant', ['kept answer'])]);
    conversation.mapping.abandoned = { parent: 'node-0', message: message('assistant', ['discarded answer']) };

    const texts = conversationHelpers.conversationMessages(conversation).messages.map((entry) => entry.text);

    expect(texts).toEqual(['question', 'kept answer']);
  });

  test('turns an uploaded image into a positioned marker named after the upload', () => {
    const conversation = chain([
      message('user', [imagePart('file_00aa'), 'what is this?'], {
        metadata: { attachments: [{ id: 'file_00aa', name: 'screenshot.png' }] }
      })
    ]);

    expect(conversationHelpers.conversationMessages(conversation)).toEqual({
      imageCount: 1,
      messages: [
        {
          role: 'user',
          text: '[image-01]\n\nwhat is this?',
          title: '',
          attachments: [{ id: 'image-01', kind: 'image', name: 'screenshot.png', src: 'sediment://file_00aa' }]
        }
      ]
    });
  });

  test('a generated image arrives from a tool message and reads as an assistant reply', () => {
    const conversation = chain([
      message('user', ['draw a cat']),
      message('tool', [imagePart('file_00bb'), 'internal generation log'])
    ]);

    const { messages } = conversationHelpers.conversationMessages(conversation);

    expect(messages[1].role).toBe('assistant');
    expect(messages[1].text).toBe('[image-01]');
  });
});

// A Deep Research report is not a file reference in the JSON: its whole body
// sits in the widget state of the tool message that rendered the report card.
function reportMessage(title, body) {
  return message('tool', ['widget'], {
    content: { content_type: 'code', text: '{}' },
    metadata: {
      chatgpt_sdk: { widget_state: JSON.stringify({ plan: { title }, report_message: { content: { parts: [body] } } }) }
    }
  });
}

describe('read: reports and generated files from the backend conversation', () => {
  // Titled by its own first heading — what ChatGPT shows — not by the research plan's working title.
  test('a deep research report becomes a report entry at its place in the chat', async () => {
    stubConversation(chain([message('user', ['research x']), reportMessage('Working title', '# Report Title\n\nBody.'), message('assistant', ['anything else?'])]));

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).messages).toEqual([
      { role: 'user', text: 'research x' },
      {
        role: 'report',
        title: 'Report Title',
        text: '[report-01]',
        attachments: [{ id: 'report-01', kind: 'report', name: 'Report Title' }]
      },
      { role: 'assistant', text: 'anything else?' }
    ]);
  });

  test('--files-inline prints the report body from the conversation', async () => {
    stubConversation(chain([message('user', ['research x']), reportMessage('Working title', '# Report Title\n\nBody.')]));

    const stdout = captureStdout();
    await runCli(['read', 'abc', '-f', 'json', '--files-inline']);

    expect(JSON.parse(stdout.join('')).messages[1].text).toBe('# Report Title\n\nBody.');
  });

  // The file's `file_<id>` is nowhere in the JSON; the sandbox link in the
  // reply is, and the interpreter download endpoint resolves it.
  test('a generated file is resolved from its sandbox link, right after the reply that offers it', async () => {
    const reply = 'Here it is: [backup.ps1](sandbox:/mnt/data/backup.ps1) — and again [backup.ps1](sandbox:/mnt/data/backup.ps1)';
    const messages = [message('user', ['write a script']), message('assistant', [reply], { id: 'msg-1' }), message('user', ['thanks'])];
    stubConversation({ ...chain(messages), conversation_id: 'abc' }, {
      sandboxFiles: { '/mnt/data/backup.ps1': 'Write-Host "hi"' }
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json', '--files-inline']);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).messages).toEqual([
      { role: 'user', text: 'write a script' },
      { role: 'assistant', text: reply },
      {
        role: 'file',
        title: 'backup.ps1',
        text: 'Write-Host "hi"',
        attachments: [{ id: 'file-01', kind: 'file', name: 'backup.ps1' }]
      },
      { role: 'user', text: 'thanks' }
    ]);
  });

  // An expired sandbox must not cost the transcript; the Files-in-chat panel
  // still gets its chance at the file afterwards.
  test('a sandbox link that no longer resolves leaves the transcript intact', async () => {
    const gone = message('assistant', ['[gone.txt](sandbox:/mnt/data/gone.txt)'], { id: 'msg-1' });
    stubConversation({ ...chain([gone]), conversation_id: 'abc' });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).messages).toEqual([
      { role: 'assistant', text: '[gone.txt](sandbox:/mnt/data/gone.txt)' }
    ]);
  });
});

describe('normalizeConversationFetch', () => {
  test('rejects anything that is not a 200 response carrying a conversation', () => {
    const body = JSON.stringify(chain([message('user', ['hi'])]));

    expect(conversationHelpers.normalizeConversationFetch({ status: 200, body })).not.toBeNull();
    expect(conversationHelpers.normalizeConversationFetch({ status: 404, body })).toBeNull();
    expect(conversationHelpers.normalizeConversationFetch({ status: 200, body: '<html>' })).toBeNull();
    expect(conversationHelpers.normalizeConversationFetch({ status: 200, body: '{"detail":"x"}' })).toBeNull();
    expect(conversationHelpers.normalizeConversationFetch(null)).toBeNull();
  });
});

describe('read from the backend conversation', () => {
  test('returns the whole transcript without touching the DOM scrape', async () => {
    stubConversation(chain([message('user', ['hi']), message('assistant', ['hello'])]));

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join(''))).toEqual({
      ok: true,
      url: 'https://chatgpt.com/c/abc',
      count: 2,
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello' }
      ]
    });
  });

  // An empty transcript used to exit 0 with `count: 0` — indistinguishable
  // from success, which is how a ChatGPT markup change went unnoticed.
  test('a chat that yields no messages fails instead of reporting success', async () => {
    stubConversation(chain([message('tool', ['only chrome'])]));

    captureStdout();
    const stderr = captureStderr();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(5);
    expect(stderr.join('')).toContain('No messages');
  });

  test('--files-output resolves an image pointer to its signed URL and writes the file', async () => {
    const requests = [];
    stubConversation(chain([message('user', [imagePart('file_00aa')])]), { dataUrl: PNG_DATA_URL, requests });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json', '--files-output', outputDir]);

    expect(code).toBe(0);
    expect(requests).toEqual(['file_00aa']);
    expect(existsSync(join(outputDir, 'image-01.png'))).toBe(true);
    expect(JSON.parse(stdout.join('')).messages[0].text).toContain('![image-01](');
  });

  test('--file-id resolves only the requested image pointer', async () => {
    const requests = [];
    stubConversation(chain([message('user', [imagePart('file_00aa'), imagePart('file_00bb')])]), {
      dataUrl: PNG_DATA_URL,
      requests
    });

    captureStdout();
    const code = await runCli(['read', 'abc', '--files-output', outputDir, '--file-id', 'image-02']);

    expect(code).toBe(0);
    expect(requests).toEqual(['file_00bb']);
    expect(existsSync(join(outputDir, 'image-01.png'))).toBe(false);
    expect(existsSync(join(outputDir, 'image-02.png'))).toBe(true);
  });
});
