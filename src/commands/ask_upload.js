// Attaches image files to the ChatGPT composer and waits for upload readiness.
import {
  COMPOSER_FILE_INPUT_SELECTOR,
  EDITOR_SELECTOR,
  SEND_SELECTOR,
  USER_SELECTOR
} from './chatgpt_surface.js';

const PREVIEW_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 60_000;

const PREPARE_INPUT_SCRIPT = `(() => {
  const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
  const form = editor?.closest('form');
  document.querySelectorAll('[data-chatgptcli-file-input="1"]').forEach((input) => input.removeAttribute('data-chatgptcli-file-input'));
  if (!form) return { ok: false, reason: 'composer file input not found' };
  const files = ${'__IMAGE_FILES__'};
  const mimeByExtension = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  const accepts = (input, file) => {
    const accepted = (input.accept || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!accepted.length) return true;
    const extension = file.slice(file.lastIndexOf('.')).toLowerCase();
    const mime = mimeByExtension[extension];
    return accepted.some((value) => value === 'image/*' || value === extension || value === mime);
  };
  const candidates = Array.from(form.querySelectorAll('input[type="file"]')).filter((input) =>
    !input.disabled && !input.hasAttribute('capture') && (files.length === 1 || input.multiple) && files.every((file) => accepts(input, file))
  );
  if (candidates.length !== 1) {
    return { ok: false, reason: candidates.length ? 'composer file input is ambiguous' : 'composer file input not found' };
  }
  candidates[0].setAttribute('data-chatgptcli-file-input', '1');
  return { ok: true };
})()`;

function prepareInputScript(paths) {
  return PREPARE_INPUT_SCRIPT.replace('__IMAGE_FILES__', JSON.stringify(paths));
}

export async function attachImages(page, paths) {
  let prepared;
  try {
    prepared = await page.evaluate(prepareInputScript(paths));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `could not find composer file input: ${message}` };
  }
  if (!prepared?.ok) return { ok: false, reason: prepared?.reason || 'composer file input not found' };
  if (typeof page.setFileInput !== 'function') {
    return { ok: false, reason: 'Browser Bridge cannot set file inputs; update the OpenCLI extension.' };
  }

  try {
    await page.setFileInput(paths, COMPOSER_FILE_INPUT_SELECTOR);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `Browser Bridge file upload failed: ${message}; update the OpenCLI extension if it says not supported.`
    };
  }

  const names = paths.map((path) => path.split(/[\\/]/).at(-1));
  const previews = buildPreviewScript(names, paths.length);
  try {
    for (let poll = 0; poll < Math.ceil(PREVIEW_TIMEOUT_MS / 1000); poll += 1) {
      await page.wait(1);
      if (await page.evaluate(previews)) return { ok: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `could not verify image previews: ${message}` };
  }

  return { ok: false, reason: `image preview did not appear for ${names.join(', ')} within 20 s` };
}

function buildPreviewScript(names, count) {
  return `(() => {
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    const scope = editor?.closest('form');
    if (!scope) return false;
    const text = (scope.innerText || '').toLowerCase();
    const labels = Array.from(scope.querySelectorAll('[role="group"][aria-label], [data-composer-attachments] button[aria-label]'))
      .map((node) => (node.getAttribute('aria-label') || '').toLowerCase());
    const names = ${JSON.stringify(names)};
    const named = names.every((name) => [text, ...labels].some((value) => value.includes(name.toLowerCase())));
    const previews = Array.from(scope.querySelectorAll('img[src], canvas')).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 32 && rect.height > 32;
    });
    return named || previews.length >= ${count};
  })()`;
}

export async function waitForSendReady(page, timeoutMs) {
  const pollCount = timeoutMs <= 1000 ? 1 : Math.floor(timeoutMs / 1000) + 1;
  let state = {};
  for (let poll = 0; poll < pollCount; poll += 1) {
    state = await page.evaluate(`(() => {
      const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
      const send = document.querySelector(${JSON.stringify(SEND_SELECTOR)});
      const userMessageCount = document.querySelectorAll(${JSON.stringify(USER_SELECTOR)}).length;
      return {
        editorText: editor instanceof HTMLElement ? (editor.innerText || '').trim() : '',
        sendReady: send instanceof HTMLButtonElement ? !send.disabled : false,
        userMessageCount
      };
    })()`);
    if (!state?.editorText || state.sendReady || poll + 1 === pollCount) break;
    await page.wait(1);
  }
  return { ...state, timedOut: Boolean(state?.editorText) && !state?.sendReady };
}

export const __test__ = { buildPreviewScript };
