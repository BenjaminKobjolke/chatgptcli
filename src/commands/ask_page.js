// The in-page half of `ask`: everything that drives or reads the chatgpt.com tab.
// Retry policy and output rendering live in ask.js.
import { CHATGPT_ROOT_URL, isChatHost } from '../core/chatgpt_site.js';
import {
  EDITOR_SELECTOR,
  SEND_SELECTOR,
  STOP_SELECTOR,
  USER_SELECTOR,
  probeChatGptSurface,
  normalizeSurfaceState,
  summarizeSurfaceIssue
} from './chatgpt_surface.js';

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"] [data-chatgpt-selection-message-id]';
// In-page: every mounted assistant reply as { key, text }, keyed by message id so it survives a re-mount.
const ASSISTANTS_EXPRESSION = `Array.from(document.querySelectorAll(${JSON.stringify(ASSISTANT_SELECTOR)}))
  .map((node) => {
    const text = ((node instanceof HTMLElement ? node.innerText : node.textContent) || '').trim();
    return { key: node.getAttribute('data-chatgpt-selection-message-id') || node.getAttribute('data-message-id') || text, text };
  })
  .filter((entry) => entry.text)`;
const RETRYABLE_PREFIXES = ['[BLOCKED]', '[NO RESPONSE]', '[SEND FAILED]', '[SUBMIT FAILED]'];
const BLOCKED_PREFIX = '[BLOCKED]';
const NO_RESPONSE_PREFIX = '[NO RESPONSE]';
const SEND_FAILED_PREFIX = '[SEND FAILED]';
const SUBMIT_FAILED_PREFIX = '[SUBMIT FAILED]';
export async function askOnPage(page, input) {
  let surface = await ensureReadySurface(page, input.newChat);
  if (!surface.editorReady || surface.loginLike || surface.challengeLike) {
    return blocked(summarizeSurfaceIssue(surface));
  }

  const baselineKeys = new Set(normalizeAssistants(await page.evaluate(ASSISTANTS_EXPRESSION)).map((entry) => entry.key));
  const sendResult = await injectAndSend(page, input.prompt);
  if (!sendResult.ok) {
    if (sendResult.submitFailed) {
      const profile = input.profile || 'bridge default';
      return {
        response: `${SUBMIT_FAILED_PREFIX} Prompt typed but send did not start (check: ${sendResult.check}; tab: ${sendResult.url}; profile: ${profile})`
      };
    }
    return { response: `${SEND_FAILED_PREFIX} ${sendResult.reason}` };
  }

  const result = await waitForAssistantResponse(page, {
    prompt: input.prompt,
    timeoutMs: input.timeoutMs,
    baselineKeys
  });

  if (isSuccessfulResponse(result.response)) {
    return result;
  }

  surface = await probeChatGptSurface(page);
  if (surface.loginLike || surface.challengeLike) {
    return blocked(summarizeSurfaceIssue(surface));
  }

  return result;
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

  return surface;
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

async function injectAndSend(page, prompt) {
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

  const sendState = await page.evaluate(`(() => {
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    const send = document.querySelector(${JSON.stringify(SEND_SELECTOR)});
    const userMessageCount = document.querySelectorAll(${JSON.stringify(USER_SELECTOR)}).length;
    return {
      editorText: editor instanceof HTMLElement ? (editor.innerText || '').trim() : '',
      sendReady: send instanceof HTMLButtonElement ? !send.disabled : false,
      userMessageCount
    };
  })()`);

  if (!sendState?.editorText) {
    return { ok: false, reason: 'Prompt was not inserted into the ChatGPT editor.' };
  }

  if (!sendState.sendReady) {
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

async function waitForAssistantResponse(page, input) {
  const startedAt = Date.now();
  let lastResponse = '';

  while (Date.now() - startedAt < input.timeoutMs) {
    await page.wait(2);
    const probe = await page.evaluate(`(() => {
      const assistants = ${ASSISTANTS_EXPRESSION};
      const streaming = Boolean(document.querySelector(${JSON.stringify(STOP_SELECTOR)}));
      return {
        assistants,
        streaming
      };
    })()`);

    const response = pickLatestAssistantCandidate(probe.assistants, input.baselineKeys, input.prompt);
    // The stop selector has drifted before, so a reply must also hold still for one full poll.
    if (response && !probe.streaming && response === lastResponse) {
      return { response };
    }
    lastResponse = response || lastResponse;

  }

  return { response: lastResponse || NO_RESPONSE_PREFIX };
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

export function normalizeResponse(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAssistants(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({ key: String(entry?.key ?? ''), text: normalizeResponse(entry?.text) }))
    .filter((entry) => entry.text);
}

function pickLatestAssistantCandidate(assistants, baselineKeys, prompt) {
  const normalizedPrompt = normalizeResponse(prompt);
  const fresh = normalizeAssistants(assistants).filter((entry) => !baselineKeys.has(entry.key));

  for (let i = fresh.length - 1; i >= 0; i -= 1) {
    if (fresh[i].text !== normalizedPrompt) {
      return fresh[i].text;
    }
  }

  return '';
}

export function isSuccessfulResponse(response) {
  return Boolean(response) && !RETRYABLE_PREFIXES.some((prefix) => response.startsWith(prefix));
}

export function shouldRetry(response) {
  return RETRYABLE_PREFIXES.some((prefix) => response.startsWith(prefix));
}

export const __test__ = {
  isOnChatGpt,
  pickLatestAssistantCandidate,
  waitForAssistantResponse,
  probeChatGptSurface,
  normalizeSurfaceState,
  summarizeSurfaceIssue
};
