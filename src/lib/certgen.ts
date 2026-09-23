// Render Certificate of Credit Acceptance DOCX from public/template.docx (the reference package with an empty body).
// Formatting (fonts, sizes, table grid, borders, logo, page setup) is copied from the reference's certificates.
// Pure string/bytes work, so it runs in the browser and in Node.
import { writeZip, type Files } from './zip.ts';

export type Row = { src_code: string; src_title: string; src_credit: string | number; grade?: string;
  tgt_code: string; tgt_title: string; tgt_credit: string | number; matching?: string };
export type Cert = { student_name: string; student_id: string; program: string; tgt_dept: string; tgt_short: string;
  src_short: string; src_program: string; src_institution?: string; institution?: string; matching?: string;
  matching_mode?: 'bulk' | 'per_course'; last_col?: string; sign_left?: string; sign_right?: string; rows: Row[] };

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>';
const TAB = '<w:tabs><w:tab w:val="left" w:pos="3735"/></w:tabs>';
const BORDERS = '<w:tcBorders>' + ['top', 'left', 'bottom', 'right'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') + '</w:tcBorders>';
const GRID = [1169, 2159, 900, 900, 1258, 1892, 902, 1145]; // twips, from reference "Content Matching" tables
const TEXT_W = 11907 - 2 * 1440; // A4 width minus margins

const LOGO = (id: number) => `<w:r><w:rPr><w:noProof/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>9525</wp:posOffset></wp:positionV><wp:extent cx="1047750" cy="504825"/><wp:effectExtent l="0" t="0" r="0" b="9525"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="${id}" name="Logo ${id}" descr="DIU logo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId5"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="1047750" cy="504825"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;

const rpr = (bold = false, size: number | null = 24) =>
  `<w:rPr>${FONT}${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}<w:szCs w:val="24"/></w:rPr>`;

const run = (text: unknown, bold = false, size: number | null = 24, link = false) =>
  `<w:r>${rpr(bold, size).replace('<w:rPr>', '<w:rPr>' + (link ? '<w:rStyle w:val="Hyperlink"/>' : ''))}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

type ParaOpts = { bold?: boolean; center?: boolean; after?: number; size?: number | null; tabs?: string; raw?: boolean; pageBreak?: boolean };
function para(content = '', { bold = false, center = false, after, size = 24, tabs = TAB, raw = false, pageBreak = false }: ParaOpts = {}) {
  const ppr = `<w:pPr>${pageBreak ? '<w:pageBreakBefore/>' : ''}${tabs}${after !== undefined ? `<w:spacing w:after="${after}"/>` : ''}${center ? '<w:jc w:val="center"/>' : ''}${rpr(bold, size)}</w:pPr>`;
  return `<w:p>${ppr}${raw ? content : content ? run(content, bold, size) : ''}</w:p>`;
}

function cell(width: number, lines: string | string[], { bold = false, span = 1, vmerge = '', vcenter = false } = {}) {
  const extra = (span > 1 ? `<w:gridSpan w:val="${span}"/>` : '') + ({ restart: '<w:vMerge w:val="restart"/>', cont: '<w:vMerge/>' }[vmerge] ?? '');
  const tcpr = `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${extra}${BORDERS}${vcenter ? '<w:vAlign w:val="center"/>' : ''}</w:tcPr>`;
  return `<w:tc>${tcpr}${(Array.isArray(lines) ? lines : [lines]).map(l => para(l, { bold, size: null })).join('')}</w:tc>`;
}

const row = (cells: string[], height: number) => `<w:tr><w:trPr><w:trHeight w:val="${height}"/></w:trPr>${cells.join('')}</w:tr>`;
const fmt = (n: unknown) => (Number(n) || 0).toFixed(1);
export const total = (rows: Row[], key: 'src_credit' | 'tgt_credit') => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

function table(c: Cert) {
  const { src_short: s, tgt_short: t, rows } = c;
  const head = [[s, 'Course Code'], [s, 'Course Title'], [s, 'Credit'], 'Grade', `${t} Course Code`, `${t} Course Title`, `${t} Credit`, c.last_col || 'Content Matching'];
  const out = [row(head.map((h, i) => cell(GRID[i], h, { bold: true })), 908)];
  rows.forEach((r, i) => {
    const vals = [r.src_code, r.src_title, fmt(r.src_credit), r.grade ?? '', r.tgt_code, r.tgt_title, fmt(r.tgt_credit)];
    const cells = vals.map((v, j) => cell(GRID[j], String(v)));
    cells.push(c.matching_mode === 'per_course'
      ? cell(GRID[7], r.matching ?? '', { vcenter: true })
      // bulk: one merged value for the whole table, as in the reference
      : cell(GRID[7], i === 0 ? c.matching ?? '' : '', { vmerge: i === 0 ? 'restart' : 'cont', vcenter: true }));
    out.push(row(cells, 624));
  });
  out.push(row([cell(GRID[0] + GRID[1], 'Total Credit', { bold: true, span: 2 }), cell(GRID[2], fmt(total(rows, 'src_credit'))), cell(GRID[3], ''),
    cell(GRID[4] + GRID[5], 'Total Credit', { bold: true, span: 2 }), cell(GRID[6], fmt(total(rows, 'tgt_credit'))), cell(GRID[7], '')], 108));
  const tblPr = '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="10325" w:type="dxa"/><w:tblInd w:w="-5" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>';
  return `<w:tbl>${tblPr}<w:tblGrid>${GRID.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${out.join('')}</w:tbl>`;
}

function certificate(c: Cert, idx: number) {
  const sigTabs = `<w:tabs><w:tab w:val="right" w:pos="${TEXT_W}"/></w:tabs>`;
  const inst = c.institution || 'Daffodil International University';
  const center = { center: true, after: 0 };
  return [
    para('', { pageBreak: idx > 0 }),
    para(LOGO(idx + 1), { center: true, raw: true }),
    para('', { bold: true, center: true }),
    para('Daffodil International University', { ...center, bold: true }),
    para('Daffodil Smart City, Birulia, Savar, Dhaka-1216', center),
    para('Phone-9138234-5, 9116774, Fax: 880-2-9124280', center),
    para(run('Website: ') + '<w:hyperlink r:id="rId6" w:history="1">' + run('www.daffodilvarsity.edu.bd', false, 24, true) + '</w:hyperlink>', { ...center, raw: true }),
    para('Certificate of Credit Acceptance', { ...center, bold: true }),
    para(`Office of the Department of ${c.tgt_dept}`, center),
    para(`Name of the Student: ${c.student_name}`, { bold: true }),
    para(`Student ID: ${c.student_id}`, { bold: true }),
    para(`Program: ${c.program}`, { bold: true }),
    para(`The following courses were completed from the ${c.src_program} (${c.src_institution || inst}) ` +
      `and have been accepted by the Department of ${c.tgt_dept}, (${inst}).`),
    table(c),
    para(`Number of credits accepted: ${fmt(total(c.rows, 'tgt_credit'))}`, { bold: true, after: 0 }),
    para(), para(), para(),
    para(run('---------------------------', true) + '<w:r><w:tab/></w:r>' + run('---------------------------', true), { tabs: sigTabs, raw: true }),
    para(run(c.sign_left || `Head, ${c.tgt_short}`, true) + '<w:r><w:tab/></w:r>' + run(c.sign_right || 'Dean, FSIT', true), { tabs: sigTabs, raw: true }),
  ].join('');
}

/** One page per certificate. `template` = files of public/template.docx. Returns the .docx bytes. */
export function buildDocx(certs: Cert[], template: Files): Uint8Array {
  const xml = new TextDecoder().decode(template.get('word/document.xml'));
  const head = xml.slice(0, xml.indexOf('<w:body>') + 8), tail = xml.slice(xml.lastIndexOf('<w:sectPr'));
  const files: Files = new Map(template);
  files.set('word/document.xml', new TextEncoder().encode(head + certs.map(certificate).join('') + tail));
  return writeZip(files);
}

const REQUIRED = ['student_name', 'student_id', 'program', 'tgt_dept', 'tgt_short', 'src_short', 'src_program'] as const;
const ROW_REQUIRED = ['src_code', 'src_title', 'src_credit', 'tgt_code', 'tgt_title', 'tgt_credit'] as const;

/** Returns a list of problems; empty means valid. */
export function validate(c: Cert): string[] {
  const missing: string[] = REQUIRED.filter(k => !String(c?.[k] ?? '').trim());
  if (!Array.isArray(c?.rows) || !c.rows.length) return [...missing, 'at least one course row'];
  c.rows.forEach((r, i) => {
    for (const k of ROW_REQUIRED) if (!String(r?.[k] ?? '').trim()) missing.push(`row ${i + 1}: ${k}`);
    for (const k of ['src_credit', 'tgt_credit'] as const) if (Number.isNaN(Number(r?.[k]))) missing.push(`row ${i + 1}: ${k} must be a number`);
  });
  return missing;
}
