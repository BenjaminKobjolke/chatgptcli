// Attachment identity and download for `read`: the marker/id vocabulary shared
// by the in-page scrape (read_scrape.js), the Files-in-chat resolver
// (read_files_panel.js) and the command itself (read.js), plus the single
// writer that turns an attachment record into a file on disk.
//
// A chat's attachments are images (`src`, fetched from the browser) and text
// bodies (`text`, already fetched by the panel resolver). Both are written by
// the same pass so `--file-id` filters one list, not two.
import { writeFileSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { AppError, ERROR_CODE } from '../core/errors.js';

export const ATTACHMENT_KIND = Object.freeze({
  IMAGE: 'image',
  REPORT: 'report',
  FILE: 'file'
});

const DATA_URL_PATTERN = /^data:([^;,]*)[^,]*,(.*)$/s;
const MIME_EXTENSIONS = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg'
});
const DEFAULT_IMAGE_EXTENSION = '.png';
const DEFAULT_TEXT_EXTENSION = Object.freeze({ report: '.md', file: '.txt' });

let nodeFetchImpl = (url) => fetch(url);

export function __setAttachmentDepsForTest(deps) {
  if (deps.nodeFetch) {
    nodeFetchImpl = deps.nodeFetch;
  }
}

export function __resetAttachmentDepsForTest() {
  nodeFetchImpl = (url) => fetch(url);
}

export function attachmentId(kind, index) {
  return `${kind}-${String(index).padStart(2, '0')}`;
}

export function markerFor(id) {
  return `[${id}]`;
}

export function linkFor(id, path) {
  return `![${id}](${path})`;
}

// Markdown links must use forward slashes, so a Windows `join()` result
// (`out\image-01.png`) would produce a broken link.
export function toPosixPath(path) {
  return path.split(sep).join('/');
}

// Boundary normalizer for the `attachments` field that reaches JSON output.
// Internal-only fields (an image's `frameIndex`, a text body's `text`) are
// dropped here so the machine-readable output stays a stable contract.
export function normalizeAttachments(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((entry) => {
      const object = entry && typeof entry === 'object' ? entry : {};
      const normalized = {
        id: typeof object.id === 'string' ? object.id : '',
        kind: typeof object.kind === 'string' ? object.kind : '',
        name: typeof object.name === 'string' ? object.name : ''
      };
      if (typeof object.src === 'string' && object.src) normalized.src = object.src;
      if (typeof object.file === 'string' && object.file) normalized.file = object.file;
      return normalized;
    })
    .filter((entry) => entry.id);
}

// The single place a resolved text attachment (a Deep Research report body or
// a generated file) becomes a transcript entry: allocates the id, decides
// marker vs. inlined body, and carries the body on the attachment record so
// the download pass never fetches it twice. `extraAttachments` are records
// already registered for the same entry — the images inside a report body.
export function textAttachmentEntry({ role, title, text }, context, extraAttachments = []) {
  context.counters[role] += 1;
  const id = attachmentId(role, context.counters[role]);
  return {
    role,
    title,
    text: context.filesInline ? text : markerFor(id),
    attachments: [{ id, kind: role, name: title, text }, ...extraAttachments]
  };
}

// `page.evaluate` only returns JSON-serializable values, so the image comes
// back as a data URL rather than bytes. Also used by read_files_panel.js for a
// binary attachment listed in the Files-in-chat panel, which needs the bearer
// token the panel click exposed.
export function imageDataUrlScript(url, authHeader = '') {
  const init = authHeader
    ? `{ credentials: 'include', headers: { authorization: ${JSON.stringify(authHeader)} } }`
    : `{ credentials: 'include' }`;
  return `
    fetch(${JSON.stringify(url)}, ${init})
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => (blob ? new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      }) : ''))
      .catch(() => '')
  `;
}

function decodeDataUrl(value) {
  const match = typeof value === 'string' ? value.match(DATA_URL_PATTERN) : null;
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  return buffer.length ? { mime: match[1], buffer } : null;
}

// The same upload can surface twice: once as an <img> in its message turn and
// once as a Files-in-chat entry. Both URLs carry the same `file_<hash>` asset
// id, which is the only stable thing about them — the signature and timestamp
// query params differ per render.
export function assetKeyOf(url) {
  const match = typeof url === 'string' ? url.match(/file[-_][A-Za-z0-9]+/) : null;
  return match ? match[0] : '';
}

export function hasImageForAsset(messages, url) {
  const key = assetKeyOf(url);
  if (!key) return false;
  return messages.some((message) =>
    (Array.isArray(message.attachments) ? message.attachments : []).some(
      (attachment) => attachment.kind === ATTACHMENT_KIND.IMAGE && assetKeyOf(attachment.src) === key
    )
  );
}

function extensionFromUrl(url) {
  try {
    return extname(new URL(url).pathname);
  } catch {
    return '';
  }
}

function imageExtension(mime, src) {
  return MIME_EXTENSIONS[mime] || extensionFromUrl(src || '') || DEFAULT_IMAGE_EXTENSION;
}

// An image inside a cross-origin report iframe must be fetched from that
// frame's own context; the top frame cannot read its response.
async function fetchImageInPage(page, attachment) {
  const script = imageDataUrlScript(attachment.src, attachment.authHeader || '');
  if (typeof attachment.frameIndex === 'number' && typeof page.evaluateInFrame === 'function') {
    return page.evaluateInFrame(script, attachment.frameIndex);
  }
  return page.evaluate(script);
}

// Signed files.oaiusercontent.com URLs are readable without a cookie but are
// CORS-blocked for an in-page fetch, so the two paths cover different hosts.
async function fetchImageBuffer(page, attachment) {
  const inPage = await fetchImageInPage(page, attachment).catch(() => '');
  const decoded = decodeDataUrl(inPage);
  if (decoded) return decoded;

  const response = await nodeFetchImpl(attachment.src);
  if (!response || response.ok === false) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length ? { mime: '', buffer } : null;
}

async function attachmentBytes(page, attachment) {
  if (attachment.kind === ATTACHMENT_KIND.IMAGE) {
    // A panel image already came back as a data URL during resolution — its
    // signed URL may not survive a second fetch, so those bytes are reused.
    const fetched = decodeDataUrl(attachment.dataUrl) || (await fetchImageBuffer(page, attachment));
    return fetched
      ? { buffer: fetched.buffer, extension: imageExtension(fetched.mime || attachment.mime, attachment.src) }
      : null;
  }

  if (typeof attachment.text !== 'string' || !attachment.text) return null;
  // Only a `file`'s name is a real filename (the `fn=` param). A report's is
  // its title, where extname() reads a dotted title ("Badge System v1.2
  // final") as the extension and writes `report-01.2 final` instead of `.md`.
  const named = attachment.kind === ATTACHMENT_KIND.FILE ? extname(attachment.name || '') : '';
  const extension = named || DEFAULT_TEXT_EXTENSION[attachment.kind] || '.txt';
  return { buffer: Buffer.from(attachment.text, 'utf8'), extension };
}

function collectTargets(messages, fileId) {
  const all = messages.flatMap((message) =>
    (Array.isArray(message.attachments) ? message.attachments : []).map((attachment) => ({ message, attachment }))
  );
  if (!fileId) return all;

  const matches = all.filter((target) => target.attachment.id === fileId);
  if (!matches.length) {
    const known = all.map((target) => target.attachment.id).join(', ');
    throw new AppError(ERROR_CODE.INPUT_INVALID, `No attachment with id: ${fileId}`, {
      hint: known ? `Ids in this chat: ${known}` : 'This chat has no attachments.'
    });
  }
  return matches;
}

// A skipped download used to be invisible: the transcript kept the bare marker
// and looked exactly like a chat whose attachment was never found. stdout stays
// machine-readable, so the warning belongs on stderr (as in doctor.js).
function warnSkipped(id, reason) {
  process.stderr.write(`attachment ${id}: download failed (${reason}), marker left in place\n`);
}

// Writes every attachment (or just `fileId`) into `filesOutputDir`, rewriting
// the owning message's bare marker into a markdown link. A download that fails
// leaves the marker bare instead of failing the read — an expired signed URL
// must not cost the caller the whole transcript.
export async function downloadAttachments({ page, messages, filesOutputDir, fileId }) {
  for (const { message, attachment } of collectTargets(messages, fileId)) {
    const bytes = await attachmentBytes(page, attachment).catch(() => null);
    if (!bytes) {
      warnSkipped(attachment.id, 'no content');
      continue;
    }

    const path = join(filesOutputDir, `${attachment.id}${bytes.extension}`);
    try {
      writeFileSync(path, bytes.buffer);
    } catch (error) {
      warnSkipped(attachment.id, error instanceof Error ? error.message : String(error));
      continue;
    }

    const relativePath = toPosixPath(path);
    attachment.file = relativePath;
    message.text = message.text.replace(markerFor(attachment.id), linkFor(attachment.id, relativePath));
  }
}
