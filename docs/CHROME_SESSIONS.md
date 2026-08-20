# Chrome Sessions

How chatgptcli decides which Chrome, which profile directory, and which Browser Bridge session it talks to.

## Three layers

1. **Chrome executable + profile directory** — which browser process `chatgptcli launch` starts.
2. **Browser Bridge profile (session)** — which of the connected Chrome profiles the bridge daemon routes `ask`/`read`/`switch` commands to. Each Chrome profile running the OpenCLI extension registers with a `contextId` (e.g. `qfqeup77`).
3. **ChatGPT chat** — which conversation inside that profile (`switch <chat-url>`, unrelated to this document).

## Configuration: `~/.chatgptcli/settings.json`

Created/updated by `set-chrome` and `switch-session`; read by `launch`, `ask`, `read`, `switch`.

```json
{
  "chrome": {
    "executable": "D:\\Apps\\chrome-chatgpt\\chrome.exe",
    "profileDir": "C:\\Users\\XIDA\\.chatgptcli\\chrome-profile",
    "bridgeProfile": "qfqeup77"
  }
}
```

All keys optional. Defaults: platform Chrome path (`C:\Program Files\Google\Chrome\Application\chrome.exe` on Windows), `~/.chatgptcli/chrome-profile`, no bridge profile.

| Key | Set by | Used by |
|---|---|---|
| `chrome.executable` | `set-chrome <path>` | `launch` |
| `chrome.profileDir` | `set-chrome --profile <dir>` | `launch` (`--user-data-dir`) |
| `chrome.bridgeProfile` | `switch-session` | `ask`, `read`, `switch` (bridge routing) |

Broken JSON in the file → `CONFIG_INVALID` (exit 6) naming the file.

## Commands

```bash
chatgptcli set-chrome "D:\Apps\chrome-chatgpt\chrome.exe" [--profile <dir>]
chatgptcli launch                 # start configured Chrome with the profile dir + extension
chatgptcli switch-session [n|contextId|none]   # pick the bridge profile
```

`launch` adds `--load-extension=<opencli>/extension` only when that directory exists on disk. In the compiled exe without an opencli checkout it prints a note instead — install the OpenCLI extension in Chrome manually (see `docs/BUILD_EXECUTABLE.md`).

## How a bridge profile is chosen at runtime

`ask`/`read`/`switch` pass `chrome.bridgeProfile` to the bridge as `preferredContextId` — a preference the daemon arbitrates against live connections (implementation: `connectBridge()` in `src/core/opencli.js`, `resolveBridgeProfile()` in `src/core/settings.js`):

| Connected profiles | Stored `bridgeProfile` | Result |
|---|---|---|
| 1 | any / none | that profile (automatic) |
| 2+ | connected | stored profile |
| 2+ | missing or disconnected | error: `Multiple Browser Bridge profiles are connected` + hint `Run: chatgptcli switch-session` |
| 0 | — | error: extension not connected |

A preference (not a hard pin) means a stale stored profile can never block you when only one real profile is left — the daemon falls back to it automatically.

## Typical flows

**Dedicated ChatGPT Chrome next to your normal Chrome (both run the extension):**

```bash
chatgptcli set-chrome "D:\Apps\chrome-chatgpt\chrome.exe"
chatgptcli launch                 # log in to chatgpt.com once in that window
chatgptcli switch-session        # pick the chrome-chatgpt profile from the list
chatgptcli ask "hello"
```

**"Multiple Browser Bridge profiles are connected":** run `chatgptcli switch-session`, pick one. Happens whenever a second extension-enabled Chrome profile connects.

**Wrong profile answering?** `chatgptcli switch-session` again — the `(current)` marker shows the active pick.

## Related opencli state

The opencli daemon keeps its own profile config in `~/.opencli/browser-profiles.json` (aliases, default via `opencli profile use`). chatgptcli does not write it; the `bridgeProfile` preference in chatgptcli's own settings.json takes effect per connect call and coexists with an opencli default.
