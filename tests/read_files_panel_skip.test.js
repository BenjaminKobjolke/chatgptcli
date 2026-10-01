import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runCli } from '../src/cli.js';
import { __resetReadDepsForTest, __setReadDepsForTest } from '../src/commands/read.js';
import {
  bindOriginalStdio,
  captureStdout,
  fakeConversationExtras,
  fakeFilesPanelExtras,
  fakeReadPage,
  restoreStdio
} from './test_helpers.js';

const originalStdio = bindOriginalStdio();

beforeEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

afterEach(() => {
  restoreStdio(originalStdio);
  __resetReadDepsForTest();
});

function generatedFile(id, name) {
  const contentUrl = `https://chatgpt.com/backend-api/estuary/content?id=${id}&fn=${name}`;
  return {
    downloadUrl: `https://chatgpt.com/backend-api/files/download/${id}`,
    contentUrl,
    metaJson: { download_url: contentUrl },
    contentText: `content of ${name}`
  };
}

// A chat whose one uploaded image already sits in its message.
const CHAT_WITH_IMAGE = {
  url: 'https://chatgpt.com/c/abc',
  imageCount: 1,
  messages: [
    {
      role: 'user',
      text: '[image-01]',
      title: '',
      attachments: [{ id: 'image-01', kind: 'image', name: 'shot.png', src: 'sediment://file_00aa' }]
    }
  ]
};

function stubPanel(evaluateResult, options) {
  __setReadDepsForTest({
    openChat: async () => fakeReadPage(evaluateResult, fakeFilesPanelExtras(evaluateResult, options))
  });
}

function toolMessage(extra) {
  return { author: { role: 'tool' }, recipient: 'all', content: { content_type: 'code', text: '' }, metadata: {}, ...extra };
}

// A one-message chat served from the conversation JSON, with a Files-in-chat
// panel behind it.
function stubConversationWithPanel(message, panelOptions) {
  const conversation = { current_node: 'a', mapping: { a: { parent: null, message } } };
  const panel = fakeFilesPanelExtras(null, panelOptions);
  const fromConversation = fakeConversationExtras(conversation);
  __setReadDepsForTest({
    openChat: async () => fakeReadPage(null, {
      ...panel,
      evaluate: async (script) => (await fromConversation.evaluate(script)) ?? panel.evaluate(script)
    })
  });
}

// Every panel entry costs a menu reopen, a click and a network poll, so an
// entry whose outcome is already known must not be clicked at all.
describe('read: Files-in-chat entries that are already known', () => {
  test('an image already placed in its message and a repeated listing are not clicked', async () => {
    const clicks = [];
    const script = generatedFile('file_gen', 'backup.ps1');
    stubPanel(CHAT_WITH_IMAGE, {
      fileLabels: ['backup.ps1', 'shot.png', 'backup.ps1'],
      fileEntries: [script, generatedFile('file_00aa', 'shot.png'), script],
      clicks
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(clicks).toEqual([0]);
    const output = JSON.parse(stdout.join(''));
    expect(output.messages.map((message) => message.text)).toEqual(['[image-01]', '[file-01]']);
  });

  // Nothing was clicked, so no viewer replaced the panel: it would stay open
  // in the user's own tab.
  test('a panel holding only known entries is closed again', async () => {
    const clicks = [];
    stubPanel(CHAT_WITH_IMAGE, {
      fileLabels: ['shot.png'],
      fileEntries: [generatedFile('file_00aa', 'shot.png')],
      clicks
    });

    captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(clicks).toEqual(['close-panel']);
  });

  // The conversation JSON positions every image, named or not, so a panel
  // entry that is an image has nothing left to add.
  test('images are not clicked once the conversation JSON has placed them', async () => {
    const clicks = [];
    const image = { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_00bb' };
    stubConversationWithPanel(toolMessage({ content: { content_type: 'multimodal_text', parts: [image] } }), {
      fileLabels: ['ChatGPT Image 1.png'],
      clicks
    });

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(clicks).toEqual(['close-panel']);
    expect(JSON.parse(stdout.join('')).messages.map((message) => message.text)).toEqual(['[image-01]']);
  });

  // The panel lists a report under a label of its own, so the name check
  // cannot catch it; its body can.
  test('a report the conversation JSON already delivered is not added a second time', async () => {
    const reportState = { report_message: { content: { parts: ['# Report'] } } };
    const contentUrl = 'https://chatgpt.com/backend-api/estuary/content?id=file_rep';
    stubConversationWithPanel(
      toolMessage({ metadata: { chatgpt_sdk: { widget_state: JSON.stringify({ plan: { title: 'Plan title' }, ...reportState }) } } }),
      {
        fileLabels: ['Report as listed'],
        fileEntries: [
          {
            downloadUrl: 'https://chatgpt.com/backend-api/files/download/file_rep',
            contentUrl,
            metaJson: { download_url: contentUrl },
            contentJson: { title: 'Report as listed', widget_state: reportState }
          }
        ]
      }
    );

    const stdout = captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).messages.map((message) => message.text)).toEqual(['[report-01]']);
  });

  test('entries without a label are all still clicked', async () => {
    const clicks = [];
    stubPanel({ url: 'https://chatgpt.com/c/abc', messages: [{ role: 'user', text: 'hi', title: '' }] }, {
      fileButtonCount: 2,
      fileEntries: [generatedFile('file_one', 'one.md'), generatedFile('file_two', 'two.md')],
      clicks
    });

    captureStdout();
    const code = await runCli(['read', 'abc', '-f', 'json']);

    expect(code).toBe(0);
    expect(clicks).toEqual([0, 1]);
  });
});
