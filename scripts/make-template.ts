// Build public/template.docx from the reference: same package (styles, logo, page setup, fonts),
// but with the body emptied, so the hosted site never ships the real students' data.
// Run when the reference changes:  npm run template
import { readFileSync, writeFileSync } from 'node:fs';
import { readZip, writeZip } from '../src/lib/zip.ts';

const files = await readZip(readFileSync(new URL('../Credit 11-06-2026 (1).docx', import.meta.url)));
const xml = new TextDecoder().decode(files.get('word/document.xml'));
const empty = xml.slice(0, xml.indexOf('<w:body>') + 8) + xml.slice(xml.lastIndexOf('<w:sectPr'));
files.set('word/document.xml', new TextEncoder().encode(empty));
writeFileSync(new URL('../public/template.docx', import.meta.url), writeZip(files));
console.log('public/template.docx written,', empty.length, 'bytes of document.xml');
