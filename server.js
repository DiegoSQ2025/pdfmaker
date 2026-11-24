'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const pdfLib = require('pdf-lib');
const core = require('./shared/export-core');

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(express.static(__dirname));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/export', upload.array('files'), async (req, res) => {
  try {
    const spec = JSON.parse(req.body.spec || '{}');
    const bytes = await core.buildPdf(pdfLib, spec, req.files.map((f) => f.buffer));

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
