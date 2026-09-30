// Transcript file (PDF or photo) -> text, in the browser. Both libraries load on first scan only.
// ponytail: English OCR only, no deskew; blurry or rotated photos read badly, so the UI asks users to review the rows.
export async function fileToText(file: File, progress: (msg: string) => void): Promise<string> {
  const pages: (File | HTMLCanvasElement)[] = [];
  if (file.type === 'application/pdf') {
    progress('Reading PDF…');
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      // rebuild visual lines: same baseline (y within 3pt) = same line, then left to right
      const items = (await page.getTextContent()).items.filter((it): it is typeof it & { str: string; transform: number[] } => 'str' in it);
      items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
      let y = NaN;
      for (const it of items) {
        if (!it.str.trim()) continue;
        text += (Math.abs(it.transform[5] - y) > 3 ? '\n' : ' ') + it.str;
        y = it.transform[5];
      }
      text += '\n';
      if (text.replace(/\s/g, '').length > 50) continue;
      // no text layer: scanned PDF, render the page and OCR it below
      const viewport = page.getViewport({ scale: 2 });
      const canvas = Object.assign(document.createElement('canvas'), { width: viewport.width, height: viewport.height });
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
      pages.push(canvas);
    }
    if (!pages.length) return text;
  } else pages.push(file);

  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: m => m.status === 'recognizing text' && progress(`Reading text… ${Math.round(m.progress * 100)}%`),
  });
  progress('Loading text reader…');
  let out = '';
  try { for (const p of pages) out += (await worker.recognize(p)).data.text + '\n'; }
  finally { await worker.terminate(); }
  return out;
}
