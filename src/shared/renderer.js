(() => {
  'use strict';

  function getSvgUtils(deps = {}) {
    if (deps.svgUtils) return deps.svgUtils;
    if (globalThis.GeminiSvgExporter?.svgUtils) return globalThis.GeminiSvgExporter.svgUtils;
    if (typeof require === 'function') {
      return require('./svg-utils.js');
    }
    throw new Error('svgUtils モジュールが見つかりません');
  }

  function resolveBackgroundColor(format, settings = {}) {
    const normalized = String(format || 'png').toLowerCase();
    if (normalized === 'jpeg' || normalized === 'jpg') {
      return settings.jpgBgColor || '#FFFFFF';
    }
    if (settings.pngBackground === 'white') {
      return '#FFFFFF';
    }
    if (settings.pngBackground === 'custom') {
      return settings.pngBgColor || '#FFFFFF';
    }
    return null;
  }

  function loadImageFromSrc(src, ImageCtor = globalThis.Image) {
    return new Promise((resolve, reject) => {
      const img = new ImageCtor();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('SVG画像の読み込みに失敗しました'));
      img.src = src;
    });
  }

  async function loadSvgImage(svgXml, deps = {}) {
    const utils = getSvgUtils(deps);
    const ImageCtor = deps.ImageCtor || globalThis.Image;
    const UrlApi = deps.URL || globalThis.URL;
    const BlobCtor = deps.BlobCtor || globalThis.Blob;

    if (typeof ImageCtor !== 'function') {
      throw new Error('Image コンストラクタが利用できません');
    }

    const dataUrl = utils.svgToDataUrl(svgXml);
    try {
      return await loadImageFromSrc(dataUrl, ImageCtor);
    } catch {
      if (!UrlApi?.createObjectURL || typeof BlobCtor !== 'function') {
        throw new Error('SVG画像のデコードに失敗しました');
      }
      const svgBlob = new BlobCtor([svgXml], { type: 'image/svg+xml;charset=utf-8' });
      const objectUrl = UrlApi.createObjectURL(svgBlob);
      try {
        return await loadImageFromSrc(objectUrl, ImageCtor);
      } finally {
        UrlApi.revokeObjectURL?.(objectUrl);
      }
    }
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      if (!canvas || typeof canvas.toBlob !== 'function') {
        reject(new Error('Canvas.toBlob が利用できません'));
        return;
      }
      try {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error(`${mimeType} へのエンコードに失敗しました`));
              return;
            }
            resolve(blob);
          },
          mimeType,
          quality
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  function createCanvasElement(width, height, deps = {}) {
    if (typeof deps.createCanvas === 'function') {
      return deps.createCanvas(width, height);
    }
    const doc = deps.document || globalThis.document;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('Canvas を作成できる Document が利用できません');
    }
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function isSecurityTaintError(err) {
    if (!err) return false;
    return err.name === 'SecurityError' || /tainted|insecure/i.test(String(err.message || ''));
  }

  async function rasterizePreparedSvg(prepared, format, settings, deps = {}) {
    const normalized = String(format || 'png').toLowerCase();
    const mimeType = normalized === 'jpeg' || normalized === 'jpg' ? 'image/jpeg' : 'image/png';
    const qualityNum = Number(settings?.jpgQuality ?? 92);
    const quality = mimeType === 'image/jpeg'
      ? Math.min(1, Math.max(0.5, qualityNum / 100))
      : undefined;

    const { metrics, svgXml } = prepared;
    const img = await loadSvgImage(svgXml, deps);
    const canvas = createCanvasElement(metrics.canvasWidth, metrics.canvasHeight, deps);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D コンテキストを取得できませんでした');
    }

    const bgColor = resolveBackgroundColor(mimeType === 'image/jpeg' ? 'jpeg' : 'png', settings);
    if (bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, metrics.canvasWidth, metrics.canvasHeight);
    } else {
      ctx.clearRect(0, 0, metrics.canvasWidth, metrics.canvasHeight);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, metrics.padPx, metrics.padPx, metrics.innerWidth, metrics.innerHeight);

    const blob = await canvasToBlob(canvas, mimeType, quality);
    return {
      blob,
      mimeType,
      width: metrics.canvasWidth,
      height: metrics.canvasHeight,
      scale: metrics.effectiveScale,
      wasClamped: metrics.wasClamped,
    };
  }

  async function renderSvgToBlob(svgText, format, settings = {}, deps = {}) {
    const utils = getSvgUtils(deps);
    const { svgEl, repaired } = utils.parseSvgString(svgText, deps.DOMParserCtor || globalThis.DOMParser);

    const prepareOpts = {
      scale: settings.scale ?? 2,
      padding: settings.padding ?? 0,
      measureBBoxFn: deps.measureBBoxFn || null,
      XMLSerializerCtor: deps.XMLSerializerCtor || globalThis.XMLSerializer,
      stripUnsafeForCanvas: false,
    };

    const prepared = utils.prepareSvgForRasterization(svgEl, prepareOpts);
    const title = utils.extractSvgTitle(svgEl);

    try {
      const rendered = await rasterizePreparedSvg(prepared, format, settings, deps);
      return {
        ...rendered,
        repaired,
        title,
        svgEl,
      };
    } catch (err) {
      if (!isSecurityTaintError(err)) {
        throw err;
      }

      // Retry once with foreignObject and external http(s) <image> stripped
      const strippedPrepared = utils.prepareSvgForRasterization(svgEl, {
        ...prepareOpts,
        stripUnsafeForCanvas: true,
      });
      try {
        const retried = await rasterizePreparedSvg(strippedPrepared, format, settings, deps);
        return {
          ...retried,
          repaired,
          title,
          svgEl,
          strippedExternalContent: true,
        };
      } catch (retryErr) {
        if (isSecurityTaintError(retryErr)) {
          throw new Error('外部リソースまたはforeignObjectによりCanvasへの出力が制限されました');
        }
        throw retryErr;
      }
    }
  }

  async function convertBlobToPngBlob(blob, deps = {}) {
    if (!blob) {
      throw new Error('変換元の画像Blobがありません');
    }

    let source;
    let width = 0;
    let height = 0;
    let shouldCloseBitmap = false;

    if (typeof (deps.createImageBitmap || globalThis.createImageBitmap) === 'function') {
      const createBitmap = deps.createImageBitmap || globalThis.createImageBitmap;
      source = await createBitmap(blob);
      width = source.width;
      height = source.height;
      shouldCloseBitmap = typeof source.close === 'function';
    } else {
      const UrlApi = deps.URL || globalThis.URL;
      const ImageCtor = deps.ImageCtor || globalThis.Image;
      if (!UrlApi?.createObjectURL || typeof ImageCtor !== 'function') {
        throw new Error('画像をPNGへ変換するAPIが利用できません');
      }
      const objectUrl = UrlApi.createObjectURL(blob);
      try {
        source = await loadImageFromSrc(objectUrl, ImageCtor);
        width = source.naturalWidth || source.width;
        height = source.naturalHeight || source.height;
      } finally {
        UrlApi.revokeObjectURL?.(objectUrl);
      }
    }

    try {
      const canvas = createCanvasElement(Math.max(1, width), Math.max(1, height), deps);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('PNG変換用のCanvasコンテキストを取得できませんでした');
      }
      ctx.drawImage(source, 0, 0);
      return await canvasToBlob(canvas, 'image/png');
    } finally {
      if (shouldCloseBitmap) {
        source.close();
      }
    }
  }

  /**
   * Copy rendered SVG to the clipboard.
   * Starts ClipboardItem with Promise<Blob> synchronously inside the user-click turn
   * so Chrome preserves user activation.
   */
  async function copySvgImageToClipboard(svgText, format, settings = {}, deps = {}) {
    const clipboard = deps.clipboard || globalThis.navigator?.clipboard;
    const ClipboardItemCtor = deps.ClipboardItemCtor || globalThis.ClipboardItem;

    if (!clipboard || typeof clipboard.write !== 'function' || typeof ClipboardItemCtor !== 'function') {
      throw new Error('この環境では画像クリップボード書き込み (ClipboardItem) が利用できません');
    }

    const normalized = String(format || 'png').toLowerCase();
    const isJpeg = normalized === 'jpeg' || normalized === 'jpg';

    if (!isJpeg) {
      let renderMeta = null;
      const pngPromise = (async () => {
        const res = await renderSvgToBlob(svgText, 'png', settings, deps);
        renderMeta = res;
        return res.blob;
      })();

      await clipboard.write([
        new ClipboardItemCtor({ 'image/png': pngPromise }),
      ]);
      if (!renderMeta) {
        await pngPromise;
      }

      return {
        ...renderMeta,
        clipboardFormat: 'image/png',
        jpegCompatMode: false,
        includesWebJpeg: false,
      };
    }

    // Chrome rejects standard 'image/jpeg' in ClipboardItem.write().
    // Render opaque-background JPEG first, then re-encode as 'image/png' for OS clipboard compatibility,
    // optionally attaching 'web image/jpeg' when supported.
    let renderMeta = null;
    const jpgPromise = (async () => {
      const res = await renderSvgToBlob(svgText, 'jpeg', settings, deps);
      renderMeta = res;
      return res.blob;
    })();

    const pngCompatPromise = (async () => {
      const jpgBlob = await jpgPromise;
      return await convertBlobToPngBlob(jpgBlob, deps);
    })();

    const supportsWebJpeg =
      typeof ClipboardItemCtor.supports === 'function' &&
      ClipboardItemCtor.supports('web image/jpeg');

    let includesWebJpeg = false;

    if (supportsWebJpeg) {
      try {
        await clipboard.write([
          new ClipboardItemCtor({
            'image/png': pngCompatPromise,
            'web image/jpeg': jpgPromise,
          }),
        ]);
        includesWebJpeg = true;
      } catch {
        const compatBlob = await pngCompatPromise;
        await clipboard.write([
          new ClipboardItemCtor({ 'image/png': compatBlob }),
        ]);
        includesWebJpeg = false;
      }
    } else {
      await clipboard.write([
        new ClipboardItemCtor({ 'image/png': pngCompatPromise }),
      ]);
    }

    if (!renderMeta) {
      await jpgPromise;
    }

    return {
      ...renderMeta,
      clipboardFormat: 'image/png',
      jpegCompatMode: true,
      includesWebJpeg,
    };
  }

  function triggerBlobDownload(blob, filename, deps = {}) {
    const UrlApi = deps.URL || globalThis.URL;
    const doc = deps.document || globalThis.document;
    const scheduleTimer = deps.setTimeout || globalThis.setTimeout;
    const revokeDelayMs = deps.revokeDelayMs ?? 2000;

    const objectUrl = UrlApi.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    doc.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      if (typeof scheduleTimer === 'function') {
        scheduleTimer(() => UrlApi.revokeObjectURL?.(objectUrl), revokeDelayMs);
      } else {
        UrlApi.revokeObjectURL?.(objectUrl);
      }
    }
  }

  async function downloadSvgImage(svgText, format, settings = {}, deps = {}) {
    const utils = getSvgUtils(deps);
    const normalized = String(format || 'png').toLowerCase();
    const ext = normalized === 'jpeg' || normalized === 'jpg' ? 'jpg' : 'png';
    const renderFormat = ext === 'jpg' ? 'jpeg' : 'png';

    const rendered = await renderSvgToBlob(svgText, renderFormat, settings, deps);
    const baseName = utils.buildExportBasename(rendered.svgEl, {
      now: deps.now || new Date(),
      sourceFilename: deps.sourceFilename || '',
    });
    const filename = `${baseName}.${ext}`;

    triggerBlobDownload(rendered.blob, filename, deps);

    let svgFilename = null;
    if (settings.saveWithSvg) {
      const BlobCtor = deps.BlobCtor || globalThis.Blob;
      const cleanSvgXml = utils.prepareCleanSvgDocument(
        rendered.svgEl,
        deps.XMLSerializerCtor || globalThis.XMLSerializer
      );
      const svgBlob = new BlobCtor([cleanSvgXml], { type: 'image/svg+xml;charset=utf-8' });
      svgFilename = `${baseName}.svg`;

      const gapMs = deps.downloadGapMs ?? 160;
      if (gapMs > 0) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, gapMs));
      }
      triggerBlobDownload(svgBlob, svgFilename, deps);
    }

    return {
      ...rendered,
      filename,
      ext,
      svgFilename,
    };
  }

  const exported = {
    resolveBackgroundColor,
    loadSvgImage,
    canvasToBlob,
    renderSvgToBlob,
    convertBlobToPngBlob,
    copySvgImageToClipboard,
    downloadSvgImage,
  };

  if (!globalThis.GeminiSvgExporter) {
    globalThis.GeminiSvgExporter = {};
  }
  globalThis.GeminiSvgExporter.renderer = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})();
