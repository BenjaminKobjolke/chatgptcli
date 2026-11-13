// Reads a privacy-safe summary of the current ChatGPT composer state.
import {
  COMPOSER_ATTACHMENT_TILE_SELECTOR,
  EDITOR_SELECTOR,
  SEND_SELECTOR,
  STOP_SELECTOR,
  VISIBLE_STOP_EXPRESSION,
  USER_SELECTOR
} from './chatgpt_surface.js';

export const COMPOSER_IDLE_TIMEOUT_MS = 60_000;
export const COMPOSER_RELOAD_AFTER_MS = 20_000;

const IDLE_PROBE_SCRIPT = `(() => {
  const __chatgptcliIdleProbe = true;
  return ${VISIBLE_STOP_EXPRESSION};
})()`;

const STATE_SCRIPT = `(() => {
  const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
  const form = editor?.closest('form');
  const tiles = form ? Array.from(form.querySelectorAll(${JSON.stringify(COMPOSER_ATTACHMENT_TILE_SELECTOR)})) : [];
  const send = form?.querySelector(${JSON.stringify(SEND_SELECTOR)}) || null;
  const alertRegion = form?.querySelector('[role="alert"], [role="status"]')
    || document.querySelector('[role="alert"], [role="status"]');
  const largeImages = form ? Array.from(form.querySelectorAll('img[src], canvas')).filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 32 && rect.height > 32;
  }) : [];
  const uploading = tiles.filter((tile) => tile.querySelector(
    '[role="progressbar"], [aria-busy="true"], circle'
  )).length;
  const stop = document.querySelector(${JSON.stringify(STOP_SELECTOR)});
  const stops = Array.from(document.querySelectorAll(${JSON.stringify(STOP_SELECTOR)}));
  const visibleStop = stops.find((node) => node.getClientRects().length > 0) || null;
  const diagnosticStop = visibleStop || stop;
  return {
    url: location.href,
    fileInputs: form ? form.querySelectorAll('input[type="file"]').length : 0,
    markedInputFiles: form?.querySelector('[data-chatgptcli-file-input="1"]')?.files?.length ?? null,
    tiles: tiles.length,
    largeImages: largeImages.length,
    uploading,
    send: {
      found: Boolean(send),
      disabled: send instanceof HTMLButtonElement ? send.disabled : false,
      testId: send?.getAttribute('data-testid') || '',
      ariaLabel: send?.getAttribute('aria-label') || ''
    },
    stop: Boolean(stop),
    stopLabel: (diagnosticStop?.getAttribute('aria-label') || diagnosticStop?.innerText || diagnosticStop?.textContent || '').trim().replace(/[\\r\\n\\t]+/g, ' ').slice(0, 60),
    stopTestId: diagnosticStop?.getAttribute('data-testid') || '',
    stopInForm: Boolean(diagnosticStop && form?.contains(diagnosticStop)),
    stopVisible: Boolean(visibleStop),
    stopMatches: stops.length,
    editorChars: editor instanceof HTMLElement ? (editor.innerText || '').length : 0,
    userMessages: document.querySelectorAll(${JSON.stringify(USER_SELECTOR)}).length,
    alert: (alertRegion?.innerText || alertRegion?.textContent || '').trim().slice(0, 160)
  };
})()`;

export async function waitForComposerIdle(page, timeoutMs = COMPOSER_IDLE_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (true) {
    let busy;
    try {
      busy = await page.evaluate(IDLE_PROBE_SCRIPT);
    } catch {
      return { idle: true };
    }

    if (!busy) return { idle: true };
    if (Date.now() - startedAt >= timeoutMs) {
      return { idle: false, snapshot: await readComposerState(page) };
    }
    await page.wait(1);
  }
}

export async function readComposerState(page, { uploadPath = 'none' } = {}) {
  try {
    const state = await page.evaluate(STATE_SCRIPT);
    if (state?.error) return { error: singleLine(state.error) };
    return normalizeComposerState(state, uploadPath);
  } catch (error) {
    return { error: singleLine(error instanceof Error ? error.message : error) };
  }
}

export function formatComposerState(state) {
  if (state?.error) return `error=${quote(state.error)}`;
  const send = state?.send || {};
  const sendState = !send.found ? 'missing' : send.disabled ? 'disabled' : 'ready';
  return [
    `url=${singleLine(state?.url)}`,
    `fileInputs=${numberOr(state?.fileInputs, 0)}`,
    `markedInputFiles=${state?.markedInputFiles == null ? 'null' : numberOr(state.markedInputFiles, 0)}`,
    `tiles=${numberOr(state?.tiles, 0)}`,
    `largeImages=${numberOr(state?.largeImages, 0)}`,
    `uploading=${numberOr(state?.uploading, 0)}`,
    `send=${sendState}`,
    `testId=${singleLine(send.testId)}`,
    `ariaLabel=${quote(send.ariaLabel)}`,
    `stop=${Boolean(state?.stop)}`,
    `stopLabel=${quote(state?.stopLabel)}`,
    `stopTestId=${quote(state?.stopTestId)}`,
    `stopInForm=${Boolean(state?.stopInForm)}`,
    `stopVisible=${Boolean(state?.stopVisible)}`,
    `stopMatches=${numberOr(state?.stopMatches, 0)}`,
    `editorChars=${numberOr(state?.editorChars, 0)}`,
    `userMessages=${numberOr(state?.userMessages, 0)}`,
    `alert=${quote(state?.alert)}`,
    `uploadPath=${singleLine(state?.uploadPath)}`
  ].join(' ');
}

function normalizeComposerState(value, uploadPath) {
  const state = value && typeof value === 'object' ? value : {};
  const send = state.send && typeof state.send === 'object' ? state.send : {};
  return {
    url: stringOr(state.url),
    fileInputs: numberOr(state.fileInputs, 0),
    markedInputFiles: state.markedInputFiles == null ? null : numberOr(state.markedInputFiles, 0),
    tiles: numberOr(state.tiles, 0),
    largeImages: numberOr(state.largeImages, 0),
    uploading: numberOr(state.uploading, 0),
    send: {
      found: Boolean(send.found),
      disabled: Boolean(send.disabled),
      testId: stringOr(send.testId),
      ariaLabel: stringOr(send.ariaLabel)
    },
    stop: Boolean(state.stop),
    stopLabel: singleLine(state.stopLabel).slice(0, 60),
    stopTestId: singleLine(state.stopTestId).slice(0, 60),
    stopInForm: Boolean(state.stopInForm),
    stopVisible: Boolean(state.stopVisible),
    stopMatches: numberOr(state.stopMatches, 0),
    editorChars: numberOr(state.editorChars, 0),
    userMessages: numberOr(state.userMessages, 0),
    alert: stringOr(state.alert).trim().slice(0, 160),
    uploadPath
  };
}

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function stringOr(value) {
  return typeof value === 'string' ? value : '';
}

function singleLine(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

function quote(value) {
  return JSON.stringify(singleLine(value));
}
