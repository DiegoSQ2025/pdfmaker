'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
});

const COLORS = {
  nero: rgb(0, 0, 0),
  bianco: rgb(1, 1, 1),
  rosso: rgb(0.86, 0.11, 0.15),
  verde: rgb(0.13, 0.55, 0.13),
  blu: rgb(0.1, 0.22, 0.75),
};

function parseColor(value) {
  if (value && COLORS[value]) return COLORS[value];
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    const n = parseInt(value.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  return COLORS.nero;
}

const WINANSI_FIXES = {
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '–': '-',
  '—': '-',
  '…': '...',
  '\u00a0': ' ',
};

function sanitizeText(text) {
  return String(text || '')
    .replace(/[“”‘’–—…\u00a0]/g, (ch) => WINANSI_FIXES[ch])
    .replace(/[^\u0000-\u00ff]/g, '?');
}

function normalizeRotation(rot) {
  return ((Math.round(rot || 0) % 360) + 360) % 360;
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

async function embedImage(out, dataUrl) {
  const data = Buffer.from(String(dataUrl).split(',').pop() || '', 'base64');
  if (String(dataUrl).indexOf('data:image/png') === 0) return out.embedPng(data);
  return out.embedJpg(data);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/export', upload.array('files'), async (req, res) => {
  try {
    const spec = JSON.parse(req.body.spec || '{}');
    const pages = Array.isArray(spec.pages) ? spec.pages : [];
    const annotations = Array.isArray(spec.annotations) ? spec.annotations : [];

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nessun PDF caricato' });
    }
    if (pages.length === 0) {
      return res.status(400).json({ error: 'Nessuna pagina selezionata' });
    }

    const docs = [];
    for (const file of req.files) {
      docs.push(await PDFDocument.load(file.buffer, { ignoreEncryption: true }));
    }

    const out = await PDFDocument.create();
    out.setTitle('PDFMaker');

    const copied = [];
    for (const entry of pages) {
      const src = docs[entry.file];
      if (!src || entry.page == null || entry.page < 0 || entry.page >= src.getPageCount()) {
        return res.status(400).json({ error: 'Riferimento pagina non valido' });
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
        const color = parseColor(annotation.color);
        const lines = sanitizeText(annotation.text).split(/\r?\n/);
        lines.forEach((line, i) => {
          const baselineDisplayY = annotation.y + size * 0.85 + i * size * 1.25;
          const pt = toRawPoint({ x: annotation.x, y: baselineDisplayY }, W, H, rotation);
          if (!line) return;
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

    const bytes = await out.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="pdfmaker.pdf"');
    res.send(Buffer.from(bytes));
  } catch (err) {
    console.error('[export] errore:', err.message);
    res.status(500).json({ error: 'Elaborazione PDF non riuscita: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PDFMaker in ascolto su http://localhost:${PORT}`);
});
