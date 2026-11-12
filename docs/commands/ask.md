# ask

Send a prompt to ChatGPT through the logged-in browser session and return the response.

```bash
chatgptcli ask <prompt> [--new] [--file <path>] [--image <path>]... [--timeout <seconds>] [--max-attempts <n>] [--retry-delay-ms <ms>] [-f json|text]
```

Uses the `chatgpt.com` web UI (via the opencli Browser Bridge), not the OpenAI API.

## Options

| Option | Default | Description |
|---|---|---|
| `--new` | off | Start a fresh chat instead of reusing the currently open one |
| `--file <path>` | none | Inline a local text file's content into the prompt |
| `--image <path>` | none | Repeat 1–10 times to upload PNG, JPG, JPEG, WebP, or GIF images (max 20 MB each) through the composer; waits for every upload before sending |
| `--timeout <seconds>` | `120` | Max time to wait for the assistant response per attempt |
| `--max-attempts <n>` | `5` | Retry attempts for blocked, empty, send-failed, submit-failed, or upload-failed responses |
| `--retry-delay-ms <ms>` | `1500` | Delay between retries |
| `-f, --format <json\|text>` | `json` | Output format |

## Behavior

- Attempt 1 uses the current chat (unless `--new`); every retry falls back to a fresh chat.
- Retries on `[BLOCKED]`, `[NO RESPONSE]`, `[SEND FAILED]`, `[SUBMIT FAILED]`, and `[UPLOAD FAILED]` results; anything else is final.
- A `[SUBMIT FAILED]` result means the prompt was entered but neither the send click nor one Enter fallback started sending. It includes the failed check, tab URL, and browser profile. The CLI checks that ChatGPT accepted the prompt before it waits for an answer.
- Login state comes from ChatGPT's `/api/auth/session` response, not words on the page. A prompt or conversation mentioning login, sign in, or access denied cannot make a logged-in page look like a login or challenge screen.
- JSON output includes the attempt plan for agent consumption.
- `--file` inlines the file as text (UTF-8 text files only, max 1 MB); a missing file or oversized file fails with `INPUT_INVALID`. No browser upload — the content is appended to the prompt in a `--- FILE: <name> ---` block.
- `--image` uploads pictures to the current chat, or to a fresh chat with `--new`. The prompt is required. Missing files, unsupported types, files over 20 MB, more than 10 images, or an upload failure produce a clear error. Use `--image` for pictures; `--file` rejects image extensions and remains text-only.
- `[UPLOAD FAILED]` is retryable. If it says the bridge cannot set file inputs, update the OpenCLI Chrome extension; otherwise use the reported reason to diagnose the upload.

## Examples

```bash
chatgptcli ask "Summarize this post"
chatgptcli ask "Reply with only OK" --new -f text
chatgptcli ask "What do you think about the structure of my README.md" --file "README.md" -f text
chatgptcli ask "Review this UI" --image "a.png" --image "b.png" --file "brief.md" --new -f text
chatgptcli ask "Hello" --max-attempts 3 --retry-delay-ms 1000
```

JSON result:

```json
{
  "ok": true,
  "response": "OK",
  "attempts": 1,
  "plan": [{ "attempt": 1, "mode": "current-chat", "status": "success" }]
}
```

## Exit codes

`0` on success, `1` when no stable response was obtained.

On exe versions before `0.1.10`, a long `--file` prompt containing words such as “login” or “sign in” can produce a false `[BLOCKED]` not-logged-in result. Update the exe before treating that message as an actual login problem.
