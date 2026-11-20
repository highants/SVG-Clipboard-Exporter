(() => {
  'use strict';

  const MESSAGES = Object.freeze({
    ja: Object.freeze({
      appTitle: 'SVG Clipboard Exporter',
      appSubtitle: 'クリップボードやドロップしたSVGをPNG / JPGへ変換',
      langToggleLabel: 'Englishへ切り替え',
      langToggleShort: 'EN',
      openDropWindow: 'D&D専用ウィンドウ',
      openDropWindowTitle: 'エクスプローラー等からSVGファイルを直接ドラッグ＆ドロップできる専用ウィンドウを開きます',

      svgDetectedBadge: 'SVG検出',
      fileLoadedBadge: 'ファイル読込',
      convertTitle: '画像に変換しますか？',
      convertDesc: 'SVGコードをPNGまたはJPG画像に変換してクリップボードへコピー・保存できます。',
      previewAlt: '{title} のプレビュー',
      previewUnavailable: 'プレビュー不可: {error}',
      scaleLabel: '倍率',
      quickScaleAria: '今回の出力倍率',
      saveWithSvgShort: '保存時にSVGファイルも一緒に保存',

      btnCopyPng: 'PNGに変換してコピー',
      btnCopyJpg: 'JPGに変換してコピー',
      btnSavePng: 'PNG保存',
      btnSaveJpg: 'JPG保存',
      btnDismiss: '変換しない',
      btnClose: '閉じる',
      btnCloseToast: '通知を閉じる',

      idleText: 'クリップボードにSVGコードをコピーすると自動起動します。下のエリアにSVGファイルをドロップしても変換できます。',
      btnRecheck: 'クリップボードを再確認',
      noSvgInClipboard: 'クリップボードに有効なSVGコードが見つかりませんでした',

      dropZoneTitle: 'SVGファイルをここにドロップ、またはクリックして選択',
      dropZoneHint: 'エクスプローラーから直接ドラッグする場合は「D&D専用ウィンドウ」が便利です',
      dropZoneActive: 'ここにドロップして読み込み',
      dropInvalidFile: '有効なSVGファイル（.svg）ではありません: {name}',
      dropReadError: 'ファイルの読み込みに失敗しました: {error}',

      settingsSummary: '変換・監視設定',
      languageLabel: '表示言語 / Language',
      languageAuto: '自動（ブラウザ設定）',
      languageJa: '日本語',
      languageEn: 'English',
      monitorClipboardLabel: 'SVGコピー時に自動検出して確認する',
      promptModeLabel: 'SVG検出時の起動方法',
      promptModePopup: '拡張ポップアップを自動起動（失敗時はページ内表示）',
      promptModeOverlay: 'ページ内確認ダイアログを表示',
      saveWithSvgLabel: '画像保存時に元のSVGファイルも一緒に保存する',
      defaultScaleLabel: 'デフォルト出力倍率',
      scale1x: '1x（等倍）',
      scale2x: '2x（高精細・推奨）',
      scale3x: '3x（超高精細）',
      scale4x: '4x（最大）',
      jpgQualityLabel: 'JPG圧縮品質',
      jpgBgColorLabel: 'JPG背景色（透過不可のため塗り潰し）',
      jpgBgPresetsAria: 'JPG背景色のプリセット',
      swatchWhite: '白',
      swatchLightGray: '明灰',
      swatchDark: '濃紺',
      pngBgLabel: 'PNG背景設定',
      pngBgTransparent: '透過（Transparent）',
      pngBgWhite: '白背景（#FFFFFF）',
      pngBgCustom: 'カスタム背景色',
      pngCustomBgLabel: 'PNGカスタム背景色',
      paddingLabel: '外周余白（Padding）',
      padding0: '0px（余白なし）',

      jpgNoteTitle: 'JPGコピーの仕様メモ:',
      jpgNoteBody: 'Chrome標準のClipboard APIは image/jpeg 単体書き込みに対応していないため、JPGコピー時は指定の背景色とJPG品質で生成した画像をOS貼り付け互換のあるPNG形式でクリップボードへ書き込みます（直接のJPGファイルは「JPG保存」をご利用ください）。',
      btnReset: '初期設定に戻す',
      statusSaved: '設定を保存しました',
      statusReset: '初期設定に戻しました',

      copiedPng: 'PNG ({width}×{height}) をクリップボードにコピーしました',
      copiedJpg: 'JPG品質{quality}%・背景付き ({width}×{height}) をクリップボードにコピーしました（貼付互換PNG形式）',
      copyFailed: 'コピー失敗: {error}',
      savedImageOnly: '{ext} ({width}×{height}) を保存しました',
      savedImageWithSvg: '{ext} + SVG ({width}×{height}) を保存しました',
      saveFailed: '保存失敗: {error}',

      overlayTitle: 'SVGコードを検出しました',
      overlayQuestion: 'PNG または JPG 画像に変換してクリップボードへコピーしますか？',
      toastRegionAria: 'SVG変換通知',

      converterTitle: 'SVG ドラッグ＆ドロップ変換',
      converterSubtitle: 'SVGファイルを直接ドラッグ＆ドロップ、または Ctrl+V で貼り付けてPNG/JPGへ変換できます',
      converterDropMain: 'ここにSVGファイルをドラッグ＆ドロップ（複数ファイル対応）',
      converterDropSub: 'クリックしてファイル選択 / Ctrl+V でSVGコードを貼り付け',
      converterFileListHeading: '読み込み済みSVG ({count}件)',
      converterBatchPng: 'すべてPNG保存',
      converterBatchJpg: 'すべてJPG保存',
      converterClearAll: 'リストをクリア',
      converterRemoveItem: 'リストから削除',
      converterBatchDone: '{count}件の{ext}を保存しました',
      converterBatchDoneWithSvg: '{count}件の{ext} + SVGを保存しました',
      converterPastedSvg: '貼り付けられたSVG',
      converterEmptyHint: 'SVGファイルをドロップするとプレビューと変換ボタンが表示されます。',
      unknownError: '不明なエラー',
    }),
    en: Object.freeze({
      appTitle: 'SVG Clipboard Exporter',
      appSubtitle: 'Convert copied or dropped SVG to PNG / JPG',
      langToggleLabel: 'Switch to Japanese',
      langToggleShort: '日本語',
      openDropWindow: 'Drop Window',
      openDropWindowTitle: 'Open a persistent window where you can drag and drop SVG files directly from Explorer or Finder',

      svgDetectedBadge: 'SVG Ready',
      fileLoadedBadge: 'File Loaded',
      convertTitle: 'Convert to image?',
      convertDesc: 'Export the detected SVG as a PNG or JPG image to your clipboard or download it.',
      previewAlt: 'Preview of {title}',
      previewUnavailable: 'Preview unavailable: {error}',
      scaleLabel: 'Scale',
      quickScaleAria: 'Export scale for this image',
      saveWithSvgShort: 'Also save .svg file on download',

      btnCopyPng: 'Copy as PNG',
      btnCopyJpg: 'Copy as JPG',
      btnSavePng: 'Save PNG',
      btnSaveJpg: 'Save JPG',
      btnDismiss: 'Dismiss',
      btnClose: 'Close',
      btnCloseToast: 'Close notification',

      idleText: 'Copy any SVG code to launch automatically, or drop an .svg file below to convert.',
      btnRecheck: 'Check Clipboard Again',
      noSvgInClipboard: 'No valid SVG code was found in the clipboard.',

      dropZoneTitle: 'Drop an .svg file here or click to choose',
      dropZoneHint: 'For dragging directly from Explorer/Finder, use "Drop Window" so the panel stays open.',
      dropZoneActive: 'Release to load SVG',
      dropInvalidFile: 'Not a valid SVG file: {name}',
      dropReadError: 'Failed to read file: {error}',

      settingsSummary: 'Export & Monitoring Settings',
      languageLabel: 'Language / 表示言語',
      languageAuto: 'Auto (Browser Default)',
      languageJa: '日本語',
      languageEn: 'English',
      monitorClipboardLabel: 'Auto-detect copied SVG and ask to convert',
      promptModeLabel: 'When SVG is detected',
      promptModePopup: 'Auto-open extension popup (fallback to in-page dialog)',
      promptModeOverlay: 'Show in-page confirmation dialog',
      saveWithSvgLabel: 'Also save the original .svg file when saving an image',
      defaultScaleLabel: 'Default Export Scale',
      scale1x: '1x (Original)',
      scale2x: '2x (HiDPI, Recommended)',
      scale3x: '3x (Ultra Crisp)',
      scale4x: '4x (Maximum)',
      jpgQualityLabel: 'JPG Quality',
      jpgBgColorLabel: 'JPG Background (opaque fill)',
      jpgBgPresetsAria: 'JPG background presets',
      swatchWhite: 'White',
      swatchLightGray: 'Light',
      swatchDark: 'Dark',
      pngBgLabel: 'PNG Background',
      pngBgTransparent: 'Transparent',
      pngBgWhite: 'White (#FFFFFF)',
      pngBgCustom: 'Custom Color',
      pngCustomBgLabel: 'Custom PNG Background',
      paddingLabel: 'Outer Padding',
      padding0: '0px (None)',

      jpgNoteTitle: 'Note on JPG Clipboard Copy:',
      jpgNoteBody: 'Chrome Clipboard API does not allow writing raw image/jpeg alone. "Copy as JPG" renders with your opaque background and JPEG quality, then writes an OS-compatible PNG bitmap (plus web image/jpeg where supported). Use "Save JPG" for a pure .jpg file.',
      btnReset: 'Reset Defaults',
      statusSaved: 'Settings saved',
      statusReset: 'Reset to defaults',

      copiedPng: 'Copied PNG ({width}×{height}) to clipboard',
      copiedJpg: 'Copied JPG {quality}% with background ({width}×{height}) as compatible PNG bitmap',
      copyFailed: 'Copy failed: {error}',
      savedImageOnly: 'Saved {ext} ({width}×{height})',
      savedImageWithSvg: 'Saved {ext} + SVG ({width}×{height})',
      saveFailed: 'Save failed: {error}',

      overlayTitle: 'SVG Code Detected',
      overlayQuestion: 'Convert to a PNG or JPG image and copy to clipboard?',
      toastRegionAria: 'SVG conversion notifications',

      converterTitle: 'SVG Drag & Drop Converter',
      converterSubtitle: 'Drag & drop .svg files directly from your desktop or press Ctrl+V to paste SVG code.',
      converterDropMain: 'Drag & drop .svg files here (supports multiple files)',
      converterDropSub: 'Click to browse files or press Ctrl+V to paste SVG code',
      converterFileListHeading: 'Loaded SVGs ({count})',
      converterBatchPng: 'Save All PNG',
      converterBatchJpg: 'Save All JPG',
      converterClearAll: 'Clear List',
      converterRemoveItem: 'Remove from list',
      converterBatchDone: 'Saved {count} {ext} file(s)',
      converterBatchDoneWithSvg: 'Saved {count} {ext} + SVG file(s)',
      converterPastedSvg: 'Pasted SVG',
      converterEmptyHint: 'Drop one or more .svg files to preview and export as PNG or JPG.',
      unknownError: 'Unknown error',
    }),
  });

  function resolveLanguage(settingLang = 'auto', browserLang = globalThis.navigator?.language || 'ja') {
    if (settingLang === 'ja' || settingLang === 'en') {
      return settingLang;
    }
    const normalized = String(browserLang || '').toLowerCase();
    return normalized.startsWith('ja') ? 'ja' : 'en';
  }

  function t(lang, key, params = {}) {
    const resolved = lang === 'en' ? 'en' : 'ja';
    const dict = MESSAGES[resolved] || MESSAGES.ja;
    const template = dict[key] ?? MESSAGES.ja[key] ?? key;
    return String(template).replace(/\{(\w+)\}/g, (_, token) => {
      return params[token] !== undefined && params[token] !== null
        ? String(params[token])
        : `{${token}}`;
    });
  }

  function applyI18nToDocument(doc, lang) {
    if (!doc) return;
    const resolved = lang === 'en' ? 'en' : 'ja';
    if (doc.documentElement) {
      doc.documentElement.lang = resolved;
    }

    for (const el of doc.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(resolved, key);
    }
    for (const el of doc.querySelectorAll('[data-i18n-aria]')) {
      const key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(resolved, key));
    }
    for (const el of doc.querySelectorAll('[data-i18n-title]')) {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(resolved, key));
    }
  }

  const exported = {
    MESSAGES,
    resolveLanguage,
    t,
    applyI18nToDocument,
  };

  if (!globalThis.GeminiSvgExporter) {
    globalThis.GeminiSvgExporter = {};
  }
  globalThis.GeminiSvgExporter.i18n = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})();
