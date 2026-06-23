/* a.a PDFプレビュー — pdf.jsで1ページ目をcanvas描画して資料を常にプレビュー表示する。
   pdf.js は必要時にCDNから遅延ロード（本番は将来ローカルへvendor推奨）。 */
(function (g) {
  'use strict';
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  let loading = null;

  function loadLib() {
    if (g.pdfjsLib) return Promise.resolve(g.pdfjsLib);
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PDFJS;
      s.onload = () => { try { g.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; } catch (e) {} res(g.pdfjsLib); };
      s.onerror = () => rej(new Error('pdf.jsの読み込みに失敗'));
      document.head.appendChild(s);
    });
    return loading;
  }

  /** url のPDF1ページ目を container 内にcanvasで描画 */
  g.aaRenderPdf = async function (url, container) {
    const lib = await loadLib();
    const pdf = await lib.getDocument(url).promise;
    const page = await pdf.getPage(1);
    const targetW = container.clientWidth || 480;
    const vp0 = page.getViewport({ scale: 1 });
    const scale = (targetW / vp0.width) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    c.style.width = '100%'; c.style.display = 'block';
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    container.innerHTML = '';
    container.appendChild(c);
  };
})(window);
