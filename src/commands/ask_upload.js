// Attaches image files to the ChatGPT composer and waits for upload readiness.
import {
  COMPOSER_FILE_INPUT_SELECTOR,
  EDITOR_SELECTOR,
  SEND_SELECTOR,
  USER_SELECTOR
} from './chatgpt_surface.js';
import { IMAGE_MIME_TYPES } from '../core/prompt_images.js';
import { injectFilesInPage } from './ask_upload_inject.js';
import { formatComposerState, readComposerState } from './ask_composer_state.js';

const PREVIEW_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 60_000;
const FALLBACK_UPLOAD_ERRORS = /Not allowed|not supported|Unknown action|fileChooserOpened not received/;
const FILE_ACCESS_HINT = 'enable "Allow access to file URLs" for the OpenCLI extension (chrome://extensions > OpenCLI > Details) so Chrome can upload the files directly';

const PREPARE_INPUT_SCRIPT = `(() => {
  const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
  const form = editor?.closest('form');
  document.querySelectorAll('[data-chatgptcli-file-input="1"]').forEach((input) => input.removeAttribute('data-chatgptcli-file-input'));
  document.querySelectorAll('[data-chatgptcli-assigned]').forEach((input) => input.removeAttribute('data-chatgptcli-assigned'));
  if (!form) return { ok: false, reason: 'composer file input not found' };
  const files = ${'__IMAGE_FILES__'};
  const mimeByExtension = ${JSON.stringify(IMAGE_MIME_TYPES)};
  const acceptedTypes = (input) => (input.accept || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const accepts = (input, file) => {
    const accepted = acceptedTypes(input);
    if (!accepted.length) return true;
    const extension = file.slice(file.lastIndexOf('.')).toLowerCase();
    const mime = mimeByExtension[extension];
    return accepted.some((value) => value === 'image/*' || value === extension || value === mime);
  };
  const isImageOnly = (input) => {
    const accepted = acceptedTypes(input);
    return accepted.length > 0 && accepted.every((value) =>
      value === 'image/*' || value.startsWith('image/') || Object.values(mimeByExtension).includes(value) || Object.keys(mimeByExtension).includes(value)
    );
  };
  const candidates = Array.from(form.querySelectorAll('input[type="file"]')).filter((input) =>
    !input.disabled && !input.hasAttribute('capture') && (files.length === 1 || input.multiple) && files.every((file) => accepts(input, file))
  );
  const imageOnlyCandidates = candidates.filter(isImageOnly);
  const preferredCandidates = imageOnlyCandidates.length ? imageOnlyCandidates : candidates;
  if (preferredCandidates.length !== 1) {
    return { ok: false, reason: preferredCandidates.length ? 'composer file input is ambiguous' : 'composer file input not found' };
  }
  preferredCandidates[0].setAttribute('data-chatgptcli-file-input', '1');
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
  if (typeof page.setFileInput !== 'function') return uploadWithFallback(page, paths);

  try {
    await page.setFileInput(paths, COMPOSER_FILE_INPUT_SELECTOR);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (FALLBACK_UPLOAD_ERRORS.test(message)) return uploadWithFallback(page, paths);
    return { ok: false, reason: `Browser Bridge file upload failed: ${message}` };
  }

  return waitForPreviews(page, paths, 'native');
}

async function uploadWithFallback(page, paths) {
  const result = await injectFilesInPage(page, paths, COMPOSER_FILE_INPUT_SELECTOR);
  if (result.ok) return waitForPreviews(page, paths, 'fallback', result.assignmentState);
  return { ok: false, reason: `Browser upload fallback failed: ${result.reason}; ${FILE_ACCESS_HINT}` };
}

async function waitForPreviews(page, paths, uploadPath, assignmentState) {
  const names = paths.map((path) => path.split(/[\\/]/).at(-1));
  const previews = buildPreviewScript(names, paths.length);
  try {
    for (let poll = 0; poll < Math.ceil(PREVIEW_TIMEOUT_MS / 1000); poll += 1) {
      await page.wait(1);
      if (await page.evaluate(previews)) return { ok: true, uploadPath };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `could not verify image previews: ${message}` };
  }

  const state = await readComposerState(page, { uploadPath });
  const assignment = assignmentState ? `; ${formatAssignmentState(assignmentState)}` : '';
  return {
    ok: false,
    reason: `image preview did not appear for ${names.join(', ')} within 20 s; composer: ${formatComposerState(state)}${assignment}`
  };
}

function formatAssignmentState(state) {
  const afterChange = formatInputSnapshot(state.afterChange);
  const inspection = state.handlerInspection || {};
  const stages = Object.entries(state.stages || {})
    .map(([name, snapshot]) => `${name}:${formatInputSnapshot(snapshot)}`)
    .join(',');
  return `assignmentAfterChange=${afterChange} handlerFound=${Boolean(state.handlerFound)} dispatchPath=${state.dispatchPath || 'unknown'} handlerReadsFiles=${Boolean(inspection.readsFiles)} handlerClearsValue=${Boolean(inspection.clearsValue)} handlerError=${state.handlerError || 'none'} stages=${stages}`;
}

function formatInputSnapshot(state) {
  const connection = state?.connected ? 'connected' : 'detached';
  const marker = state?.marked ? 'present' : 'missing';
  const files = state?.files == null ? 'null' : state.files;
  return `${connection}/${marker}/${files}`;
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
