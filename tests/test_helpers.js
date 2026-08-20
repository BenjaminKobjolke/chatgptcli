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
export function fakeFilesPanelExtras(evaluateResult, { menuButtonPresent = true, panelMenuItemPresent = true, fileButtonCount = 0, fileEntries = [] } = {}) {
  let lastClickedIndex = -1;

  const evaluate = async (script) => {
    if (script.includes('MESSAGE_ATTR')) return evaluateResult;
    if (script.includes('conversation-options-button')) return menuButtonPresent;
    if (script.includes('role="menu"') && script.includes('View files in chat')) return panelMenuItemPresent;
    if (script.includes('.length') && script.includes('li button')) return fileButtonCount;
    if (script.includes('Close fullscreen view')) return true;

    const clickMatch = script.includes('li button') && script.match(/\)\[(\d+)\]/);
    if (clickMatch) {
      const index = Number(clickMatch[1]);
      if (index >= fileButtonCount) return false;
      lastClickedIndex = index;
      return true;
    }

    if (script.includes('fetch(')) {
      const entry = fileEntries[lastClickedIndex];
      if (!entry) return '';
      if (entry.downloadUrl && script.includes(entry.downloadUrl)) return JSON.stringify(entry.metaJson ?? {});
      if (entry.contentUrl && script.includes(entry.contentUrl)) {
        return typeof entry.contentText === 'string' ? entry.contentText : JSON.stringify(entry.contentJson ?? {});
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
