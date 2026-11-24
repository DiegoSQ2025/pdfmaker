'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const pdfLib = require('pdf-lib');
const core = require('./shared/export-core');

const MAX_FILES = 20;
const MAX_PAGES = 2000;
const MAX_ANNOTATIONS = 1000;
const MAX_TEXT_LENGTH = 5000;
const MAX_IMAGE_DATA_LENGTH = 8 * 1024 * 1024;
const IMAGE_TYPES = ['data:image/png;base64,', 'data:image/jpeg;base64,'];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

class ValidationError extends Error {}

function expectInt(value, field, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new ValidationError(`Campo ${field} non valido`);
  }
  return expectNumber(n, field, min, max);
}

function expectNumber(value, field, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`Campo ${field} non valido`);
  }
  if (n < min) {
    throw new ValidationError(`Campo ${field} sotto il minimo`);
  }
  if (n > max) {
    throw new ValidationError(`Campo ${field} oltre il massimo`);
  }
  return n;
}

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new ValidationError('Spec non valida');
  }
  if (!Array.isArray(spec.pages)) {
    throw new ValidationError('Campo pages mancante o non valido');
  }
  if (spec.pages.length === 0) {
    throw new ValidationError('Nessuna pagina selezionata');
  }
  if (spec.pages.length > MAX_PAGES) {
    throw new ValidationError('Troppe pagine richieste');
  }

  spec.pages.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new ValidationError(`Pagina ${i} non valida`);
    }
    expectInt(entry.file, `pages[${i}].file`, 0, 1000);
    expectInt(entry.page, `pages[${i}].page`, 0, 100000);
    expectInt(entry.rotation, `pages[${i}].rotation`, 0, 359);
  });

  if (spec.annotations === undefined) {
    spec.annotations = [];
  }
  if (!Array.isArray(spec.annotations)) {
    throw new ValidationError('Campo annotations non valido');
  }
  if (spec.annotations.length > MAX_ANNOTATIONS) {
    throw new ValidationError('Troppe annotazioni');
  }

  spec.annotations.forEach((annotation, i) => {
    if (!annotation || typeof annotation !== 'object') {
      throw new ValidationError(`Annotazione ${i} non valida`);
    }
    expectInt(annotation.page, `annotations[${i}].page`, 0, spec.pages.length);

    if (annotation.kind === 'text') {
      expectNumber(annotation.size, `annotations[${i}].size`, 4, 200);
      expectNumber(annotation.x, `annotations[${i}].x`, 0, 100000);
      expectNumber(annotation.y, `annotations[${i}].y`, 0, 100000);
      if (typeof annotation.text !== 'string' || annotation.text.length === 0) {
        throw new ValidationError(`Annotazione ${i}: testo mancante`);
      }
      if (annotation.text.length > MAX_TEXT_LENGTH) {
        throw new ValidationError(`Annotazione ${i}: testo troppo lungo (max ${MAX_TEXT_LENGTH} caratteri)`);
      }
      if (typeof annotation.color !== 'undefined' && typeof annotation.color !== 'string') {
        throw new ValidationError(`Annotazione ${i}: colore non valido`);
      }
    } else if (annotation.kind === 'image') {
      expectNumber(annotation.x, `annotations[${i}].x`, 0, 100000);
      expectNumber(annotation.y, `annotations[${i}].y`, 0, 100000);
      expectNumber(annotation.w, `annotations[${i}].w`, 1, 5000);
      expectNumber(annotation.h, `annotations[${i}].h`, 1, 5000);
      if (typeof annotation.image !== 'string') {
        throw new ValidationError(`Annotazione ${i}: immagine mancante`);
      }
      if (annotation.image.length > MAX_IMAGE_DATA_LENGTH) {
        throw new ValidationError(`Annotazione ${i}: immagine troppo grande`);
      }
      if (!IMAGE_TYPES.some((prefix) => annotation.image.indexOf(prefix) === 0)) {
        throw new ValidationError(`Annotazione ${i}: formato immagine non supportato (PNG o JPEG)`);
      }
    } else {
      throw new ValidationError(`Annotazione ${i}: tipo non valido`);
    }
  });

  return spec;
}

const app = express();
Object.entries(SECURITY_HEADERS).forEach(([header, value]) => {
  app.use((req, res, next) => {
    res.setHeader(header, value);
    next();
  });
});
app.use(express.json({ limit: '30mb' }));
app.use(express.static(__dirname));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: MAX_FILES },
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/export', upload.array('files'), async (req, res) => {
  try {
    let spec;
    try {
      spec = JSON.parse(req.body.spec || '{}');
    } catch (err) {
      throw new ValidationError('Spec JSON non leggibile');
    }
    validateSpec(spec);

    const bytes = await core.buildPdf(pdfLib, spec, req.files.map((f) => f.buffer));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="pdfmaker.pdf"');
    res.send(Buffer.from(bytes));
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('[export] errore:', err.message);
      res.status(500).json({ error: 'Elaborazione PDF non riuscita' });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PDFMaker in ascolto su http://localhost:${PORT}`);
});
