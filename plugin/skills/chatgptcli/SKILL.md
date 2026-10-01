---
name: chatgptcli
description: Read ChatGPT conversations and ask ChatGPT questions via the user's logged-in browser session. Use when the user says "get the chatgpt chat", "read the chatgpt conversation", "get the chat for <chatgpt.com URL or id>", "ask chatgpt <question>", "ask chatgpt about this file", or "send this to chatgpt". Drives the compiled chatgptcli.exe, which controls a local Chrome session logged into chatgpt.com.
---

# chatgptcli

Wraps `chatgptcli.exe` — a CLI that reads and writes ChatGPT conversations through the user's own logged-in Chrome session (no API key).

## 1. Locate the exe

Use the first that exists:

1. `chatgptcli.exe` in the current repo root (when working inside the chatgptcli repo)
2. `$HOME\.chatgptcli\bin\chatgptcli.exe`

If neither exists, download it (Windows PowerShell):

```powershell
New-Item -ItemType Directory -Force "$HOME\.chatgptcli\bin" | Out-Null
Invoke-WebRequest "https://github.com/BenjaminKobjolke/chatgptcli/releases/latest/download/chatgptcli.exe" -OutFile "$HOME\.chatgptcli\bin\chatgptcli.exe"
```

If the download fails (404, network error): **stop**. Tell the user the exe could not be downloaded and point them to https://github.com/BenjaminKobjolke/chatgptcli/releases — there is no build fallback.

### Exe updates

- If any command prints `UPDATE_REQUIRED` (exit code 7): the installed exe is older than this plugin requires (`min_exe_version.txt` next to this file). Run the commands printed in that message, then retry the original command once.
- Bootstrap for old exes (≤ 0.1.1, before the self-check existed): after locating an installed exe at `$HOME\.chatgptcli\bin\chatgptcli.exe`, if `chatgptcli.exe --version` prints less than `0.1.2`, run `taskkill /im chatgptcli.exe /f` and the download command above once, then continue.

## 2. Command mapping

All commands print JSON by default; use `-f text` for plain text and relay that to the user.

| User intent | Command |
|---|---|
| "get / read the chatgpt chat" (current chat) | `chatgptcli.exe read -f text` |
| "get the chat for <url or id>" | `chatgptcli.exe read <url-or-id> -f text` |
| "get the deep research report" / "show the generated file" | `chatgptcli.exe read <url-or-id> -f text --files-inline` |
| "download the images / attachments from the chat" | `chatgptcli.exe read <url-or-id> -f text --files-output "path\to\dir"` |
| "ask chatgpt X" | `chatgptcli.exe ask "X" -f text` |
| "ask chatgpt about file Y" / "send this file to chatgpt" | `chatgptcli.exe ask "question" --file "path\to\Y" -f text` |

Notes:
- **If a transcript shows a prompt with no answer, or the answer only points at a report/canvas/file: do not report "no answer saved". Re-run the same `read` with `--files-inline`.** Deep research replies, canvases and generated documents live in the chat's "Files in chat" panel, not in the message stream, so a plain `read` shows the prompt alone.
- `read` accepts a full `https://chatgpt.com/c/<id>` URL or the bare id.
- `read` returns the whole chat regardless of length, and message text is ChatGPT's markdown source (code fences, `**bold**`, tables) — relay it as markdown. Reasoning, tool calls and citation markers are left out; only the branch currently shown is included.
- `read` never reports an empty chat: a transcript with no messages is an error on stderr, and stdout stays empty. **Do not retry it with `--files-inline`** — that flag only changes how attachments print. Act on the message instead:
  - `AUTH_MISSING: Not logged into chatgpt.com in the bridge browser` (exit 3): run `chatgptcli.exe launch`, ask the user to log in in that browser window, then retry once.
  - `API_ERROR: The bridge browser tab is not on a chat` or `API_ERROR: Chat not found for the account logged into the bridge browser` (exit 5): with a URL or id given, the bridge browser is logged into a different account than the one owning the chat, or the chat was deleted (ChatGPT redirects away from a chat it cannot open). Tell the user to open the URL in the bridge browser window and **stop** — retrying cannot help. On a bare `read` the first message just means no chat is open in the tab: ask for the chat URL.
  - `API_ERROR: No messages found in this chat` (exit 5): the cause could not be told (the tab is not on a chat, shows a CAPTCHA, or ChatGPT changed). Run `chatgptcli.exe launch`, have the user confirm the chat opens, retry once; if it still fails, tell the user the exe needs an update rather than reporting an empty conversation.
- A `read` takes about 15 seconds whatever the number of attachments (the chat is reloaded first). Reports and generated files appear as `[report-NN]` / `[file-NN]` entries at their place in the conversation.
- `read` shows attachments as markers (`[image-01]`, `[report-01]`, `[file-01]`), not content. To get the actual content use `--files-inline` (report/file text in the transcript) or `--files-output <dir>` (writes every attachment to disk, images included, and turns each marker into a markdown link). `--file-id <id>` with `--files-output` downloads just one.
- `read` reloads the chat before reading, with or without a URL argument — a stale tab hides the "Files in chat" panel and every attachment with it. An attachment it could not write is named on stderr, and `--files-output` echoes the resolved output directory as `filesOutputDir` in the JSON.
- `ask` options: `--new` starts a fresh chat; `--timeout <seconds>` for long answers (default 120); `--file <path>` inlines a local text file's content into the prompt (UTF-8 text only, max 1 MB — no browser upload). Use an absolute or repo-relative path and quote it for PowerShell.
- Quote the prompt for PowerShell; escape embedded double quotes.

## 3. Prerequisites and errors

Requires Chrome logged into chatgpt.com plus the opencli Browser Bridge (bundled in the exe).

- Connection / bridge error: run `chatgptcli.exe launch` (starts Chrome with the bridge profile and opens chatgpt.com), then `chatgptcli.exe setup` to verify: `[OK] Browser Bridge connected: <profile>` (exit 0) means the browser is reachable; `[FAIL] Browser Bridge: no browser profile connected` (exit 6) means Chrome is not running or the extension is missing; `several profiles connected` means run `chatgptcli.exe switch-session`. Ask the user to log in if needed, then retry. If the bridge still reports no connection after that, the OpenCLI extension is probably missing — ask the user to install it from the Chrome Web Store (https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) in the Chrome profile being used, then retry.
- `doctor` does not exist in the exe; `setup` is the diagnostic command. `launch` only starts the browser — it cannot tell whether chatgpt.com is logged in.
- Login or CAPTCHA gate reported in output: tell the user to complete login/CAPTCHA in the launched browser window, then retry.
