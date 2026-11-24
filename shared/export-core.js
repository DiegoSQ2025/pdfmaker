(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PDFMakerCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WINANSI_FIXES = {
    '\u201c': '"',
    '\u201d': '"',
    '\u2018': "'",
    '\u2019': "'",
    '\u2013': '-',
    '\u2014': '-',
    '\u2026': '...',
    '\u00a0': ' ',
  };

  function normalizeRotation(rot) {
    return ((Math.round(rot || 0) % 360) + 360) % 360;
  }

  function sanitizeText(text) {
    return String(text || '')
      .replace(/[\u201c\u201d\u2018\u2019\u2013\u2014\u2026\u00a0]/g, (ch) => WINANSI_FIXES[ch])
      .replace(/[^\u0000-\u00ff]/g, '?');
  }

  function parseColor(value, rgb) {
    const named = {
      nero: rgb(0, 0, 0),
      bianco: rgb(1, 1, 1),
      rosso: rgb(0.86, 0.11, 0.15),
      verde: rgb(0.13, 0.55, 0.13),
      blu: rgb(0.1, 0.22, 0.75),
    };
    if (value && named[value]) return named[value];
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
      const n = parseInt(value.slice(1), 16);
      return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    }
    return named.nero;
  }

  function toRawPoint(display, rawW, rawH, rotation) {
    const rot = normalizeRotation(rotation);
    switch (rot) {
      case 90:
        return { x: display.y, y: display.x };
      case 180:
        return { x: rawW - display.x, y: display.y };
      case 270:
        return { x: rawW - display.y, y: rawH - display.x };
      default:
        return { x: display.x, y: rawH - display.y };
    }
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = String(dataUrl).split(',').pop() || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function embedImage(out, dataUrl) {
    const bytes = dataUrlToBytes(dataUrl);
    if (String(dataUrl).indexOf('data:image/png') === 0) {
      return out.embedPng(bytes);
    }
    return out.embedJpg(bytes);
  }

  async function buildPdf(pdfLib, spec, fileBuffers) {
    const { PDFDocument, StandardFonts, degrees, rgb } = pdfLib;
    const pages = Array.isArray(spec.pages) ? spec.pages : [];
    const annotations = Array.isArray(spec.annotations) ? spec.annotations : [];

    if (!fileBuffers || fileBuffers.length === 0) {
      throw new Error('Nessun PDF caricato');
    }
    if (pages.length === 0) {
      throw new Error('Nessuna pagina selezionata');
    }

    const docs = [];
    for (const buffer of fileBuffers) {
      docs.push(await PDFDocument.load(buffer, { ignoreEncryption: true }));
    }

    const out = await PDFDocument.create();
    out.setTitle('PDFMaker');

    const copied = [];
    for (const entry of pages) {
      const src = docs[entry.file];
      if (!src || entry.page == null || entry.page < 0 || entry.page >= src.getPageCount()) {
        throw new Error('Riferimento pagina non valido');
      }
      const [copiedPage] = await out.copyPages(src, [entry.page]);
      copiedPage.setRotation(degrees(normalizeRotation(entry.rotation)));
      out.addPage(copiedPage);
      copied.push(copiedPage);
    }

    const fonts = {
      regular: await out.embedFont(StandardFonts.Helvetica),
      bold: await out.embedFont(StandardFonts.HelveticaBold),
    };

    for (const annotation of annotations) {
      const page = copied[annotation.page];
      if (!page) continue;
      const rotation = normalizeRotation(pages[annotation.page].rotation);
      const { width: W, height: H } = page.getSize();

      if (annotation.kind === 'text') {
        const size = Math.min(200, Math.max(4, Number(annotation.size) || 16));
        const color = parseColor(annotation.color, rgb);
        const lines = sanitizeText(annotation.text).split(/\r?\n/);
        lines.forEach((line, i) => {
          if (!line) return;
          const baselineDisplayY = annotation.y + size * 0.85 + i * size * 1.25;
          const pt = toRawPoint({ x: annotation.x, y: baselineDisplayY }, W, H, rotation);
          page.drawText(line, {
            x: pt.x,
            y: pt.y,
            size,
            font: annotation.bold ? fonts.bold : fonts.regular,
            color,
            rotate: degrees(rotation),
          });
        });
      } else if (annotation.kind === 'image' && annotation.image) {
        const img = await embedImage(out, annotation.image);
        const c1 = toRawPoint({ x: annotation.x, y: annotation.y }, W, H, rotation);
        const c2 = toRawPoint(
          { x: annotation.x + Number(annotation.w || 0), y: annotation.y + Number(annotation.h || 0) },
          W,
          H,
          rotation
        );
        const x0 = Math.min(c1.x, c2.x);
        const x1 = Math.max(c1.x, c2.x);
        const y0 = Math.min(c1.y, c2.y);
        const y1 = Math.max(c1.y, c2.y);

        let anchor;
        let drawW;
        let drawH;
        if (rotation === 90) {
          anchor = { x: x1, y: y0 };
          drawW = y1 - y0;
          drawH = x1 - x0;
        } else if (rotation === 180) {
          anchor = { x: x1, y: y1 };
          drawW = x1 - x0;
          drawH = y1 - y0;
        } else if (rotation === 270) {
          anchor = { x: x0, y: y1 };
          drawW = y1 - y0;
          drawH = x1 - x0;
        } else {
          anchor = { x: x0, y: y0 };
          drawW = x1 - x0;
          drawH = y1 - y0;
        }

        page.drawImage(img, {
          x: anchor.x,
          y: anchor.y,
          width: drawW,
          height: drawH,
          rotate: degrees(rotation),
        });
      }
    }

    return await out.save();
  }

  return {
    buildPdf,
    normalizeRotation,
    sanitizeText,
    parseColor,
    toRawPoint,
    dataUrlToBytes,
  };
});
