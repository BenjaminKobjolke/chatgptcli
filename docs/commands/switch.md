# switch

Navigate the browser tab to a specific chat. Reads nothing, sends nothing.

```bash
chatgptcli switch <chat-url-or-id>
```

## Arguments

- Full URL: `https://chatgpt.com/c/<id>` (project chat URLs like `/g/.../c/<id>` also work)
- Bare id: `6a8690d7-...` → expanded to `https://chatgpt.com/c/<id>`

Non-ChatGPT URLs are rejected.

## Output

```json
{ "ok": true, "url": "https://chatgpt.com/c/..." }
```

`url` is the final location after navigation.

## Notes

- Waits up to 10 s for chat messages to appear after navigating.
- Follow-up `ask` (without `--new`) and `read` then operate on this chat.
