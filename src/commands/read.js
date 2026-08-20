import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import { loadBrowserBridge } from '../core/opencli.js';

const MESSAGE_SELECTOR = '[data-message-author-role]';

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
  const page = await bridge.connect({ timeout: 30, session: 'site:chatgpt' });

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
  const { bridge, page } = await openChat(input);

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
  const { bridge, page } = await openChat(input);

  try {
    const result = await page.evaluate(`(() => {
      return {
        url: location.href,
        messages: Array.from(document.querySelectorAll(${JSON.stringify(MESSAGE_SELECTOR)}))
          .map((node) => ({
            role: node.getAttribute('data-message-author-role'),
            text: (node instanceof HTMLElement ? node.innerText : node?.textContent || '').trim()
          }))
          .filter((message) => message.text)
      };
    })()`);

    const messages = Array.isArray(result?.messages) ? result.messages : [];

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
