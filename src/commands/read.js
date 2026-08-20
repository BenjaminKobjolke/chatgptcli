import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import { connectBridge, loadBrowserBridge } from '../core/opencli.js';
import { resolveBridgeProfile } from '../core/settings.js';
import { READ_SCRAPE_SCRIPT, REPORT_FRAME_SCRIPT } from './read_scrape.js';
import { resolveReportFiles } from './read_files_panel.js';

const MESSAGE_SELECTOR = '[data-message-author-role]';
const CHATGPT_ROOT_URL = 'https://chatgpt.com/';

let openChatImpl = openChat;

export function __setReadDepsForTest(deps) {
  if (deps.openChat) {
    openChatImpl = deps.openChat;
  }
}

export function __resetReadDepsForTest() {
  openChatImpl = openChat;
}

// Matches a report placeholder's `reportFrameSrc` (from read_scrape.js) to a
// page.frames() entry: exact URL first, falling back to same-host (the
// report iframe's src can carry a query string that varies per load).
function findReportFrame(frames, src) {
  if (!Array.isArray(frames) || !src) return null;
  const exact = frames.find((frame) => frame && frame.url === src);
  if (exact) return exact;
  try {
    const host = new URL(src).host;
    return frames.find((frame) => {
      try {
        return frame && new URL(frame.url).host === host;
      } catch {
        return false;
      }
    }) || null;
  } catch {
    return null;
  }
}

// Resolves report-iframe placeholders in place by evaluating
// REPORT_FRAME_SCRIPT inside each matched cross-origin frame. A report
// always opens with a heading (see REPORT_FRAME_SCRIPT); the deep-research
// UI renders a few sibling iframes for its title/status chrome sharing the
// same frame title, so a placeholder that resolves without a title is that
// chrome, not the report body, and is left empty to be filtered out below.
async function resolveReportFrames(rawMessages, page) {
  const placeholders = rawMessages.filter(
    (message) => message && message.role === 'report' && !message.text && message.reportFrameSrc
  );
  if (!placeholders.length) return;

  const frames = await page.frames();
  for (const placeholder of placeholders) {
    const frame = findReportFrame(frames, placeholder.reportFrameSrc);
    if (!frame) continue;

    const resolved = await page.evaluateInFrame(REPORT_FRAME_SCRIPT, frame.index);
    const title = resolved && typeof resolved.title === 'string' ? resolved.title : '';
    const text = resolved && typeof resolved.text === 'string' ? resolved.text : '';
    if (title) {
      placeholder.title = title;
      placeholder.text = text;
    }
  }
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

// `page.goto` on a URL the tab is already sitting on is a no-op (no reload) —
// confirmed live (see PLAN.md) to leave a stale, already-open chat tab in a
// broken DOM state (e.g. the "Files in chat" panel silently failing to
// resolve). Navigating to a neutral URL first forces a real reload before
// landing on the target, which fixed the flakiness in repeated live testing.
async function navigateAndWaitForMessages(page, url) {
  await page.goto(CHATGPT_ROOT_URL, { settleMs: 1000 });
  await page.goto(url, { settleMs: 1500 });
  // ponytail: fixed 10s poll for message nodes, no --timeout flag until someone needs it
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const count = await page.evaluate(`document.querySelectorAll(${JSON.stringify(MESSAGE_SELECTOR)}).length`);
    if (count > 0) break;
    await page.wait(1);
  }
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
    await navigateAndWaitForMessages(page, input.url);
  }

  return { bridge, page };
}

async function withOpenChat(input, fn) {
  const { bridge, page } = await openChatImpl(input);
  try {
    return await fn(page);
  } finally {
    await bridge.close().catch(() => {});
  }
}

export async function runSwitch(input) {
  return withOpenChat(input, async (page) => {
    const url = await page.evaluate('window.location.href');
    return {
      exitCode: EXIT_CODE.SUCCESS,
      output: JSON.stringify({ ok: true, url }, null, 2)
    };
  });
}

export async function runRead(input) {
  return withOpenChat(input, async (page) => {
    const result = await page.evaluate(READ_SCRAPE_SCRIPT);
    const rawMessages = Array.isArray(result?.messages) ? result.messages : [];
    await resolveReportFrames(rawMessages, page);
    await resolveReportFiles(rawMessages, page);

    const messages = rawMessages.map(normalizeEntry).filter((message) => message.text);

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
  });
}

export const __test__ = { navigateAndWaitForMessages };
