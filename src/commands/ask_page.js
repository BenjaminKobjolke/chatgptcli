// The in-page half of `ask`: everything that drives or reads the chatgpt.com tab.
// Retry policy and output rendering live in ask.js.
import { CHATGPT_ROOT_URL, isChatHost, isChatPath } from '../core/chatgpt_site.js';
import { __test__ as responseHelpers, captureAssistantBaseline, waitForAssistantResponse } from './ask_response.js';
import {
  EDITOR_SELECTOR,
  SEND_SELECTOR,
  STOP_SELECTOR,
  USER_SELECTOR,
  probeChatGptSurface,
  normalizeSurfaceState,
  summarizeSurfaceIssue
} from './chatgpt_surface.js';
import { attachImages, UPLOAD_TIMEOUT_MS, waitForSendReady } from './ask_upload.js';

const RETRYABLE_PREFIXES = ['[BLOCKED]', '[NO RESPONSE]', '[SEND FAILED]', '[SUBMIT FAILED]', '[UPLOAD FAILED]'];
const BLOCKED_PREFIX = '[BLOCKED]';
const SEND_FAILED_PREFIX = '[SEND FAILED]';
const SUBMIT_FAILED_PREFIX = '[SUBMIT FAILED]';
const UPLOAD_FAILED_PREFIX = '[UPLOAD FAILED]';
const FRESH_CHAT_FAILED_MESSAGE = 'fresh chat did not open';
export async function askOnPage(page, input) {
  const readiness = await ensureReadySurface(page, input.newChat);
  let surface = readiness.surface;
  if (readiness.freshChatIssue) {
    return {
      response: `${SEND_FAILED_PREFIX} ${FRESH_CHAT_FAILED_MESSAGE} (tab: ${readiness.freshChatIssue.url})`,
      url: readiness.freshChatIssue.url
    };
  }
  if (!surface.editorReady || surface.loginLike || surface.challengeLike) {
    return blocked(summarizeSurfaceIssue(surface));
  }

  const { baselineKeys, baselineUserCount } = await captureAssistantBaseline(page);
  const images = Array.isArray(input.images) ? input.images : [];
  if (images.length) {
    const upload = await attachImages(page, images);
    if (!upload.ok) return { response: `${UPLOAD_FAILED_PREFIX} ${upload.reason}` };
  }

  const sendResult = await injectAndSend(page, input.prompt, { hasImages: images.length > 0 });
  if (!sendResult.ok) {
    if (sendResult.uploadFailed) {
      return { response: `${UPLOAD_FAILED_PREFIX} ${sendResult.reason}` };
    }
    if (sendResult.submitFailed) {
      const profile = input.profile || 'bridge default';
      return withChatUrl(page, {
        response: `${SUBMIT_FAILED_PREFIX} Prompt typed but send did not start (check: ${sendResult.check}; tab: ${sendResult.url}; profile: ${profile})`
      });
    }
    return withChatUrl(page, { response: `${SEND_FAILED_PREFIX} ${sendResult.reason}` });
  }

  const result = await waitForAssistantResponse(page, {
    prompt: input.prompt,
    timeoutMs: input.timeoutMs,
    baselineKeys,
    baselineUserCount
  });

  if (isSuccessfulResponse(result.response)) {
    return withChatUrl(page, result);
  }

  surface = await probeChatGptSurface(page);
  if (surface.loginLike || surface.challengeLike) {
    return withChatUrl(page, blocked(summarizeSurfaceIssue(surface)));
  }

  return withChatUrl(page, result);
}

async function withChatUrl(page, result) {
  const url = await page.evaluate('window.location.href').catch(() => '');
  return isChatPath(url) ? { ...result, url } : result;
}

async function ensureReadySurface(page, newChat) {
  if (newChat || !(await isOnChatGpt(page))) {
    await page.goto(CHATGPT_ROOT_URL, { settleMs: 1500 });
    await page.wait(2);
  }

  let surface = await waitForSurface(page, 8000);

  if (!surface.editorReady && !surface.loginLike && !surface.challengeLike) {
    await page.goto(CHATGPT_ROOT_URL, { settleMs: 1500 });
    await page.wait(2);
    surface = await waitForSurface(page, 8000);
  }

  if (!newChat) return { surface };

  let freshChat = await inspectFreshChat(page);
  if (isChatPath(freshChat.url) || freshChat.userMessageCount > 0) {
    await page.goto(CHATGPT_ROOT_URL, { settleMs: 1500 });
    await page.wait(2);
    surface = await waitForSurface(page, 8000);
    freshChat = await inspectFreshChat(page);
  }

  if (isChatPath(freshChat.url) || freshChat.userMessageCount > 0) {
    return { surface, freshChatIssue: freshChat };
  }

  return { surface };
}

async function inspectFreshChat(page) {
  const state = await page.evaluate(`(() => ({
    url: window.location.href,
    userMessageCount: document.querySelectorAll(${JSON.stringify(USER_SELECTOR)}).length
  }))()`);
  return {
    url: typeof state?.url === 'string' ? state.url : '',
    userMessageCount: Number(state?.userMessageCount) || 0
  };
}

async function waitForSurface(page, timeoutMs) {
  const startedAt = Date.now();
  let latest = normalizeSurfaceState({});

  while (Date.now() - startedAt < timeoutMs) {
    latest = await probeChatGptSurface(page);
    if (latest.editorReady || latest.loginLike || latest.challengeLike) {
      return latest;
    }
    await page.wait(1);
  }

  return latest;
}

async function injectAndSend(page, prompt, { hasImages }) {
  const focused = await page.evaluate(`(() => {
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    if (!(editor instanceof HTMLElement)) return { ok: false, reason: 'ChatGPT editor not found.' };
    editor.focus();
    editor.click();
    return { ok: true };
  })()`);

  if (!focused?.ok) {
    return { ok: false, reason: focused?.reason || 'ChatGPT editor not focusable.' };
  }

  if (page.insertText) {
    await page.insertText(prompt);
  } else {
    await page.evaluate(`(() => {
      const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
      if (!(editor instanceof HTMLElement)) return { ok: false };
      document.execCommand('insertText', false, ${JSON.stringify(prompt)});
      return { ok: true };
    })()`);
  }

  await page.wait(1);

  const sendState = await waitForSendReady(page, hasImages ? UPLOAD_TIMEOUT_MS : 1000);

  if (!sendState?.editorText) {
    return { ok: false, reason: 'Prompt was not inserted into the ChatGPT editor.' };
  }

  if (!sendState.sendReady) {
    if (hasImages) {
      return { ok: false, uploadFailed: true, reason: `upload did not finish within ${UPLOAD_TIMEOUT_MS / 1000} s (send button stayed disabled)` };
    }
    return { ok: false, reason: 'ChatGPT send button never became enabled.' };
  }

  const clickResult = await page.evaluate(`(() => {
    const send = document.querySelector(${JSON.stringify(SEND_SELECTOR)});
    if (!(send instanceof HTMLButtonElement)) return { ok: false, reason: 'ChatGPT send button not found.' };
    send.click();
    return { ok: true };
  })()`);

  if (!clickResult?.ok) {
    return { ok: false, reason: clickResult?.reason || 'ChatGPT send click failed.' };
  }

  let submit = await waitForSubmitStart(page, sendState.userMessageCount);
  if (!submit.started && typeof page.pressKey === 'function') {
    await page.evaluate(`(() => {
      const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
      if (editor instanceof HTMLElement) {
        editor.focus();
        editor.click();
      }
    })()`);
    await page.pressKey('Enter');
    submit = await waitForSubmitStart(page, sendState.userMessageCount);
  }

  if (!submit.started) {
    return {
      ok: false,
      submitFailed: true,
      check: 'composer still holds the prompt, no stop button, no new user message after click and Enter',
      url: submit.url
    };
  }
  return { ok: true };
}

async function waitForSubmitStart(page, baselineUserMessageCount) {
  let latest = { editorFound: false, editorText: '', stopPresent: false, userMessageCount: baselineUserMessageCount, url: '' };
  for (let poll = 0; poll < 5; poll += 1) {
    await page.wait(1);
    latest = await page.evaluate(`(() => {
      const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
      return {
        editorFound: editor instanceof HTMLElement,
        editorText: editor instanceof HTMLElement ? (editor.innerText || '').trim() : '',
        stopPresent: Boolean(document.querySelector(${JSON.stringify(STOP_SELECTOR)})),
        userMessageCount: document.querySelectorAll(${JSON.stringify(USER_SELECTOR)}).length,
        url: location.href
      };
    })()`);
    if (!latest || typeof latest !== 'object') continue;
    if ((latest.editorFound && !latest.editorText) || latest.stopPresent || Number(latest.userMessageCount) > Number(baselineUserMessageCount)) {
      return { started: true, url: typeof latest.url === 'string' ? latest.url : '' };
    }
  }
  return { started: false, url: typeof latest?.url === 'string' ? latest.url : '' };
}

async function isOnChatGpt(page) {
  const url = await page.evaluate('window.location.href').catch(() => '');
  if (typeof url !== 'string' || !url) return false;

  try {
    return isChatHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function blocked(message) {
  return { response: `${BLOCKED_PREFIX} ${message}` };
}

export function isSuccessfulResponse(response) {
  return Boolean(response) && !RETRYABLE_PREFIXES.some((prefix) => response.startsWith(prefix));
}

export function shouldRetry(response) {
  return RETRYABLE_PREFIXES.some((prefix) => response.startsWith(prefix));
}

export const __test__ = {
  isOnChatGpt,
  ...responseHelpers,
  probeChatGptSurface,
  normalizeSurfaceState,
  summarizeSurfaceIssue
};
