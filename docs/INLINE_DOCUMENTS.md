# Inline documents (Deep Research reports & generated files)

`chatgptcli read` scrapes the DOM of a chatgpt.com tab. Normally every turn is a
`[data-message-author-role]` node and its `innerText` is the whole message. Two
kinds of attachment break that assumption and need special handling:

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
to "simplify" this; see `PLAN.md` session 4 for the live A/B evidence.

Implementation: `resolveReportFiles` in `src/commands/read_files_panel.js`,
called from `runRead` (`read.js`) after the top-frame scrape. Per file entry,
repeated once per file
(opening the viewer for one file removes the panel from the DOM, so the menu
must be reopened fresh for the next one — confirmed live; the "More" button
itself stays functional throughout):

1. Click `[data-testid="conversation-options-button"]` ("More"), then the menu
   item whose text is exactly `View files in chat` (no stable selector exists
   for it — matched by trimmed `textContent`, the most brittle part of this
   path). Poll for `section[aria-label="Files in chat"] li button` entries.
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
     `title` is read off the `fn=` query param on the signed content URL (the
     only place the filename survives — it is not in the panel's DOM).
   Either entry shape is appended to the message list (not interleaved by
   conversation position — see "Known-brittle bits").
5. `button[aria-label="Close fullscreen view"]` is clicked before moving to the
   next file (or returning). This drives the **user's real, already-open**
   Chrome tab — leaving it stuck in the fullscreen artifact viewer after a
   `read` call is a visible side effect the user did not ask for.

## Cross-origin iframe path (inert — kept as cover, not deleted)

An earlier attempt tried to read the report directly out of its rendering
iframe. It is proven **non-functional** against this project's browser bridge
and is retained only as a no-op fallback (explicit decision: not worth the risk
of deleting working-adjacent code for a bridge behavior that could change
upstream) — see `PLAN.md` for the full investigation.

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
   limitation of this bridge's tab-scoped attach model — see `PLAN.md`), so
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

**Untried, and the recommended next step if this gap needs closing**: the
inline report card's own Export → Export to Markdown flow (see "Session 2" in
`PLAN.md` — proven end-to-end for a *different* file, real download to disk)
against a file that 403s via the conversation-scoped endpoint. Full detail and
the corrected write-up: `PLAN.md` session 4.

## Known-brittle bits

- **"View files in chat" menu item has no stable selector.** No
  `data-testid`, no `aria-label` — matched by exact `textContent`. If ChatGPT
  ever localizes or renames this menu item, `openFilesInChatPanel` in
  `src/commands/read.js` returns 0 (silently no report), the same failure mode
  as the old iframe path had before this feature existed. Re-inspect the
  "More" menu's live markup first if reports silently vanish again.
- **Report entries are appended, not interleaved.** `resolveReportFiles`
  discovers reports independently of the top-frame scrape's DOM order (the
  iframe placeholders it could otherwise position against are inert — see
  above) and appends them to the end of the message list in files-panel order.
  In a chat with multiple reports interspersed with other turns, output order
  will not exactly match conversation order.
- **Backend-api coupling.** The `/backend-api/files/download/` and
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
