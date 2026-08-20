import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import { connectBridge, loadBrowserBridge } from '../core/opencli.js';
import { resolveBridgeProfile } from '../core/settings.js';
import { READ_SCRAPE_SCRIPT } from './read_scrape.js';

const MESSAGE_SELECTOR = '[data-message-author-role]';

let openChatImpl = openChat;

export function __setReadDepsForTest(deps) {
  if (deps.openChat) {
    openChatImpl = deps.openChat;
  }
}

export function __resetReadDepsForTest() {
  openChatImpl = openChat;
}

function normalizeEntry(value) {
  const object = value && typeof value === 'object' ? value : {};
  const role = typeof object.role === 'string' ? object.role : '';
  const text = typeof object.text === 'string' ? object.text : '';
  const title = typeof object.title === 'string' ? object.title : '';
  return title ? { role, text, title } : { role, text };
}

export function normalizeChatUrl(target) {
  if (!target) return null;

  if (!/^https?:\/\//i.test(target)) {
    return `https://chatgpt.com/c/${target}`;
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `Invalid chat URL: ${target}`);
  }

  const hostname = url.hostname;
  if (hostname !== 'chatgpt.com' && !hostname.endsWith('.chatgpt.com') && hostname !== 'chat.openai.com') {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `Not a ChatGPT URL: ${target}`, {
      hint: 'Use a https://chatgpt.com/c/... URL or a bare chat id.'
    });
  }

  return url.href;
}

async function openChat(input) {
  const { BrowserBridge } = await loadBrowserBridge();
  const bridge = new BrowserBridge();
  const page = await connectBridge(bridge, {
    timeout: 30,
    session: 'site:chatgpt',
    preferredContextId: resolveBridgeProfile()
  });

  if (input.url) {
    await page.goto(input.url, { settleMs: 1500 });
    // ponytail: fixed 10s poll for message nodes, no --timeout flag until someone needs it
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10000) {
      const count = await page.evaluate(`document.querySelectorAll(${JSON.stringify(MESSAGE_SELECTOR)}).length`);
      if (count > 0) break;
      await page.wait(1);
    }
  }

  return { bridge, page };
}

export async function runSwitch(input) {
  const { bridge, page } = await openChatImpl(input);

  try {
    const url = await page.evaluate('window.location.href');
    return {
      exitCode: EXIT_CODE.SUCCESS,
      output: JSON.stringify({ ok: true, url }, null, 2)
    };
  } finally {
    await bridge.close().catch(() => {});
  }
}

export async function runRead(input) {
  const { bridge, page } = await openChatImpl(input);

  try {
    const result = await page.evaluate(READ_SCRAPE_SCRIPT);

    const messages = Array.isArray(result?.messages)
      ? result.messages.map(normalizeEntry).filter((message) => message.text)
      : [];

    if (input.format === 'text') {
      return {
        exitCode: EXIT_CODE.SUCCESS,
        output: messages.map((message) => `[${message.role}]\n${message.text}`).join('\n\n')
      };
    }

    return {
      exitCode: EXIT_CODE.SUCCESS,
      output: JSON.stringify({ ok: true, url: result?.url || '', count: messages.length, messages }, null, 2)
    };
  } finally {
    await bridge.close().catch(() => {});
  }
}
