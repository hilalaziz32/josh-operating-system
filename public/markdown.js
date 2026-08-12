// The report renderer.
//
// Reports arrive as Markdown from the model and are rendered into the page, so
// this escapes first and formats second — no upstream value can smuggle markup
// through. Deliberately small: it covers the shapes the playbook actually emits
// (headings, bullets, tables, emphasis, rules) and nothing more.

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

export function renderMarkdown(src) {
  const lines = String(src).split('\n');
  const out = [];
  let list = null;
  let table = null;

  const closeList = () => {
    if (list) {
      out.push(`<ul>${list.join('')}</ul>`);
      list = null;
    }
  };
  const closeTable = () => {
    if (table) {
      const [head, ...body] = table;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body
            .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
      );
      table = null;
    }
  };
  const closeAll = () => {
    closeList();
    closeTable();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (!line.trim()) {
      closeAll();
      continue;
    }

    // Table rows, with the |---|---| separator swallowed.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      closeList();
      (table ||= []).push(cells);
      continue;
    }
    closeTable();

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeAll();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    // Bullets, including the nested ones the sub-skills sometimes emit.
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      closeTable();
      const depth = bullet[1].length >= 2 ? ' class="sub"' : '';
      (list ||= []).push(`<li${depth}>${inline(bullet[2])}</li>`);
      continue;
    }
    closeList();

    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      out.push('<hr>');
      continue;
    }

    // A numbered item reads as a list item, not a paragraph starting with "1.".
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numbered) {
      out.push(`<p class="numbered">${inline(numbered[1])}</p>`);
      continue;
    }

    out.push(`<p>${inline(line)}</p>`);
  }

  closeAll();
  return out.join('');
}
