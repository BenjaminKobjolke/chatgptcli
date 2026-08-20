# ask

Send a prompt to ChatGPT through the logged-in browser session and return the response.

```bash
chatgptcli ask <prompt> [--new] [--file <path>] [--timeout <seconds>] [--max-attempts <n>] [--retry-delay-ms <ms>] [-f json|text]
```

Uses the `chatgpt.com` web UI (via the opencli Browser Bridge), not the OpenAI API.

## Options

| Option | Default | Description |
|---|---|---|
| `--new` | off | Start a fresh chat instead of reusing the currently open one |
| `--file <path>` | none | Inline a local text file's content into the prompt |
| `--timeout <seconds>` | `120` | Max time to wait for the assistant response per attempt |
| `--max-attempts <n>` | `5` | Retry attempts for blocked/empty responses |
| `--retry-delay-ms <ms>` | `1500` | Delay between retries |
| `-f, --format <json\|text>` | `json` | Output format |

## Behavior

- Attempt 1 uses the current chat (unless `--new`); every retry falls back to a fresh chat.
- Retries on `[BLOCKED]`, `[NO RESPONSE]`, and `[SEND FAILED]` results; anything else is final.
- JSON output includes the attempt plan for agent consumption.
- `--file` inlines the file as text (UTF-8 text files only, max 1 MB); a missing file or oversized file fails with `INPUT_INVALID`. No browser upload — the content is appended to the prompt in a `--- FILE: <name> ---` block.

## Examples

```bash
chatgptcli ask "Summarize this post"
chatgptcli ask "Reply with only OK" --new -f text
chatgptcli ask "What do you think about the structure of my README.md" --file "README.md" -f text
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
