'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SITE = process.env.SITE_URL || 'https://diegosq2025.github.io/pdfmaker/';

async function createSamplePdf(filePath) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Pagina ${i} di test`, { x: 72, y: 770, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
  }
  fs.writeFileSync(filePath, await doc.save());
}

async function main() {
  const tmp = fs.mkdtempSync('/tmp/pw-test-');
  const samplePath = path.join(tmp, 'sample.pdf');
  await createSamplePdf(samplePath);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => consoleErrors.push('[pageerror] ' + err.message));

  console.log('1) Apro', SITE);
  const response = await page.goto(SITE, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('   status:', response.status());
  console.log('   titolo:', await page.title());

  console.log('2) Carico un PDF via input file');
  await page.setInputFiles('#pdfInput', samplePath);
  await page.waitForTimeout(3000);

  const cardCount = await page.locator('.page-card').count();
  console.log('   miniature renderizzate:', cardCount);
  const dropzoneVisible = await page.locator('#dropzone').isVisible();
  console.log('   dropzone ancora visibile (non dovrebbe):', dropzoneVisible);

  console.log('3) Inserisco testo con lo strumento Testo');
  await page.click('.btn.tool[data-tool="text"]');
  const thumbCount = await page.locator('.page-thumb-wrap').count();
  if (thumbCount > 0) {
    const box = await page.locator('.page-thumb-wrap canvas').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
    await page.waitForTimeout(500);
    const modalVisible = await page.locator('#textModal').isVisible();
    console.log('   modale testo aperta:', modalVisible);
    await page.fill('#textValue', 'Ciao dal test automatico');
    await page.click('#textConfirm');
    await page.waitForTimeout(1500);
    const annotationCount = await page.locator('.annotation').count();
    console.log('   annotazioni a video:', annotationCount);
    const toastText = await page.locator('#toast').textContent().catch(() => '');
    console.log('   toast:', (toastText || '(vuoto)').trim());
  } else {
    console.log('   NESSUNA miniatura: blocco il test qui');
  }

  console.log('4) Scarico il PDF finale');
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.click('#exportBtn');
  const download = await downloadPromise;
  if (download) {
    const outPath = path.join(tmp, 'final.pdf');
    await download.saveAs(outPath);
    const size = fs.statSync(outPath).size;
    const check = await PDFDocument.load(fs.readFileSync(outPath));
    console.log('   download:', download.suggestedFilename(), size, 'bytes,', check.getPageCount(), 'pagine');
  } else {
    console.log('   NESSUN DOWNLOAD');
  }

  console.log('\nErrori console rilevati:', consoleErrors.length);
  consoleErrors.slice(0, 10).forEach((err) => console.log(' -', err));

  await page.screenshot({ path: '/tmp/pw-final.png', fullPage: true });
  console.log('screenshot: /tmp/pw-final.png');

  await browser.close();
}

main().catch((err) => {
  console.error('SIMULAZIONE FALLITA:', err.message);
  process.exit(1);
});
