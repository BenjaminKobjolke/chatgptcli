import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import { withSitePage } from '../../.omx/reference/opencli-app-kit/src/core/session.js';
import { resolveBridgeProfile } from '../core/settings.js';
import { askOnPage, isSuccessfulResponse, shouldRetry } from './ask_page.js';
import { normalizeResponse } from './ask_response.js';

let browserAskRunner = runBrowserAsk;
let sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let withSitePageImpl = withSitePage;

export function __setAskDepsForTest(deps) {
  if (deps.browserAskRunner) {
    browserAskRunner = deps.browserAskRunner;
  }
  if (deps.sleep) {
    sleepImpl = deps.sleep;
  }
  if (deps.withSitePage) {
    withSitePageImpl = deps.withSitePage;
  }
}

export function __resetAskDepsForTest() {
  browserAskRunner = runBrowserAsk;
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  withSitePageImpl = withSitePage;
}

export async function runAsk(input) {
  const prompt = (input.prompt || '').trim();
  if (!prompt) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, 'Missing prompt', {
      hint: 'Usage: chatgptcli ask "your prompt"'
    });
  }

  const plan = [];
  let lastResponse = '';
  let lastUrl;

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const mode = (input.newChat || attempt > 1) ? 'fresh-chat' : 'current-chat';
    const result = await browserAskRunner({
      prompt,
      images: input.images || [],
      timeoutSeconds: input.timeoutSeconds,
      newChat: mode === 'fresh-chat'
    });

    const response = normalizeResponse(result.response);
    lastResponse = response || lastResponse;
    lastUrl = typeof result.url === 'string' && result.url ? result.url : undefined;

    if (isSuccessfulResponse(response)) {
      plan.push({ attempt, mode, status: 'success' });
      return {
        exitCode: EXIT_CODE.SUCCESS,
        output: renderResult({ ok: true, response, attempts: attempt, plan, ...(lastUrl ? { url: lastUrl } : {}) }, input.format)
      };
    }

    const reason = response || 'ChatGPT browser flow returned no response.';
    const retryable = shouldRetry(response);
    plan.push({
      attempt,
      mode,
      status: retryable && attempt < input.maxAttempts ? 'retry' : 'error',
      reason
    });

    if (!retryable || attempt === input.maxAttempts) {
      return {
        exitCode: EXIT_CODE.GENERIC,
        output: renderResult({ ok: false, response: lastResponse || null, attempts: attempt, plan, ...(lastUrl ? { url: lastUrl } : {}) }, input.format)
      };
    }

    await sleepImpl(input.retryDelayMs);
  }

  return {
    exitCode: EXIT_CODE.GENERIC,
    output: renderResult({ ok: false, response: lastResponse || null, attempts: input.maxAttempts, plan, ...(lastUrl ? { url: lastUrl } : {}) }, input.format)
  };
}

async function runBrowserAsk(input) {
  const profile = resolveBridgeProfile();
  return withSitePageImpl({
    appName: 'chatgptcli',
    session: 'site:chatgpt',
    timeout: Math.max(30, input.timeoutSeconds),
    preferredContextId: profile || undefined
  }, async (page) => {
    return askOnPage(page, {
      prompt: input.prompt,
      images: input.images || [],
      timeoutMs: input.timeoutSeconds * 1000,
      newChat: input.newChat,
      profile
    });
  });
}

export const __test__ = { runBrowserAsk };

function renderResult(result, format) {
  if (format === 'text') {
    if (result.ok) return result.response;

    const lastStep = result.plan[result.plan.length - 1];
    return [
      'Failed to get a stable ChatGPT response.',
      result.response ? `Last response: ${result.response}` : '',
      lastStep?.reason ? `Last reason: ${lastStep.reason}` : ''
    ].filter(Boolean).join('\n');
  }

  return JSON.stringify(result, null, 2);
}
