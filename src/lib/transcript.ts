// Transcript text (from a text PDF or OCR) -> student + course/grade rows. Pure, so `npm run check` covers it.
// ponytail: line-based regexes tuned for "CODE title credit grade" rows; another layout means editing ROW/GRADE.
type Dept = { courses: { code: string }[] };
export type Scan = { name?: string; id?: string; dept?: string; rows: { code: string; grade: string; known: boolean }[] };

const ROW = /\b([A-Z]{2,4})\s?-?([0-9OI]{3,4})\s?(L?)\b/; // OCR reads 0 as O and 1 as I
const GRADE = /(?<![\w.+-])(A\+|A-|A|B\+|B-|B|C\+|C|D|F|W)(?![\w+-])/g;
const FAILED = new Set(['F', 'W']);

export function parseTranscript(text: string, depts: Record<string, Dept>): Scan {
  const inDept = Object.fromEntries(Object.entries(depts).map(([k, d]) => [k, new Set(d.courses.map(c => c.code))]));
  const prefixes = new Set(Object.values(depts).flatMap(d => d.courses.map(c => c.code.split(' ')[0])));
  const all = new Set(Object.values(inDept).flatMap(s => [...s]));
  const found = new Map<string, { code: string; grade: string; known: boolean }>(); // retakes: last attempt wins

  for (const line of text.split('\n')) {
    const m = line.toUpperCase().match(ROW);
    if (!m || !prefixes.has(m[1])) continue;
    const code = `${m[1]} ${m[2].replace(/O/g, '0').replace(/I/g, '1')}${m[3]}`;
    const rest = line.slice((m.index ?? 0) + m[0].length);
    const grade = [...rest.matchAll(GRADE)].at(-1)?.[1] ?? '';
    if (FAILED.has(grade)) { found.delete(code); continue; }
    found.set(code, { code, grade, known: all.has(code) });
  }

  const rows = [...found.values()];
  const dept = Object.keys(inDept).map(k => [k, rows.filter(r => inDept[k].has(r.code)).length] as const)
    .sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0)?.[0];
  const name = text.match(/^\s*(?:student'?s?\s+)?name(?:\s+of\s+(?:the\s+)?student)?\s*[:\-]\s*(.+?)\s*(?:\b(?:student\s+)?id\b.*)?$/im)?.[1];
  const idm = text.match(/\bid\b\D{0,12}(\d{3})[-\s]?(\d{2})[-\s]?(\d{3,4})\b/i) ?? text.match(/\b(\d{3})-(\d{2})-(\d{3,4})\b/);
  return { name, id: idm && `${idm[1]}-${idm[2]}-${idm[3]}`, dept, rows };
}
