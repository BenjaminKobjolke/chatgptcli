// Reads assistant replies from the ChatGPT page and selects a stable response.
import { STOP_SELECTOR, USER_SELECTOR } from './chatgpt_surface.js';

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"] [data-chatgpt-selection-message-id]';
const ASSISTANTS_EXPRESSION = `Array.from(document.querySelectorAll(${JSON.stringify(ASSISTANT_SELECTOR)}))
  .map((node) => {
    const text = ((node instanceof HTMLElement ? node.innerText : node.textContent) || '').trim();
    return { key: node.getAttribute('data-chatgpt-selection-message-id') || node.getAttribute('data-message-id') || text, text };
  })
  .filter((entry) => entry.text)`;
const NO_RESPONSE_PREFIX = '[NO RESPONSE]';

export async function captureAssistantBaseline(page) {
  const baseline = await page.evaluate(`(() => ({
    assistants: ${ASSISTANTS_EXPRESSION},
    userMessageCount: document.querySelectorAll(${JSON.stringify(USER_SELECTOR)}).length
  }))()`);
  return {
    baselineKeys: new Set(normalizeAssistants(baseline?.assistants).map((entry) => entry.key)),
    baselineUserCount: Number(baseline?.userMessageCount) || 0
  };
}

export async function waitForAssistantResponse(page, input) {
  const startedAt = Date.now();
  let lastResponse = '';

  while (Date.now() - startedAt < input.timeoutMs) {
    await page.wait(2);
    const probe = await page.evaluate(`(() => {
      const assistants = ${ASSISTANTS_EXPRESSION};
      const streaming = Boolean(document.querySelector(${JSON.stringify(STOP_SELECTOR)}));
      return {
        assistants,
        streaming,
        userMessageCount: document.querySelectorAll(${JSON.stringify(USER_SELECTOR)}).length
      };
    })()`);

    const hasNewUserMessage = Number(probe?.userMessageCount) > input.baselineUserCount;
    const response = hasNewUserMessage
      ? pickLatestAssistantCandidate(probe.assistants, input.baselineKeys, input.prompt)
      : '';
    // The stop selector has drifted before, so a reply must also hold still for one full poll.
    if (response && !probe.streaming && response === lastResponse) {
      return { response };
    }
    lastResponse = response || lastResponse;
  }

  return { response: lastResponse || NO_RESPONSE_PREFIX };
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

export function normalizeResponse(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const __test__ = { captureAssistantBaseline, pickLatestAssistantCandidate, waitForAssistantResponse };
