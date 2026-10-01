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

const SESSION_URL = '/api/auth/session';
const CONVERSATION_URL = '/backend-api/conversation/';
const CHAT_PATH_MARKER = '/c/';
const STATUS_OK = 200;
const ROLE = Object.freeze({ USER: 'user', ASSISTANT: 'assistant', TOOL: 'tool' });
const VISIBLE_CONTENT_TYPES = Object.freeze(['text', 'multimodal_text']);
const VISIBLE_RECIPIENT = 'all';
const IMAGE_PART_TYPE = 'image_asset_pointer';
// Citations arrive as private-use-delimited tokens (U+E200 cite U+E202 turn0search0 U+E201)
// that the web UI swaps for source pills; in a transcript they are noise.
const CITATION_PATTERN = /[^]*/g;
const HTTP_URL_PATTERN = /^https?:/i;

// Kept thin: it only moves bytes out of the page. Everything that interprets
// them runs in Node, where it can be tested. The chat id comes from the tab's
// own location so a bare `read` (no URL argument) works the same way.
function conversationFetchScript() {
  return `(async () => {
    const result = { url: location.href, status: 0, authHeader: '', body: '' };
    try {
      const session = await fetch(${JSON.stringify(SESSION_URL)}, { credentials: 'include' }).then((response) => response.json());
      const chatId = location.pathname.split(${JSON.stringify(CHAT_PATH_MARKER)}).pop().split('/')[0];
      if (!session || !session.accessToken || !chatId) return result;
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

function conversationMessages(conversation) {
  const messages = [];
  let imageCount = 0;
  for (const message of activePath(conversation)) {
    const entry = messageEntry(message, imageCount);
    if (!entry) continue;
    imageCount += entry.attachments.length;
    messages.push(entry);
  }
  return { messages, imageCount };
}

// Returns the same `{ url, messages, imageCount }` shape as the DOM scrape so
// read.js consumes either source through one code path, plus the bearer header
// later fetches need.
export async function readConversation(page) {
  const fetched = normalizeConversationFetch(await page.evaluate(conversationFetchScript()));
  if (!fetched) return null;
  return { url: fetched.url, authHeader: fetched.authHeader, ...conversationMessages(fetched.conversation) };
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
