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
import { ATTACHMENT_KIND, FILE_DOWNLOAD_URL_PART, hasImageForAsset, isImageFileName } from './read_attachments.js';
import { attachmentEntry, fetchAttachedFileEntry } from './read_file_content.js';

// The testid is the older markup; the redesigned header only labels the button.
const CONVERSATION_OPTIONS_BUTTON_SELECTOR =
  '[data-testid="conversation-options-button"], header button[aria-label="More"]';
const FILES_IN_CHAT_MENU_ITEM_TEXT = 'View files in chat';
// Tag-agnostic on purpose: the panel was a <section>, the redesign labels a
// tabpanel and the <ul> inside it. Either way each entry is one `li button`.
const FILES_IN_CHAT_PANEL_SELECTOR = '[aria-label="Files in chat"]';
const FILE_ENTRY_BUTTON_SELECTOR = `${FILES_IN_CHAT_PANEL_SELECTOR} li button`;
const CLOSE_VIEWER_SELECTOR = 'button[aria-label="Close fullscreen view"], button[aria-label="Close viewer"]';
const CLOSE_PANEL_SELECTOR = 'aside button[aria-label="Close panel"]';
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

// Both the viewer and the panel sit in the user's own, visible tab, so each is
// closed again; a close control that is not there is nothing to fail over.
async function clickIfPresent(page, selector) {
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`).catch(() => {});
}

// Opens the "More" -> "View files in chat" panel and returns one label per
// file entry — its file name, or '' where the markup carries none ([] if the
// chat has no Files-in-chat panel, or it never populates). Also used to reopen
// the panel between files, since opening the fullscreen artifact viewer for
// one file removes the panel from the DOM.
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
  if (!panelOpened) return [];

  // The list streams in — confirmed live: 2 entries on the first look, 7 a
  // moment later — so a count is only trusted once it repeats.
  let previousCount = -1;
  const labels = await pollForValue(page, async () => {
    const current = await page.evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(FILE_ENTRY_BUTTON_SELECTOR)}), (el) => el.getAttribute('aria-label') || '')`
    );
    const count = Array.isArray(current) ? current.length : 0;
    const settled = count > 0 && count === previousCount;
    previousCount = count;
    return settled ? current.map(String) : null;
  });
  return labels || [];
}

function attachmentsOf(rawMessages) {
  return rawMessages.flatMap((message) => (Array.isArray(message.attachments) ? message.attachments : []));
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

  const fileEntry = downloadUrl ? await fetchAttachedFileEntry(page, downloadUrl, authHeader, { wantBytes }) : null;

  await clickIfPresent(page, CLOSE_VIEWER_SELECTOR);
  return fileEntry;
}

// Drives the "Files in chat" panel to resolve attachments — Deep Research
// reports and plain generated files (code-interpreter/canvas output) alike —
// and appends each to `rawMessages` as a `[report-NN]` / `[file-NN]` marker
// entry (or the inlined body under `--files-inline`). Independent of (and
// additional to) the cross-origin-iframe resolution in read.js: that path is a
// no-op against the real bridge (see docs/INLINE_DOCUMENTS_AND_IMAGES.md), so
// this is the only path that currently produces report bodies. No-ops entirely
// against a `page` that lacks network-capture support (older test doubles).
export async function resolveReportFiles(rawMessages, page, context) {
  if (typeof page.startNetworkCapture !== 'function' || typeof page.readNetworkCapture !== 'function') return;

  let labels = await openFilesInChatPanel(page);
  // Each click costs a menu reopen, the click and a network poll (~5-9 s), so
  // an entry is skipped when its outcome is already known: an attachment the
  // transcript already holds under that name, any image once the conversation
  // JSON has positioned every image (confirmed live: 35 generated images, none
  // of them named, cost a 5 minute read), or a file the panel lists a second
  // time (which fires no request at all and would burn the whole poll budget).
  // ponytail: matched by file name — an entry exposes nothing else. A second,
  // different upload reusing a name is skipped too, and so is an image that
  // exists only as a download link. Compare ids if the panel ever exposes them.
  const known = new Set(attachmentsOf(rawMessages).map((attachment) => attachment.name).filter(Boolean));
  const isKnown = (label) => known.has(label) || (context.imagesPositioned && isImageFileName(label));
  let panelOpen = labels.length > 0;

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (label && isKnown(label)) continue;
    if (!panelOpen) {
      labels = await openFilesInChatPanel(page);
      if (index >= labels.length) break;
    }
    panelOpen = false;
    if (label) known.add(label);

    const fileEntry = await fetchAttachedFile(page, index, Boolean(context.filesOutputDir));
    // An upload already scraped as an <img> in its own message turn is listed
    // here too; the in-turn one keeps its position in the transcript, so the
    // panel duplicate is dropped rather than given a second id.
    // A report the conversation JSON already delivered is listed here under a
    // label of its own, so that one is recognized by its body instead.
    const isDuplicate =
      fileEntry?.role === ATTACHMENT_KIND.IMAGE
        ? hasImageForAsset(rawMessages, fileEntry.src)
        : attachmentsOf(rawMessages).some((attachment) => attachment.text && attachment.text === fileEntry?.text);
    if (fileEntry && !isDuplicate) rawMessages.push(attachmentEntry(fileEntry, context));
  }

  // A clicked entry swaps the panel for the viewer, which is closed above; a
  // panel nothing was clicked in is still open.
  if (panelOpen) await clickIfPresent(page, CLOSE_PANEL_SELECTOR);
}
