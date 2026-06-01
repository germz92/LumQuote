/**
 * Client-side PDF from server-rendered quote HTML (same template as Puppeteer).
 * Requires html2pdf.bundle.min.js (global html2pdf).
 */

async function waitForDocumentImages(doc, timeoutMs = 15000) {
  const images = Array.from(doc.querySelectorAll('img'));
  if (images.length === 0) return;

  await Promise.race([
    Promise.all(
      images.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          })
      )
    ),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Quote images took too long to load')), timeoutMs);
    }),
  ]);
}

function waitForIframeReady(iframe) {
  return new Promise((resolve) => {
    const doc = iframe.contentDocument;
    if (doc && doc.readyState === 'complete') {
      resolve();
      return;
    }
    iframe.addEventListener('load', () => resolve(), { once: true });
  });
}

/**
 * @param {string} html Full HTML document from generateQuoteHTML
 * @param {string} filename Download filename
 */
async function downloadPdfFromHtml(html, filename) {
  if (typeof html2pdf === 'undefined') {
    throw new Error('PDF library not loaded. Refresh the page and try again.');
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'PDF export');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;visibility:hidden';
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();

    await waitForIframeReady(iframe);
    await waitForDocumentImages(doc);

    const source = doc.body;
    const contentWidth = Math.max(source.scrollWidth, 794);

    await html2pdf()
      .set({
        margin: [20, 20, 20, 20],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: contentWidth,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: ['tr', 'img', '.totals'],
        },
      })
      .from(source)
      .save();
  } finally {
    iframe.remove();
  }
}

window.downloadPdfFromHtml = downloadPdfFromHtml;
