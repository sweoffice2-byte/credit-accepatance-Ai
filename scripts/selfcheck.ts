// Smoke test for the generators (no browser needed):  npm run check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readZip, writeZip } from '../src/lib/zip.ts';
import { buildDocx, validate, type Cert } from '../src/lib/certgen.ts';
import { buildPdf } from '../src/lib/pdf.ts';
import { parseTranscript } from '../src/lib/transcript.ts';
import catalog from '../src/data/catalog.json' with { type: 'json' };

const row = { src_code: 'ICE 1248', src_title: 'OOP Laboratory & <Co> (x)', src_credit: 1, grade: 'A+', tgt_code: 'SE 217', tgt_title: 'Lab (x)', tgt_credit: 1, matching: '80%' };
const cert: Cert = { student_name: 'Test', student_id: '253-35-731', program: 'B.Sc. in Software Engineering', tgt_dept: 'Software Engineering',
  tgt_short: 'SWE', src_short: 'ICE', src_program: 'B.Sc. in Information and Communication Engineering', matching: '95%',
  rows: [{ ...row, src_code: 'ICE 1141', src_credit: 3, tgt_credit: 3 }, row] };

// zip round-trip
const sample = new Map([['a.txt', new TextEncoder().encode('hello')], ['dir/b.bin', new Uint8Array([0, 255, 7])]]);
assert.deepEqual(await readZip(writeZip(sample)), sample);

// docx
const template = await readZip(readFileSync(new URL('../public/template.docx', import.meta.url)));
assert.ok(!new TextDecoder().decode(template.get('word/document.xml')).includes('Shifat'), 'template carries no student data');
const docx = await readZip(buildDocx([cert, { ...cert, matching_mode: 'per_course' }], template));
const xml = new TextDecoder().decode(docx.get('word/document.xml'));
assert.equal(xml.split('<w:tbl>').length - 1, 2);
assert.ok(xml.includes('&amp; &lt;Co&gt;'), 'user text is XML-escaped');
assert.ok(xml.includes('Number of credits accepted: 4.0'));
assert.ok(xml.includes('>80%<'), 'per-course matching printed');
assert.ok(docx.has('word/media/image1.png') && docx.has('word/styles.xml'));

// validation
assert.ok(validate({ ...cert, rows: [] }).includes('at least one course row'));
assert.ok(validate({ ...cert, rows: [{ ...row, tgt_credit: 'x' }] }).some(e => e.includes('must be a number')));

// pdf: 40 rows must spill onto a second page; parentheses in text are escaped
const measure = (t: string, bold: boolean, size: number) => t.length * size * (bold ? 0.52 : 0.47);
const pdf = new TextDecoder('latin1').decode(buildPdf([{ ...cert, rows: Array(40).fill(row) }], measure));
assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
assert.ok(Number(pdf.match(/\/Count (\d+)/)![1]) >= 2, "long table spills onto more pages");
assert.ok(pdf.includes('(Lab \\(x\\)) Tj'), 'parentheses escaped');
const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
assert.ok(pdf.slice(xref).startsWith('xref'), 'xref offset is exact');
console.log('generators ok');

// transcript scan
const t = parseTranscript(`Student Name: Jane Doe  ID: 253 35 731
CSE 113 Programming and Problem Solving 3.0 A+
CSE1I4 Programming and Problem-Solving Lab 1.5 B
CSE 123 Data Structure 3.0 F
CSE 123 Data Structure 3.0 A-
CSE 213 Algorithms 3.0 W
CSE 999 Not A Course 3.0 A
Total Credits 12.0`, catalog.departments);
assert.equal(t.name, 'Jane Doe');
assert.equal(t.id, '253-35-731');
assert.equal(t.dept, 'CSE');
assert.deepEqual(t.rows.map(r => `${r.code} ${r.grade}`), ['CSE 113 A+', 'CSE 114 B', 'CSE 123 A-', 'CSE 999 A']);
assert.deepEqual(t.rows.map(r => r.known), [true, true, true, false]);
console.log('transcript ok');
