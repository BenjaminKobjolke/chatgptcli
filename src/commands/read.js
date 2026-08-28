import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import { connectBridge, loadBrowserBridge } from '../core/opencli.js';
import { resolveBridgeProfile } from '../core/settings.js';
import { readScrapeScript, reportFrameScript } from './read_scrape.js';
import { resolveReportFiles } from './read_files_panel.js';
import {
  ATTACHMENT_KIND,
  downloadAttachments,
  normalizeAttachments,
  textAttachmentEntry,
  toPosixPath
} from './read_attachments.js';

// Turn containers, not role nodes: an image-only assistant reply has no role
// node, so counting role nodes underreports how much of the chat has mounted.
const TURN_SELECTOR = '[data-testid^="conversation-turn"], [data-message-author-role]';
const CHATGPT_ROOT_URL = 'https://chatgpt.com/';
const CHAT_HOSTS = Object.freeze(['chatgpt.com', 'chat.openai.com']);
const CHAT_PATH_PREFIX = '/c/';

function isChatHost(hostname) {
  return CHAT_HOSTS.includes(hostname) || hostname.endsWith('.chatgpt.com');
}

// Location test for a bare `read` (no URL argument). Deliberately NOT
// `normalizeChatUrl`: that one normalizes *user input*, so it coerces any
// prefix-less string into `https://chatgpt.com/c/<string>` (`about:blank`
// would become a bogus chat URL) and throws on a foreign host. Here a
// non-chat tab is a normal case, not an error.
function chatUrlFromLocation(href) {
  if (typeof href !== 'string' || !href) return null;
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return isChatHost(url.hostname) && url.pathname.startsWith(CHAT_PATH_PREFIX) ? url.href : null;
}

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
async function resolveReportFrames(rawMessages, page, context) {
  const placeholders = rawMessages.filter(
    (message) => message && message.role === 'report' && !message.text && message.reportFrameSrc
  );
  if (!placeholders.length) return;

  const frames = await page.frames();
  for (const placeholder of placeholders) {
    const frame = findReportFrame(frames, placeholder.reportFrameSrc);
    if (!frame) continue;

    const resolved = await page.evaluateInFrame(reportFrameScript(context.counters.image), frame.index);
    const title = resolved && typeof resolved.title === 'string' ? resolved.title : '';
    const text = resolved && typeof resolved.text === 'string' ? resolved.text : '';
    if (!title) continue;

    const images = Array.isArray(resolved.attachments) ? resolved.attachments : [];
    context.counters.image += images.length;
    // The report body lives in another origin, so its images can only be
    // fetched from inside that same frame.
    for (const image of images) {
      image.frameIndex = frame.index;
    }

    Object.assign(
      placeholder,
      textAttachmentEntry({ role: ATTACHMENT_KIND.REPORT, title, text }, context, images)
    );
  }
}

function normalizeEntry(value) {
  const object = value && typeof value === 'object' ? value : {};
  const role = typeof object.role === 'string' ? object.role : '';
  const text = typeof object.text === 'string' ? object.text : '';
  const title = typeof object.title === 'string' ? object.title : '';
  const attachments = normalizeAttachments(object.attachments);
  const entry = title ? { role, text, title } : { role, text };
  return attachments.length ? { ...entry, attachments } : entry;
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

  if (!isChatHost(url.hostname)) {
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
  // Waiting for the first message node is not enough: the page keeps mounting
  // turns for seconds afterwards, and scraping early silently truncates the
  // chat (confirmed live — a chat with 8 turns scraped as 5, losing every
  // image-only reply). Poll until the count stops growing instead.
  // ponytail: fixed 15s budget, no --timeout flag until someone needs it
  const startedAt = Date.now();
  let previousCount = -1;
  while (Date.now() - startedAt < 15000) {
    const count = await page.evaluate(`document.querySelectorAll(${JSON.stringify(TURN_SELECTOR)}).length`);
    if (count > 0 && count === previousCount) break;
    previousCount = count;
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

  // Without an argument the chat already open in the tab is the target — but it
  // still needs the same hard reload, or the stale tab hides the "More" menu
  // and the "Files in chat" panel and every attachment silently disappears.
  const url = input.url || chatUrlFromLocation(await page.evaluate('window.location.href').catch(() => ''));
  if (url) {
    await navigateAndWaitForMessages(page, url);
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
    const result = await page.evaluate(readScrapeScript(0));
    const rawMessages = Array.isArray(result?.messages) ? result.messages : [];
    // Ids run per kind across the whole chat, but each browser context numbers
    // its own images, so the running image count is handed to the next scrape.
    const context = {
      counters: { image: Number(result?.imageCount) || 0, report: 0, file: 0 },
      filesInline: Boolean(input.filesInline),
      // Read by the panel resolver to decide whether an image's bytes must
      // travel back with it — its signed URL may not survive a second fetch.
      filesOutputDir: input.filesOutputDir || ''
    };
    await resolveReportFrames(rawMessages, page, context);
    await resolveReportFiles(rawMessages, page, context);

    if (input.filesOutputDir) {
      mkdirSync(input.filesOutputDir, { recursive: true });
      await downloadAttachments({
        page,
        messages: rawMessages,
        filesOutputDir: input.filesOutputDir,
        fileId: input.fileId
      });
    }

    const messages = rawMessages
      .map(normalizeEntry)
      .filter((message) => message.text || message.attachments?.length);

    if (input.format === 'text') {
      return {
        exitCode: EXIT_CODE.SUCCESS,
        output: messages.map((message) => `[${message.role}]\n${message.text}`).join('\n\n')
      };
    }

    // Marker links keep the caller's own (possibly relative) path; the JSON
    // says once, unambiguously, which directory that resolved to.
    const filesOutputDir = input.filesOutputDir ? { filesOutputDir: toPosixPath(resolve(input.filesOutputDir)) } : {};

    return {
      exitCode: EXIT_CODE.SUCCESS,
      output: JSON.stringify(
        { ok: true, url: result?.url || '', count: messages.length, ...filesOutputDir, messages },
        null,
        2
      )
    };
  });
}

export const __test__ = { navigateAndWaitForMessages, chatUrlFromLocation };
