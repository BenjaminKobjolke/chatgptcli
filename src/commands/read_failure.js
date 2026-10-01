// Why `read` found no messages. The conversation fetch (read_conversation.js)
// is the only place that can tell a logged-out browser from a chat the account
// cannot open; this module names those causes and the error each one becomes.
import { ERROR_CODE } from '../core/errors.js';

const STATUS_NOT_FOUND = 404;
const FETCH_FAILURE = Object.freeze({
  NONE: '',
  LOGGED_OUT: 'logged-out',
  OFF_CHAT: 'off-chat',
  NOT_FOUND: 'not-found'
});

// What read.js throws for a transcript without messages, keyed by cause.
// An empty result is never a success: `ok: true, count: 0` reads like an empty
// chat, which is how a logged-out browser and a ChatGPT markup change both
// went unnoticed.
export const EMPTY_TRANSCRIPT_ERROR = Object.freeze({
  [FETCH_FAILURE.LOGGED_OUT]: {
    code: ERROR_CODE.AUTH_MISSING,
    message: 'Not logged into chatgpt.com in the bridge browser',
    hint: 'Run `chatgptcli launch`, log in in that browser window, then retry.'
  },
  // ChatGPT redirects away from a chat the account cannot open (confirmed live
  // with an unknown id), so this is also what a wrong account looks like.
  [FETCH_FAILURE.OFF_CHAT]: {
    code: ERROR_CODE.API_ERROR,
    message: 'The bridge browser tab is not on a chat',
    hint:
      'ChatGPT leaves a chat URL it cannot open: the browser is logged into a different account, or the chat was deleted. ' +
      'Open the chat in the bridge browser window to check. Without an argument, read needs a chat open in that tab.'
  },
  [FETCH_FAILURE.NOT_FOUND]: {
    code: ERROR_CODE.API_ERROR,
    message: 'Chat not found for the account logged into the bridge browser',
    hint: 'Open the chat URL in the bridge browser window: it is logged into a different account, or the chat was deleted.'
  },
  [FETCH_FAILURE.NONE]: {
    code: ERROR_CODE.API_ERROR,
    message: 'No messages found in this chat',
    hint:
      'Check that the bridge browser is logged into chatgpt.com (`chatgptcli launch`) and shows the chat, not a CAPTCHA. ' +
      'If it does, ChatGPT changed its page or API — update chatgptcli.'
  }
});

// Classifies the raw result of the in-page conversation fetch. A fetch that
// threw (a challenge page, no network) reports nothing: `NONE`.
export function conversationFetchFailure(value) {
  const object = value && typeof value === 'object' ? value : {};
  if (object.loggedOut) return FETCH_FAILURE.LOGGED_OUT;
  if (object.offChat) return FETCH_FAILURE.OFF_CHAT;
  if (object.status === STATUS_NOT_FOUND) return FETCH_FAILURE.NOT_FOUND;
  return FETCH_FAILURE.NONE;
}
