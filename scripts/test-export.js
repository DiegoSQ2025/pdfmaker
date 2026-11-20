'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const BASE = `http://localhost:${process.env.PORT || 3000}`;

async function createSamplePdf(filePath) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ['Pagina uno', 'Pagina due']) {
    const page = doc.addPage([595, 842]);
    page.drawText(label, { x: 72, y: 770, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
  }
  fs.writeFileSync(filePath, await doc.save());
}

async function main() {
  const tmp = fs.mkdtempSync('/tmp/pdfmaker-test-');
  const samplePath = path.join(tmp, 'sample.pdf');
  const outPath = path.join(tmp, 'output.pdf');
  await createSamplePdf(samplePath);

  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error('health check fallito');
  console.log('health:', await health.json());

  const png1x1 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPhfDwADsgF07mKd1wAAAABJRU5ErkJggg==';

  const spec = {
    pages: [
      { file: 0, page: 1, rotation: 0 },
      { file: 0, page: 0, rotation: 90 },
      { file: 0, page: 1, rotation: 180 },
    ],
    annotations: [
      { kind: 'text', page: 0, x: 60, y: 50, size: 20, color: '#db1b26', bold: true, text: 'Prima riga\nCittà è più àccentuata' },
      { kind: 'image', page: 1, x: 100, y: 100, w: 120, h: 90, image: png1x1 },
      { kind: 'text', page: 1, x: 30, y: 30, size: 14, color: '#111111', bold: false, text: 'su pagina ruotata' },
      { kind: 'image', page: 2, x: 250, y: 250, w: 60, h: 60, image: png1x1 },
    ],
  };

  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(samplePath)], { type: 'application/pdf' }), 'sample.pdf');
  form.append('spec', JSON.stringify(spec));

  const response = await fetch(`${BASE}/api/export`, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`export fallito (${response.status}): ${await response.text()}`);
  }
  const outBytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outPath, outBytes);
  console.log('export ok,', outBytes.length, 'bytes');

  const check = await PDFDocument.load(outBytes);
  if (check.getPageCount() !== 3) throw new Error('numero pagine errato: ' + check.getPageCount());
  const rotations = check.getPages().map((p) => p.getRotation().angle);
  console.log('pagine:', check.getPageCount(), 'rotazioni:', rotations.join(','));
  if (JSON.stringify(rotations) !== JSON.stringify([0, 90, 180])) throw new Error('rotazioni errate');

  console.log('TEST OK');
}

main().catch((err) => {
  console.error('TEST FALLITO:', err);
  process.exit(1);
});
