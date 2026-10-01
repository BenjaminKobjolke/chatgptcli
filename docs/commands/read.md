# read

Dump the full transcript (all user and assistant messages) of a chat. Sends nothing.

```bash
chatgptcli read [chat-url-or-id] [--files-output <dir>] [--file-id <id>] [--files-inline] [-f json|text]
```

Without an argument, reads the chat currently open in the browser tab. With a URL or bare chat id, navigates there first (like [`switch`](switch.md)) and then reads. Either way the chat is hard-reloaded first — a stale tab hides the "Files in chat" panel, and with it every generated file and report.

Messages come from the chat's backend conversation JSON, fetched inside the logged-in tab — not from the rendered page. ChatGPT only keeps the few turns near the viewport mounted, so the page cannot supply a complete transcript; the JSON always can. Message text is therefore ChatGPT's own markdown source (code fences, `**bold**`, tables), not the rendered text.

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

`attachments` is present only on messages that have one; `file` only after a successful download. An image's `src` is ChatGPT's asset pointer (`sediment://file_…`) until `--files-output` resolves it to a signed URL.

Text: `[role]` header followed by the message body, blank line between messages.

## Notes

- The transcript is the branch of the chat currently shown: answers abandoned by regenerating or editing are not included. Reasoning, tool calls and web-search chatter are left out, and citation markers are stripped.
- A chat that yields no messages at all is an error (`API_ERROR`, exit 5), not an empty success — it means the tab is not logged in, is not on a chat, or ChatGPT changed underneath the tool.
- Uploaded and generated images get their marker at the real position in the message that carries them. A Deep Research report is its own `report` entry where it appeared in the chat, and a generated file is a `file` entry right after the reply that links it. All three come from the conversation JSON.
- The "Files in chat" panel is still checked afterwards for anything the JSON did not explain (a canvas, an uploaded text file); what it finds is appended after the messages. It opens only entries not already in the transcript — each costs a few seconds — so a typical read takes about 15 seconds whatever the number of attachments.
- If the conversation JSON cannot be fetched, `read` falls back to scraping the rendered page. That fallback only sees the turns currently mounted, so a long chat comes back truncated to its tail.
- Ids are assigned per read. Take the id from the same run's output before passing it to `--file-id`.
- A download that fails — an expired signed URL, a blocked host — leaves the bare marker in place and the read still succeeds; the skipped attachment is named on stderr.
- With `--files-output`, the JSON output carries `filesOutputDir`: the directory the files actually landed in, resolved to an absolute path (marker links keep the path you passed).
- ChatGPT Deep Research reports (the downloadable document with an Export button) are captured as an extra `report` entry — see [`docs/INLINE_DOCUMENTS_AND_IMAGES.md`](../INLINE_DOCUMENTS_AND_IMAGES.md) for what is and isn't preserved.
- Requires the same setup as `ask` (Browser Bridge connected, logged into chatgpt.com).
