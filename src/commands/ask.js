import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import { connectBridge, loadBrowserBridge } from '../core/opencli.js';
import { resolveBridgeProfile } from '../core/settings.js';
import { askOnPage, isSuccessfulResponse, normalizeResponse, shouldRetry } from './ask_page.js';

let browserAskRunner = runBrowserAsk;
let sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function __setAskDepsForTest(deps) {
  if (deps.browserAskRunner) {
    browserAskRunner = deps.browserAskRunner;
  }
  if (deps.sleep) {
    sleepImpl = deps.sleep;
  }
}

export function __resetAskDepsForTest() {
  browserAskRunner = runBrowserAsk;
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const mode = (input.newChat || attempt > 1) ? 'fresh-chat' : 'current-chat';
    const result = await browserAskRunner({
      prompt,
      timeoutSeconds: input.timeoutSeconds,
      newChat: mode === 'fresh-chat'
    });

    const response = normalizeResponse(result.response);
    lastResponse = response || lastResponse;

    if (isSuccessfulResponse(response)) {
      plan.push({ attempt, mode, status: 'success' });
      return {
        exitCode: EXIT_CODE.SUCCESS,
        output: renderResult({ ok: true, response, attempts: attempt, plan }, input.format)
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
        output: renderResult({ ok: false, response: lastResponse || null, attempts: attempt, plan }, input.format)
      };
    }

    await sleepImpl(input.retryDelayMs);
  }

  return {
    exitCode: EXIT_CODE.GENERIC,
    output: renderResult({ ok: false, response: lastResponse || null, attempts: input.maxAttempts, plan }, input.format)
  };
}

async function runBrowserAsk(input) {
  const { BrowserBridge } = await loadBrowserBridge();
  const bridge = new BrowserBridge();

  try {
    const page = await connectBridge(bridge, {
      timeout: Math.max(30, input.timeoutSeconds),
      session: 'site:chatgpt',
      preferredContextId: resolveBridgeProfile()
    });

    return await askOnPage(page, {
      prompt: input.prompt,
      timeoutMs: input.timeoutSeconds * 1000,
      newChat: input.newChat
    });
  } finally {
    await bridge.close().catch(() => {});
  }
}

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
