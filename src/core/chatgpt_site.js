// Which web addresses are ChatGPT: the one place the supported hosts are named.
export const CHATGPT_ROOT_URL = 'https://chatgpt.com/';
export const SESSION_URL = '/api/auth/session';
// A chat's path is `/c/<id>`, or `/g/<project>/c/<id>` inside a project.
export const CHAT_PATH_MARKER = '/c/';
// Public share URLs are not owned by the account currently signed in.
export const SHARE_PATH_MARKER = '/share/';
const CHAT_HOSTS = Object.freeze(['chatgpt.com', 'chat.openai.com']);

export function isChatHost(hostname) {
  return CHAT_HOSTS.includes(hostname) || hostname.endsWith('.chatgpt.com');
}

export function isSharePath(href) {
  if (typeof href !== 'string' || !href) return false;
  try {
    return new URL(href).pathname.includes(SHARE_PATH_MARKER);
  } catch {
    return false;
  }
}
