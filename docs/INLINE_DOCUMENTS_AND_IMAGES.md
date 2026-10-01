# Inline documents and images (Deep Research reports, generated files, images)

`chatgptcli read` takes a chat's messages from its backend conversation JSON
(see "Message source" below) and falls back to scraping the DOM of the
chatgpt.com tab, where every turn used to be a `[data-message-author-role]` node
whose `innerText` is the whole message. Two kinds of attachment are in neither
place and need special handling:

- A **ChatGPT Deep Research report** — the richly formatted, downloadable
  document with an **Export** button — renders **inside a cross-origin
  sandboxed iframe** (host `web-sandbox.oaiusercontent.com`,
  `title="internal://deep-research"`), not as a node in the top document. The
  top frame's `page.evaluate` cannot read across that boundary.
- A **plain generated file** (code-interpreter/canvas output, e.g. a `.md`
  file ChatGPT creates and offers as a download) renders as an inline
  attachment card whose message text is just the download link's label (e.g.
  "Markdown-Testdatei herunterladen") — not the file's actual content.

Without special handling, `read` silently skips both.

This doc is the maintainer contract for that handling. Two independent
mechanisms exist; only the first currently produces report bodies (see
"Cross-origin iframe path" below for why the second is inert cover, kept
per explicit decision rather than deleted).

## Message source: backend conversation JSON

ChatGPT's redesigned chat page (confirmed live 2026-10-01) removed
`[data-testid^="conversation-turn"]` and `[data-message-author-role]` and, more
importantly, **virtualizes the chat list**: only the ~5 turns near the viewport
are mounted, older ones load on scroll while newer ones unmount. A chat with 46
user turns exposed 5. No selector can read a complete transcript out of that
DOM, so `read` stopped using it as its primary source.

`readConversation` in `src/commands/read_conversation.js` runs one in-page
script: `GET /api/auth/session` for the bearer token, then
`GET /backend-api/conversation/<id>` (the id comes from the tab's own
`location.pathname`). Everything that interprets the response runs in Node:

- `mapping` is a tree. The visible chat is the path from `current_node` up
  through `parent`; branches abandoned by regenerating or editing are skipped.
- A message is kept when `author.role` is `user` or `assistant`, `recipient` is
  `all`, `content.content_type` is `text` or `multimodal_text`, and
  `metadata.is_visually_hidden_from_conversation` is not set. That drops
  reasoning (`thoughts`, `reasoning_recap`), tool calls (`recipient: web.run`,
  `python`) and tool output.
- A `tool` message is kept only for its image parts — a generated image — and
  is emitted as `assistant`, without the tool's own log text.
- Citation tokens (U+E200 … U+E201) are stripped from text parts.
- An `image_asset_pointer` part becomes an `[image-NN]` marker at its position,
  with the pointer (`sediment://file_<id>`) as the attachment's `src` and the
  upload's name from `metadata.attachments`. `resolveImagePointers` swaps the
  pointer for a signed URL through `/backend-api/files/download/<id>` — only
  under `--files-output`, since it costs one request per image.

- A **Deep Research report** is not a file reference in the JSON. Its whole
  markdown body sits in the `tool` message that rendered the report card:
  `metadata.chatgpt_sdk.widget_state` is a JSON *string* whose
  `report_message.content.parts[0]` is the report (confirmed live: byte-identical
  to what the panel path downloads). It becomes a `report` entry at that
  message's position, with no request at all. Its title is the body's first
  `# ` heading — the one ChatGPT shows; `plan.title` in the same state is only
  the research plan's working title.
- A **generated file** has no `file_<id>` anywhere in the JSON (confirmed live).
  The reply that offers it links its sandbox path — `sandbox:/mnt/data/<name>` —
  and `GET /backend-api/conversation/<id>/interpreter/download?message_id=<message.id>&sandbox_path=<path>`
  answers with the same `{ download_url, file_name }` shape as the files
  endpoint, so `fetchSignedContent` reads it unchanged. It becomes a `file`
  entry right after that reply. A path linked twice in one reply resolves once.

Both are found by `conversationMessages` as empty placeholders and filled by
`resolvePendingAttachments`, which read.js calls once it owns the id counters.
A sandbox link that no longer resolves leaves its placeholder empty, and the
entry drops out like any other empty one. The fetch-and-classify code is shared
with the panel path in `src/commands/read_file_content.js`.

`readConversation` returns `null` when the fetch does not come back as a 200
with a `mapping`; `runRead` then falls back to the DOM scrape, which is why the
sections below still describe it.

**The "Files in chat" panel still runs after the JSON**, as the net for what the
JSON path does not explain (a canvas, an uploaded text file, a file whose
sandbox link has expired). It clicks only entries whose label is not already an
attachment name in the transcript. On the image and file chats measured that is
no click at all; a report is still clicked once, because the panel lists it
under a label that is not its title, and is then dropped as a duplicate:

| Chat | Before | After |
|---|---|---|
| 5 uploaded images, one generated file listed twice | ~45 s | ~16 s |
| 35 images, 28 of them generated | 5 min 7 s | ~15 s |
| one Deep Research report | ~13 s | 15-29 s (one click, same as before) |

An empty transcript is an error (`API_ERROR`, exit 5). It used to be
`ok: true, count: 0`, which is how the DOM change went unnoticed.

## Markers: inlining is opt-in

A resolved attachment is **not** inlined by default. Each one gets an id —
`image-NN`, `report-NN`, `file-NN`, numbered sequentially per kind across the
chat — and the transcript carries a bare `[report-01]` marker where the
attachment sits. The body travels on the entry's `attachments` record instead,
so it reaches the caller only through:

- `--files-inline` — print the report/file body in the transcript, the
  behavior that used to be unconditional; or
- `--files-output <dir>` — write it to `<dir>/<id><ext>` (`.md` for a report)
  and rewrite the marker to `![report-01](<dir>/report-01.md)`. A report is
  always `.md`: its `name` is the report *title*, so a title with a dot in it
  must not be read as carrying its own extension.

Images follow the same contract but have no inline form: `--files-output`
downloads the bytes, and without it the marker is all the caller gets. An
`<img>` counts as content only once it has loaded at 64x64 or larger —
requiring real pixels is what keeps unloaded chrome (citation favicons, tool
glyphs) from producing markers that appear on some runs and not others.

The next paragraph describes the **DOM fallback** only; from the conversation
JSON an image is a part of its message and always gets a positioned marker.

**An image is usually not in its message turn at all.** Confirmed live: a
screenshot attached to a user message renders no `<img>` inside
`[data-message-author-role]`, and a generated image arrives as a turn that has
no role node whatsoever — a chat with 8 `conversation-turn` containers exposed
only 5 role nodes, with every 1254px image outside all of them. How much of
that has mounted varies run to run, which is why `navigateAndWaitForMessages`
waits for the turn count to stop growing rather than for the first turn, and
why the panel — which does not depend on rendering at all — is the source of
record for images. Panel images are appended as their own `image` entries;
only an `<img>` genuinely inside a message keeps a positioned marker.
The panel path therefore classifies each attachment by the **blob's own MIME
type**, not its filename (an uploaded image's signed content URL carries no
`fn=` param to judge), and an `image/*` body never goes down the text path,
where it would decode to mojibake. The same upload can appear both ways; the
panel copy is dropped when a message-turn `<img>` already carries the same
`file_<hash>` asset id.

The marker vocabulary (ids, `[id]`, `![id](path)`, the `/`-separated path)
lives in `src/commands/read_attachments.js` and is shared by the in-page
scrape, the panel resolver, and the download pass.

## Primary path: the "Files in chat" panel

Every file attached to or produced in a chat — including each Deep Research
report — is also listed in ChatGPT's **"Files in chat"** panel, reached via the
conversation's **"More" menu → "View files in chat"** (there is no standalone
header button for it). Crucially, that menu, panel, and the fullscreen artifact
viewer it opens are **all normal top-frame `chatgpt.com` DOM** — not the
sandboxed iframe — so this path sidesteps the cross-origin wall entirely instead
of trying to reach across it.

**Every read hard-reloads the chat first.** `openChat` in `src/commands/read.js`
calls `navigateAndWaitForMessages(page, url)`, which navigates to
`https://chatgpt.com/` and *then* to the target URL before polling for message
nodes — never a single `page.goto(url)`. This is load-bearing, not defensive
boilerplate: `page.goto` on a URL the tab is already sitting on is a documented
no-op (no reload), and a stale already-open tab was confirmed live to leave the
"More" button and Files-in-chat panel intermittently missing from the DOM. An
earlier hover-based theory for that flakiness (`:hover`-gated button, needs a
real mouse move) was tested live and refuted — the button is present
immediately after a hard reload with zero hover. Do not remove the root-URL hop
to "simplify" this: a live A/B run against the same chat showed the panel missing
without the hop and present with it.

That applies to the **no-argument** `read` too, which reads whatever chat the
tab already shows. It used to skip the reload entirely — and confirmed live on a
chat holding one Deep Research report, `read <url>` returned the report while a
bare `read` against the same, already-open chat returned only the user message,
no report and no warning. `openChat` now derives the target from the tab's own
`window.location.href` through `chatUrlFromLocation` (a chatgpt.com host + a
`/c/` path, returning `null` for anything else) and feeds it to the same
`navigateAndWaitForMessages`. `normalizeChatUrl` must not be reused for that
test: it normalizes *user input*, so it turns a prefix-less string like
`about:blank` into `https://chatgpt.com/c/about:blank` and throws on a foreign
host.

Implementation: `resolveReportFiles` in `src/commands/read_files_panel.js`,
called from `runRead` (`read.js`) after the top-frame scrape. Per file entry,
repeated once per file
(opening the viewer for one file removes the panel from the DOM, so the menu
must be reopened fresh for the next one — confirmed live; the "More" button
itself stays functional throughout):

1. Open "More" — `header button[aria-label="More"]`, formerly
   `[data-testid="conversation-options-button"]` — then pick the menu item whose
   text is exactly `View files in chat` (no stable selector exists for it —
   matched by trimmed `textContent`, the most brittle part of this path). The
   redesigned button is a Radix menu trigger: it opens on `pointerdown` and
   ignores a synthetic `click()`. Opening and picking are one poll, because the
   button can be in the DOM before its handler is attached — the opener is
   re-fired for as long as no `[role="menu"]` shows. Then poll for
   `[aria-label="Files in chat"] li button` entries until the count repeats:
   the list streams in (confirmed live: 2 entries, then 7). Each entry button's
   `aria-label` is the file name; the poll returns those labels.
   **An entry whose outcome is already known is skipped** — every click costs a
   menu reopen, the click and a network poll (~5-9 s). Skipped are: an entry
   whose label is the `name` of an attachment the transcript already holds; any
   entry with an image extension once the conversation JSON has positioned the
   images (a generated image has no name to match — 35 of them cost a 5 minute
   read before this rule); and an entry whose label was already handled earlier
   in the same walk. The match is by name because an entry exposes nothing
   else — no id, no thumbnail (confirmed live). So a second, different upload
   reusing a file name is skipped too, and so is an image that exists only as a
   download link. On the DOM fallback nothing is known, so nothing is skipped.
   A report the JSON already delivered but the panel lists under another label
   is clicked once and then dropped, recognized by its identical body.
2. `startNetworkCapture('')`, click file entry `i`, poll `readNetworkCapture()`
   for a request whose `url` contains `/backend-api/files/download/` — this is
   the only way to learn the file's real `file_<id>` and the bearer token
   (`requestHeaders.authorization`), neither of which are exposed anywhere in
   the panel's DOM. **`readNetworkCapture()` only exposes request metadata,
   never response bodies** — confirmed live — so the content itself is fetched
   explicitly rather than read off the capture.
3. Two-hop in-page fetch (`page.evaluate(fetch(...))`, same bearer header on
   both hops): the captured download URL returns `{ download_url, ... }` (a
   signed redirect, no report content yet); fetching that `download_url` (an
   `/backend-api/estuary/content?...&sig=...` URL) returns the actual report
   file JSON: `{ title, widget_state: { report_message: { content: { parts:
   [markdown] } } } }`.
4. `normalizeAttachedFileContent` (boundary normalizer) decides the shape from
   the raw hop-2 body:
   - JSON that parses AND matches a report's shape (`normalizeReportFileJson`
     extracts `title` + `parts[0]`) → `{ role: 'report', text, title }`.
   - JSON that parses but does **not** match the report shape (a plain
     uploaded file with metadata-only JSON, or a malformed/failed fetch)
     degrades to `null` — no entry. This is intentional, existing behavior,
     unchanged by the plain-text case below.
   - Text that does **not** parse as JSON at all — confirmed live for a
     code-interpreter/canvas-generated file (e.g. a `.md` ChatGPT creates and
     offers as a download): the hop-2 response is raw `text/markdown`, not
     JSON. Promoted to `{ role: 'file', text: rawText.trim(), title }`, where
     `title` is read off the `fn=` query param on the signed content URL, or —
     when that param is absent, as confirmed live for a generated `.ps1` — off
     the last segment of the download endpoint's own `file_name`
     (`/mnt/data/backup-prosody.ps1`).
   Either entry shape is appended to the message list (not interleaved by
   conversation position — see "Known-brittle bits").
   A file the panel lists twice fires no second download request (the page
   has it cached); clicking the repeat would time out after the poll budget,
   about 10 s — which is why a repeated label is skipped in step 1.
5. `button[aria-label="Close viewer"]` (formerly `"Close fullscreen view"`) is clicked before moving to the
   next file (or returning). This drives the **user's real, already-open**
   Chrome tab — leaving it stuck in the fullscreen artifact viewer after a
   `read` call is a visible side effect the user did not ask for. When every
   entry was skipped no viewer ever replaced the panel, so the panel itself is
   closed through `aside button[aria-label="Close panel"]` (confirmed live; it
   ignores Escape).

## Cross-origin iframe path (inert — kept as cover, not deleted)

An earlier attempt tried to read the report directly out of its rendering
iframe. It is proven **non-functional** against this project's browser bridge
and is retained only as a no-op fallback (explicit decision: not worth the risk
of deleting working-adjacent code for a bridge behavior that could change
upstream).

1. **Top frame** (`READ_SCRAPE_SCRIPT` in `read_scrape.js`): selector
   `[data-message-author-role], [class*="_reportPage_"], iframe[title="internal://deep-research"]`.
   - A `_reportPage_...` container (an even older inline rendering — kept as a
     second fallback) only becomes a `report` entry if it is **not** inside a
     message node and is the **outermost** such container.
   - A matching `iframe` becomes an **ordered placeholder**:
     `{ role: 'report', text: '', title: '', reportFrameSrc: iframe.src }`.
2. **Frame resolution** (`resolveReportFrames` in `read.js`): matches each
   placeholder's `reportFrameSrc` against `page.frames()`. Against the real
   bridge, `page.frames()` always returns `[]` for cross-origin iframes (a CDP
   limitation of this bridge's tab-scoped attach model), so
   this never resolves; the placeholder stays empty and drops out via the
   final `.filter(message => message.text)`.

Output shape from the cross-origin iframe path: `{ role: 'report', title, text }`.
The Files-in-chat panel path can additionally emit `{ role: 'file', title, text }`
for a plain generated file — see step 4 above.

## DOM -> markdown mapping

| Tag(s) | Markdown |
|---|---|
| `h1`-`h6` | `#`..`######` heading |
| `p` | paragraph + blank line |
| `strong`, `b` | `**bold**` |
| `em`, `i` | `*italic*` |
| `br` | newline |
| `img` (content image) | `[image-NN]` marker on its own line; UI chrome is dropped |
| `ul`/`ol` > `li` | `- item` / `1. item` |
| `table` | GitHub markdown table (header row, `---` separator, body rows) |
| `pre` (plain) | fenced code block |
| `pre` containing a rendered mermaid `<svg>` | ` ```mermaid ` fence with a placeholder (see below) |

Any other tag is unwrapped (its children are serialized, the tag itself
produces no markup) — this is why the scoped tag set above is enough: unknown
tags degrade to plain text instead of erroring.

## Deliberate lossy choices

- **Citation markers dropped.** `sup[data-citation-index]` and any
  `[data-citation-interactive]` node are skipped entirely, so `[1]`/`[2]`
  footnote markers don't pollute the markdown text.
- **Mermaid diagrams are not reconstructed.** ChatGPT renders mermaid to an
  `<svg>`; the original mermaid *source* is not in the DOM. A rendered `pre`
  becomes a ` ```mermaid ` fence containing `%% diagram rendered in ChatGPT`
  instead of a real diagram. Reconstructing a diagram from SVG node/edge labels
  is out of scope.

## Safety: do not loop live automation against a real chat

Running the compiled exe (or any script driving `resolveReportFiles`) in a
tight back-to-back loop against the same live chat caused the chat to become
**Archived** during testing — a real, visible side effect the user had to
manually undo. Root cause not confirmed, but the "More" dropdown's items are
`View files in chat` / `Unpin chat` / `Archive` / `Delete`; a stray click
plausibly landed on the wrong occurrence of that menu during overlapping runs.
Space out live-test runs against a real chat; don't loop them back-to-back.

## Known gap: conversation-scoped download endpoint can 403 for a file the
## conversation itself can otherwise see

Confirmed live on one chat with two Deep Research reports: `resolveReportFiles`
returned only one of the two. The missing file's
`/backend-api/files/download/file_<id>` request reliably returns **403
Forbidden** — reproduced 3 ways (with/without `check_context_scopes_for_conversation_id`,
with/without `gizmo_id`), not a transient glitch, and the *same* 403 happens
when a human clicks that exact file in the Files-in-chat panel.

The file is not actually inaccessible: opening it from ChatGPT's separate
**Library** view (`chatgpt.com/library`) renders it fine, through a completely
different endpoint (`libfile_<id>`, not `file_<id>`) authenticated via
`fetch('/api/auth/session', {credentials:'include'}).accessToken` rather than a
network-capture-derived bearer. Each Library node's `origination_thread_id`
matches the owning chat's conversation id exactly, so — in principle — a
chat's reports could be found via `GET /backend-api/files/library/nodes`
filtered on `origination_thread_id` + `library_artifact_type ===
"deep_research_report"`, no "Files in chat" panel or "More" menu involved at
all.

Not implemented: the Library-side content endpoint that does work
(`POST /backend-api/files/library/files/libfile_<id>/deep-research/tools/get_state`)
returns the raw research **transcript** (`meta.deep_research_widget_messages`),
not the single clean markdown string this codebase's `normalizeReportFileJson`
expects — no message fragment exceeds ~2000 chars, so the polished report text
is assembled by ChatGPT's own frontend from many pieces, not present
pre-built anywhere in that payload. A `libfile_id` variant of the simple
two-hop `files/download` flow (`.../libfile_.../download`, `/content`, bare)
was tried and 404/405/404s — no shortcut there either.

**Probably closed by the JSON path, unverified**: a report's body now comes out
of the conversation JSON without touching `files/download` at all, so the 403
should no longer matter — but the chat that showed it has not been re-read.

**Untried, and the fallback if that turns out wrong**: the
inline report card's own Export → Export to Markdown flow (proven end-to-end
for a *different* file, real download to disk) against a file that 403s via
the conversation-scoped endpoint.

## Known-brittle bits

- **"View files in chat" menu item has no stable selector.** No
  `data-testid`, no `aria-label` — matched by exact `textContent`. If ChatGPT
  ever localizes or renames this menu item, `openFilesInChatPanel` in
  `src/commands/read_files_panel.js` returns no entries (silently no report), the same failure mode
  as the old iframe path had before this feature existed. Re-inspect the
  "More" menu's live markup first if reports silently vanish again.
- **Panel-found entries are appended, not interleaved.** Reports and files
  taken from the conversation JSON sit at their position in the chat. Whatever
  only `resolveReportFiles` finds (the DOM fallback, or a file the JSON path
  could not resolve) is still appended to the end of the message list in
  files-panel order.
- **Sandbox links.** A generated file is recognized by a `sandbox:/mnt/data/…`
  link in the reply text. A file ChatGPT creates without linking it that way is
  left to the panel. How long a sandbox path keeps resolving is unknown; a
  3-day-old one did.
- **Backend-api coupling.** The `/api/auth/session` and
  `/backend-api/conversation/<id>` endpoints and the `mapping` / `current_node`
  shape behind the message source, the `/backend-api/files/download/` and
  `/backend-api/estuary/content` endpoints, the `download_url` redirect shape,
  and the `widget_state.report_message.content.parts[0]` report shape are all
  OpenAI-private, undocumented, and can change without notice — this whole
  path is more coupled to ChatGPT's internals than the DOM-scrape paths below.
- **Iframe title string.** The report iframe is matched by
  `title="internal://deep-research"` — an internal ChatGPT identifier that can
  change without notice. If detection silently stops working again, re-inspect
  a live report iframe's attributes first (title, `src` host) before assuming
  the markup changed underneath the serializer.
- **Chrome-vs-body disambiguation by heading.** Multiple sibling iframes share
  the same `title`; the real report body is picked out only by "did
  `REPORT_FRAME_SCRIPT` find a heading" (see Detection above). A report that
  legitimately has no heading would be misdetected as chrome and dropped —
  hasn't been observed, but is the ceiling of this heuristic.
- **`reportFrameSrc` host-matching fallback.** `findReportFrame` in
  `src/commands/read.js` matches placeholder to `page.frames()` entry by exact
  URL first, then by host only. If a chat ever renders more than one distinct
  report on the same host, host-matching could pick the wrong frame; exact-URL
  matching is expected to cover the normal case.
- **CSS-module hash suffix (legacy path).** The old inline report container's
  class looked like `_reportPage_16ou1_1` — the hash suffix is
  build-generated by ChatGPT. That path is kept as a fallback only; match by
  prefix (`[class*="_reportPage_"]`), never the exact class string, if it's
  ever exercised again.
- **New tags.** If a future report uses a tag not in the mapping table above
  (e.g. `blockquote`, `img`, `hr`), it currently falls through to "unwrap
  children" — text survives, structure doesn't. Add a case to `serializeNode`
  in `src/commands/read_scrape.js` (inside `SERIALIZE_HELPERS`, shared by both
  scripts) and a row to the table above when that happens; don't widen
  speculatively.
