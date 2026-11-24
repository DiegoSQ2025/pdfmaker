'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const state = {
  files: [],
  layout: [],
  tool: 'select',
  pendingImage: null,
  selectedAnnotation: null,
  busy: false,
};

const toolsMeta = {
  select: { cls: 'tool-select', cursor: 'move' },
  text: { cls: 'tool-text', cursor: 'text' },
  image: { cls: 'tool-image', cursor: 'copy' },
};

const els = {
  pdfInput: document.getElementById('pdfInput'),
  imageInput: document.getElementById('imageInput'),
  addPdfBtn: document.getElementById('addPdfBtn'),
  dropzone: document.getElementById('dropzone'),
  dropzoneBtn: document.getElementById('dropzoneBtn'),
  pagesGrid: document.getElementById('pagesGrid'),
  exportBtn: document.getElementById('exportBtn'),
  status: document.getElementById('status'),
  textModal: document.getElementById('textModal'),
  textValue: document.getElementById('textValue'),
  textSize: document.getElementById('textSize'),
  textColor: document.getElementById('textColor'),
  textBold: document.getElementById('textBold'),
  textConfirm: document.getElementById('textConfirm'),
  textCancel: document.getElementById('textCancel'),
  toast: document.getElementById('toast'),
  workspace: document.getElementById('workspace'),
};

function showToast(message, isError) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', Boolean(isError));
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function setStatus(text) {
  els.status.textContent = text;
}

function updateToolUi() {
  document.querySelectorAll('.btn.tool').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === state.tool);
  });
  document.querySelectorAll('.page-card').forEach((card) => {
    card.classList.remove('tool-select', 'tool-text', 'tool-image');
    card.classList.add(toolsMeta[state.tool].cls);
  });
}

function normalizeAngle(angle) {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

async function getDisplaySize(entry) {
  const pdfPage = await state.files[entry.file].pdfDoc.getPage(entry.page + 1);
  const viewport = pdfPage.getViewport({ scale: 1, rotation: normalizeAngle(entry.rot) });
  return { width: viewport.width, height: viewport.height };
}

async function handlePdfFiles(fileList) {
  const pdfFiles = Array.from(fileList).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdfFiles.length === 0) {
    showToast('Seleziona almeno un file PDF', true);
    return;
  }

  setStatus('Caricamento in corso…');
  try {
    for (const file of pdfFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

      const fileEntry = { name: file.name, bytes, pdfDoc, pages: [] };
      for (let i = 0; i < pdfDoc.numPages; i += 1) {
        const pdfPage = await pdfDoc.getPage(i + 1);
        fileEntry.pages.push({ intrinsicRotation: normalizeAngle(pdfPage.rotate) });
        state.layout.push({
          file: state.files.length,
          page: i,
          rot: normalizeAngle(pdfPage.rotate),
          annotations: [],
        });
      }
      state.files.push(fileEntry);
    }

    els.dropzone.hidden = true;
    els.pagesGrid.hidden = false;
    updateToolUi();
    await renderAll();
    setStatus(`${state.layout.length} pagine · ${state.files.length} file`);
  } catch (err) {
    console.error(err);
    showToast('Impossibile leggere uno dei PDF', true);
    setStatus('');
  }
}

async function renderPageCard(entry, index) {
  const file = state.files[entry.file];
  const pdfPage = await file.pdfDoc.getPage(entry.page + 1);
  const rotation = normalizeAngle(entry.rot);
  const display = pdfPage.getViewport({ scale: 1, rotation });
  const aspect = display.height / display.width;

  const cssWidth = Math.min(240, Math.max(150, 240 * (display.width / 700)));
  const scale = cssWidth / display.width;
  const viewport = pdfPage.getViewport({ scale, rotation });

  const card = document.createElement('div');
  card.className = `page-card ${toolsMeta[state.tool].cls}`;
  card.draggable = state.tool === 'select' && state.selectedAnnotation === null;
  card.dataset.index = index;

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'page-thumb-wrap';
  thumbWrap.style.width = `${cssWidth}px`;
  thumbWrap.style.height = `${Math.round(cssWidth * aspect)}px`;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  thumbWrap.appendChild(canvas);

  const overlay = document.createElement('div');
  overlay.className = 'page-overlay';
  overlay.title = 'Clicca per posizionare';
  overlay.addEventListener('click', (event) => handlePlacementClick(event, index, scale));
  thumbWrap.appendChild(overlay);

  entry.annotations.forEach((annotation, annotationIndex) => {
    overlay.appendChild(buildAnnotationElement(annotation, annotationIndex, index, scale));
  });

  const renderTask = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport });
  renderTask.catch((err) => {
    if (err && err.name !== 'RenderingCancelledException') console.error(err);
  });

  const meta = document.createElement('div');
  meta.className = 'page-meta';

  const label = document.createElement('span');
  label.className = 'page-label';
  label.innerHTML = `<strong>${escapeHtml(file.name)}</strong><br />p. ${entry.page + 1}`;
  meta.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'page-actions';

  const rotateBtn = document.createElement('button');
  rotateBtn.className = 'icon-btn';
  rotateBtn.textContent = '⟳';
  rotateBtn.title = 'Ruota di 90°';
  rotateBtn.addEventListener('click', () => rotateEntry(index));
  actions.appendChild(rotateBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn danger';
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Elimina pagina';
  deleteBtn.addEventListener('click', () => deleteEntry(index));
  actions.appendChild(deleteBtn);

  meta.appendChild(actions);

  card.appendChild(thumbWrap);
  card.appendChild(meta);

  card.addEventListener('dragstart', (event) => {
    card.classList.add('dragging');
    event.dataTransfer.setData('text/plain', String(index));
    event.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!card.classList.contains('dragging')) card.classList.add('dragover');
  });
  card.addEventListener('dragleave', () => card.classList.remove('dragover'));
  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('dragover');
    const from = Number(event.dataTransfer.getData('text/plain'));
    const to = index;
    if (Number.isNaN(from) || from === to) return;
    const moved = state.layout.splice(from, 1)[0];
    state.layout.splice(to, 0, moved);
    renderAll();
  });

  return card;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function buildAnnotationElement(annotation, annotationIndex, pageIndex, scale) {
  const element = document.createElement('div');
  element.className = 'annotation';
  element.dataset.page = pageIndex;
  element.dataset.annotation = annotationIndex;
  element.style.left = `${annotation.x * scale}px`;
  element.style.top = `${annotation.y * scale}px`;

  if (annotation.kind === 'text') {
    element.textContent = annotation.text;
    element.style.fontSize = `${annotation.size * scale}px`;
    element.style.color = annotation.color;
    element.style.fontWeight = annotation.bold ? '700' : '400';
    element.style.fontFamily = 'Helvetica, Arial, sans-serif';
  } else {
    element.style.width = `${annotation.w * scale}px`;
    element.style.height = `${annotation.h * scale}px`;
    if (/^data:image\/(png|jpeg);base64,/.test(annotation.image)) {
      const img = document.createElement('img');
      img.src = annotation.image;
      element.appendChild(img);
    } else {
      element.style.background = 'rgba(219, 27, 38, 0.2)';
    }

    if (state.selectedAnnotation && state.selectedAnnotation.page === pageIndex
      && state.selectedAnnotation.index === annotationIndex) {
      element.classList.add('is-selected');
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      handle.style.position = 'absolute';
      handle.style.right = '-6px';
      handle.style.bottom = '-6px';
      handle.style.width = '12px';
      handle.style.height = '12px';
      handle.style.background = 'var(--accent)';
      handle.style.borderRadius = '3px';
      handle.style.cursor = 'nwse-resize';
      handle.addEventListener('mousedown', (event) => startResize(event, pageIndex, annotationIndex, scale));
      element.appendChild(handle);
    }
  }

  element.addEventListener('click', (event) => event.stopPropagation());
  element.addEventListener('mousedown', (event) =>
    startAnnotationDrag(event, pageIndex, annotationIndex, scale));

  element.addEventListener('dblclick', () => {
    const pageEntry = state.layout[pageIndex];
    const annotationEntry = pageEntry.annotations[annotationIndex];
    if (annotationEntry && annotationEntry.kind === 'text') {
      openTextModal({
        initialText: annotationEntry.text,
        initialSize: annotationEntry.size,
        initialColor: annotationEntry.color,
        initialBold: annotationEntry.bold,
        onConfirm(text, size, color, bold) {
          if (text) {
            annotationEntry.text = text;
            annotationEntry.size = size;
            annotationEntry.color = color;
            annotationEntry.bold = bold;
            renderAll();
          }
        },
      });
    }
  });

  return element;
}

function startAnnotationDrag(event, pageIndex, annotationIndex, scale) {
  event.preventDefault();
  event.stopPropagation();
  if (state.tool !== 'select') return;

  selectAnnotation(pageIndex, annotationIndex);

  const annotation = state.layout[pageIndex].annotations[annotationIndex];
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = annotation.x;
  const originY = annotation.y;
  const overlay = event.target.closest('.page-overlay');

  function onMove(moveEvent) {
    const dx = (moveEvent.clientX - startX) / scale;
    const dy = (moveEvent.clientY - startY) / scale;
    annotation.x = originX + dx;
    annotation.y = originY + dy;
    const el = overlay.querySelector(`[data-annotation="${annotationIndex}"]`);
    if (el) {
      el.style.left = `${Math.max(0, annotation.x) * scale}px`;
      el.style.top = `${Math.max(0, annotation.y) * scale}px`;
    }
  }

  function onUp() {
    annotation.x = Math.max(0, annotation.x);
    annotation.y = Math.max(0, annotation.y);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startResize(event, pageIndex, annotationIndex, scale) {
  event.preventDefault();
  event.stopPropagation();
  const annotation = state.layout[pageIndex].annotations[annotationIndex];
  const aspect = annotation.h / annotation.w;
  const startX = event.clientX;
  const startY = event.clientY;
  const originW = annotation.w;

  function onMove(moveEvent) {
    const dx = (moveEvent.clientX - startX) / scale;
    const dy = (moveEvent.clientY - startY) / scale;
    const delta = (Math.abs(dx) + Math.abs(dy)) / 2;
    annotation.w = Math.max(12, originW + delta);
    annotation.h = annotation.w * aspect;
    renderAll();
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    renderAll();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function selectAnnotation(pageIndex, annotationIndex) {
  state.selectedAnnotation = { page: pageIndex, index: annotationIndex };
  renderAll();
}

function handlePlacementClick(event, pageIndex, scale) {
  event.preventDefault();
  if (state.tool === 'select') return;
  if (state.tool === 'image' && !state.pendingImage) {
    showToast('Scegli prima un\'immagine cliccando su "Immagine"', true);
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / scale;
  const y = (event.clientY - rect.top) / scale;

  if (state.tool === 'text') {
    openTextModal({
      onConfirm(text, size, color, bold) {
        if (!text) return;
        state.layout[pageIndex].annotations.push({
          kind: 'text',
          text,
          x,
          y,
          size,
          color,
          bold,
        });
        setTool('select');
        renderAll();
      },
    });
  } else if (state.tool === 'image') {
    const meta = state.pendingImage;
    const maxW = 200;
    const naturalW = (meta.width * 72) / 96;
    const w = Math.min(naturalW, maxW);
    const h = w * (meta.height / meta.width);
    state.layout[pageIndex].annotations.push({
      kind: 'image',
      x,
      y,
      w,
      h,
      image: meta.dataUrl,
    });
    state.pendingImage = null;
    setTool('select');
    renderAll();
  }
}

function openTextModal(options) {
  const modal = els.textModal;
  modal.hidden = false;
  if (options.initialText !== undefined) {
    els.textValue.value = options.initialText;
    els.textSize.value = options.initialSize;
    els.textColor.value = options.initialColor;
    els.textBold.checked = options.initialBold;
  } else {
    els.textValue.value = '';
  }
  els.textConfirm.disabled = els.textValue.value.trim() === '';
  els.textValue.focus();

  const confirmState = () => {
    els.textConfirm.disabled = els.textValue.value.trim() === '';
  };
  els.textValue.addEventListener('input', confirmState);

  const cleanup = () => {
    modal.hidden = true;
    els.textValue.removeEventListener('input', confirmState);
    els.textConfirm.removeEventListener('click', onConfirm);
    els.textCancel.removeEventListener('click', onCancel);
  };

  function onConfirm() {
    const text = els.textValue.value.trim();
    if (!text) {
      showToast('Scrivi prima il testo da inserire');
      els.textValue.focus();
      return;
    }
    const size = Math.min(96, Math.max(6, Number(els.textSize.value) || 18));
    const color = els.textColor.value;
    const bold = els.textBold.checked;
    cleanup();
    options.onConfirm(text, size, color, bold);
    showToast('Testo inserito: trascinalo per posizionarlo meglio');
  }

  function onCancel() {
    cleanup();
  }

  els.textConfirm.addEventListener('click', onConfirm);
  els.textCancel.addEventListener('click', onCancel);
}

function rotateEntry(index) {
  const entry = state.layout[index];
  getDisplaySize(entry).then((oldDims) => {
    const from = normalizeAngle(entry.rot);
    const to = (from + 90) % 360;
    const delta = (to - from + 360) % 360;
    entry.rot = to;
    entry.annotations = entry.annotations.map((annotation) => transformBox(annotation, oldDims, delta));
    renderAll();
  });
}

function transformBox(annotation, oldDims, delta) {
  const { A, B } = oldDims;
  let w = annotation.w;
  let h = annotation.h;
  const isText = annotation.kind === 'text';
  if (isText) {
    const lines = annotation.text.split(/\r?\n/);
    w = Math.max(...lines.map((line) => line.length), 1) * annotation.size * 0.55;
    h = lines.length * annotation.size * 1.25;
  }
  const { x, y } = annotation;
  let box;
  if (delta === 90) {
    box = { x: B - y - h, y: x, w: h, h: w };
  } else if (delta === 180) {
    box = { x: A - x - w, y: B - y - h, w, h };
  } else {
    box = { x: y, y: A - x - w, w: h, h: w };
  }
  const result = { ...annotation, x: box.x, y: box.y };
  if (!isText) {
    result.w = box.w;
    result.h = box.h;
  }
  return result;
}

function deleteEntry(index) {
  state.layout.splice(index, 1);
  if (state.selectedAnnotation && state.selectedAnnotation.page === index) {
    state.selectedAnnotation = null;
  }
  if (state.layout.length === 0) {
    resetWorkspace();
  }
  renderAll();
  setStatus(`${state.layout.length} pagine · ${state.files.length} file`);
}

function resetWorkspace() {
  state.files = [];
  state.layout = [];
  state.selectedAnnotation = null;
  state.pendingImage = null;
  els.dropzone.hidden = false;
  els.pagesGrid.hidden = true;
  setStatus('');
}

function setTool(tool) {
  state.tool = tool;
  if (tool === 'image' && !state.pendingImage) {
    els.imageInput.click();
  }
  updateToolUi();
  renderAll();
}

async function renderAll() {
  const grid = els.pagesGrid;
  grid.innerHTML = '';
  const cards = await Promise.all(state.layout.map((entry, index) => renderPageCard(entry, index)));
  cards.forEach((card) => grid.appendChild(card));
  updateToolUi();
}

async function exportPdf() {
  if (state.busy) return;
  if (state.layout.length === 0) {
    showToast('Nessuna pagina da esportare', true);
    return;
  }

  state.busy = true;
  els.exportBtn.disabled = true;
  setStatus('Generazione del PDF…');

  try {
    const spec = {
      pages: state.layout.map((entry) => ({
        file: entry.file,
        page: entry.page,
        rotation: normalizeAngle(entry.rot),
      })),
      annotations: [],
    };
    state.layout.forEach((entry, pageIndex) => {
      entry.annotations.forEach((annotation) => {
        spec.annotations.push({ ...annotation, page: pageIndex });
      });
    });

    let blob = null;
    try {
      const formData = new FormData();
      state.files.forEach((file) => {
        formData.append('files', new Blob([file.bytes], { type: 'application/pdf' }), file.name);
      });
      formData.append('spec', JSON.stringify(spec));

      const response = await fetch('/api/export', { method: 'POST', body: formData });
      if (response.ok && (response.headers.get('content-type') || '').includes('application/pdf')) {
        blob = await response.blob();
      }
    } catch (err) {
      console.warn('Backend non disponibile, generazione locale in corso…');
    }

    if (!blob) {
      const bytes = await window.PDFMakerCore.buildPdf(
        window.PDFLib,
        spec,
        state.files.map((file) => file.bytes)
      );
      blob = new Blob([bytes], { type: 'application/pdf' });
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pdfmaker.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setStatus('PDF generato');
    showToast('PDF pronto, download avviato');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Esportazione non riuscita', true);
    setStatus('');
  } finally {
    state.busy = false;
    els.exportBtn.disabled = false;
  }
}

document.querySelectorAll('.btn.tool').forEach((btn) => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

els.addPdfBtn.addEventListener('click', () => els.pdfInput.click());
els.dropzoneBtn.addEventListener('click', () => els.pdfInput.click());
els.pdfInput.addEventListener('change', () => {
  handlePdfFiles(els.pdfInput.files);
  els.pdfInput.value = '';
});
els.imageInput.addEventListener('change', async () => {
  const file = els.imageInput.files[0];
  els.imageInput.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    showToast('Formato immagine non supportato (usa PNG o JPEG)', true);
    return;
  }
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  const meta = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = dataUrl;
  });
  state.pendingImage = { dataUrl, ...meta };
  showToast('Ora clicca su una pagina per inserire l\'immagine');
});

els.exportBtn.addEventListener('click', exportPdf);

['dragover', 'dragenter'].forEach((type) => {
  els.workspace.addEventListener(type, (event) => {
    event.preventDefault();
    if (state.files.length === 0) els.dropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((type) => {
  els.workspace.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('dragover');
    if (type === 'drop' && event.dataTransfer && event.dataTransfer.files.length > 0) {
      handlePdfFiles(event.dataTransfer.files);
    }
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!els.textModal.hidden) {
      els.textModal.hidden = true;
    } else {
      setTool('select');
    }
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedAnnotation
    && document.activeElement.tagName !== 'TEXTAREA'
    && document.activeElement.tagName !== 'INPUT') {
    const { page, index } = state.selectedAnnotation;
    state.layout[page].annotations.splice(index, 1);
    state.selectedAnnotation = null;
    renderAll();
  }
});
