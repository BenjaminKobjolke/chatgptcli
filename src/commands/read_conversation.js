// Primary message source for `read`: the chat's own backend conversation JSON,
// fetched in-page with the session's bearer token.
//
// The DOM cannot serve this any more. ChatGPT virtualizes the chat list — only
// the handful of turns near the viewport are mounted, older ones load on scroll
// while newer ones unmount — so a DOM scrape returns the tail of a long chat and
// nothing says so. The JSON holds every message regardless of what is rendered.
//
// The endpoints are OpenAI-private and undocumented. When they stop answering,
// `readConversation` returns `null` and read.js falls back to the DOM scrape.
import { CHAT_PATH_MARKER } from '../core/chatgpt_site.js';
import {
  ATTACHMENT_KIND,
  FILE_DOWNLOAD_URL_PART,
  assetKeyOf,
  attachmentId,
  collectTargets,
  fetchSignedContent,
  markerFor,
  safeJsonParse
} from './read_attachments.js';
import { attachmentEntry, fetchAttachedFileEntry, normalizeReportFileJson } from './read_file_content.js';
import { conversationFetchFailure } from './read_failure.js';

const SESSION_URL = '/api/auth/session';
const CONVERSATION_URL = '/backend-api/conversation/';
const STATUS_OK = 200;
const ROLE = Object.freeze({ USER: 'user', ASSISTANT: 'assistant', TOOL: 'tool' });
const VISIBLE_CONTENT_TYPES = Object.freeze(['text', 'multimodal_text']);
const VISIBLE_RECIPIENT = 'all';
const IMAGE_PART_TYPE = 'image_asset_pointer';
// Citations arrive as private-use-delimited tokens (U+E200 cite U+E202 turn0search0 U+E201)
// that the web UI swaps for source pills; in a transcript they are noise.
const CITATION_PATTERN = /[^]*/g;
const HTTP_URL_PATTERN = /^https?:/i;
// A generated file is offered as a markdown link to its path in the code sandbox.
const SANDBOX_LINK_PATTERN = /sandbox:(\/mnt\/data\/[^\s)\]"']+)/g;
const SANDBOX_DOWNLOAD_PATH = '/interpreter/download';
const FIRST_HEADING_PATTERN = /^#\s+(.+)$/m;

// Kept thin: it only moves bytes out of the page. Everything that interprets
// them runs in Node, where it can be tested. The chat id comes from the tab's
// own location so a bare `read` (no URL argument) works the same way.
function conversationFetchScript() {
  return `(async () => {
    const chatId = location.pathname.split(${JSON.stringify(CHAT_PATH_MARKER)}).pop().split('/')[0];
    const result = { url: location.href, status: 0, loggedOut: false, offChat: !chatId, authHeader: '', body: '' };
    try {
      const session = await fetch(${JSON.stringify(SESSION_URL)}, { credentials: 'include' }).then((response) => response.json());
      // Set only once the session answered: a fetch that throws (a challenge
      // page, no network) must not read as "logged out".
      result.loggedOut = !session || !session.accessToken;
      if (result.loggedOut || result.offChat) return result;
      result.authHeader = 'Bearer ' + session.accessToken;
      const response = await fetch(${JSON.stringify(CONVERSATION_URL)} + chatId, {
        credentials: 'include',
        headers: { authorization: result.authHeader }
      });
      result.status = response.status;
      result.body = await response.text();
    } catch {}
    return result;
  })()`;
}

// Boundary normalizer. `null` means "no usable conversation" — a failed fetch,
// an error body, or a page that is not a chat — and sends the caller to the
// DOM fallback.
function normalizeConversationFetch(value) {
  const object = value && typeof value === 'object' ? value : {};
  if (object.status !== STATUS_OK || typeof object.body !== 'string') return null;

  const conversation = safeJsonParse(object.body);
  if (!conversation || typeof conversation !== 'object' || !conversation.mapping || typeof conversation.mapping !== 'object') {
    return null;
  }

  return {
    url: typeof object.url === 'string' ? object.url : '',
    authHeader: typeof object.authHeader === 'string' ? object.authHeader : '',
    conversation
  };
}

// `mapping` is a tree: regenerating or editing a message leaves the abandoned
// branch in place. The chat the user sees is the path from `current_node` up
// to the root. The Set guards the walk against a malformed, cyclic payload.
function activePath(conversation) {
  const { mapping } = conversation;
  const seen = new Set();
  const path = [];
  for (let id = conversation.current_node; mapping[id] && !seen.has(id); id = mapping[id].parent) {
    seen.add(id);
    path.unshift(mapping[id].message);
  }
  return path;
}

function uploadName(message, assetPointer) {
  const uploads = Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : [];
  const upload = uploads.find((entry) => entry && entry.id === assetKeyOf(assetPointer));
  return upload && typeof upload.name === 'string' ? upload.name : '';
}

// Most of the JSON is not conversation: reasoning, tool calls and their output,
// hidden system context. A generated image is the one thing a `tool` message
// contributes — the UI shows it as the assistant's reply, without the tool's
// own log text.
function messageEntry(message, imageOffset) {
  const object = message && typeof message === 'object' ? message : {};
  const role = object.author?.role;
  const content = object.content && typeof object.content === 'object' ? object.content : {};

  if (!Object.values(ROLE).includes(role)) return null;
  if (object.metadata?.is_visually_hidden_from_conversation) return null;
  if ((object.recipient ?? VISIBLE_RECIPIENT) !== VISIBLE_RECIPIENT) return null;
  if (!VISIBLE_CONTENT_TYPES.includes(content.content_type)) return null;

  const fromTool = role === ROLE.TOOL;
  const attachments = [];
  const blocks = (Array.isArray(content.parts) ? content.parts : [])
    .map((part) => {
      if (typeof part === 'string') return fromTool ? '' : part.replace(CITATION_PATTERN, '').trim();
      if (part?.content_type !== IMAGE_PART_TYPE || typeof part.asset_pointer !== 'string') return '';
      const id = attachmentId(ATTACHMENT_KIND.IMAGE, imageOffset + attachments.length + 1);
      attachments.push({
        id,
        kind: ATTACHMENT_KIND.IMAGE,
        name: uploadName(object, part.asset_pointer),
        src: part.asset_pointer
      });
      return markerFor(id);
    })
    .filter(Boolean);

  if (!blocks.length) return null;
  return { role: fromTool ? ROLE.ASSISTANT : role, text: blocks.join('\n\n'), title: '', attachments };
}

// Reports and generated files are found here but only become entries in
// `resolvePendingAttachments`: their ids come from counters read.js owns, and a
// file's content is a network fetch away. Until then each is a placeholder at
// its position in the chat — empty, so one that never resolves drops out of
// the transcript like any other empty entry.
function pendingEntry(role, pending) {
  return { role, text: '', title: '', attachments: [], pending };
}

// A Deep Research report is not a file reference: its whole markdown body sits
// in the widget state of the tool message that rendered the report card
// (confirmed live), so it needs no download at all. The title ChatGPT shows
// is the body's own first heading; the plan carries only a working title.
function pendingReport(message) {
  const state = safeJsonParse(message?.metadata?.chatgpt_sdk?.widget_state);
  if (!state || typeof state !== 'object') return null;
  const report = normalizeReportFileJson({ title: state.plan?.title, widget_state: state });
  if (!report) return null;
  const title = report.text.match(FIRST_HEADING_PATTERN)?.[1].trim() || report.title;
  return pendingEntry(ATTACHMENT_KIND.REPORT, { role: ATTACHMENT_KIND.REPORT, text: report.text, title });
}

// A generated file's `file_<id>` is nowhere in the JSON (confirmed live). The
// reply that offers it links its sandbox path instead, and the interpreter
// download endpoint turns message id + path into the same signed-URL answer
// the files endpoint gives.
function pendingFiles(message, text, conversationId) {
  if (message.author?.role !== ROLE.ASSISTANT || !message.id || !conversationId) return [];
  const paths = new Set(Array.from(text.matchAll(SANDBOX_LINK_PATTERN), (match) => match[1]));
  return Array.from(paths, (path) =>
    pendingEntry(ATTACHMENT_KIND.FILE, {
      downloadUrl:
        `${CONVERSATION_URL}${conversationId}${SANDBOX_DOWNLOAD_PATH}` +
        `?message_id=${encodeURIComponent(message.id)}&sandbox_path=${encodeURIComponent(path)}`
    })
  );
}

function conversationMessages(conversation) {
  const messages = [];
  let imageCount = 0;
  for (const message of activePath(conversation)) {
    const report = pendingReport(message);
    if (report) {
      messages.push(report);
      continue;
    }
    const entry = messageEntry(message, imageCount);
    if (!entry) continue;
    imageCount += entry.attachments.length;
    messages.push(entry, ...pendingFiles(message, entry.text, conversation.conversation_id));
  }
  return { messages, imageCount };
}

// `result` has the same `{ url, messages, imageCount }` shape as the DOM scrape
// so read.js consumes either source through one code path, plus the bearer
// header later fetches need. `imagesPositioned` tells the panel resolver that
// every image of the chat already has its marker. `result` is `null` when the
// fetch was unusable; `failure` then says why, if the fetch could tell.
export async function readConversation(page) {
  const raw = await page.evaluate(conversationFetchScript());
  const fetched = normalizeConversationFetch(raw);
  const result = fetched && {
    url: fetched.url,
    authHeader: fetched.authHeader,
    imagesPositioned: true,
    ...conversationMessages(fetched.conversation)
  };
  return { result, failure: conversationFetchFailure(raw) };
}

// Turns the placeholders `conversationMessages` left behind into report and
// file entries, in place. A file that no longer resolves (an expired sandbox)
// stays an empty placeholder; the Files-in-chat panel still gets its chance.
export async function resolvePendingAttachments({ page, messages, authHeader, context }) {
  for (const message of messages) {
    const { pending } = message;
    if (!pending) continue;
    delete message.pending;

    const fileEntry = pending.downloadUrl
      ? await fetchAttachedFileEntry(page, pending.downloadUrl, authHeader, {
          wantBytes: Boolean(context.filesOutputDir),
          isGeneratedFile: true
        }).catch(() => null)
      : pending;
    if (fileEntry) Object.assign(message, attachmentEntry(fileEntry, context));
  }
}

// An image in the JSON is an asset pointer (`sediment://file_<id>`), not a
// URL. It is turned into a signed, fetchable one only when a download was
// asked for — one request per image is not worth paying on every read.
export async function resolveImagePointers({ page, messages, authHeader, fileId }) {
  if (!authHeader) return;

  for (const { attachment } of collectTargets(messages, fileId)) {
    const assetId = assetKeyOf(attachment.src);
    if (attachment.kind !== ATTACHMENT_KIND.IMAGE || !assetId || HTTP_URL_PATTERN.test(attachment.src)) continue;

    const signed = await fetchSignedContent(page, FILE_DOWNLOAD_URL_PART + assetId, authHeader);
    if (!signed.url) continue;
    attachment.src = signed.url;
    attachment.authHeader = authHeader;
  }
}

export const __test__ = { conversationMessages, normalizeConversationFetch };
