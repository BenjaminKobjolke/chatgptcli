import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAT_PATH_MARKER, SHARE_PATH_MARKER, hardNavigate, isChatHost, isSharePath } from '../core/chatgpt_site.js';
import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import { withSitePage } from '../../.omx/reference/opencli-app-kit/src/core/session.js';
import { resolveBridgeProfile } from '../core/settings.js';
import { readConversation, resolveImagePointers, resolvePendingAttachments } from './read_conversation.js';
import { EMPTY_TRANSCRIPT_ERROR, FETCH_FAILURE } from './read_failure.js';
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
// `[data-turn-key]` is the redesigned markup's turn; public shares expose each
// transcript item directly as `[data-message-role]`.
const TURN_SELECTOR = '[data-turn-key], [data-testid^="conversation-turn"], [data-message-author-role], [data-message-role]';

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
  return isChatHost(url.hostname)
    && (url.pathname.includes(CHAT_PATH_MARKER) || url.pathname.includes(SHARE_PATH_MARKER))
    ? url.href
    : null;
}

let openChatImpl = null;
let withSitePageImpl = withSitePage;

export function __setReadDepsForTest(deps) {
  if (deps.openChat) {
    openChatImpl = deps.openChat;
  }
  if (deps.withSitePage) {
    withSitePageImpl = deps.withSitePage;
  }
}

export function __resetReadDepsForTest() {
  openChatImpl = null;
  withSitePageImpl = withSitePage;
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
      hint: 'Use a https://chatgpt.com/c/... URL, a https://chatgpt.com/share/... URL, or a bare chat id.'
    });
  }

  return url.href;
}

async function navigateAndWaitForMessages(page, url) {
  await hardNavigate(page, url);
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

async function withOpenChat(input, fn) {
  if (openChatImpl) {
    const { bridge, page } = await openChatImpl(input);
    try {
      const url = input.url || chatUrlFromLocation(await page.evaluate('window.location.href').catch(() => ''));
      return await fn(page, url);
    } finally {
      await bridge.close().catch(() => {});
    }
  }

  return withSitePageImpl({
    appName: 'chatgptcli',
    session: 'site:chatgpt',
    timeout: 30,
    preferredContextId: resolveBridgeProfile()
  }, async (page) => {
    // Without an argument the already open chat is the target, but still hard-reload it.
    const url = input.url || chatUrlFromLocation(await page.evaluate('window.location.href').catch(() => ''));
    if (url) await navigateAndWaitForMessages(page, url);
    return fn(page, url);
  });
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
  return withOpenChat(input, async (page, targetUrl) => {
    // The backend JSON is complete; the DOM only holds the turns currently
    // mounted, so it is the fallback for when that endpoint stops answering.
    const conversation = await readConversation(page);
    const result = conversation.result ?? (await page.evaluate(readScrapeScript(0)));
    const rawMessages = Array.isArray(result?.messages) ? result.messages : [];
    // Ids run per kind across the whole chat, but each browser context numbers
    // its own images, so the running image count is handed to the next scrape.
    const context = {
      counters: { image: Number(result?.imageCount) || 0, report: 0, file: 0 },
      filesInline: Boolean(input.filesInline),
      imagesPositioned: Boolean(result?.imagesPositioned),
      // Read by the panel resolver to decide whether an image's bytes must
      // travel back with it — its signed URL may not survive a second fetch.
      filesOutputDir: input.filesOutputDir || ''
    };
    await resolvePendingAttachments({ page, messages: rawMessages, authHeader: result?.authHeader, context });
    await resolveReportFrames(rawMessages, page, context);
    await resolveReportFiles(rawMessages, page, context);

    if (input.filesOutputDir) {
      mkdirSync(input.filesOutputDir, { recursive: true });
      await resolveImagePointers({
        page,
        messages: rawMessages,
        authHeader: result?.authHeader,
        fileId: input.fileId
      });
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

    if (!messages.length) {
      const failure = isSharePath(targetUrl) ? FETCH_FAILURE.SHARE_UNREADABLE : conversation.failure;
      const { code, message, hint } = EMPTY_TRANSCRIPT_ERROR[failure];
      throw new AppError(code, message, { hint });
    }

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

export const __test__ = { navigateAndWaitForMessages, chatUrlFromLocation, normalizeChatUrl, withOpenChat };
