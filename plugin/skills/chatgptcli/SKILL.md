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

## 2. Command mapping

All commands print JSON by default; use `-f text` for plain text and relay that to the user.

| User intent | Command |
|---|---|
| "get / read the chatgpt chat" (current chat) | `chatgptcli.exe read -f text` |
| "get the chat for <url or id>" | `chatgptcli.exe read <url-or-id> -f text` |
| "ask chatgpt X" | `chatgptcli.exe ask "X" -f text` |
| "ask chatgpt about file Y" / "send this file to chatgpt" | `chatgptcli.exe ask "question" --file "path\to\Y" -f text` |

Notes:
- `read` accepts a full `https://chatgpt.com/c/<id>` URL or the bare id.
- `ask` options: `--new` starts a fresh chat; `--timeout <seconds>` for long answers (default 120); `--file <path>` inlines a local text file's content into the prompt (UTF-8 text only, max 1 MB — no browser upload). Use an absolute or repo-relative path and quote it for PowerShell.
- Quote the prompt for PowerShell; escape embedded double quotes.

## 3. Prerequisites and errors

Requires Chrome logged into chatgpt.com plus the opencli Browser Bridge (bundled in the exe).

- Connection / bridge error: run `chatgptcli.exe launch` (starts Chrome with the bridge profile and opens chatgpt.com), then `chatgptcli.exe setup` to verify. Ask the user to log in if needed, then retry. If the bridge still reports no connection after that, the OpenCLI extension is probably missing — ask the user to install it from the Chrome Web Store (https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) in the Chrome profile being used, then retry.
- Login or CAPTCHA gate reported in output: tell the user to complete login/CAPTCHA in the launched browser window, then retry.
