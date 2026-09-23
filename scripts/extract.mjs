// Build src/data/catalog.json from the DIU FSIT folder + past certificates in the reference docx.
// Run whenever diu-fsit changes:  npm run extract   (needs `pdftotext` from poppler on PATH)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { readZip } from '../src/lib/zip.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'diu-fsit');
const REF = join(ROOT, 'Credit 11-06-2026 (1).docx');
const OUT = join(ROOT, 'src/data/catalog.json');

const DEPTS = { // short -> [department name, program name]
  SWE: ['Software Engineering', 'B.Sc. in Software Engineering'],
  'SWE-OLD': ['Software Engineering (2010-2020 curriculum)', 'B.Sc. in Software Engineering'],
  CSE: ['Computer Science and Engineering', 'B.Sc. in Computer Science and Engineering'],
  CIS: ['Computing and Information System', 'B.Sc. in Computing and Information System'],
  ITM: ['Information Technology and Management', 'B.Sc. in Information Technology and Management'],
  MCT: ['Multimedia and Creative Technology', 'B.Sc. in Multimedia and Creative Technology'],
  ICE: ['Information and Communication Engineering', 'B.Sc. in Information and Communication Engineering'],
  CE: ['Civil Engineering', 'B.Sc. in Civil Engineering'],
};

// ponytail: CSE brochure is a scanned image (OCR too noisy), transcribed by hand from 5YbQ...pdf
const CSE_MANUAL = `
CSE 112|Computer Fundamentals|3
CSE 113|Programming and Problem Solving|3
CSE 114|Programming and Problem-Solving Lab|1.5
CSE 115|Introduction to Biology & Chemistry for Computation|3
CSE 121|Electrical Circuits|3
CSE 122|Electrical Circuits Lab|1.5
CSE 123|Data Structure|3
CSE 124|Data Structure Lab|1.5
CSE 212|Discrete Mathematics|3
CSE 213|Algorithms|3
CSE 214|Algorithms Lab|1.5
CSE 215|Electronic Devices and Circuits|3
CSE 216|Electronic Devices and Circuits Lab|1.5
CSE 221|Object Oriented Programming|3
CSE 222|Object Oriented Programming Lab|1.5
CSE 223|Digital Logic Design|3
CSE 224|Digital Logic Design Lab|1.5
CSE 225|Data Communication|3
CSE 226|Numerical Methods|3
CSE 227|Systems Analysis and Design|3
CSE 228|Theory of Computation|3
CSE 311|Database Management System|3
CSE 312|Database Management System Lab|1.5
CSE 313|Compiler Design|3
CSE 314|Compiler Design Lab|1.5
CSE 315|Software Engineering|3
CSE 316|Artificial Intelligence|3
CSE 317|Microprocessor and Microcontrollers|3
CSE 321|Computer Networks|3
CSE 322|Computer Networks Lab|1.5
CSE 323|Operating Systems|3
CSE 324|Operating Systems Lab|1.5
CSE 325|Instrumentation and Control|3
CSE 326|Social and Professional Issues in Computing|3
CSE 411|Computer Graphics|3
CSE 412|Computer Graphics Lab|1.5
CSE 413|Computer Architecture and Organization|3
ENG 101|Basic Functional English and English Spoken|3
ENG 102|Writing and Comprehension|3
MAT 101|Mathematics-I|3
MAT 102|Mathematics-II: Calculus, Complex Variables & Linear Algebra|3
MAT 211|Engineering Mathematics|3
PHY 101|Physics-I|3
PHY 102|Physics-II|3
PHY 103|Physics-II Lab|1.5
BNS 101|Bangladesh Studies|3
AOL 101|Art of Living|3
STA 101|Statistics and Probability|3
ACT 327|Financial and Managerial Accounting|3
ECO 426|Engineering Economics|3
CSE 498|FYDP/Capstone Project (Phase I)|3
CSE 499|FYDP/Capstone Project (Phase II)|3
CSE 441|UI and UX Design|3
CSE 442|Software Quality Assurance|3
CSE 443|Web Computing|3
CSE 444|Software Architecture and Design Pattern|3
CSE 445|Intellectual Property and Contract Law|3
CSE 446|Mobile Applications Development|3
CSE 447|Concurrent and Distributed Programming|3
CSE 448|Virtual Reality and 3D Games|3
CSE 451|Cloud Computing and Services|3
CSE 452|Optical Fiber Communication|3
CSE 453|Wireless Sensor Network|3
CSE 454|Cyber Security and Forensics|3
CSE 455|High Performance Computing|3
CSE 456|Network Programming|3
CSE 457|Wireless and Cellular Communication|3
CSE 461|Algorithm Engineering|3
CSE 462|Computational Complexity|3
CSE 463|Advanced Algorithms|3
CSE 464|Basic Graph Theory|3
CSE 465|Algorithmic Game Theory|3
CSE 466|Bioinformatics Algorithm|3
CSE 467|Algorithm for distributed computation|3
CSE 471|Introduction to Embedded Systems|3
CSE 472|Internet of Things (IoT)|3
CSE 473|Robotics|3
CSE 474|VLSI Design|3
CSE 475|Micro-sensors|3
CSE 476|Sensor Manufacturing and Process Control|3
CSE 477|Introduction to Nanotechnology and Nanodevices|3
CSE 478|Additive Manufacturing Engineering|3`;

const CODE = String.raw`([A-Z]{2,4})\s?-?(\d{3,4}\s?L?)\b`;
const ISCED = String.raw`\d{4}-\d{3}$`; // MCT certificate uses ISCED-style codes, e.g. 0223-111
const startsWith = (re, s) => new RegExp(`^(?:${re})`).exec(s);

export const norm = code => { // 'SE111' / 'CSE-112' / 'CIS 122 L' -> 'SE 111', 'CSE 112', 'CIS 122L'
  const m = startsWith(CODE, code.trim().toUpperCase());
  return m ? `${m[1]} ${m[2].replaceAll(' ', '')}` : code.trim();
};
const clean = t => t.replace(/\s+/g, ' ').replace(/^[ .:-]+|[ .:-]+$/g, '');

const pdfText = prefix => {
  const f = readdirSync(SRC).find(n => n.startsWith(prefix) && n.endsWith('.pdf'));
  return execFileSync('pdftotext', ['-layout', join(SRC, f), '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
};

function* rowsCodeTitleCredit(text) {
  // "MCT111   Fundamentals of Graphic Design   3   NA"  /  "SWE112: Computer Fundamentals with Lab   4  CORE"
  const re = new RegExp(String.raw`^\s*(?:Level-\S+|Term-\S+(?: \d+)?)?\s*` + CODE + String.raw`:?\s+(\S.*?)\s{2,}(\d(?:\.\d+)?)\b`, 'gm');
  for (const m of text.matchAll(re)) yield [`${m[1]} ${m[2]}`, m[3], m[4]];
}

function* sweNew() {
  const t = pdfText('VXvz');
  // tables: "3      CS418       Network and Communication Security"
  for (const m of t.matchAll(new RegExp(String.raw`^\s*(\d(?:\.\d)?)\s+` + CODE + String.raw`\s+(\S.*)$`, 'gm')))
    if (!m[4].endsWith(')')) yield [`${m[2]} ${m[3]}`, m[4], m[1]]; // skip wrapped tails like "Major)"
  // course header blocks (authoritative, override tables)
  for (const block of t.split('Course Code:').slice(1)) {
    const b = block.slice(0, 1500);
    const code = /^\s*(\S.*?)(?:\s{2,}|$)/.exec(b), title = /Course Title:\s*(.+?)(?:\s{2,}|$)/.exec(b), credit = /Credit(?: Value)?:\s*([\d.]+)/.exec(b);
    if (code && title && credit) for (const c of code[1].split('/')) yield [c, title[1], credit[1]]; // "ENG 101/GED 104"
  }
}

async function* xlsxItm() {
  const zip = await readZip(readFileSync(join(SRC, 'Office Open XML spreadsheet.xlsx')));
  const text = name => new TextDecoder().decode(zip.get(name));
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([^<]*)/g)].map(t => t[1]).join(''));
  const sheet = text('xl/worksheets/sheet1.xml');
  for (const [, row] of sheet.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)) {
    const cells = {};
    for (const [, col, attrs, v] of row.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<f>.*?<\/f>)?(?:<v>(.*?)<\/v>)?.*?<\/c>)/gs))
      if (v !== undefined) cells[col] = /t="s"/.test(attrs) ? shared[+v] : /t="(str|inlineStr)"/.test(attrs) ? v : +v;
    const [code, title, credit] = [cells.A, cells.B, cells.C];
    if (code && title && typeof credit === 'number' && startsWith(CODE, String(code))) yield [code, title, credit];
  }
}

async function* referenceCerts() { // past certificates -> [srcDept, [[src cells], [tgt cells]]]
  const x = new TextDecoder().decode((await readZip(readFileSync(REF))).get('word/document.xml'));
  const txt = s => clean([...s.matchAll(/<w:p\b.*?<\/w:p>/gs)].map(p => [...p[0].matchAll(/<w:t[^>]*>([^<]*)/g)].map(t => t[1]).join('')).join(' '));
  for (const [tbl] of x.matchAll(/<w:tbl>.*?<\/w:tbl>/gs)) {
    const rows = [...tbl.matchAll(/<w:tr\b.*?<\/w:tr>/gs)].map(r => [...r[0].matchAll(/<w:tc>.*?<\/w:tc>/gs)].map(c => txt(c[0])));
    const src = rows[0][0].split(/\s+/)[0];
    const pairs = rows.slice(1).filter(r => r.length >= 7 && startsWith(`${CODE}|${ISCED}`, r[0].toUpperCase()) && startsWith(CODE, r[4].toUpperCase()))
      .map(r => [r.slice(0, 4), r.slice(4, 7)]);
    const at = x.indexOf(tbl);
    yield [src === 'CSE' && x.slice(Math.max(0, at - 3000), at).includes('Civil') ? 'CE' : src, pairs];
  }
}

export async function build() {
  const cat = Object.fromEntries(Object.entries(DEPTS).map(([k, [name, program]]) => [k, { name, program, courses: new Map() }]));
  const add = (dept, code, title, credit, overwrite = true) => {
    code = norm(String(code)); title = clean(String(title)); credit = Number(String(credit).trim());
    if (!startsWith(`${CODE}|${ISCED}`, code) || !title || !(credit > 0 && credit <= 12)) return;
    if (overwrite || !cat[dept].courses.has(code)) cat[dept].courses.set(code, { code, title, credit });
  };

  for (const s of sweNew()) add('SWE', ...s);
  for (const s of rowsCodeTitleCredit(pdfText('c1Ha'))) add('SWE-OLD', ...s);
  for (const s of rowsCodeTitleCredit(pdfText('ERAZ'))) add('MCT', ...s, false);
  for (const s of rowsCodeTitleCredit(pdfText('course-offer'))) add('CIS', ...s);
  for await (const s of xlsxItm()) add('ITM', ...s);
  for (const line of CSE_MANUAL.trim().split('\n')) add('CSE', ...line.split('|'));

  const mappings = [];
  for await (const [src, pairs] of referenceCerts())
    for (const [[sc, st, scr], [tc, tt, tcr]] of pairs) {
      add(src, sc, st, scr, false);
      add('SWE', tc, tt, tcr, false);
      const m = { src_dept: src, src: norm(sc), tgt_dept: 'SWE', tgt: norm(tc) };
      if (!mappings.some(o => JSON.stringify(o) === JSON.stringify(m))) mappings.push(m);
    }

  for (const d of Object.values(cat)) d.courses = [...d.courses.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  return { departments: cat, mappings };
}

const data = await build();
writeFileSync(OUT, JSON.stringify(data, null, 1));
for (const [k, d] of Object.entries(data.departments)) console.log(k.padEnd(8), String(d.courses.length).padStart(4), 'courses');
console.log(data.mappings.length, 'known mappings');
assert.equal(norm('SE111'), 'SE 111'); assert.equal(norm('CSE-112'), 'CSE 112'); assert.equal(norm('CIS 122 L'), 'CIS 122L');
assert.ok(data.departments.SWE.courses.length > 50);
