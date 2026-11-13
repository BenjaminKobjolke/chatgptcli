// Which web addresses are ChatGPT: the one place the supported hosts are named.
export const CHATGPT_ROOT_URL = 'https://chatgpt.com/';
export const SESSION_URL = '/api/auth/session';
// A chat's path is `/c/<id>`, or `/g/<project>/c/<id>` inside a project.
export const CHAT_PATH_MARKER = '/c/';
// Public share URLs are not owned by the account currently signed in.
export const SHARE_PATH_MARKER = '/share/';
const CHAT_HOSTS = Object.freeze(['chatgpt.com', 'chat.openai.com']);

// `page.goto` on a URL the tab is already sitting on is a no-op (no reload) —
// confirmed live to leave a stale, already-open chat tab in a
// broken DOM state (e.g. the "Files in chat" panel silently failing to
// resolve). Navigating to a neutral URL first forces a real reload before
// landing on the target, which fixed the flakiness in repeated live testing.
export async function hardNavigate(page, url) {
  await page.goto(CHATGPT_ROOT_URL, { settleMs: 1000 });
  await page.goto(url, { settleMs: 1500 });
}

export function isChatHost(hostname) {
  return CHAT_HOSTS.includes(hostname) || hostname.endsWith('.chatgpt.com');
}

export function isChatPath(href) {
  if (typeof href !== 'string' || !href) return false;
  try {
    const url = new URL(href);
    return isChatHost(url.hostname) && url.pathname.includes(CHAT_PATH_MARKER);
  } catch {
    return false;
  }
}

export function isSharePath(href) {
  if (typeof href !== 'string' || !href) return false;
  try {
    return new URL(href).pathname.includes(SHARE_PATH_MARKER);
  } catch {
    return false;
  }
}
