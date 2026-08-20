// In-page script evaluated via the Browser Bridge (page.evaluate) to scrape a
// chatgpt.com chat. Exported as a string, not a function: it runs as JS source
// inside the browser tab, not in this Node process.
//
// ponytail: the DOM->markdown mapping below covers the tag set ChatGPT
// currently emits in Deep Research reports (headings, paragraphs, lists,
// tables, mermaid pre-blocks). Widen only when a new tag shows up in a real
// report — see docs/INLINE_DOCUMENTS.md for the full contract.
export const READ_SCRAPE_SCRIPT = `(() => {
  const MESSAGE_ATTR = 'data-message-author-role';
  const REPORT_CLASS_PART = '_reportPage_';
  const NL = String.fromCharCode(10);
  const FENCE = String.fromCharCode(96, 96, 96);

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
    const heading = node.querySelector('h1, h2, h3, h4, h5, h6');
    const title = heading ? textOf(heading).trim() : '';
    const markdown = serializeChildren(node).replace(/\\n{3,}/g, NL + NL).trim();
    return { title, markdown };
  }

  const nodes = Array.from(document.querySelectorAll(
    '[' + MESSAGE_ATTR + '], [class*="' + REPORT_CLASS_PART + '"]'
  ));

  const entries = nodes.map((node) => {
    if (node.hasAttribute(MESSAGE_ATTR)) {
      return { role: node.getAttribute(MESSAGE_ATTR), text: textOf(node).trim(), title: '' };
    }
    if (node.closest('[' + MESSAGE_ATTR + ']')) return null;
    if (node.parentElement && node.parentElement.closest('[class*="' + REPORT_CLASS_PART + '"]')) return null;
    const report = serializeReport(node);
    return report.markdown ? { role: 'report', text: report.markdown, title: report.title } : null;
  }).filter((entry) => entry && entry.text);

  return { url: location.href, messages: entries };
})()`;
