/**
 * worker/pdf-minimal.js
 *
 * Minimal PDF generator — handcrafted so the Worker doesn't need to
 * bundle React-PDF / pdf-lib / pdfkit (all of which either require
 * nodejs_compat or pull in substantial dependency trees).
 *
 * Scope is deliberately tiny:
 *   - Letter page (612 × 792 points)
 *   - The 14 standard PDF fonts — Helvetica + Helvetica-Bold — so we
 *     do NOT need to embed font programs (page 416 of the PDF 1.7 spec).
 *   - Text drawing at any (x, y), with word-wrap.
 *   - Thin rules + filled rectangles.
 *   - Multi-page paging with an auto-advance when the cursor hits the
 *     bottom margin.
 *
 * Returns a Uint8Array — the caller is responsible for persisting (we
 * push it to R2 via env.MANELINE_R2.put).
 *
 * TECH_DEBT(phase-2): swap to @react-pdf/renderer once we want photo
 * grids, vector illustrations, or tables with cell borders. This file
 * is intentionally kept small so that swap is cheap.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54; // ~0.75in

export class PdfDoc {
  constructor() {
    this.objects = []; // index 0 is unused — PDF objects are 1-indexed
    this.pages = [];
    this.fontRegular = this.#addObject({ Type: '/Font', Subtype: '/Type1', BaseFont: '/Helvetica', Encoding: '/WinAnsiEncoding' });
    this.fontBold    = this.#addObject({ Type: '/Font', Subtype: '/Type1', BaseFont: '/Helvetica-Bold', Encoding: '/WinAnsiEncoding' });
    this.cursor = { y: PAGE_H - MARGIN, page: null, content: '' };
    this.newPage();
  }

  newPage() {
    this.#flushPage();
    const contentId = this.#allocObject();
    this.pages.push({ contentId });
    this.cursor = { y: PAGE_H - MARGIN, page: this.pages.length - 1, content: '' };
  }

  /**
   * Write a line of text at the current cursor. Advances `y` by size*lineHeight.
   */
  text(str, { size = 11, bold = false, lineHeight = 1.25, color = null } = {}) {
    const needed = size * lineHeight + 6;
    if (this.cursor.y - needed < MARGIN) this.newPage();
    const font = bold ? 'F2' : 'F1';
    const x = MARGIN;
    const y = this.cursor.y - size; // baseline
    const colorOp = color ? `${color[0]} ${color[1]} ${color[2]} rg\n` : '';
    const resetOp = color ? '0 0 0 rg\n' : '';
    this.cursor.content += `q\n${colorOp}BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfString(str)}) Tj ET\n${resetOp}Q\n`;
    this.cursor.y -= size * lineHeight;
  }

  /**
   * Word-wrap `str` to roughly `maxWidth` points using 6pt as an average
   * glyph width for Helvetica (conservative; prevents runoff at MARGIN).
   * Good enough for record notes; full text-width metrics would pull in
   * the entire AFM table.
   */
  textWrapped(str, { size = 11, bold = false, indent = 0 } = {}) {
    const avgGlyph = size * 0.52;
    const maxCharsPerLine = Math.floor((PAGE_W - 2 * MARGIN - indent) / avgGlyph);
    const words = String(str).split(/\s+/);
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > maxCharsPerLine) {
        this.#textIndented(line.trim(), { size, bold, indent });
        line = w;
      } else {
        line = (line + ' ' + w).trim();
      }
    }
    if (line) this.#textIndented(line, { size, bold, indent });
  }

  /** Horizontal rule at current cursor. */
  rule({ color = [0.85, 0.85, 0.85] } = {}) {
    if (this.cursor.y - 10 < MARGIN) this.newPage();
    const y = this.cursor.y - 2;
    this.cursor.content += `q ${color[0]} ${color[1]} ${color[2]} RG 0.5 w ${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S Q\n`;
    this.cursor.y -= 10;
  }

  /** Vertical space. */
  space(pts) {
    if (this.cursor.y - pts < MARGIN) this.newPage();
    else this.cursor.y -= pts;
  }

  /** Serialize to a Uint8Array. */
  build() {
    this.#flushPage();

    // Build Pages tree.
    const pagesId = this.#allocObject();
    const pageIds = this.pages.map((p) => {
      const id = this.#addObject({
        Type: '/Page',
        Parent: `${pagesId} 0 R`,
        MediaBox: `[0 0 ${PAGE_W} ${PAGE_H}]`,
        Resources: `<< /Font << /F1 ${this.fontRegular} 0 R /F2 ${this.fontBold} 0 R >> >>`,
        Contents: `${p.contentId} 0 R`,
      });
      return id;
    });
    this.objects[pagesId] = {
      __raw: `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    };
    const catalogId = this.#addObject({ Type: '/Catalog', Pages: `${pagesId} 0 R` });

    // Assemble the file body.
    let body = '%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n';
    const offsets = new Array(this.objects.length).fill(0);
    const enc = new TextEncoder();
    const chunks = [enc.encode(body)];
    let pos = chunks[0].length;

    for (let i = 1; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (!obj) continue;
      offsets[i] = pos;
      let rendered;
      if (obj.__streamBytes) {
        const header = enc.encode(`${i} 0 obj\n<< /Length ${obj.__streamBytes.length} >>\nstream\n`);
        const footer = enc.encode(`\nendstream\nendobj\n`);
        chunks.push(header, obj.__streamBytes, footer);
        pos += header.length + obj.__streamBytes.length + footer.length;
        continue;
      }
      if (obj.__raw) {
        rendered = `${i} 0 obj\n${obj.__raw}\nendobj\n`;
      } else {
        const entries = Object.entries(obj).map(([k, v]) => `/${k} ${v}`).join(' ');
        rendered = `${i} 0 obj\n<< ${entries} >>\nendobj\n`;
      }
      const bytes = enc.encode(rendered);
      chunks.push(bytes);
      pos += bytes.length;
    }

    const xrefStart = pos;
    const xrefCount = this.objects.length;
    let xref = `xref\n0 ${xrefCount}\n0000000000 65535 f \n`;
    for (let i = 1; i < xrefCount; i++) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${xrefCount} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    chunks.push(enc.encode(xref));

    // Concat chunks into one Uint8Array.
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  /* --------- internals --------- */

  #allocObject() {
    this.objects.push(null);
    return this.objects.length - 1;
  }

  #addObject(dict) {
    const id = this.#allocObject();
    this.objects[id] = dict;
    return id;
  }

  #flushPage() {
    if (this.cursor.page == null) return;
    const page = this.pages[this.cursor.page];
    const stream = this.cursor.content;
    this.objects[page.contentId] = { __streamBytes: new TextEncoder().encode(stream) };
  }

  #textIndented(str, { size, bold, indent }) {
    const needed = size * 1.25 + 2;
    if (this.cursor.y - needed < MARGIN) this.newPage();
    const font = bold ? 'F2' : 'F1';
    const x = MARGIN + indent;
    const y = this.cursor.y - size;
    this.cursor.content += `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfString(str)}) Tj ET\n`;
    this.cursor.y -= size * 1.25;
  }
}

function escapePdfString(s) {
  // PDF string literals need \ -> \\, ( -> \(, ) -> \). Non-ASCII is
  // written as-is; Helvetica's WinAnsiEncoding covers the common Latin-1
  // range well enough for vet record content.
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
