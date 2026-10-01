// Resolves Files-in-chat attachments — Deep Research reports and plain
// generated files (code-interpreter/canvas output) alike — via the "Files in
// chat" panel, the primary working detection path (the cross-origin iframe
// path in read.js is inert against the real bridge). Split out of read.js to
// stay under the project's 300-line file limit. See docs/INLINE_DOCUMENTS_AND_IMAGES.md
// for the full contract.
//
// Attachments are listed in the "Files in chat" panel, reached via the
// conversation's "More" menu (there is no standalone header button).
// Confirmed live: readNetworkCapture() only exposes request metadata, never
// response bodies, so content is fetched explicitly in-page rather than read
// off the capture.
import {
  ATTACHMENT_KIND,
  FILE_DOWNLOAD_URL_PART,
  attachmentId,
  fetchSignedContent,
  hasImageForAsset,
  markerFor,
  safeJsonParse,
  textAttachmentEntry
} from './read_attachments.js';

// The testid is the older markup; the redesigned header only labels the button.
const CONVERSATION_OPTIONS_BUTTON_SELECTOR =
  '[data-testid="conversation-options-button"], header button[aria-label="More"]';
const FILES_IN_CHAT_MENU_ITEM_TEXT = 'View files in chat';
// Tag-agnostic on purpose: the panel was a <section>, the redesign labels a
// tabpanel and the <ul> inside it. Either way each entry is one `li button`.
const FILES_IN_CHAT_PANEL_SELECTOR = '[aria-label="Files in chat"]';
const FILE_ENTRY_BUTTON_SELECTOR = `${FILES_IN_CHAT_PANEL_SELECTOR} li button`;
const CLOSE_VIEWER_SELECTOR = 'button[aria-label="Close fullscreen view"], button[aria-label="Close viewer"]';
const FILES_PANEL_POLL_ATTEMPTS = 10;

// Repeatedly awaits `probe()` (a zero-arg async check) until it returns a
// truthy value or the attempt budget runs out; returns that value, or `null`
// on timeout. Shared by the panel-population and download-request polls
// below, which otherwise differ only in what they're probing for.
async function pollForValue(page, probe) {
  for (let attempt = 0; attempt < FILES_PANEL_POLL_ATTEMPTS; attempt += 1) {
    const value = await probe();
    if (value) return value;
    if (attempt < FILES_PANEL_POLL_ATTEMPTS - 1) await page.wait(1);
  }
  return null;
}

// Boundary normalizer (CODING_RULES "Boundary Normalizers") for a fetched
// report file's JSON. A file in the panel that isn't a Deep Research report
// (a plain upload, or a malformed/failed fetch) has no `parts[0]` and
// degrades to `null` here, so it never becomes a report entry.
function normalizeReportFileJson(value) {
  const object = value && typeof value === 'object' ? value : {};
  const title = typeof object.title === 'string' ? object.title : '';
  const parts = object.widget_state?.report_message?.content?.parts;
  const text = Array.isArray(parts) && typeof parts[0] === 'string' ? parts[0] : '';
  return text ? { title, text } : null;
}

// Opens the "More" -> "View files in chat" panel and returns the number of
// file entries found (0 if the chat has no Files-in-chat panel, or it never
// populates). Also used to reopen the panel between files, since opening the
// fullscreen artifact viewer for one file removes the panel from the DOM.
//
// Every step here polls rather than checking once: confirmed live that
// `openChat`'s readiness wait (page.wait for the first message node) can
// resolve before the header has finished mounting, so a single
// document.querySelector for "More" can miss it on a heavier page load —
// same class of race for the dropdown menu's items rendering after the click.
//
// Opening the menu and picking the item are one poll for the same reason: the
// button can exist before its handler is attached, so the opener is re-fired
// for as long as no menu shows instead of being trusted once.
async function openFilesInChatPanel(page) {
  const panelOpened = await pollForValue(page, () =>
    page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button'));
      const hit = items.find((el) => (el.textContent || '').trim() === ${JSON.stringify(FILES_IN_CHAT_MENU_ITEM_TEXT)});
      if (hit) {
        hit.click();
        return true;
      }
      const btn = document.querySelector(${JSON.stringify(CONVERSATION_OPTIONS_BUTTON_SELECTOR)});
      if (!btn || document.querySelector('[role="menu"]')) return false;
      // Confirmed live: the redesigned button is a Radix menu trigger, which
      // opens on pointerdown and ignores a synthetic click entirely.
      if (btn.hasAttribute('data-testid')) btn.click();
      else btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
      return false;
    })()`)
  );
  if (!panelOpened) return 0;

  // The list streams in — confirmed live: 2 entries on the first look, 7 a
  // moment later — so a count is only trusted once it repeats.
  let previousCount = -1;
  const count = await pollForValue(page, async () => {
    const current = await page.evaluate(`document.querySelectorAll(${JSON.stringify(FILE_ENTRY_BUTTON_SELECTOR)}).length`);
    const settled = current > 0 && current === previousCount;
    previousCount = current;
    return settled ? current : 0;
  });
  return count || 0;
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
function normalizeAttachedFileContent(rawText, name) {
  const parsed = safeJsonParse(rawText);
  if (parsed !== null) {
    const report = normalizeReportFileJson(parsed);
    return report ? { role: 'report', text: report.text, title: report.title } : null;
  }
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  return text ? { role: 'file', text, title: name } : null;
}

async function fetchAttachedFileEntry(page, downloadUrl, authHeader, wantBytes) {
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

  return normalizeAttachedFileContent(body?.text ?? '', content.name);
}

// Clicks file entry `index`, captures the network request it fires to
// discover the file's real id and bearer token (there is no other way to
// learn either without clicking), then fetches the attachment content
// directly in-page via a two-hop fetch: the download endpoint returns a
// signed `download_url`, which is then fetched for the actual file content
// (a Deep Research report's JSON, or a plain generated file's raw text).
async function fetchAttachedFile(page, index, wantBytes) {
  await page.startNetworkCapture('');
  const clicked = await page.evaluate(`(() => {
    const btn = document.querySelectorAll(${JSON.stringify(FILE_ENTRY_BUTTON_SELECTOR)})[${index}];
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) return null;

  const entry = await pollForValue(page, async () => {
    const captured = await page.readNetworkCapture();
    return Array.isArray(captured)
      ? captured.find((item) => typeof item?.url === 'string' && item.url.includes(FILE_DOWNLOAD_URL_PART))
      : null;
  });
  const downloadUrl = entry?.url || '';
  const authHeader = entry?.requestHeaders?.authorization || entry?.requestHeaders?.Authorization || '';

  const fileEntry = downloadUrl ? await fetchAttachedFileEntry(page, downloadUrl, authHeader, wantBytes) : null;

  await page
    .evaluate(`(() => {
      const btn = document.querySelector(${JSON.stringify(CLOSE_VIEWER_SELECTOR)});
      if (btn) btn.click();
    })()`)
    .catch(() => {});

  return fileEntry;
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

// Drives the "Files in chat" panel to resolve attachments — Deep Research
// reports and plain generated files (code-interpreter/canvas output) alike —
// and appends each to `rawMessages` as a `[report-NN]` / `[file-NN]` marker
// entry (or the inlined body under `--files-inline`). Independent of (and
// additional to) the cross-origin-iframe resolution in read.js: that path is a
// no-op against the real bridge (see PLAN.md), so this is the only path that
// currently produces report bodies. No-ops entirely against a `page` that
// lacks network-capture support (older test doubles).
export async function resolveReportFiles(rawMessages, page, context) {
  if (typeof page.startNetworkCapture !== 'function' || typeof page.readNetworkCapture !== 'function') return;

  let fileCount = await openFilesInChatPanel(page);
  if (!fileCount) return;

  for (let index = 0; index < fileCount; index += 1) {
    const fileEntry = await fetchAttachedFile(page, index, Boolean(context.filesOutputDir));
    // An upload already scraped as an <img> in its own message turn is listed
    // here too; the in-turn one keeps its position in the transcript, so the
    // panel duplicate is dropped rather than given a second id.
    const isDuplicateImage =
      fileEntry?.role === ATTACHMENT_KIND.IMAGE && hasImageForAsset(rawMessages, fileEntry.src);
    if (fileEntry && !isDuplicateImage) {
      rawMessages.push(
        fileEntry.role === ATTACHMENT_KIND.IMAGE
          ? imageAttachmentEntry(fileEntry, context)
          : textAttachmentEntry(fileEntry, context)
      );
    }

    if (index < fileCount - 1) {
      fileCount = await openFilesInChatPanel(page);
      if (!fileCount) break;
    }
  }
}
