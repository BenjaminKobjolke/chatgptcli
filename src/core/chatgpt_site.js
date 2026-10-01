// Which web addresses are ChatGPT: the one place the supported hosts are named.
export const CHATGPT_ROOT_URL = 'https://chatgpt.com/';
// A chat's path is `/c/<id>`, or `/g/<project>/c/<id>` inside a project.
export const CHAT_PATH_MARKER = '/c/';
const CHAT_HOSTS = Object.freeze(['chatgpt.com', 'chat.openai.com']);

export function isChatHost(hostname) {
  return CHAT_HOSTS.includes(hostname) || hostname.endsWith('.chatgpt.com');
}
