---
name: chatgptcli
description: Read ChatGPT conversations and ask ChatGPT questions via the user's browser session. Use when the user says "get the chatgpt chat", "read the chatgpt conversation", "get the chat for <chatgpt.com URL or id>", "read this shared chat", "ask chatgpt <question>", "ask chatgpt about this file", "send this screenshot to chatgpt", or "send this to chatgpt". Drives the compiled chatgptcli.exe, which controls a local Chrome session; public shared links can be read without an account login.
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
| "read this public shared chat: <share-url>" | `chatgptcli.exe read "<share-url>" -f text` |
| "get the deep research report" / "show the generated file" | `chatgptcli.exe read <url-or-id> -f text --files-inline` |
| "download the images / attachments from the chat" | `chatgptcli.exe read <url-or-id> -f text --files-output "path\to\dir"` |
| "ask chatgpt X" | `chatgptcli.exe ask "X" -f text` |
| Read back the exact chat used by an ask | `chatgptcli.exe read "<url from ask JSON>" -f text` |
| "ask chatgpt about file Y" / "send this file to chatgpt" | `chatgptcli.exe ask "question" --file "path\to\Y" -f text` |
| "ask chatgpt about these screenshots" / "send this image to chatgpt" | `chatgptcli.exe ask "question" --image "path\to\a.png" --image "path\to\b.png" -f text` |
| Ask returns `[SUBMIT FAILED]` | Retry once with `chatgptcli.exe ask "question" --new --max-attempts 1`; if it fails again, report the named check, tab URL, and profile. |
| Ask returns `[SEND FAILED] fresh chat did not open` | Retry once with `chatgptcli.exe ask "question" --new --max-attempts 1`; if it fails again, report the tab URL. |
| Ask returns `[SEND FAILED] the newest message in this chat is not this prompt` | Another session may be using the shared ChatGPT tab. Retry once with `chatgptcli.exe ask "question" --new --max-attempts 1` and tell the user not to use ChatGPT in the OpenCLI browser window while an ask runs. |
| Ask returns `[UPLOAD FAILED]` | Retry once with `chatgptcli.exe ask "question" --image "path\to\image.png" --new --max-attempts 1`; if it fails again, report the upload reason. |

Notes:
- **If a transcript shows a prompt with no answer, or the answer only points at a report/canvas/file: do not report "no answer saved". Re-run the same `read` with `--files-inline`.** Deep research replies, canvases and generated documents live in the chat's "Files in chat" panel, not in the message stream, so a plain `read` shows the prompt alone.
- `read` accepts a full `https://chatgpt.com/c/<id>` URL, a public `https://chatgpt.com/share/<id>` link (including query strings), or a bare id. Quote URLs for PowerShell.
- A public shared link returns the available conversation in the normal transcript format and does not require a logged-in account. Generated sandbox files and image downloads with `--files-output` need the account access token, so on a shared link they remain markers or are omitted.
- `read` returns the whole chat regardless of length, and message text is ChatGPT's markdown source (code fences, `**bold**`, tables) — relay it as markdown. Reasoning, tool calls and citation markers are left out; only the branch currently shown is included.
- `read` never reports an empty chat: a transcript with no messages is an error on stderr, and stdout stays empty. **Do not retry it with `--files-inline`** — that flag only changes how attachments print. Act on the message instead:
  - `AUTH_MISSING: Not logged into chatgpt.com in the bridge browser` (exit 3): run `chatgptcli.exe launch`, ask the user to log in in that browser window, then retry once.
  - `API_ERROR: The bridge browser tab is not on a chat` or `API_ERROR: Chat not found for the account logged into the bridge browser` (exit 5): with a URL or id given, the bridge browser is logged into a different account than the one owning the chat, or the chat was deleted (ChatGPT redirects away from a chat it cannot open). Tell the user to open the URL in the bridge browser window and **stop** — retrying cannot help. On a bare `read` the first message just means no chat is open in the tab: ask for the chat URL.
  - `API_ERROR: No messages found in this chat` (exit 5): the cause could not be told (the tab is not on a chat, shows a CAPTCHA, or ChatGPT changed). Run `chatgptcli.exe launch`, have the user confirm the chat opens, retry once; if it still fails, tell the user the exe needs an update rather than reporting an empty conversation.
  - `API_ERROR: No messages found on this shared ChatGPT link` (exit 5): the share may have been deleted or made private. Ask the user to open the link in a browser and confirm it is still available and shared; do not retry the CLI command. chatgptcli 0.1.8 reported this for every public share when the bridge browser was logged in; the minimum exe version now forces an update, so this error again means the share is gone or private.
- A `read` takes about 15 seconds whatever the number of attachments (the chat is reloaded first). Reports and generated files appear as `[report-NN]` / `[file-NN]` entries at their place in the conversation.
- `read` shows attachments as markers (`[image-01]`, `[report-01]`, `[file-01]`), not content. To get the actual content use `--files-inline` (report/file text in the transcript) or `--files-output <dir>` (writes every attachment to disk, images included, and turns each marker into a markdown link). `--file-id <id>` with `--files-output` downloads just one.
- `read` reloads the chat before reading, with or without a URL argument — a stale tab hides the "Files in chat" panel and every attachment with it. An attachment it could not write is named on stderr, and `--files-output` echoes the resolved output directory as `filesOutputDir` in the JSON.
- `ask` options: `--new` starts a fresh chat; `--timeout <seconds>` for long answers (default 120); `--file <path>` inlines a local text file's content into the prompt (UTF-8 text only, max 1 MB — no browser upload); repeat `--image <path>` for 1–10 PNG, JPG, JPEG, WebP, or GIF pictures (max 20 MB each), uploaded through the composer. Images work in the current chat or with `--new`; ChatGPT finishes uploading before the prompt is sent. `--file` stays text-only and rejects image extensions with a hint to use `--image`. Use an absolute or repo-relative path and quote it for PowerShell.
- `ask -f json` returns the `url` of the chat used when known. To inspect that exact exchange, run `chatgptcli.exe read "<url>" -f text`. A `[SEND FAILED] fresh chat did not open` result means the tab stayed on an existing chat; retry once with `--new --max-attempts 1`, then report the tab URL if it persists.
- `[SEND FAILED] the newest message in this chat is not this prompt` means another session typed into the shared ChatGPT tab; retry once with `--new --max-attempts 1`, and tell the user not to use ChatGPT in the OpenCLI browser window while an ask runs.
- `[SUBMIT FAILED]` means the prompt was typed but sending did not start after the send click and one Enter fallback. It is not a login error: do not tell the user to log in just from this result. Retry once with `--new --max-attempts 1`; if it still fails, report the check, tab URL, and profile from the result.
- `[UPLOAD FAILED]` means ChatGPT could not attach or finish uploading one or more images. Images are uploaded natively first and sent through the ChatGPT page if Chrome refuses. Retry once with `--new --max-attempts 1`; if the reason mentions `Allow access to file URLs`, tell the user to turn on that switch for the OpenCLI extension in `chrome://extensions` (OpenCLI > Details) and retry. Otherwise report the upload reason and do not treat it as a login failure.
- Exes below `0.1.10` can falsely report `[BLOCKED] ChatGPT page is not in a logged-in ready state` when an `--file` prompt contains words such as “login” or “sign in”. Update the exe before asking the user to log in for that result.
- Quote the prompt for PowerShell; escape embedded double quotes.

## 3. Prerequisites and errors

Requires Chrome logged into chatgpt.com plus the opencli Browser Bridge (bundled in the exe).

- Connection / bridge error: run `chatgptcli.exe launch` (starts Chrome with the bridge profile and opens chatgpt.com), then `chatgptcli.exe setup` to verify: setup starts the bridge itself when needed and may take up to 30 seconds; `[OK] Browser Bridge connected: <profile>` (exit 0) means the browser is reachable; `[FAIL] Browser Bridge: no browser profile connected` (exit 6) means Chrome is not running or the extension is missing; `several profiles connected` means run `chatgptcli.exe switch-session`. If setup reports `Browser Bridge daemon could not be started` (exit 6), retry setup once, then report the failure. If the bridge still reports no connection after that, the OpenCLI extension is probably missing — ask the user to install it from the Chrome Web Store (https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) in the Chrome profile being used, then retry.
- Login check: after the bridge connects, setup reports `[OK] ChatGPT logged in (profile <id>)`, `[FAIL] ChatGPT is not logged in in the bridge browser (profile <id>)`, or `[FAIL] ChatGPT login state could not be checked: <reason>`. For the logged-out result, ask the user to log into chatgpt.com in that bridge browser and rerun setup. For an unknown result, open chatgpt.com in that browser and rerun setup. Setup only navigates there when the tab is not already on a ChatGPT page, so it preserves an open chat.
- `doctor` does not exist in the exe; `setup` is the diagnostic command. `launch` only starts the browser — it cannot tell whether chatgpt.com is logged in.
- A `[BLOCKED]` login result is based on ChatGPT's session response; ask the user to log in only when the session is actually missing. For CAPTCHA or verification gates, tell the user to complete the check in the browser window, then retry.
