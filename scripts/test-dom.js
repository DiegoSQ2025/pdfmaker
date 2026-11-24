'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const ROOT = path.join(__dirname, '..');

function buildDom() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', (...args) => errors.push('console.error: ' + args.join(' ')));
  vc.on('log', (...args) => errors.push('console.log: ' + args.join(' ')));
  vc.on('warn', (...args) => errors.push('console.warn: ' + args.join(' ')));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://diegosq2025.github.io/pdfmaker/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });

  dom.window.URL.createObjectURL = dom.window.URL.createObjectURL || (() => 'blob:fake');
  dom.window.URL.revokeObjectURL = dom.window.URL.revokeObjectURL || (() => {});
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    clearRect() {},
    drawImage() {},
    save() {},
    restore() {},
  });

  return { dom, errors };
}

function makeFakePdfLib() {
  return {
    PDFDocument: { createStub: true },
    StandardFonts: {},
    degrees() {},
    rgb() {},
  };
}

function makeFakePdfJs(numPages) {
  function makePage(num) {
    return {
      rotate: 0,
      async getPage() {
        return {
          rotate: 0,
          getViewport({ scale, rotation }) {
            return { scale, rotation, width: 595 * (scale || 1), height: 842 * (scale || 1) };
          },
          render() {
            return { catch(cb) { if (cb) cb(); } };
          },
        };
      },
    };
  }
  return {
    numPages,
    getPage: makePage(),
    getViewport: null,
  };
}

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

async function main() {
  const { dom, errors } = buildDom();
  const { window } = dom;

  window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: (n) => Promise.resolve({
        rotate: 0,
        getViewport: ({ scale, rotation }) => ({
          scale, rotation,
          width: 595 * scale, height: 842 * scale,
        }),
        render: () => ({ catch(cb) { if (cb) cb(); } }),
      }),
    }),
  }) };
  window.PDFLib = makeFakePdfLib();
  window.PDFMakerCore = { buildPdf: async () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]) };

  const appCode = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  window.eval(appCode + '\n;window.__app = { handlePdfFiles, setTool, rotateEntry, exportPdf, state };');
  await new Promise((r) => setTimeout(r, 100));

  console.log('SIMULAZIONE DOM — flusso utente completo');
  check('libreria app caricata senza errori', errors.filter((e) => e.startsWith('jsdomError')).length === 0,
    errors.join(' | '));
  check('dropzone visibile all avvio', !window.document.getElementById('dropzone').hidden);
  check('griglia pagine nascosta all avvio', window.document.getElementById('pagesGrid').hidden);

  window.eval(`
    class FakeFile {
      constructor(name) { this.name = name; this.type = 'application/pdf'; }
      async arrayBuffer() { return new ArrayBuffer(10); }
    }
    window.__files = [new FakeFile('documento di prova.pdf')];
  `);
  await window.eval(`__app.handlePdfFiles(window.__files)`);
  await new Promise((r) => setTimeout(r, 200));

  const layoutLen1 = await window.eval('__app.state.layout.length');
  const filesLen1 = await window.eval('__app.state.files.length');
  check('PDF caricati: 2 pagine in layout', layoutLen1 === 2, `layout=${layoutLen1}`);
  check('documento registrato in state.files', filesLen1 === 1, `files=${filesLen1}`);

  const gridHidden = await window.eval('document.getElementById("pagesGrid").hidden');
  const cards = await window.eval('document.querySelectorAll(".page-card").length');
  check('griglia mostrata dopo il caricamento', gridHidden === false);
  check('2 schede pagina renderizzate', cards === 2, `cards=${cards}`);
  if (cards === 0) {
    console.log('  DEBUG errori catturati finora:');
    errors.forEach((e) => console.log('   *', e.slice(0, 300)));
    const toastText = window.document.getElementById('toast').textContent;
    console.log('  DEBUG toast:', toastText);
  }

  await window.eval(`__app.setTool('text')`);
  await new Promise((r) => setTimeout(r, 200));
  const toolActive = await window.eval(`document.querySelector('.btn.tool[data-tool="text"]').classList.contains('active')`);
  check('strumento Testo attivato', toolActive === true);

  await window.eval(`(() => {
    const overlay = document.querySelector('.page-overlay');
    const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clientX', { value: 120 });
    Object.defineProperty(ev, 'clientY', { value: 80 });
    overlay.dispatchEvent(ev);
  })()`);
  await new Promise((r) => setTimeout(r, 100));
  check('modale testo aperta al click sulla pagina', !window.document.getElementById('textModal').hidden);

  await window.eval(`(() => {
    document.getElementById('textValue').value = 'Ciao';
    document.getElementById('textValue').dispatchEvent(new window.Event('input', { bubbles: true }));
    document.getElementById('textConfirm').click();
  })()`);
  await new Promise((r) => setTimeout(r, 200));

  const annotations = await window.eval(`JSON.stringify(__app.state.layout.map(e => e.annotations.length))`);
  const modalClosed = window.document.getElementById('textModal').hidden;
  check('annotazione di testo creata (1 sola, sulla prima pagina)', annotations === '[1,0]', annotations);
  check('modale chiusa dopo Inserisci', modalClosed === true);
  const toolBack = await window.eval('__app.state.tool');
  check('strumento tornato su Sposta', toolBack === 'select', toolBack);
  const annText = await window.eval('__app.state.layout[0].annotations[0].text');
  check('contenuto annotazione = Ciao', annText === 'Ciao', annText);

  await window.eval(`__app.setTool('text')`);
  await new Promise((r) => setTimeout(r, 200));
  await window.eval(`(() => {
    const overlay = document.querySelector('.page-overlay');
    const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clientX', { value: 130 });
    Object.defineProperty(ev, 'clientY', { value: 90 });
    overlay.dispatchEvent(ev);
  })()`);
  await new Promise((r) => setTimeout(r, 100));
  const emptyClick = await window.eval(`(() => {
    document.getElementById('textValue').value = '';
    document.getElementById('textValue').dispatchEvent(new window.Event('input', { bubbles: true }));
    return document.getElementById('textConfirm').disabled;
  })()`);
  check('pulsante Inserisci disabilitato con testo vuoto', emptyClick === true, String(emptyClick));

  const filledClick = await window.eval(`(() => {
    document.getElementById('textValue').value = 'Ciao due';
    document.getElementById('textValue').dispatchEvent(new window.Event('input', { bubbles: true }));
    return document.getElementById('textConfirm').disabled;
  })()`);
  check('pulsante Inserisci abilitato con testo pieno', filledClick === false, String(filledClick));
  await window.eval(`document.getElementById('textCancel').click()`);
  await new Promise((r) => setTimeout(r, 100));
  const annCountAfterCancel = await window.eval('__app.state.layout[0].annotations.length');
  check('Annulla non inserisce nulla', annCountAfterCancel === 1, String(annCountAfterCancel));

  window.eval(`__app.rotateEntry(0)`);
  await new Promise((r) => setTimeout(r, 200));
  const rot = await window.eval('__app.state.layout[0].rot');
  check('pagina 1 ruotata a 90', rot === 90, `rot=${rot}`);

  const bypassServerFetch = true;
  if (bypassServerFetch) {
    await window.eval('__app.exportPdf()');
    await new Promise((r) => setTimeout(r, 400));
    const blockingErrors = errors.filter((e) => e.startsWith('jsdomError')
      && !e.includes('navigation to another Document'));
    check('export client-side completato senza eccezioni bloccanti',
      blockingErrors.length === 0, errors.join(' | '));
  }

  console.log(`\nRISULTATO: ${passed} pass, ${failed} fail`);
  if (failed > 0) {
    console.log('\nErrori console catturati:');
    errors.slice(0, 20).forEach((e) => console.log(' -', e));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('SIMULAZIONE FALLITA:', err);
  process.exit(1);
});
