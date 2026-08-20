# read

Dump the full transcript (all user and assistant messages) of a chat. Sends nothing.

```bash
chatgptcli read [chat-url-or-id] [-f json|text]
```

Without an argument, reads the chat currently open in the browser tab. With a URL or bare chat id, navigates there first (like [`switch`](switch.md)) and then reads.

## Options

| Option | Default | Description |
|---|---|---|
| `[chat-url-or-id]` | current tab | Chat to read: `https://chatgpt.com/c/<id>` or bare id |
| `-f, --format <json\|text>` | `json` | Output format |

## Output

JSON:

```json
{
  "ok": true,
  "url": "https://chatgpt.com/c/...",
  "count": 3,
  "messages": [
    { "role": "user", "text": "Reply with only OK" },
    { "role": "assistant", "text": "OK" },
    { "role": "report", "title": "Report Title", "text": "# Report Title\n\n..." }
  ]
}
```

Text: `[role]` header followed by the message body, blank line between messages.

## Notes

- Reads the DOM of the open tab; in very long chats the page may only keep visible messages rendered, so the transcript can be truncated to what is loaded.
- ChatGPT Deep Research reports (the downloadable document with an Export button) are captured as an extra `report` entry with the report converted to markdown — see [`docs/INLINE_DOCUMENTS.md`](../INLINE_DOCUMENTS.md) for what is and isn't preserved.
- Requires the same setup as `ask` (Browser Bridge connected, logged into chatgpt.com).
