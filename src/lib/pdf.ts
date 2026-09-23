// Draw the certificates straight into a PDF, no dependencies. Mirrors the DOCX layout from certgen.ts
// (A4, 1in margins, 12pt/11pt Times, same 8-column grid). Uses the PDF standard Times fonts, so nothing is embedded.
// ponytail: WinAnsi (Latin-1) text only; non-Latin names print as "?". Embed a TTF if that's ever needed.
import { total, type Cert } from './certgen.ts';

/** Width in points of `text` in Times at `size` pt. */
export type Measure = (text: string, bold: boolean, size: number) => number;
export type Logo = { jpeg: Uint8Array; width: number; height: number };

const TW = 1 / 20; // twips -> points
const PAGE_W = 11907 * TW, PAGE_H = 16839 * TW, MARGIN = 72, TEXT_W = PAGE_W - 2 * MARGIN, BOTTOM = PAGE_H - MARGIN;
const GRID = [1169, 2159, 900, 900, 1258, 1892, 902, 1145].map(w => w * TW);
const TABLE_X = MARGIN - 5 * TW, PAD = 108 * TW; // tblInd -5, default cell margin 108
const LEAD = 1.24; // body text: Word "1.08 multiple" line spacing on Times New Roman
const AFTER = 8; // body text: default paragraph spacing after (160 twips)
const CELL_LEAD = 1.15; // table cells: "Table Grid" style = single spacing, no space after
const ASCENT = 0.891; // Times New Roman ascent, baseline = line top + ascent
const LOGO_W = 1047750 / 12700, LOGO_H = 504825 / 12700; // EMU -> points

const WINANSI: Record<string, number> = { '€': 128, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151 };
const pdfStr = (s: string) => '(' + [...s].map(ch => {
  const c = ch.codePointAt(0)!;
  const b = c < 128 || (c >= 160 && c < 256) ? c : WINANSI[ch] ?? 63;
  return b === 40 || b === 41 || b === 92 ? '\\' + ch : String.fromCharCode(b);
}).join('') + ')';
const n = (v: number) => (Math.round(v * 100) / 100).toString();

export function buildPdf(certs: Cert[], measure: Measure, logo?: Logo): Uint8Array {
  const pages: string[][] = [];
  let ops: string[] = [], y = MARGIN;
  const newPage = () => { ops = []; pages.push(ops); y = MARGIN; };

  const text = (x: number, top: number, s: string, bold: boolean, size: number) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${n(x)} ${n(PAGE_H - top - size * ASCENT)} Td ${pdfStr(s)} Tj ET`);
  const line = (x1: number, y1: number, x2: number, y2: number) => ops.push(`${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S`);
  const rect = (x: number, top: number, w: number, h: number) => ops.push(`${n(x)} ${n(PAGE_H - top - h)} ${n(w)} ${n(h)} re S`);

  function wrap(s: string, width: number, bold: boolean, size: number): string[] {
    const lines: string[] = [];
    let cur = '';
    for (const word of s.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (measure(next, bold, size) <= width) { cur = next; continue; }
      if (cur) lines.push(cur);
      cur = word;
      while (measure(cur, bold, size) > width && cur.length > 1) { // break words longer than the cell
        let i = cur.length - 1;
        while (i > 1 && measure(cur.slice(0, i), bold, size) > width) i--;
        lines.push(cur.slice(0, i)); cur = cur.slice(i);
      }
    }
    return cur || !lines.length ? [...lines, cur] : lines;
  }

  type P = { text?: string; bold?: boolean; size?: number; center?: boolean; after?: number };
  function para({ text: s = '', bold = false, size = 12, center = false, after = AFTER }: P) {
    for (const l of wrap(s, TEXT_W, bold, size)) {
      if (l) text(center ? MARGIN + (TEXT_W - measure(l, bold, size)) / 2 : MARGIN, y, l, bold, size);
      y += size * LEAD;
    }
    y += after;
  }

  // table cell: list of paragraphs at 11pt, single spaced
  type Cell = { paras: string[]; bold?: boolean; span?: number; vcenter?: boolean };
  const cellLines = (c: Cell, w: number) => c.paras.map(p => wrap(p, w - 2 * PAD, !!c.bold, 11));
  const cellHeight = (ls: string[][]) => ls.reduce((a, l) => a + l.length * 11 * CELL_LEAD, 0);

  function drawRow(cells: Cell[], minH: number, merged = false) {
    let x = TABLE_X, col = 0;
    const laid = cells.map(c => {
      const w = GRID.slice(col, col + (c.span ?? 1)).reduce((a, b) => a + b, 0);
      const r = { c, x, w, lines: cellLines(c, w) };
      x += w; col += c.span ?? 1;
      return r;
    });
    const h = Math.max(minH, ...laid.map(l => cellHeight(l.lines)));
    if (y + h > BOTTOM) { closeSegment(); newPage(); }
    if (merged && !seg) { seg = { top: y, value: segValue }; segValue = ''; } // value only in the first segment
    for (const [i, { c, x, w, lines }] of laid.entries()) {
      if (merged && i === laid.length - 1) continue; // merged "Content Matching" column, drawn per page segment
      rect(x, y, w, h);
      let top = y + (c.vcenter ? (h - cellHeight(lines)) / 2 : 0);
      for (const l of lines.flat()) { if (l) text(x + PAD, top, l, !!c.bold, 11); top += 11 * CELL_LEAD; }
    }
    y += h;
  }

  // bulk content matching: one merged cell per page segment, value centered in the first segment
  let seg: { top: number; value: string } | null = null, segValue = '';
  const lastX = TABLE_X + GRID.slice(0, 7).reduce((a, b) => a + b, 0);
  function closeSegment() {
    if (!seg) return;
    rect(lastX, seg.top, GRID[7], y - seg.top);
    if (seg.value) text(lastX + PAD, seg.top + (y - seg.top - 11 * CELL_LEAD) / 2, seg.value, false, 11);
    seg = null;
  }

  for (const c of certs) {
    newPage();
    const bulk = c.matching_mode !== 'per_course';
    para({ bold: true });
    // logo floats over the next two empty paragraphs, like the anchored picture in the docx
    if (logo) ops.push(`q ${n(LOGO_W)} 0 0 ${n(LOGO_H)} ${n(MARGIN + (TEXT_W - LOGO_W) / 2)} ${n(PAGE_H - y - 0.75 - LOGO_H)} cm /Im1 Do Q`);
    para({});
    para({ bold: true, center: true });
    para({ text: 'Daffodil International University', bold: true, center: true, after: 0 });
    para({ text: 'Daffodil Smart City, Birulia, Savar, Dhaka-1216', center: true, after: 0 });
    para({ text: 'Phone-9138234-5, 9116774, Fax: 880-2-9124280', center: true, after: 0 });
    { // "Website: <link>" with the link in hyperlink blue + underline
      const a = 'Website: ', b = 'www.daffodilvarsity.edu.bd', wa = measure(a, false, 12), wb = measure(b, false, 12);
      const x = MARGIN + (TEXT_W - wa - wb) / 2;
      text(x, y, a, false, 12);
      ops.push('q 0.02 0.39 0.76 rg 0.02 0.39 0.76 RG 0.6 w'); // colour scoped to q..Q
      text(x + wa, y, b, false, 12);
      line(x + wa, y + 12 * 1.05, x + wa + wb, y + 12 * 1.05);
      ops.push('Q');
      y += 12 * LEAD;
    }
    para({ text: 'Certificate of Credit Acceptance', bold: true, center: true, after: 0 });
    para({ text: `Office of the Department of ${c.tgt_dept}`, center: true, after: 0 });
    para({ text: `Name of the Student: ${c.student_name}`, bold: true });
    para({ text: `Student ID: ${c.student_id}`, bold: true });
    para({ text: `Program: ${c.program}`, bold: true });
    const inst = c.institution || 'Daffodil International University';
    para({ text: `The following courses were completed from the ${c.src_program} (${c.src_institution || inst}) and have been accepted by the Department of ${c.tgt_dept}, (${inst}).` });

    const s = c.src_short, t = c.tgt_short;
    drawRow([[s, 'Course Code'], [s, 'Course Title'], [s, 'Credit'], ['Grade'], [`${t} Course Code`], [`${t} Course Title`], [`${t} Credit`], [c.last_col || 'Content Matching']]
      .map(paras => ({ paras, bold: true })), 908 * TW);
    segValue = c.matching ?? '';
    c.rows.forEach(r => {
      const cells: Cell[] = [r.src_code, r.src_title, fmt(r.src_credit), r.grade ?? '', r.tgt_code, r.tgt_title, fmt(r.tgt_credit), bulk ? '' : r.matching ?? '']
        .map((v, i) => ({ paras: [String(v)], vcenter: i === 7 }));
      drawRow(cells, 624 * TW, bulk);
    });
    closeSegment();
    drawRow([{ paras: ['Total Credit'], bold: true, span: 2 }, { paras: [fmt(total(c.rows, 'src_credit'))] }, { paras: [''] },
      { paras: ['Total Credit'], bold: true, span: 2 }, { paras: [fmt(total(c.rows, 'tgt_credit'))] }, { paras: [''] }], 108 * TW);

    const sigBlock = 12 * LEAD * 6 + AFTER * 4;
    if (y + sigBlock > BOTTOM) newPage();
    para({ text: `Number of credits accepted: ${fmt(total(c.rows, 'tgt_credit'))}`, bold: true, after: 0 });
    para({}); para({}); para({});
    const sig = (l: string, r: string) => { text(MARGIN, y, l, true, 12); text(MARGIN + TEXT_W - measure(r, true, 12), y, r, true, 12); y += 12 * LEAD + AFTER; };
    sig('---------------------------', '---------------------------');
    sig(c.sign_left || `Head, ${c.tgt_short}`, c.sign_right || 'Dean, FSIT');
  }
  return serialize(pages, logo);
}

const fmt = (v: unknown) => (Number(v) || 0).toFixed(1);

function serialize(pages: string[][], logo?: Logo): Uint8Array {
  const latin1 = (s: string) => Uint8Array.from(s, ch => ch.charCodeAt(0) & 0xff);
  const chunks: Uint8Array[] = [], offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array) => { chunks.push(b); size += b.length; };
  const obj = (id: number, body: string | Uint8Array[]) => {
    offsets[id] = size;
    push(latin1(`${id} 0 obj\n`));
    for (const part of typeof body === 'string' ? [latin1(body)] : body) push(part);
    push(latin1('\nendobj\n'));
  };
  const stream = (dict: string, data: Uint8Array) => [latin1(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, latin1('\nendstream')];

  push(latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
  const first = 6, kids = pages.map((_, i) => `${first + 2 * i} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  obj(5, logo ? stream(`/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, logo.jpeg) : '<< >>');
  const res = `<< /Font << /F1 3 0 R /F2 4 0 R >>${logo ? ' /XObject << /Im1 5 0 R >>' : ''} >>`;
  pages.forEach((ops, i) => {
    obj(first + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] /Resources ${res} /Contents ${first + 2 * i + 1} 0 R >>`);
    obj(first + 2 * i + 1, stream('', latin1(['0.5 w', ...ops].join('\n'))));
  });
  const count = first + 2 * pages.length, xref = size;
  push(latin1(`xref\n0 ${count}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const out = new Uint8Array(size);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
