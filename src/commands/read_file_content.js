// Turns a fetched attachment into a transcript entry: the two-hop content
// fetch, the boundary normalizers that tell a Deep Research report from a
// plain generated file from an image, and the entry shape for each. Shared by
// the conversation-JSON resolver (read_conversation.js) and the Files-in-chat
// panel resolver (read_files_panel.js) so neither grows its own parser.
import {
  ATTACHMENT_KIND,
  attachmentId,
  fetchSignedContent,
  markerFor,
  safeJsonParse,
  textAttachmentEntry
} from './read_attachments.js';

// Boundary normalizer (CODING_RULES "Boundary Normalizers") for a fetched
// report file's JSON. A file in the panel that isn't a Deep Research report
// (a plain upload, or a malformed/failed fetch) has no `parts[0]` and
// degrades to `null` here, so it never becomes a report entry.
export function normalizeReportFileJson(value) {
  const object = value && typeof value === 'object' ? value : {};
  const title = typeof object.title === 'string' ? object.title : '';
  const parts = object.widget_state?.report_message?.content?.parts;
  const text = Array.isArray(parts) && typeof parts[0] === 'string' ? parts[0] : '';
  return text ? { title, text } : null;
}

// Classifies a panel attachment by the blob's own MIME type rather than its
// filename: confirmed live that an uploaded screenshot's signed content URL
// carries no `fn=` parameter at all, so there is no name to judge. `wantBytes`
// decides whether the image travels back as a data URL (a download was asked
// for) or only as its type — base64 over the bridge is not free.
async function fetchBodyInPage(page, url, authHeader, wantBytes) {
  return page.evaluate(`
    fetch(${JSON.stringify(url)}, {
      credentials: 'include',
      headers: { authorization: ${JSON.stringify(authHeader)} }
    })
      .then((response) => response.blob())
      .then((blob) => {
        if (!blob.type.startsWith('image/')) {
          return blob.text().then((text) => ({ type: 'text', text }));
        }
        if (!${Boolean(wantBytes)}) return { type: 'image', mime: blob.type, dataUrl: '' };
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ type: 'image', mime: blob.type, dataUrl: String(reader.result) });
          reader.onerror = () => resolve({ type: 'image', mime: blob.type, dataUrl: '' });
          reader.readAsDataURL(blob);
        });
      })
      .catch(() => ({ type: 'text', text: '' }))
  `);
}

// Boundary normalizer for a fetched attachment's raw hop-2 body. Confirmed
// live: a Deep Research report's content is JSON shaped like
// `normalizeReportFileJson` expects, but a plain generated file (e.g. a
// code-interpreter markdown output) returns its content as raw
// `text/markdown` — not JSON at all. JSON that parses but isn't report-shaped
// stays dropped (existing, intentional behavior for non-report uploads); only
// genuinely non-JSON text is promoted to a generic `file` entry.
function normalizeAttachedFileContent(rawText, name, isGeneratedFile) {
  const parsed = safeJsonParse(rawText);
  if (parsed !== null && !isGeneratedFile) {
    const report = normalizeReportFileJson(parsed);
    return report ? { role: ATTACHMENT_KIND.REPORT, text: report.text, title: report.title } : null;
  }
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  return text ? { role: ATTACHMENT_KIND.FILE, text, title: name } : null;
}

// `isGeneratedFile` is set when the caller already knows what the URL points at
// (a sandbox path from the conversation JSON): its content is the file, even
// when that content happens to be JSON.
export async function fetchAttachedFileEntry(page, downloadUrl, authHeader, { wantBytes = false, isGeneratedFile = false } = {}) {
  const content = await fetchSignedContent(page, downloadUrl, authHeader);
  if (!content.url) return null;

  const body = await fetchBodyInPage(page, content.url, authHeader, wantBytes);
  if (body?.type === 'image') {
    return {
      role: ATTACHMENT_KIND.IMAGE,
      title: content.name,
      mime: body.mime || '',
      dataUrl: body.dataUrl || '',
      src: content.url,
      authHeader
    };
  }

  return normalizeAttachedFileContent(body?.text ?? '', content.name, isGeneratedFile);
}

// An image has no inline form — `--files-inline` cannot print bytes — so it is
// always a marker entry, and its id continues the same per-kind sequence the
// in-page scrape started.
function imageAttachmentEntry(fileEntry, context) {
  context.counters.image += 1;
  const id = attachmentId(ATTACHMENT_KIND.IMAGE, context.counters.image);
  return {
    role: ATTACHMENT_KIND.IMAGE,
    title: fileEntry.title,
    text: markerFor(id),
    attachments: [
      {
        id,
        kind: ATTACHMENT_KIND.IMAGE,
        name: fileEntry.title,
        src: fileEntry.src,
        mime: fileEntry.mime,
        dataUrl: fileEntry.dataUrl,
        authHeader: fileEntry.authHeader
      }
    ]
  };
}

export function attachmentEntry(fileEntry, context) {
  return fileEntry.role === ATTACHMENT_KIND.IMAGE
    ? imageAttachmentEntry(fileEntry, context)
    : textAttachmentEntry(fileEntry, context);
}
