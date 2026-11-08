/* ============================================================
   app.js — Interfaz, interacción e historial
   ============================================================ */

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // Refs
  const uploadScreen = $('#uploadScreen');
  const editorScreen = $('#editorScreen');
  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');
  const imageInput = $('#imageInput');

  const pdfCanvas = $('#pdfCanvas');
  const overlayLayer = $('#overlayLayer');

  const pageInfo = $('#pageInfo');
  const prevBtn = $('#prevPage');
  const nextBtn = $('#nextPage');

  const btnDownload = $('#btnDownload');
  const btnReset = $('#btnReset');
  const btnUndo = $('#btnUndo');
  const btnRedo = $('#btnRedo');

  const imageControls = $('#imageControls');
  const opacityRange = $('#opacityRange');
  const opacityVal = $('#opacityVal');
  const deleteImageBtn = $('#deleteImage');
  const resetRotationBtn = $('#resetRotation');
  const flipImageBtn = $('#flipImage');
  const duplicateImageBtn = $('#duplicateImage');
  const bringForwardBtn = $('#bringForward');
  const sendBackwardBtn = $('#sendBackward');
  const filterButtons = document.querySelectorAll('[data-filter]');
  const zoomIn = $('#zoomIn');
  const zoomOut = $('#zoomOut');
  const zoomVal = $('#zoomVal');
  const toastEl = $('#toast');

  // Crop modal
  const cropModal = $('#cropModal');
  const cropContainer = $('#cropContainer');
  const cropImage = $('#cropImage');
  const cropSelection = $('#cropSelection');
  const cropCancel = $('#cropCancel');
  const cropSkip = $('#cropSkip');
  const cropConfirm = $('#cropConfirm');

  // Estado
  let images = [];     
  let selected = null;
  let pageMetrics = null;
  let baseZoom = 1.0;

  // Historial
  let history = [];
  let historyIndex = -1;

  // Crop state
  let pendingImageDataUrl = null;
  let cropRect = null;

  // ============================================================
  //  UTILIDADES
  // ============================================================
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function showToast(msg) {
    clearTimeout(showToast._t);
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  // ============================================================
  //  HISTORIAL (undo/redo)
  // ============================================================
  function snapshot() {
    const state = images.map((im) => ({
      pageIndex: im.pageIndex,
      dataUrlOriginal: im.dataUrlOriginal,
      dataUrl: im.dataUrl,
      xFrac: im.xFrac,
      yFrac: im.yFrac,
      wFrac: im.wFrac,
      hFrac: im.hFrac,
      rotation: im.rotation,
      opacity: im.opacity,
      filter: im.filter
    }));
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.stringify(state));
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function restoreHistory() {
    if (historyIndex < 0 || historyIndex >= history.length) return;
    const state = JSON.parse(history[historyIndex]);
    overlayLayer.innerHTML = '';
    images = [];
    selected = null;
    imageControls.hidden = true;
    state.forEach((s) => {
      const el = createFloatingImage(s);
      s.el = el;
      images.push(s);
    });
    redrawAllImages();
  }

  function undo() {
    if (historyIndex > 0) {
      historyIndex--;
      restoreHistory();
      updateHistoryButtons();
    }
  }
  function redo() {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      restoreHistory();
      updateHistoryButtons();
    }
  }
  function updateHistoryButtons() {
    btnUndo.disabled = historyIndex <= 0;
    btnRedo.disabled = historyIndex >= history.length - 1;
  }

  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);

  // ============================================================
  //  UPLOAD
  // ============================================================
  dropZone.addEventListener('click', (e) => {
    if (e.target.closest('label')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); })
  );
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handleFile(file);
  });

  async function handleFile(file) {
    if (file.type !== 'application/pdf') {
      showToast('Selecciona un archivo PDF válido.');
      return;
    }
    showToast('Cargando PDF...');
    try {
      const { totalPages } = await PDFEditor.load(file);
      images = [];
      history = [];
      historyIndex = -1;
      baseZoom = 1.0;
      uploadScreen.classList.add('hidden');
      editorScreen.classList.remove('hidden');
      btnDownload.disabled = false;
      btnReset.disabled = false;
      await renderCurrentPage();
      updatePageInfo();
      snapshot();  
      showToast(`PDF cargado · ${totalPages} página(s)`);
    } catch (err) {
      console.error(err);
      showToast('Error al cargar el PDF.');
    }
  }

  // ============================================================
  //  RENDER
  // ============================================================
  async function renderCurrentPage() {
    if (!PDFEditor.isLoaded()) return;
    PDFEditor.setScale(baseZoom);
    pageMetrics = await PDFEditor.renderPage(pdfCanvas, PDFEditor.getPage());
    redrawAllImages();
  }

  function redrawAllImages() {
    overlayLayer.innerHTML = '';
    const pageIdx = PDFEditor.getPage() - 1;
    images
      .filter((im) => im.pageIndex === pageIdx)
      .forEach((im) => {
        overlayLayer.appendChild(im.el);
        updateElPosition(im);
      });
    if (selected && images.includes(selected) && selected.pageIndex === pageIdx) {
      selected.el.classList.add('selected');
      imageControls.hidden = false;
    } else {
      selected = null;
      imageControls.hidden = true;
    }
  }

  function updateElPosition(im) {
    if (!pageMetrics) return;
    im.el.style.left = (im.xFrac * pageMetrics.width) + 'px';
    im.el.style.top  = (im.yFrac * pageMetrics.height) + 'px';
    im.el.style.width  = (im.wFrac * pageMetrics.width) + 'px';
    im.el.style.height = (im.hFrac * pageMetrics.height) + 'px';
  }

  function updatePageInfo() {
    pageInfo.textContent = `${PDFEditor.getPage()} / ${PDFEditor.getTotalPages()}`;
    prevBtn.disabled = PDFEditor.getPage() <= 1;
    nextBtn.disabled = PDFEditor.getPage() >= PDFEditor.getTotalPages();
  }

  // ============================================================
  //  NAV / ZOOM
  // ============================================================
  prevBtn.addEventListener('click', async () => {
    if (PDFEditor.getPage() > 1) {
      PDFEditor.setPage(PDFEditor.getPage() - 1);
      await renderCurrentPage();
      updatePageInfo();
    }
  });
  nextBtn.addEventListener('click', async () => {
    if (PDFEditor.getPage() < PDFEditor.getTotalPages()) {
      PDFEditor.setPage(PDFEditor.getPage() + 1);
      await renderCurrentPage();
      updatePageInfo();
    }
  });

  zoomIn.addEventListener('click', () => {
    baseZoom = Math.min(3, +(baseZoom + 0.15).toFixed(2));
    zoomVal.textContent = Math.round(baseZoom * 100) + '%';
    renderCurrentPage();
  });
  zoomOut.addEventListener('click', () => {
    baseZoom = Math.max(0.3, +(baseZoom - 0.15).toFixed(2));
    zoomVal.textContent = Math.round(baseZoom * 100) + '%';
    renderCurrentPage();
  });

  // ============================================================
  //  AÑADIR IMAGEN (con modal de recorte)
  // ============================================================
  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => openCropModal(reader.result);
    reader.readAsDataURL(file);
    imageInput.value = '';
  });

  function openCropModal(dataUrl) {
    pendingImageDataUrl = dataUrl;
    cropImage.src = dataUrl;
    cropSelection.classList.add('hidden');
    cropRect = null;
    cropConfirm.disabled = true;
    cropModal.classList.remove('hidden');
  }

  function closeCropModal() {
    cropModal.classList.add('hidden');
    pendingImageDataUrl = null;
    cropRect = null;
  }

  cropCancel.addEventListener('click', closeCropModal);

  cropSkip.addEventListener('click', async () => {
    const dataUrl = pendingImageDataUrl;
    closeCropModal();
    await placeImage(dataUrl);
  });

  cropConfirm.addEventListener('click', async () => {
    if (!cropRect || !pendingImageDataUrl) return;
    const cropped = await cropImageToDataUrl(pendingImageDataUrl, cropRect);
    closeCropModal();
    await placeImage(cropped);
  });

  let cropDragStart = null;
  cropContainer.addEventListener('pointerdown', (e) => {
    const rect = cropContainer.getBoundingClientRect();
    cropDragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    cropSelection.classList.add('hidden');
    cropRect = null;
    cropConfirm.disabled = true;
    cropContainer.setPointerCapture(e.pointerId);
  });
  cropContainer.addEventListener('pointermove', (e) => {
    if (!cropDragStart) return;
    const rect = cropContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(cropDragStart.x, x);
    const top = Math.min(cropDragStart.y, y);
    const w = Math.abs(x - cropDragStart.x);
    const h = Math.abs(y - cropDragStart.y);
    if (w < 5 || h < 5) {
      cropSelection.classList.add('hidden');
      return;
    }
    cropSelection.style.left = left + 'px';
    cropSelection.style.top = top + 'px';
    cropSelection.style.width = w + 'px';
    cropSelection.style.height = h + 'px';
    cropSelection.classList.remove('hidden');
    cropRect = { x: left, y: top, w, h };
    cropConfirm.disabled = false;
  });
  cropContainer.addEventListener('pointerup', () => { cropDragStart = null; });

  function cropImageToDataUrl(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const contRect = cropContainer.getBoundingClientRect();
        const scaleX = img.naturalWidth / contRect.width;
        const scaleY = img.naturalHeight / contRect.height;
        const sx = rect.x * scaleX;
        const sy = rect.y * scaleY;
        const sw = rect.w * scaleX;
        const sh = rect.h * scaleY;
        const c = document.createElement('canvas');
        c.width = Math.round(sw);
        c.height = Math.round(sh);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function placeImage(dataUrl) {
    if (!pageMetrics) return;
    const img = new Image();
    img.src = dataUrl;
    await new Promise((r) => (img.onload = r));

    const maxWFrac = 0.3;
    const ratioPx = img.height / img.width;  
    const wFrac = maxWFrac;
    const hFrac = (wFrac * pageMetrics.width * ratioPx) / pageMetrics.height;

    const state = {
      pageIndex: PDFEditor.getPage() - 1,
      dataUrlOriginal: dataUrl,
      dataUrl,
      xFrac: (1 - wFrac) / 2,
      yFrac: (1 - hFrac) / 2,
      wFrac,
      hFrac,
      rotation: 0,
      opacity: 1,
      filter: 'none'
    };
    const el = createFloatingImage(state);
    state.el = el;
    images.push(state);
    overlayLayer.appendChild(el);
    updateElPosition(state);
    selectImage(state);
    snapshot();
    showToast('Imagen añadida. Muévela o redimensiónala.');
  }

  // ============================================================
  //  CREAR ELEMENTO FLOTANTE (drag / resize / rotate)
  // ============================================================
  function createFloatingImage(state) {
    const el = document.createElement('div');
    el.className = 'floating-image';
    el.style.opacity = state.opacity;
    el.style.transform = `rotate(${state.rotation}deg)`;

    const inner = document.createElement('img');
    inner.src = state.dataUrl;
    inner.draggable = false;
    el.appendChild(inner);

    // Tooltip para el ángulo de rotación
    const tooltip = document.createElement('div');
    tooltip.className = 'rot-tooltip';
    tooltip.textContent = state.rotation + '°';
    el.appendChild(tooltip);

    const tl = document.createElement('div'); tl.className = 'handle tl';
    const br = document.createElement('div'); br.className = 'handle br';
    const rot = document.createElement('div'); rot.className = 'handle rotate';
    el.append(tl, br, rot);

    // DRAG
    let dragging = false, startX, startY, startXFrac, startYFrac;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('handle')) return;
      selectImage(state);
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startXFrac = state.xFrac;
      startYFrac = state.yFrac;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging || !pageMetrics) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      state.xFrac = clamp(startXFrac + dx / pageMetrics.width, 0, 1 - state.wFrac);
      state.yFrac = clamp(startYFrac + dy / pageMetrics.height, 0, 1 - state.hFrac);
      updateElPosition(state);
    });
    el.addEventListener('pointerup', () => {
      if (dragging) snapshot();
      dragging = false;
    });

    // RESIZE (Bottom-Right)
    let resizingBR = false, brStartX, brStartY, brStartWFrac, brStartHFrac;
    br.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selectImage(state);
      resizingBR = true;
      brStartX = e.clientX;
      brStartY = e.clientY;
      brStartWFrac = state.wFrac;
      brStartHFrac = state.hFrac;
      br.setPointerCapture(e.pointerId);
    });
    br.addEventListener('pointermove', (e) => {
      if (!resizingBR || !pageMetrics) return;
      const dx = e.clientX - brStartX;
      const ratioPx = (brStartHFrac * pageMetrics.height) / (brStartWFrac * pageMetrics.width);
      const startWPx = brStartWFrac * pageMetrics.width;
      const newWPx = clamp(startWPx + dx, 20, pageMetrics.width - state.xFrac * pageMetrics.width);
      const newHPx = newWPx * ratioPx;
      if (state.yFrac * pageMetrics.height + newHPx > pageMetrics.height) return;
      state.wFrac = newWPx / pageMetrics.width;
      state.hFrac = newHPx / pageMetrics.height;
      updateElPosition(state);
    });
    br.addEventListener('pointerup', () => {
      if (resizingBR) snapshot();
      resizingBR = false;
    });

    // RESIZE (Top-Left)
    let resizingTL = false, tlStartX, tlStartY, tlStartXFrac, tlStartYFrac, tlStartWPx, tlStartHPx;
    tl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selectImage(state);
      resizingTL = true;
      tlStartX = e.clientX;
      tlStartY = e.clientY;
      tlStartXFrac = state.xFrac;
      tlStartYFrac = state.yFrac;
      tlStartWPx = state.wFrac * pageMetrics.width;
      tlStartHPx = state.hFrac * pageMetrics.height;
      tl.setPointerCapture(e.pointerId);
    });
    tl.addEventListener('pointermove', (e) => {
      if (!resizingTL || !pageMetrics) return;
      const dx = e.clientX - tlStartX;
      const ratioPx = tlStartHPx / tlStartWPx;
      
      const newWPx = clamp(tlStartWPx - dx, 20, pageMetrics.width);
      const newHPx = newWPx * ratioPx;

      state.xFrac = clamp(tlStartXFrac + (tlStartWPx - newWPx) / pageMetrics.width, 0, 1);
      state.yFrac = clamp(tlStartYFrac + (tlStartHPx - newHPx) / pageMetrics.height, 0, 1);
      state.wFrac = newWPx / pageMetrics.width;
      state.hFrac = newHPx / pageMetrics.height;
      
      updateElPosition(state);
    });
    tl.addEventListener('pointerup', () => {
      if (resizingTL) snapshot();
      resizingTL = false;
    });

    // ROTATE
    let rotating = false, rotStartAngle, rotStartRotation, cx, cy;
    rot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selectImage(state);
      rotating = true;
      el.classList.add('rotating');
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      rotStartAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
      rotStartRotation = state.rotation;
      rot.setPointerCapture(e.pointerId);
    });
    rot.addEventListener('pointermove', (e) => {
      if (!rotating) return;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
      let deg = rotStartRotation + ((angle - rotStartAngle) * 180) / Math.PI;
      state.rotation = Math.round(deg);
      el.style.transform = `rotate(${state.rotation}deg)`;
      tooltip.textContent = state.rotation + '°';
    });
    rot.addEventListener('pointerup', () => {
      if (rotating) snapshot();
      rotating = false;
      el.classList.remove('rotating');
    });

    // DOBLE CLIC PARA RESTABLECER ROTACIÓN
    el.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('handle')) return;
      state.rotation = 0;
      el.style.transform = `rotate(0deg)`;
      tooltip.textContent = '0°';
      snapshot();
      showToast('Rotación restablecida a 0°.');
    });

    return el;
  }

  // ============================================================
  //  SELECCIÓN
  // ============================================================
  function selectImage(state) {
    if (selected && selected.el) selected.el.classList.remove('selected');
    selected = state;
    if (state) {
      state.el.classList.add('selected');
      imageControls.hidden = false;
      syncControls();
    } else {
      imageControls.hidden = true;
    }
  }

  function syncControls() {
    if (!selected) return;
    opacityRange.value = Math.round(selected.opacity * 100);
    opacityVal.textContent = Math.round(selected.opacity * 100) + '%';
    filterButtons.forEach((b) =>
      b.classList.toggle('active', b.dataset.filter === selected.filter)
    );
  }

  pdfCanvas.addEventListener('pointerdown', () => {
    if (selected) {
      selected.el.classList.remove('selected');
      selected = null;
      imageControls.hidden = true;
    }
  });

  // ============================================================
  //  ACCIONES SOBRE IMAGEN
  // ============================================================
  opacityRange.addEventListener('input', () => {
    if (!selected) return;
    selected.opacity = +opacityRange.value / 100;
    selected.el.style.opacity = selected.opacity;
    opacityVal.textContent = opacityRange.value + '%';
  });
  opacityRange.addEventListener('change', () => { if (selected) snapshot(); });

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!selected) return;
      const f = btn.dataset.filter;
      selected.filter = f;
      filterButtons.forEach((b) => b.classList.toggle('active', b === btn));
      const newUrl = await PDFEditor.applyFilterToImage(selected.dataUrlOriginal, f);
      selected.dataUrl = newUrl;
      selected.el.querySelector('img').src = newUrl;
      snapshot();
    });
  });

  resetRotationBtn.addEventListener('click', () => {
    if (!selected) return;
    selected.rotation = 0;
    selected.el.style.transform = `rotate(0deg)`;
    const tooltip = selected.el.querySelector('.rot-tooltip');
    if (tooltip) tooltip.textContent = '0°';
    snapshot();
    showToast('Rotación restablecida a 0°.');
  });

  flipImageBtn.addEventListener('click', async () => {
    if (!selected) return;
    const img = new Image();
    img.src = selected.dataUrl;
    await new Promise((r) => (img.onload = r));
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    selected.dataUrl = c.toDataURL('image/png');
    selected.dataUrlOriginal = selected.dataUrl; 
    selected.el.querySelector('img').src = selected.dataUrl;
    snapshot();
    showToast('Imagen volteada.');
  });

  duplicateImageBtn.addEventListener('click', () => {
    if (!selected) return;
    const s = selected;
    const newState = {
      pageIndex: s.pageIndex,
      dataUrlOriginal: s.dataUrlOriginal,
      dataUrl: s.dataUrl,
      xFrac: clamp(s.xFrac + 0.02, 0, 1 - s.wFrac),
      yFrac: clamp(s.yFrac + 0.02, 0, 1 - s.hFrac),
      wFrac: s.wFrac,
      hFrac: s.hFrac,
      rotation: s.rotation,
      opacity: s.opacity,
      filter: s.filter
    };
    const el = createFloatingImage(newState);
    newState.el = el;
    images.push(newState);
    overlayLayer.appendChild(el);
    updateElPosition(newState);
    selectImage(newState);
    snapshot();
    showToast('Imagen duplicada.');
  });

  bringForwardBtn.addEventListener('click', () => {
    if (!selected) return;
    const idx = images.indexOf(selected);
    if (idx < 0) return;
    images.splice(idx, 1);
    images.push(selected);
    redrawAllImages();
    selectImage(selected);
    snapshot();
  });
  sendBackwardBtn.addEventListener('click', () => {
    if (!selected) return;
    const idx = images.indexOf(selected);
    if (idx < 0) return;
    images.splice(idx, 1);
    images.unshift(selected);
    redrawAllImages();
    selectImage(selected);
    snapshot();
  });

  deleteImageBtn.addEventListener('click', () => {
    if (!selected) return;
    selected.el.remove();
    images = images.filter((im) => im !== selected);
    selected = null;
    imageControls.hidden = true;
    snapshot();
    showToast('Imagen eliminada.');
  });

  // ============================================================
  //  ATAJOS DE TECLADO
  // ============================================================
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea';

    if ((e.ctrlKey || e.metaKey) && !typing) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (e.key === 'd' && selected) {
        e.preventDefault();
        duplicateImageBtn.click();
        return;
      }
    }
    if (!selected || typing) return;

    if (e.key === 'Escape') {
      selected.el.classList.remove('selected');
      selected = null;
      imageControls.hidden = true;
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteImageBtn.click();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && pageMetrics) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) / pageMetrics.width;
      const dy = (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) / pageMetrics.height;
      selected.xFrac = clamp(selected.xFrac + dx, 0, 1 - selected.wFrac);
      selected.yFrac = clamp(selected.yFrac + dy, 0, 1 - selected.hFrac);
      updateElPosition(selected);
      clearTimeout(document._nudgeT);
      document._nudgeT = setTimeout(() => snapshot(), 400);
    }
  });

  // ============================================================
  //  EXPORTAR PDF
  // ============================================================
  btnDownload.addEventListener('click', async () => {
    if (images.length === 0) {
      showToast('Añade al menos una imagen antes de exportar.');
      return;
    }
    btnDownload.disabled = true;
    const originalHTML = btnDownload.innerHTML;
    btnDownload.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Generando...</span>';
    try {
      const blob = await PDFEditor.exportPDF(images);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `documento-editado-${ts}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('¡PDF exportado con éxito!');
    } catch (err) {
      console.error(err);
      showToast('Error al exportar. Inténtalo de nuevo.');
    } finally {
      btnDownload.disabled = false;
      btnDownload.innerHTML = originalHTML;
    }
  });

  btnReset.addEventListener('click', () => {
    if (!confirm('¿Cerrar el documento actual? Se perderán los cambios no descargados.')) return;
    location.reload();
  });
})();