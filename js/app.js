/* ============================================================
   app.js — Lógica principal de la interfaz
   ============================================================ */

(() => {
  'use strict';

  // ---------- Refs DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const uploadScreen = $('#uploadScreen');
  const editorScreen = $('#editorScreen');
  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');
  const imageInput = $('#imageInput');

  const pdfCanvas = $('#pdfCanvas');
  const overlayLayer = $('#overlayLayer');
  const canvasWrapper = $('#canvasWrapper');

  const pageInfo = $('#pageInfo');
  const prevBtn = $('#prevPage');
  const nextBtn = $('#nextPage');

  const btnDownload = $('#btnDownload');
  const btnReset = $('#btnReset');

  const imageControls = $('#imageControls');
  const opacityRange = $('#opacityRange');
  const opacityVal = $('#opacityVal');
  const rotationRange = $('#rotationRange');
  const rotationVal = $('#rotationVal');
  const scaleRange = $('#scaleRange');
  const scaleVal = $('#scaleVal');
  const deleteImageBtn = $('#deleteImage');
  const filterButtons = document.querySelectorAll('[data-filter]');
  const zoomIn = $('#zoomIn');
  const zoomOut = $('#zoomOut');
  const zoomVal = $('#zoomVal');

  const toastEl = $('#toast');

  // ---------- Estado ----------
  let images = [];            // [{ el, pageIndex, dataUrlOriginal, dataUrl, x, y, w, h, rotation, opacity, filter }]
  let selected = null;        // imagen seleccionada
  let pageMetrics = null;     // { width, height, pdfPageWidth, pdfPageHeight, scaleFactor }
  let baseZoom = 1.0;         // zoom relativo (0.5 = 50%, 2 = 200%)

  // ============================================================
  //  UPLOAD
  // ============================================================
  function setupUpload() {
    dropZone.addEventListener('click', (e) => {
      if (e.target.closest('label')) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
      })
    );
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') handleFile(file);
    });
  }

  async function handleFile(file) {
    if (file.type !== 'application/pdf') {
      showToast('Selecciona un archivo PDF válido.');
      return;
    }
    showToast('Cargando PDF...');
    try {
      const { totalPages } = await PDFEditor.load(file);
      images = [];
      baseZoom = 1.0;
      uploadScreen.classList.add('hidden');
      editorScreen.classList.remove('hidden');
      btnDownload.disabled = false;
      btnReset.disabled = false;
      await renderCurrentPage();
      updatePageInfo();
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
      .forEach((im) => overlayLayer.appendChild(im.el));
    syncSelectionUI();
  }

  function updatePageInfo() {
    pageInfo.textContent = `${PDFEditor.getPage()} / ${PDFEditor.getTotalPages()}`;
    prevBtn.disabled = PDFEditor.getPage() <= 1;
    nextBtn.disabled = PDFEditor.getPage() >= PDFEditor.getTotalPages();
  }

  // ============================================================
  //  NAVEGACIÓN / ZOOM
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
    updateZoomLabel();
    renderCurrentPage();
  });
  zoomOut.addEventListener('click', () => {
    baseZoom = Math.max(0.3, +(baseZoom - 0.15).toFixed(2));
    updateZoomLabel();
    renderCurrentPage();
  });
  function updateZoomLabel() {
    zoomVal.textContent = Math.round(baseZoom * 100) + '%';
  }

  // ============================================================
  //  AÑADIR IMAGEN (FIRMA)
  // ============================================================
  imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await addImageFromFile(file);
    imageInput.value = ''; // permitir re-seleccionar el mismo
  });

  async function addImageFromFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = async () => {
        // Tamaño inicial: 30% del ancho de la página, manteniendo proporción
        const maxW = pageMetrics.width * 0.3;
        const ratio = img.height / img.width;
        const w = Math.min(maxW, img.width);
        const h = w * ratio;

        const pageIdx = PDFEditor.getPage() - 1;
        const state = {
          pageIndex: pageIdx,
          dataUrlOriginal: dataUrl,
          dataUrl: dataUrl,
          x: (pageMetrics.width - w) / 2,
          y: (pageMetrics.height - h) / 2,
          w, h,
          rotation: 0,
          opacity: 1,
          filter: 'none'
        };

        const el = createFloatingImage(state);
        state.el = el;
        images.push(state);
        overlayLayer.appendChild(el);
        selectImage(state);
        showToast('Imagen añadida. Arrástrala o redimensiónala.');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  // ============================================================
  //  CREAR ELEMENTO FLOTANTE (DRAG / RESIZE / ROTATE)
  // ============================================================
  function createFloatingImage(state) {
    const el = document.createElement('div');
    el.className = 'floating-image';
    el.style.left = state.x + 'px';
    el.style.top = state.y + 'px';
    el.style.width = state.w + 'px';
    el.style.height = state.h + 'px';

    const inner = document.createElement('img');
    inner.className = 'img-inner';
    inner.src = state.dataUrl;
    inner.draggable = false;
    el.appendChild(inner);

    // Handles
    const tl = document.createElement('div'); tl.className = 'handle tl';
    const br = document.createElement('div'); br.className = 'handle br';
    const rot = document.createElement('div'); rot.className = 'handle rotate';
    el.append(tl, br, rot);

    applyTransform(el, state);

    // --- Drag ---
    let dragging = false, startX, startY, startLeft, startTop;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('handle')) return;
      selectImage(state);
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = state.x; startTop = state.y;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      state.x = clamp(startLeft + dx, 0, pageMetrics.width - state.w);
      state.y = clamp(startTop + dy, 0, pageMetrics.height - state.h);
      el.style.left = state.x + 'px';
      el.style.top = state.y + 'px';
    });
    el.addEventListener('pointerup', () => { dragging = false; });

    // --- Resize (br) ---
    let resizing = false, rStartW, rStartH, rStartX, rStartY;
    br.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selectImage(state);
      resizing = true;
      rStartW = state.w; rStartH = state.h;
      rStartX = e.clientX; rStartY = e.clientY;
      br.setPointerCapture(e.pointerId);
    });
    br.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - rStartX;
      const dy = e.clientY - rStartY;
      const ratio = rStartH / rStartW;
      const newW = clamp(rStartW + dx, 20, pageMetrics.width - state.x);
      const newH = newW * ratio;
      if (state.y + newH > pageMetrics.height) return;
      state.w = newW; state.h = newH;
      el.style.width = state.w + 'px';
      el.style.height = state.h + 'px';
      scaleRange.value = Math.round((state.w / rStartW) * 100);
      scaleVal.textContent = scaleRange.value + '%';
    });
    br.addEventListener('pointerup', () => { resizing = false; });

    // --- Rotate ---
    let rotating = false, rotStartAngle, rotStartRotation, cx, cy;
    rot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selectImage(state);
      rotating = true;
      const rect = el.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
      rotStartAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
      rotStartRotation = state.rotation;
      rot.setPointerCapture(e.pointerId);
    });
    rot.addEventListener('pointermove', (e) => {
      if (!rotating) return;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
      let deg = rotStartRotation + ((angle - rotStartAngle) * 180) / Math.PI;
      deg = Math.round(deg);
      state.rotation = deg;
      el.style.transform = `rotate(${deg}deg)`;
      rotationRange.value = deg;
      rotationVal.textContent = deg + '°';
    });
    rot.addEventListener('pointerup', () => { rotating = false; });

    return el;
  }

  function applyTransform(el, state) {
    el.style.opacity = state.opacity;
    el.style.transform = `rotate(${state.rotation}deg)`;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
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

  function syncSelectionUI() {
    if (selected && !images.includes(selected)) selected = null;
    if (selected) {
      selected.el.classList.add('selected');
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
    rotationRange.value = selected.rotation;
    rotationVal.textContent = selected.rotation + '°';
    scaleRange.value = 100;
    scaleVal.textContent = '100%';
    filterButtons.forEach((b) =>
      b.classList.toggle('active', b.dataset.filter === selected.filter)
    );
  }

  // Click fuera → deseleccionar
  pdfCanvas.addEventListener('pointerdown', () => {
    if (selected) {
      selected.el.classList.remove('selected');
      selected = null;
      imageControls.hidden = true;
    }
  });

  // ============================================================
  //  CONTROLES DE IMAGEN
  // ============================================================
  opacityRange.addEventListener('input', () => {
    if (!selected) return;
    selected.opacity = +opacityRange.value / 100;
    selected.el.style.opacity = selected.opacity;
    opacityVal.textContent = opacityRange.value + '%';
  });

  rotationRange.addEventListener('input', () => {
    if (!selected) return;
    selected.rotation = +rotationRange.value;
    selected.el.style.transform = `rotate(${selected.rotation}deg)`;
    rotationVal.textContent = rotationRange.value + '°';
  });

  scaleRange.addEventListener('input', () => {
    if (!selected) return;
    const factor = +scaleRange.value / 100;
    const img = selected.el.querySelector('img');
    // Guardamos el tamaño base en data attributes la primera vez
    if (!selected.baseW) {
      selected.baseW = selected.w;
      selected.baseH = selected.h;
    }
    const nw = selected.baseW * factor;
    const nh = selected.baseH * factor;
    if (selected.x + nw > pageMetrics.width || selected.y + nh > pageMetrics.height) return;
    selected.w = nw;
    selected.h = nh;
    selected.el.style.width = nw + 'px';
    selected.el.style.height = nh + 'px';
    scaleVal.textContent = scaleRange.value + '%';
  });

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!selected) return;
      const f = btn.dataset.filter;
      selected.filter = f;
      filterButtons.forEach((b) => b.classList.toggle('active', b === btn));
      const newUrl = await PDFEditor.applyFilterToImage(selected.dataUrlOriginal, f);
      selected.dataUrl = newUrl;
      selected.el.querySelector('img').src = newUrl;
    });
  });

  deleteImageBtn.addEventListener('click', () => {
    if (!selected) return;
    selected.el.remove();
    images = images.filter((im) => im !== selected);
    selected = null;
    imageControls.hidden = true;
    showToast('Imagen eliminada.');
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
    const originalText = btnDownload.textContent;
    btnDownload.textContent = 'Generando...';
    try {
      const payload = images.map((im) => {
        // Convertir px de canvas → unidades PDF
        const sf = pageMetrics.scaleFactor;
        return {
          pageIndex: im.pageIndex,
          dataUrl: im.dataUrl,
          x: im.x / sf,
          y: im.y / sf,
          w: im.w / sf,
          h: im.h / sf,
          rotation: im.rotation,
          opacity: im.opacity,
          filter: im.filter
        };
      });
      const blob = await PDFEditor.exportPDF(payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'documento-editado.pdf';
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
      btnDownload.textContent = originalText;
    }
  });

  // ============================================================
  //  RESET
  // ============================================================
  btnReset.addEventListener('click', () => {
    if (!confirm('¿Cerrar el documento actual? Se perderán los cambios no descargados.')) return;
    location.reload();
  });

  // ============================================================
  //  TOAST
  // ============================================================
  let toastTimer;
  function showToast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  // ============================================================
  //  INIT
  // ============================================================
  setupUpload();
})();