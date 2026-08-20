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
  "count": 2,
  "messages": [
    { "role": "user", "text": "Reply with only OK" },
    { "role": "assistant", "text": "OK" }
  ]
}
```

Text: `[role]` header followed by the message body, blank line between messages.

## Notes

- Reads the DOM of the open tab; in very long chats the page may only keep visible messages rendered, so the transcript can be truncated to what is loaded.
- Requires the same setup as `ask` (Browser Bridge connected, logged into chatgpt.com).
