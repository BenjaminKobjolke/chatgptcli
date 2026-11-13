// Shared ChatGPT page selectors and readiness probe for ask and setup.
import { SESSION_URL } from '../core/chatgpt_site.js';

export const EDITOR_SELECTOR = '.ProseMirror[role="textbox"]';
export const SEND_SELECTOR = '[data-testid="send-button"], form button[type="submit"]';
// Confirmed live mid-stream: the redesigned stop button has no testid.
export const STOP_SELECTOR = '[data-testid="stop-button"], form button[aria-label^="Stop"]';
// The legacy role markup comes first, followed by redesigned content-search units.
export const USER_SELECTOR = '[data-message-author-role="user"], [data-content-search-unit-key$=":user"]';
export const COMPOSER_FILE_INPUT_SELECTOR = '[data-chatgptcli-file-input="1"]';
export const CHALLENGE_HINTS = Object.freeze([
  'captcha',
  'verify you are human',
  'human verification',
  'access denied',
  'one more step',
  '请先验证',
  '人机验证'
]);

export async function probeChatGptSurface(page) {
  const result = await page.evaluate(`(async () => {
    const bodyText = (document.body?.innerText || '').trim();
    const userMessageTexts = Array.from(document.querySelectorAll(${JSON.stringify(USER_SELECTOR)}))
      .map((message) => (message instanceof HTMLElement ? message.innerText : message.textContent) || '')
      .filter(Boolean);
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    const send = document.querySelector(${JSON.stringify(SEND_SELECTOR)});
    let loggedIn = null;
    let loginError = '';
    try {
      const response = await fetch(${JSON.stringify(SESSION_URL)}, { credentials: 'include' });
      const session = await response.json();
      loggedIn = Boolean(session?.accessToken);
    } catch (error) {
      loginError = error instanceof Error ? error.message : String(error);
    }
    return {
      url: location.href,
      bodyText,
      userMessageTexts,
      editorFound: editor instanceof HTMLElement,
      sendFound: send instanceof HTMLButtonElement,
      sendDisabled: send instanceof HTMLButtonElement ? send.disabled : false,
      loggedIn,
      loginError
    };
  })()`);

  return normalizeSurfaceState(result);
}

export function normalizeSurfaceState(value) {
  const object = value && typeof value === 'object' ? value : {};
  const editorFound = Boolean(object.editorFound);
  let bodyText = typeof object.bodyText === 'string' ? object.bodyText.toLowerCase() : '';
  for (const messageText of Array.isArray(object.userMessageTexts) ? object.userMessageTexts : []) {
    if (typeof messageText === 'string' && messageText) {
      bodyText = bodyText.replace(messageText.toLowerCase(), ' ');
    }
  }
  bodyText = bodyText.slice(0, 4000);
  const challengeLike = !editorFound && (
    Boolean(object.challengeLike) || CHALLENGE_HINTS.some((hint) => bodyText.includes(hint))
  );

  return {
    url: typeof object.url === 'string' ? object.url : '',
    editorFound,
    sendFound: Boolean(object.sendFound),
    sendDisabled: Boolean(object.sendDisabled),
    editorReady: editorFound,
    loggedIn: object.loggedIn === true ? true : object.loggedIn === false ? false : null,
    loginError: typeof object.loginError === 'string' ? object.loginError : '',
    loginLike: object.loggedIn === false || Boolean(object.loginLike),
    challengeLike
  };
}

export function summarizeSurfaceIssue(state) {
  if (state.challengeLike) {
    return 'ChatGPT page is blocked by a verification or access challenge.';
  }
  if (state.loginLike) {
    return 'ChatGPT page is not in a logged-in ready state.';
  }
  if (!state.editorFound) {
    return 'ChatGPT composer editor was not found.';
  }
  if (!state.sendFound) {
    return 'ChatGPT send button was not found.';
  }
  return 'ChatGPT composer never reached a ready state.';
}

export const __test__ = { normalizeSurfaceState };
