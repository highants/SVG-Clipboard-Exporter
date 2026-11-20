(() => {
  'use strict';

  const ns = globalThis.GeminiSvgExporter;
  if (!ns || !ns.settings || !ns.i18n || !ns.svgUtils || !ns.renderer) return;

  const { settings: settingsApi, i18n, svgUtils, renderer } = ns;

  let currentSettings = { ...settingsApi.DEFAULT_SETTINGS };
  let currentLang = 'ja';
  let activeSvg = null; // { svgText, hash, fileName? }
  let scaleOverride = null;
  let lastAnnouncement = '';
  const statusTimers = new Map();

  function tr(key, params) {
    return i18n.t(currentLang, key, params);
  }

  function dedupAnnouncement(text) {
    let msg = String(text || '');
    if (msg && msg === lastAnnouncement) {
      msg += '\u00A0';
    }
    if (msg) lastAnnouncement = msg;
    return msg;
  }

  function showStatus(elementId, text, isError = false, autoClearMs = 0) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (statusTimers.has(elementId)) {
      clearTimeout(statusTimers.get(elementId));
      statusTimers.delete(elementId);
    }

    const msg = dedupAnnouncement(text);
    el.setAttribute('data-state', isError ? 'error' : 'success');
    el.setAttribute('data-visible', msg ? 'true' : 'false');
    el.textContent = '';
    requestAnimationFrame(() => {
      el.textContent = msg;
    });

    if (autoClearMs > 0) {
      const timer = setTimeout(() => {
        el.setAttribute('data-visible', 'false');
        el.textContent = '';
      }, autoClearMs);
      statusTimers.set(elementId, timer);
    }
  }

  function applyLanguage() {
    currentLang = i18n.resolveLanguage(currentSettings.language);
    i18n.applyI18nToDocument(document, currentLang);
    document.title = tr('appTitle');
    updateSourceBadge();
    renderActiveSvgPreview();
  }

  function updateSourceBadge() {
    const badge = document.getElementById('source-badge');
    const sourceName = document.getElementById('source-name');
    if (!badge || !sourceName) return;

    if (activeSvg?.fileName) {
      badge.textContent = tr('fileLoadedBadge');
      sourceName.textContent = activeSvg.fileName;
      sourceName.hidden = false;
    } else {
      badge.textContent = tr('svgDetectedBadge');
      sourceName.textContent = '';
      sourceName.hidden = true;
    }
  }

  function applySettingsToForm(s) {
    document.getElementById('language').value = s.language;
    document.getElementById('monitorClipboard').checked = Boolean(s.monitorClipboard);
    document.getElementById('promptMode').value = s.promptMode;
    document.getElementById('saveWithSvg').checked = Boolean(s.saveWithSvg);
    document.getElementById('quick-save-svg').checked = Boolean(s.saveWithSvg);
    document.getElementById('scale').value = String(s.scale);
    document.getElementById('jpgQuality').value = String(s.jpgQuality);
    document.getElementById('jpgQualityValue').textContent = `${s.jpgQuality}%`;
    document.getElementById('jpgBgColor').value = s.jpgBgColor;
    document.getElementById('pngBackground').value = s.pngBackground;
    document.getElementById('pngBgColor').value = s.pngBgColor;
    document.getElementById('pngBgHex').textContent = s.pngBgColor;
    document.getElementById('pngBgColorField').hidden = s.pngBackground !== 'custom';
    document.getElementById('padding').value = String(s.padding);

    if (scaleOverride === null) {
      document.getElementById('quick-scale').value = String(s.scale);
    }
  }

  function readFormPartial() {
    return {
      language: document.getElementById('language').value,
      monitorClipboard: document.getElementById('monitorClipboard').checked,
      promptMode: document.getElementById('promptMode').value,
      saveWithSvg: document.getElementById('saveWithSvg').checked,
      scale: Number(document.getElementById('scale').value),
      jpgQuality: Number(document.getElementById('jpgQuality').value),
      jpgBgColor: document.getElementById('jpgBgColor').value,
      pngBackground: document.getElementById('pngBackground').value,
      pngBgColor: document.getElementById('pngBgColor').value,
      padding: Number(document.getElementById('padding').value),
    };
  }

  function renderActiveSvgPreview() {
    if (!activeSvg) return;
    const effectiveScale = scaleOverride ?? currentSettings.scale;
    const img = document.getElementById('preview-img');
    const dimsEl = document.getElementById('preview-dims');
    const box = document.getElementById('preview-box');

    try {
      const { svgEl } = svgUtils.parseSvgString(activeSvg.svgText);
      const prepared = svgUtils.prepareSvgForRasterization(svgEl, {
        scale: effectiveScale,
        padding: currentSettings.padding,
      });

      img.src = svgUtils.svgToDataUrl(prepared.svgXml);
      img.alt = tr('previewAlt', { title: activeSvg.fileName || svgUtils.extractSvgTitle(svgEl) || 'SVG' });

      const isTransparent = currentSettings.pngBackground === 'transparent';
      box.style.backgroundColor = isTransparent
        ? ''
        : (currentSettings.pngBackground === 'white' ? '#FFFFFF' : currentSettings.pngBgColor);

      const baseW = Math.round(prepared.baseDims.width);
      const baseH = Math.round(prepared.baseDims.height);
      dimsEl.textContent = `${baseW}×${baseH} → ${prepared.metrics.canvasWidth}×${prepared.metrics.canvasHeight}px`;
    } catch (err) {
      img.removeAttribute('src');
      dimsEl.textContent = tr('previewUnavailable', { error: err?.message || tr('unknownError') });
    }
  }

  function setActiveSvg(svgData) {
    activeSvg = svgData;
    const convertSec = document.getElementById('convert-section');
    const idleSec = document.getElementById('idle-section');
    const details = document.getElementById('settings-details');

    if (activeSvg) {
      convertSec.hidden = false;
      idleSec.hidden = true;
      details.open = false;
      document.getElementById('quick-scale').value = String(scaleOverride ?? currentSettings.scale);
      document.getElementById('quick-save-svg').checked = Boolean(currentSettings.saveWithSvg);
      showStatus('convert-status', '', false);
      updateSourceBadge();
      renderActiveSvgPreview();
    } else {
      convertSec.hidden = true;
      idleSec.hidden = false;
      details.open = true;
    }
  }

  async function detectCurrentSvg() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_PENDING_SVG' });
      if (resp?.pendingSvg?.svgText) {
        return resp.pendingSvg;
      }
    } catch {
      // Fall through to live clipboard check
    }

    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const text = await navigator.clipboard.readText();
        const extracted = svgUtils.extractSvgFromCode(text);
        if (extracted.status === 'complete' && extracted.svgText) {
          return {
            svgText: extracted.svgText,
            hash: svgUtils.hashSvgText(extracted.svgText),
          };
        }
      }
    } catch {
      // Clipboard read unavailable or denied
    }

    return null;
  }

  async function clearPendingInBackground(hash) {
    if (!hash) return;
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_SVG', hash });
    } catch {
      // Ignore if service worker unavailable
    }
  }

  async function loadDroppedFile(file) {
    if (!file) return;
    try {
      const loaded = await svgUtils.readSvgFromFile(file);
      showStatus('drop-status', '', false);
      setActiveSvg(loaded);
    } catch (err) {
      const msg = err?.code === 'INVALID_SVG_FILE'
        ? tr('dropInvalidFile', { name: err.fileName || file.name })
        : tr('dropReadError', { error: err?.message || tr('unknownError') });
      showStatus('drop-status', msg, true, 3000);
    }
  }

  async function handleConvertCopy(format) {
    if (!activeSvg) return;
    const effectiveSettings = {
      ...currentSettings,
      scale: scaleOverride ?? currentSettings.scale,
    };

    try {
      const res = await renderer.copySvgImageToClipboard(
        activeSvg.svgText,
        format,
        effectiveSettings
      );
      if (!activeSvg.fileName) {
        await clearPendingInBackground(activeSvg.hash);
      }
      const msg = format === 'jpeg'
        ? tr('copiedJpg', { quality: effectiveSettings.jpgQuality, width: res.width, height: res.height })
        : tr('copiedPng', { width: res.width, height: res.height });
      showStatus('convert-status', msg, false);
    } catch (err) {
      showStatus('convert-status', tr('copyFailed', { error: err?.message || tr('unknownError') }), true);
    }
  }

  async function handleConvertDownload(format) {
    if (!activeSvg) return;
    const effectiveSettings = {
      ...currentSettings,
      scale: scaleOverride ?? currentSettings.scale,
    };

    try {
      const res = await renderer.downloadSvgImage(
        activeSvg.svgText,
        format,
        effectiveSettings,
        {
          sourceFilename: activeSvg.fileName || '',
          revokeDelayMs: 5000,
        }
      );
      if (!activeSvg.fileName) {
        await clearPendingInBackground(activeSvg.hash);
      }
      const msg = res.svgFilename
        ? tr('savedImageWithSvg', { ext: res.ext.toUpperCase(), width: res.width, height: res.height })
        : tr('savedImageOnly', { ext: res.ext.toUpperCase(), width: res.width, height: res.height });
      showStatus('convert-status', msg, false);
    } catch (err) {
      showStatus('convert-status', tr('saveFailed', { error: err?.message || tr('unknownError') }), true);
    }
  }

  async function persistFromForm() {
    currentSettings = await settingsApi.saveSettings(readFormPartial());
    applySettingsToForm(currentSettings);
    applyLanguage();
    showStatus('save-status', tr('statusSaved'), false, 1800);
  }

  async function openDropConverterWindow() {
    const url = chrome.runtime.getURL('src/converter/converter.html');
    try {
      await chrome.windows.create({
        url,
        type: 'popup',
        width: 580,
        height: 720,
      });
      window.close();
    } catch {
      await chrome.tabs.create({ url });
      window.close();
    }
  }

  async function initPopup() {
    currentSettings = await settingsApi.loadSettings();
    applySettingsToForm(currentSettings);
    applyLanguage();

    const detected = await detectCurrentSvg();
    setActiveSvg(detected);

    // Quick JP / EN toggle in header
    document.getElementById('btn-lang-toggle').addEventListener('click', async () => {
      const nextLang = currentLang === 'ja' ? 'en' : 'ja';
      currentSettings = await settingsApi.saveSettings({ language: nextLang });
      applySettingsToForm(currentSettings);
      applyLanguage();
      showStatus('save-status', tr('statusSaved'), false, 1800);
    });

    // Open persistent Drag & Drop converter window
    document.getElementById('btn-open-drop-window').addEventListener('click', () => {
      void openDropConverterWindow();
    });

    // Inline quick controls on confirmation card
    document.getElementById('quick-scale').addEventListener('change', (event) => {
      const val = Number(event.target.value);
      scaleOverride = settingsApi.ALLOWED_SCALES.includes(val) ? val : null;
      renderActiveSvgPreview();
    });

    document.getElementById('quick-save-svg').addEventListener('change', async (event) => {
      currentSettings = await settingsApi.saveSettings({ saveWithSvg: event.target.checked });
      applySettingsToForm(currentSettings);
    });

    document.getElementById('btn-copy-png').addEventListener('click', () => {
      void handleConvertCopy('png');
    });
    document.getElementById('btn-copy-jpg').addEventListener('click', () => {
      void handleConvertCopy('jpeg');
    });
    document.getElementById('btn-save-png').addEventListener('click', () => {
      void handleConvertDownload('png');
    });
    document.getElementById('btn-save-jpg').addEventListener('click', () => {
      void handleConvertDownload('jpeg');
    });
    document.getElementById('btn-dismiss').addEventListener('click', async () => {
      if (activeSvg?.fileName) {
        setActiveSvg(null);
        return;
      }
      if (activeSvg?.hash) {
        await clearPendingInBackground(activeSvg.hash);
      }
      window.close();
    });

    document.getElementById('btn-recheck').addEventListener('click', async () => {
      const found = await detectCurrentSvg();
      if (found) {
        setActiveSvg(found);
      } else {
        showStatus('idle-status', tr('noSvgInClipboard'), true, 2400);
      }
    });

    // Direct Drop Zone & File Picker inside Popup
    const dropZone = document.getElementById('drop-zone');
    const dropLabel = document.getElementById('drop-zone-label');
    const fileInput = document.getElementById('file-input');

    const setDragState = (active) => {
      dropZone.setAttribute('data-dragover', active ? 'true' : 'false');
      dropLabel.textContent = active ? tr('dropZoneActive') : tr('dropZoneTitle');
    };

    dropZone.addEventListener('click', () => {
      fileInput.click();
    });
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void loadDroppedFile(file);
    });

    window.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      setDragState(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void loadDroppedFile(file);
    });
    dropZone.addEventListener('dragenter', (event) => {
      event.preventDefault();
      setDragState(true);
    });
    dropZone.addEventListener('dragleave', (event) => {
      if (!dropZone.contains(event.relatedTarget)) {
        setDragState(false);
      }
    });

    // Settings form bindings
    const form = document.getElementById('settings-form');
    const qualityInput = document.getElementById('jpgQuality');
    const qualityOutput = document.getElementById('jpgQualityValue');
    const pngBgSelect = document.getElementById('pngBackground');
    const pngBgColorField = document.getElementById('pngBgColorField');
    const pngBgColorInput = document.getElementById('pngBgColor');
    const pngBgHex = document.getElementById('pngBgHex');

    qualityInput.addEventListener('input', () => {
      qualityOutput.textContent = `${qualityInput.value}%`;
    });

    pngBgSelect.addEventListener('change', () => {
      pngBgColorField.hidden = pngBgSelect.value !== 'custom';
    });

    pngBgColorInput.addEventListener('input', () => {
      pngBgHex.textContent = pngBgColorInput.value.toUpperCase();
    });

    form.addEventListener('change', () => {
      void persistFromForm();
    });

    for (const swatch of document.querySelectorAll('.swatch')) {
      swatch.addEventListener('click', async () => {
        const targetId = swatch.dataset.target;
        const color = swatch.dataset.color;
        const input = document.getElementById(targetId);
        if (!input || !color) return;
        input.value = color;
        await persistFromForm();
      });
    }

    document.getElementById('reset-btn').addEventListener('click', async () => {
      currentSettings = await settingsApi.resetSettings();
      scaleOverride = null;
      applySettingsToForm(currentSettings);
      applyLanguage();
      showStatus('save-status', tr('statusReset'), false, 1800);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    void initPopup();
  });
})();
