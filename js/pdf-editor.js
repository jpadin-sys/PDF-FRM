/* ============================================================
   pdf-editor.js — Manejo de PDF con PDF.js y PDF-lib
   ============================================================ */

// Configurar worker de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const PDFEditor = (() => {
  let pdfDoc = null;         // documento PDF.js para render
  let pdfBytes = null;       // ArrayBuffer original (para pdf-lib al exportar)
  let currentPage = 1;
  let totalPages = 1;
  let currentScale = 1.0;    // escala de render (zoom)
  const BASE_SCALE = 1.5;    // resolución base

  /** Carga el PDF desde un File */
  async function load(file) {
    pdfBytes = await file.arrayBuffer();
    // Copia porque PDF.js consume el buffer
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    currentPage = 1;
    return { totalPages };
  }

  /** Renderiza la página actual en un canvas */
  async function renderPage(canvas, pageNum) {
    if (!pdfDoc) return null;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: BASE_SCALE * currentScale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    return {
      width: viewport.width,
      height: viewport.height,
      pdfPageWidth: page.view[2],   // ancho en unidades PDF
      pdfPageHeight: page.view[3],  // alto en unidades PDF
      scaleFactor: viewport.width / page.view[2] // px por unidad PDF
    };
  }

  /** Exporta el PDF con las imágenes incrustadas */
  async function exportPDF(images) {
    // images: [{ dataUrl, x, y, w, h, rotation, opacity, filter }]
    const { PDFDocument, degrees } = PDFLib;
    const doc = await PDFDocument.load(pdfBytes);
    const pages = doc.getPages();

    for (const img of images) {
      const page = pages[img.pageIndex];
      if (!page) continue;

      // Convertir dataUrl a bytes
      const resp = await fetch(img.dataUrl);
      const blob = await resp.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());

      let embedded;
      if (blob.type === 'image/png') {
        embedded = await doc.embedPng(bytes);
      } else {
        embedded = await doc.embedJpg(bytes);
      }

      // Coordenadas: x,y en unidades PDF (origen abajo-izquierda en PDF)
      const { width: pw, height: ph } = page.getSize();
      const drawX = img.x;
      // PDF-lib usa origen abajo-izquierda; convertimos desde px de canvas (top-left)
      const drawY = ph - img.y - img.h;

      page.drawImage(embedded, {
        x: drawX,
        y: drawY,
        width: img.w,
        height: img.h,
        rotate: degrees(-img.rotation || 0),
        opacity: img.opacity ?? 1
      });
    }

    const outBytes = await doc.save();
    return new Blob([outBytes], { type: 'application/pdf' });
  }

  /** Aplica filtros a una imagen y devuelve un dataURL nuevo */
  async function applyFilterToImage(dataUrl, filter) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        if (filter !== 'none') {
          const imageData = ctx.getImageData(0, 0, c.width, c.height);
          const d = imageData.data;
          for (let i = 0; i < d.length; i += 4) {
            let r = d[i], g = d[i + 1], b = d[i + 2];

            if (filter === 'grayscale') {
              const v = 0.299 * r + 0.587 * g + 0.114 * b;
              r = g = b = v;
            } else if (filter === 'bw') {
              const v = 0.299 * r + 0.587 * g + 0.114 * b;
              const val = v > 128 ? 255 : 0;
              r = g = b = val;
            } else if (filter === 'blue') {
              // Realza tonos azules
              r = Math.max(0, r - 30);
              g = Math.min(255, g + 20);
              b = Math.min(255, b + 40);
            } else if (filter === 'contrast') {
              const f = 1.5;
              r = Math.min(255, Math.max(0, (r - 128) * f + 128));
              g = Math.min(255, Math.max(0, (g - 128) * f + 128));
              b = Math.min(255, Math.max(0, (b - 128) * f + 128));
            }

            d[i] = r; d[i + 1] = g; d[i + 2] = b;
          }
          ctx.putImageData(imageData, 0, 0);
        }
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // ---- Get/Set ----
  const setPage = (n) => { currentPage = n; };
  const getPage = () => currentPage;
  const getTotalPages = () => totalPages;
  const getScale = () => currentScale;
  const setScale = (s) => { currentScale = s; };
  const isLoaded = () => pdfDoc !== null;

  return {
    load,
    renderPage,
    exportPDF,
    applyFilterToImage,
    setPage,
    getPage,
    getTotalPages,
    getScale,
    setScale,
    isLoaded,
    BASE_SCALE
  };
})();