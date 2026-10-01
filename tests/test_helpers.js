// Shared fakes/helpers for tests/*.test.js. Bun test hooks (beforeEach etc.)
// are per-file, so each test file still owns its own reset wiring — this
// module only carries the reusable fake-page builders and stdout/stderr
// capture helpers.

export function fakeReadPage(evaluateResult, pageExtras = {}) {
  return {
    bridge: { close: async () => {} },
    page: { evaluate: async () => evaluateResult, ...pageExtras }
  };
}

// Drives resolveReportFiles' Files-in-chat flow: the "More" menu, the
// "View files in chat" panel, per-file click + network-capture discovery,
// and the two-hop in-page fetch. `evaluateResult` is what the initial
// READ_SCRAPE_SCRIPT top-frame scrape returns; `fileEntries` describes each
// file's download/content fetch chain, in files-panel order.
// `fileLabels` are the entries' aria-labels (file names; '' when the markup has
// none) and `clicks` collects every entry index that was actually clicked,
// plus 'close-panel' when the panel itself was closed.
export function fakeFilesPanelExtras(
  evaluateResult,
  { menuButtonPresent = true, panelMenuItemPresent = true, fileButtonCount = 0, fileEntries = [], fileLabels, clicks = [] } = {}
) {
  let lastClickedIndex = -1;

  const evaluate = async (script) => {
    if (script.includes('MESSAGE_ATTR')) return evaluateResult;
    // One script opens the "More" menu and picks the panel item.
    if (script.includes('conversation-options-button')) return menuButtonPresent && panelMenuItemPresent;
    if (script.includes('getAttribute') && script.includes('li button')) return fileLabels ?? Array(fileButtonCount).fill('');
    if (script.includes('Close fullscreen view')) return true;
    if (script.includes('Close panel')) {
      clicks.push('close-panel');
      return true;
    }

    const clickMatch = script.includes('li button') && script.match(/\)\[(\d+)\]/);
    if (clickMatch) {
      const index = Number(clickMatch[1]);
      if (index >= (fileLabels?.length ?? fileButtonCount)) return false;
      lastClickedIndex = index;
      clicks.push(index);
      return true;
    }

    if (script.includes('fetch(')) {
      const entry = fileEntries[lastClickedIndex];
      if (!entry) return '';
      if (entry.downloadUrl && script.includes(entry.downloadUrl)) return JSON.stringify(entry.metaJson ?? {});
      if (entry.contentUrl && script.includes(entry.contentUrl)) {
        // The hop-2 body fetch classifies by blob type and returns an object;
        // `imageMime` on an entry makes the fake serve a binary attachment.
        const text = typeof entry.contentText === 'string' ? entry.contentText : JSON.stringify(entry.contentJson ?? {});
        if (!script.includes('blob()')) return text;
        return entry.imageMime
          ? { type: 'image', mime: entry.imageMime, dataUrl: entry.imageDataUrl || '' }
          : { type: 'text', text };
      }
      return '';
    }

    return null;
  };

  const readNetworkCapture = async () => {
    const entry = fileEntries[lastClickedIndex];
    return entry ? [{ url: entry.downloadUrl, requestHeaders: { authorization: entry.authHeader || '' } }] : [];
  };

  return { evaluate, wait: async () => {}, startNetworkCapture: async () => true, readNetworkCapture };
}

// Serves the backend-conversation path of `read`: the in-page conversation
// fetch, the files-download hop that turns an image asset pointer into a signed
// URL, and the image bytes. `requests` collects every file id hop 1 was asked
// for; `sandboxFiles` maps a generated file's sandbox path to its content;
// `loggedOut` is a session that answered without an access token, `offChat` a
// tab whose location is not a chat URL.
export function fakeConversationExtras(
  conversation,
  { status = 200, loggedOut = false, offChat = false, dataUrl = '', requests = [], sandboxFiles = {} } = {}
) {
  const evaluate = async (script) => {
    if (script.includes('/interpreter/download')) {
      const path = Object.keys(sandboxFiles).find((entry) => script.includes(encodeURIComponent(entry)));
      return path ? JSON.stringify({ download_url: `https://chatgpt.com/backend-api/estuary/content?sandbox=${encodeURIComponent(path)}`, file_name: path }) : '';
    }
    if (script.includes('blob.text()')) {
      const path = Object.keys(sandboxFiles).find((entry) => script.includes(`sandbox=${encodeURIComponent(entry)}`));
      return path ? { type: 'text', text: sandboxFiles[path] } : null;
    }
    if (script.includes('/backend-api/conversation/')) {
      if (loggedOut || offChat) {
        return { url: 'https://chatgpt.com/', status: 0, loggedOut, offChat, authHeader: '', body: '' };
      }
      return { url: 'https://chatgpt.com/c/abc', status, authHeader: 'Bearer token', body: JSON.stringify(conversation) };
    }
    const download = script.match(/\/backend-api\/files\/download\/(file[-_][A-Za-z0-9]+)/);
    if (download) {
      requests.push(download[1]);
      return JSON.stringify({ download_url: `https://chatgpt.com/backend-api/estuary/content?id=${download[1]}` });
    }
    if (script.includes('readAsDataURL')) return dataUrl;
    return null;
  };

  return { evaluate };
}

function capture(stream) {
  const chunks = [];
  stream.write = (data) => {
    chunks.push(String(data));
    return true;
  };
  return chunks;
}

export function captureStdout() {
  return capture(process.stdout);
}

export function captureStderr() {
  return capture(process.stderr);
}

// Bind once per test file, then pass to restoreStdio() from that file's own
// beforeEach/afterEach (bun test hooks are per-file, so the hooks themselves
// can't move here — only the bind/restore bodies).
export function bindOriginalStdio() {
  return {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr)
  };
}

export function restoreStdio(originals) {
  process.stdout.write = originals.stdout;
  process.stderr.write = originals.stderr;
}
