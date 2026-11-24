'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const BASE = `http://localhost:${process.env.PORT || 3000}`;

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPhfDwADsgF07mKd1wAAAABJRU5ErkJggg==';

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function exportRequest(accept, files, spec) {
  const form = new FormData();
  files.forEach((entry, i) => {
    const bytes = Array.isArray(entry) ? entry[0] : entry;
    const name = Array.isArray(entry) ? entry[1] : null;
    form.append('files', new Blob([bytes], { type: 'application/pdf' }), name || `f${i}.pdf`);
  });
  form.append('spec', JSON.stringify(spec));
  const response = await fetch(`${BASE}/api/export`, { method: 'POST', body: form });
  await accept(response);
}

async function createSamplePdf(label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(label, { x: 72, y: 770, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
  return doc;
}

async function simulationMaliciousSpec(sampleBytes) {
  console.log('\nSIMULAZIONE 1 — spec malevole o malformate');
  const bad = (name) => async (response) =>
    check(`${name} → rifiutata`, response.status === 400 || response.status === 500,
      `stato ${response.status}`);

  await exportRequest(bad('pages come stringa'), [[sampleBytes]],
    { pages: "<img src=x onerror=alert(1)>", annotations: [] });
  await exportRequest(bad('pages vuoto'), [[sampleBytes]], { pages: [], annotations: [] });
  await exportRequest(bad('rotazione fuori range'), [[sampleBytes]],
    { pages: [{ file: 0, page: 0, rotation: 99999 }], annotations: [] });
  await exportRequest(bad('file indice inesistente'), [[sampleBytes]],
    { pages: [{ file: 42, page: 0, rotation: 0 }], annotations: [] });
  await exportRequest(bad('tipo annotazione ignoto'), [[sampleBytes]],
    { pages: [{ file: 0, page: 0, rotation: 0 }], annotations: [{ kind: 'iframe', page: 0 }] });
  await exportRequest(bad('testo 500k caratteri'), [[sampleBytes]],
    { pages: [{ file: 0, page: 0, rotation: 0 }],
      annotations: [{ kind: 'text', page: 0, x: 10, y: 10, size: 12, color: '#111111', text: 'A'.repeat(500000) }] });
  await exportRequest(bad('immagine non base64-pdf'), [[sampleBytes]],
    { pages: [{ file: 0, page: 0, rotation: 0 }],
      annotations: [{ kind: 'image', page: 0, x: 10, y: 10, w: 50, h: 50,
        image: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' }] });
  await exportRequest(bad('immagine dimensioni assurde'), [[sampleBytes]],
    { pages: [{ file: 0, page: 0, rotation: 0 }],
      annotations: [{ kind: 'image', page: 0, x: 10, y: 10, w: 9999999, h: 9999999, image: PNG_1X1 }] });
  await exportRequest(async (response) => {
    const bytes = Buffer.from(await response.arrayBuffer());
    let doc = null;
    try {
      doc = await PDFDocument.load(bytes);
    } catch (err) {
      doc = null;
    }
    check('payload con script/HTML nel testo → PDF valido produce (testo neutro, non eseguibile)',
      response.status === 200 && doc !== null,
      `stato ${response.status}`);
  }, [[sampleBytes]],
    { pages: [{ file: 0, page: 0, rotation: 0, __proto__hack: '../../etc/passwd' }],
      annotations: [{ kind: 'text', page: 0, x: 10, y: 10, size: 12,
        text: ')</object></textarea><script>alert(1)</script>' }] });

  await exportRequest(async (response) => {
    check('page inesistente → 500 controllato', response.status === 500,
      `stato ${response.status}`);
  }, [[sampleBytes]], { pages: [{ file: 0, page: 999, rotation: 0 }], annotations: [] });
}

async function simulationCorruptedPdf() {
  console.log('\nSIMULAZIONE 2 — PDF corrotti o finti');
  await exportRequest(async (response) => {
    check('file casuale → 400/500 in JSON', (response.status === 400 || response.status === 500)
      && (response.headers.get('content-type') || '').includes('json'),
      `stato ${response.status}, content-type ${response.headers.get('content-type')}`);
  }, [[Buffer.from('questo non e un pdf, spero craschi!')]],
    { pages: [{ file: 0, page: 0, rotation: 0 }], annotations: [] });

  await exportRequest(async (response) => {
    check('finto PDF con intestazione valida → rifiutato senza crash',
      response.status === 400 || response.status === 500, `stato ${response.status}`);
  }, [[Buffer.from('%PDF-1.4 ma con tabella xref corrotta')]],
    { pages: [{ file: 0, page: 0, rotation: 0 }, { file: 0, page: 0, rotation: 0 }], annotations: [] });
}

async function simulationHeaders() {
  console.log('\nSIMULAZIONE 3 — security headers');
  const response = await fetch(`${BASE}/`);
  const body = await response.text();
  check('index HTTP 200', response.status === 200);
  for (const header of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'content-security-policy']) {
    check(`header ${header} presente`, Boolean(response.headers.get(header)),
      `ricevuto: ${response.headers.get(header)}`);
  }
  check('CSP include frame-ancestors none',
    (response.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"));
  check('CSP include nosniff fallback nello script CSP meta',
    body.includes('Content-Security-Policy'));
}

async function regressionValidFlow(sampleBytes) {
  console.log('\nSIMULAZIONE 4 — regressione: flusso valido');
  await exportRequest(async (response) => {
    check('export valido → 200', response.status === 200, `stato ${response.status}`);
    check('content-type application/pdf',
      (response.headers.get('content-type') || '').includes('application/pdf'));
    const bytes = Buffer.from(await response.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    check('PDF valido: 3 pagine', doc.getPageCount() === 3, `pagine: ${doc.getPageCount()}`);
    const rotations = doc.getPages().map((p) => p.getRotation().angle);
    check('rotazioni 0/90/180 corrette',
      JSON.stringify(rotations) === JSON.stringify([0, 90, 180]), rotations.join(','));
  },
  [[sampleBytes, 'documenti/rapporto.pdf'], [sampleBytes, 'documenti/allegato.pdf']],
  {
    pages: [
      { file: 1, page: 0, rotation: 0 },
      { file: 0, page: 0, rotation: 90 },
      { file: 0, page: 0, rotation: 180 },
    ],
    annotations: [
      { kind: 'text', page: 0, x: 50.5, y: 30.25, size: 18, color: '#db1b26', bold: true, text: 'Validazione sicurezza\nCittà à è ò' },
      { kind: 'image', page: 1, x: 100, y: 100, w: 80.5, h: 60.25, image: PNG_1X1 },
    ],
  });
}

async function main() {
  const sample = await createSamplePdf('Documento valida');
  const sampleBytes = Buffer.from(await sample.save());

  await simulationMaliciousSpec(sampleBytes);
  await simulationCorruptedPdf();
  await simulationHeaders();
  await regressionValidFlow(sampleBytes);

  const health = await fetch(`${BASE}/api/health`);
  check('server ancora vivo dopo tutti gli attacchi', health.ok);
  check('health risponde ok:true', (await health.json()).ok === true);

  console.log(`\nRISULTATO: ${passed} pass, ${failed} fail`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('TEST FALLITO:', err);
  process.exit(1);
});
