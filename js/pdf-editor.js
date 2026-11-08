/* ============================================================
   pdf-editor.js — PDF.js (render) + PDF-lib (export)
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const PDFEditor = (() => {
  let pdfDoc = null;
  let pdfBytes = null;
  let currentPage = 1;
  let totalPages = 1;
  let currentScale = 1.0;

  const BASE_SCALE = 1.5;

  async function load(file) {
    pdfBytes = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
    totalPages = pdfDoc.numPages;
    currentPage = 1;
    return { totalPages };
  }

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

    return { width: viewport.width, height: viewport.height };
  }

  /** Hornea rotación en los píxeles de una imagen (dataURL) */
  function bakeRotation(dataUrl, rotationDeg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const rad = (rotationDeg * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const rw = Math.round(img.width * cos + img.height * sin);
        const rh = Math.round(img.width * sin + img.height * cos);
        const c = document.createElement('canvas');
        c.width = rw;
        c.height = rh;
        const ctx = c.getContext('2d');
        ctx.translate(rw / 2, rh / 2);
        ctx.rotate(rad);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        resolve({
          dataUrl: c.toDataURL('image/png'),
          widthRatio: rw / img.width,
          heightRatio: rh / img.height
        });
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /** Exporta el PDF con las imágenes incrustadas (posiciones en fracciones) */
  async function exportPDF(images) {
    const { PDFDocument } = PDFLib;
    const doc = await PDFDocument.load(pdfBytes);
    const pages = doc.getPages();

    for (const im of images) {
      const page = pages[im.pageIndex];
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();

      // 1) Rotación horneada (si aplica)
      let dataUrl = im.dataUrl;
      let xFrac = im.xFrac, yFrac = im.yFrac;
      let wFrac = im.wFrac, hFrac = im.hFrac;

      if (Math.abs(im.rotation) > 0.1) {
        const baked = await bakeRotation(im.dataUrl, im.rotation);
        const cx = im.xFrac + im.wFrac / 2;
        const cy = im.yFrac + im.hFrac / 2;
        const nw = im.wFrac * baked.widthRatio;
        const nh = im.hFrac * baked.heightRatio;
        dataUrl = baked.dataUrl;
        xFrac = cx - nw / 2;
        yFrac = cy - nh / 2;
        wFrac = nw;
        hFrac = nh;
      }

      // 2) Fracciones → unidades PDF (origen abajo-izquierda en PDF)
      const pdfW = wFrac * pw;
      const pdfH = hFrac * ph;
      const pdfX = xFrac * pw;
      const pdfY = ph - yFrac * ph - pdfH;

      // 3) Embed
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const embedded = blob.type === 'image/png'
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);

      page.drawImage(embedded, {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH,
        opacity: im.opacity ?? 1
      });
    }

    const outBytes = await doc.save();
    return new Blob([outBytes], { type: 'application/pdf' });
  }

  /** Filtros por píxel */
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
              r = g = b = v > 128 ? 255 : 0;
            } else if (filter === 'remove-white') {
              const v = 0.299 * r + 0.587 * g + 0.114 * b;
              if (v > 220) {
                d[i + 3] = 0;
                continue;
              }
              if (v > 200) {
                const alpha = Math.round(((v - 200) / 20) * 255);
                d[i + 3] = Math.min(d[i + 3], 255 - alpha);
              }
            } else if (filter === 'blue') {
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

  return {
    load,
    renderPage,
    exportPDF,
    applyFilterToImage,
    bakeRotation,
    setPage: (n) => (currentPage = n),
    getPage: () => currentPage,
    getTotalPages: () => totalPages,
    getScale: () => currentScale,
    setScale: (s) => (currentScale = s),
    isLoaded: () => pdfDoc !== null,
    BASE_SCALE
  };
})();