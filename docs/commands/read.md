# read

Dump the full transcript (all user and assistant messages) of a chat. Sends nothing.

```bash
chatgptcli read [chat-url-or-id] [--files-output <dir>] [--file-id <id>] [--files-inline] [-f json|text]
```

Without an argument, reads the chat currently open in the browser tab. With a URL or bare chat id, navigates there first (like [`switch`](switch.md)) and then reads. Either way the chat is hard-reloaded before scraping — a stale tab hides the "Files in chat" panel, and with it every attachment.

## Options

| Option | Default | Description |
|---|---|---|
| `[chat-url-or-id]` | current tab | Chat to read: `https://chatgpt.com/c/<id>` or bare id |
| `--files-output <dir>` | off | Download every attachment into `<dir>` (created if missing) |
| `--file-id <id>` | all | With `--files-output`, download only this attachment (e.g. `image-02`) |
| `--files-inline` | off | Print report and generated-file bodies inline instead of a marker |
| `-f, --format <json\|text>` | `json` | Output format |

## Attachments

Every attachment gets an id — `image-01`, `report-01`, `file-01`, numbered sequentially per kind across the chat — and appears in the transcript as a marker at the position it occupies in the message:

```
[assistant]
First the chart:

[image-01]

As you can see, sales rose 12%.
```

With `--files-output ./out` the file is written as `<id>.<ext>` and the marker becomes a markdown link:

```
[assistant]
First the chart:

![image-01](out/image-01.png)

As you can see, sales rose 12%.
```

`--files-inline` restores the pre-marker behavior for text attachments: Deep Research reports and generated files print their full body. It combines with `--files-output` (inline the text *and* write the file).

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
    {
      "role": "assistant",
      "text": "First the chart:\n\n![image-01](out/image-01.png)",
      "attachments": [
        { "id": "image-01", "kind": "image", "name": "chart.png", "src": "https://...", "file": "out/image-01.png" }
      ]
    },
    {
      "role": "report",
      "title": "Report Title",
      "text": "[report-01]",
      "attachments": [{ "id": "report-01", "kind": "report", "name": "Report Title" }]
    }
  ]
}
```

`attachments` is present only on messages that have one; `file` only after a successful download.

Text: `[role]` header followed by the message body, blank line between messages.

## Notes

- Reads the DOM of the open tab; in very long chats the page may only keep visible messages rendered, so the transcript can be truncated to what is loaded.
- Images come from two places. An `<img>` rendered inside a message gets its marker at the real position in that message's text. Everything else — uploaded screenshots, generated images — is found through the "Files in chat" panel and appended as its own `image` entry after the messages, because ChatGPT frequently renders those outside the message node, or not at all until the page has fully hydrated. The panel is the reliable source; a panel image that duplicates one already found in a message is dropped rather than given a second id.
- An `<img>` counts as content only if it has actually loaded at 64x64 or larger; smaller or unloaded ones are UI chrome (citation favicons, tool glyphs) and get no marker.
- Ids are assigned per read. Take the id from the same run's output before passing it to `--file-id`.
- A download that fails — an expired signed URL, a blocked host — leaves the bare marker in place and the read still succeeds.
- ChatGPT Deep Research reports (the downloadable document with an Export button) are captured as an extra `report` entry — see [`docs/INLINE_DOCUMENTS_AND_IMAGES.md`](../INLINE_DOCUMENTS_AND_IMAGES.md) for what is and isn't preserved.
- Requires the same setup as `ask` (Browser Bridge connected, logged into chatgpt.com).
