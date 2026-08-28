// In-page scripts evaluated via the Browser Bridge (page.evaluate /
// page.evaluateInFrame) to scrape a chatgpt.com chat. Exported as strings,
// not functions: they run as JS source inside the browser tab (or inside a
// cross-origin iframe), not in this Node process.
//
// ponytail: the DOM->markdown mapping below covers the tag set ChatGPT
// currently emits in Deep Research reports (headings, paragraphs, lists,
// tables, mermaid pre-blocks). Widen only when a new tag shows up in a real
// report — see docs/INLINE_DOCUMENTS_AND_IMAGES.md for the full contract.
//
// Shared serializer functions, embedded (string concat, not import) into
// both READ_SCRAPE_SCRIPT and REPORT_FRAME_SCRIPT below — each script is a
// standalone source string evaluated in a different page/frame context, so
// there is no module system to share them through.
const SERIALIZE_HELPERS = `
  const NL = String.fromCharCode(10);
  const FENCE = String.fromCharCode(96, 96, 96);

  const collectedImages = [];

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  // ChatGPT renders citation favicons and tool glyphs as <img> too, and a
  // decorative or offscreen one often has not loaded at all (naturalWidth 0).
  // Requiring real, loaded pixels is what keeps phantom markers out of the
  // transcript — an id that appears only on the runs where some chrome image
  // happened to be in the DOM would make --file-id unusable.
  function isContentImage(img) {
    return img.naturalWidth >= 64 && img.naturalHeight >= 64;
  }

  function nameOfImage(img) {
    if (img.alt) return img.alt;
    try {
      return new URL(img.currentSrc || img.src, location.href).pathname.split('/').pop() || '';
    } catch {
      return '';
    }
  }

  // ChatGPT renders the same generated image two or three times (thumbnail,
  // lightbox preload). They share the asset id in the URL, which is the only
  // stable part of it, so the first occurrence wins and the rest get no marker.
  const seenAssets = new Set();

  function assetKeyOf(url) {
    const match = String(url || '').match(/file[-_][A-Za-z0-9]+/);
    return match ? match[0] : '';
  }

  function registerImage(img) {
    const src = img.currentSrc || img.src || '';
    const key = assetKeyOf(src);
    if (key && seenAssets.has(key)) return '';
    if (key) seenAssets.add(key);
    const id = 'image-' + pad(IMAGE_ID_OFFSET + collectedImages.length + 1);
    collectedImages.push({ id, kind: 'image', src, name: nameOfImage(img) });
    return id;
  }

  function markerFor(id) {
    return '[' + id + ']';
  }

  function textOf(node) {
    return node instanceof HTMLElement ? node.innerText : (node.textContent || '');
  }

  function serializeChildren(node) {
    return Array.from(node.childNodes).map(serializeNode).join('');
  }

  function serializeTable(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const cellsOf = (row) => Array.from(row.children).map((cell) =>
      serializeChildren(cell).trim().replace(/\\s*\\n+\\s*/g, ' '));
    const header = cellsOf(rows[0]);
    const separator = header.map(() => '---');
    const bodyRows = rows.slice(1).map(cellsOf);
    const toLine = (cells) => '| ' + cells.join(' | ') + ' |';
    return [toLine(header), toLine(separator)].concat(bodyRows.map(toLine)).join(NL);
  }

  function serializeNode(node) {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();

    if (tag === 'sup' && (node.hasAttribute('data-citation-index') || node.hasAttribute('data-citation-interactive'))) {
      return '';
    }
    if (tag === 'img') {
      return isContentImage(node) ? NL + markerFor(registerImage(node)) + NL : '';
    }
    if (tag === 'br') return NL;
    if (/^h[1-6]$/.test(tag)) {
      return '#'.repeat(Number(tag[1])) + ' ' + serializeChildren(node).trim() + NL + NL;
    }
    if (tag === 'p') {
      return serializeChildren(node).trim() + NL + NL;
    }
    if (tag === 'strong' || tag === 'b') {
      return '**' + serializeChildren(node) + '**';
    }
    if (tag === 'em' || tag === 'i') {
      return '*' + serializeChildren(node) + '*';
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === 'li');
      const lines = items.map((li, idx) =>
        (tag === 'ol' ? (idx + 1) + '.' : '-') + ' ' + serializeChildren(li).trim());
      return lines.join(NL) + NL + NL;
    }
    if (tag === 'table') {
      return serializeTable(node) + NL + NL;
    }
    if (tag === 'pre') {
      if (node.querySelector('svg')) {
        return FENCE + 'mermaid' + NL + '%% diagram rendered in ChatGPT' + NL + FENCE + NL + NL;
      }
      return FENCE + NL + (node.textContent || '').trim() + NL + FENCE + NL + NL;
    }
    return serializeChildren(node);
  }

  function serializeReport(node) {
    const start = collectedImages.length;
    const heading = node.querySelector('h1, h2, h3, h4, h5, h6');
    const title = heading ? textOf(heading).trim() : '';
    const markdown = serializeChildren(node).replace(/\\n{3,}/g, NL + NL).trim();
    return { title, markdown, attachments: collectedImages.slice(start) };
  }

  // A message turn keeps its innerText rendering — switching it to the
  // markdown serializer would rewrite every existing transcript — so the
  // marker is injected into the live DOM, read back through innerText (which
  // is what places it correctly among the surrounding lines), then removed.
  function textWithImageMarkers(node) {
    const markers = [];
    for (const img of Array.from(node.querySelectorAll('img'))) {
      if (!isContentImage(img)) continue;
      const id = registerImage(img);
      if (!id) continue;
      const span = document.createElement('span');
      span.textContent = NL + markerFor(id) + NL;
      img.parentNode.insertBefore(span, img);
      markers.push(span);
    }
    const text = textOf(node);
    markers.forEach((span) => span.remove());
    return text;
  }

  // A generated image is rendered inside the conversation turn but OUTSIDE the
  // [data-message-author-role] node whose innerText is the message — an
  // image-only reply has no role node at all. Reading the whole turn's
  // innerText instead would drag the turn's action-bar chrome ("Copy",
  // "Regenerate") into every transcript, so those images are appended as
  // markers after the message text rather than placed inside it.
  function markersOutsideRole(turn, roleNode) {
    return Array.from(turn.querySelectorAll('img'))
      .filter((img) => isContentImage(img) && !(roleNode && roleNode.contains(img)))
      .map((img) => registerImage(img))
      .filter(Boolean)
      .map(markerFor);
  }
`;

// Top-frame scrape: walks message turns plus any legacy inline
// `_reportPage_` report container. Deep Research reports now render inside a
// cross-origin sandboxed iframe (title="internal://deep-research") instead —
// the top frame cannot read across that boundary (page.evaluate runs here,
// not in the iframe's own context), so a report iframe is emitted as an
// ordered placeholder ({ reportFrameSrc, text: '' }) for read.js to resolve
// via page.frames() + page.evaluateInFrame(). See docs/INLINE_DOCUMENTS_AND_IMAGES.md.
// Every in-page script opens the same way: the image-id offset for this
// context (each context numbers its own images) followed by the shared
// serializer helpers.
function inPageScript(imageIdOffset, body) {
  return `(() => {
  const IMAGE_ID_OFFSET = ${Number(imageIdOffset) || 0};
${SERIALIZE_HELPERS}
${body}
})()`;
}

export function readScrapeScript(imageIdOffset) {
  return inPageScript(imageIdOffset, `
  const MESSAGE_ATTR = 'data-message-author-role';
  const TURN_SELECTOR = '[data-testid^="conversation-turn"]';
  const REPORT_CLASS_PART = '_reportPage_';
  const REPORT_FRAME_TITLE = 'internal://deep-research';

  // The turn container, not the role node, is the unit: an image-only
  // assistant reply has no [data-message-author-role] child at all, so
  // iterating role nodes drops those turns entirely (confirmed live: a chat
  // with 8 turns exposed only 5 role nodes). Older DOMs without the turn
  // testid fall back to the role nodes themselves.
  const turns = Array.from(document.querySelectorAll(TURN_SELECTOR));
  const messageNodes = turns.length ? turns : Array.from(document.querySelectorAll('[' + MESSAGE_ATTR + ']'));
  const nodes = Array.from(document.querySelectorAll(
    TURN_SELECTOR + ', [' + MESSAGE_ATTR + '], [class*="' + REPORT_CLASS_PART + '"], iframe[title="' + REPORT_FRAME_TITLE + '"]'
  )).filter((node) => messageNodes.includes(node) || !node.hasAttribute(MESSAGE_ATTR));

  const entries = nodes.map((node) => {
    if (messageNodes.includes(node)) {
      const roleNode = node.hasAttribute(MESSAGE_ATTR) ? node : node.querySelector('[' + MESSAGE_ATTR + ']');
      const start = collectedImages.length;
      const text = roleNode ? textWithImageMarkers(roleNode).trim() : '';
      const trailing = markersOutsideRole(node, roleNode);
      return {
        role: roleNode ? roleNode.getAttribute(MESSAGE_ATTR) : 'assistant',
        text: [text].concat(trailing).filter(Boolean).join(NL + NL),
        title: '',
        attachments: collectedImages.slice(start)
      };
    }
    if (node.tagName === 'IFRAME') {
      return { role: 'report', text: '', title: '', reportFrameSrc: node.src || '' };
    }
    if (node.closest('[' + MESSAGE_ATTR + ']')) return null;
    if (node.parentElement && node.parentElement.closest('[class*="' + REPORT_CLASS_PART + '"]')) return null;
    const report = serializeReport(node);
    return report.markdown
      ? { role: 'report', text: report.markdown, title: report.title, attachments: report.attachments }
      : null;
  }).filter((entry) => entry && (entry.text || entry.reportFrameSrc || (entry.attachments || []).length));

  return { url: location.href, messages: entries, imageCount: collectedImages.length };`);
}

// Evaluated inside the deep-research report iframe itself (via
// page.evaluateInFrame) to serialize the report body. The whole frame
// document IS the report, so the root is `main` if present, else `body`.
export function reportFrameScript(imageIdOffset) {
  return inPageScript(imageIdOffset, `
  const root = document.querySelector('main') || document.body;
  const report = serializeReport(root);
  return { title: report.title, text: report.markdown, attachments: report.attachments };`);
}
