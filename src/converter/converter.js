(() => {
  'use strict';

  const ns = globalThis.GeminiSvgExporter;
  if (!ns || !ns.settings || !ns.i18n || !ns.svgUtils || !ns.renderer) return;

  const { settings: settingsApi, i18n, svgUtils, renderer } = ns;

  let currentSettings = { ...settingsApi.DEFAULT_SETTINGS };
  let currentLang = 'ja';
  let loadedItems = []; // [{ id, svgText, hash, fileName, thumbUrl }]
  let selectedId = null;
  let itemSeq = 0;
  let lastAnnouncement = '';
  let dragDepth = 0;

  function tr(key, params) {
    return i18n.t(currentLang, key, params);
  }

  function showGlobalStatus(text, isError = false) {
    const el = document.getElementById('global-status');
    if (!el) return;
    let msg = String(text || '');
    if (msg && msg === lastAnnouncement) {
      msg += '\u00A0';
    }
    if (msg) lastAnnouncement = msg;

    el.setAttribute('data-state', isError ? 'error' : 'success');
    el.setAttribute('data-visible', msg ? 'true' : 'false');
    el.textContent = '';
    requestAnimationFrame(() => {
      el.textContent = msg;
    });
  }

  function applySettingsToControls() {
    document.getElementById('opt-scale').value = String(currentSettings.scale);
    document.getElementById('opt-png-bg').value = currentSettings.pngBackground;
    document.getElementById('opt-jpg-bg').value = currentSettings.jpgBgColor;
    document.getElementById('opt-save-svg').checked = Boolean(currentSettings.saveWithSvg);
  }

  function applyLanguage() {
    currentLang = i18n.resolveLanguage(currentSettings.language);
    i18n.applyI18nToDocument(document, currentLang);
    document.title = tr('converterTitle');
    renderQueue();
    renderSelectedWorkspace();
  }

  function getSelectedItem() {
    return loadedItems.find((item) => item.id === selectedId) || null;
  }

  function renderSelectedWorkspace() {
    const item = getSelectedItem();
    const workspace = document.getElementById('workspace-section');
    const emptyHint = document.getElementById('empty-hint');

    if (!item) {
      workspace.hidden = true;
      emptyHint.hidden = false;
      return;
    }

    workspace.hidden = false;
    emptyHint.hidden = true;

    const nameEl = document.getElementById('active-filename');
    const dimsEl = document.getElementById('active-dims');
    const img = document.getElementById('preview-img');
    const box = document.getElementById('preview-box');

    nameEl.textContent = item.fileName;

    try {
      const { svgEl } = svgUtils.parseSvgString(item.svgText);
      const prepared = svgUtils.prepareSvgForRasterization(svgEl, {
        scale: currentSettings.scale,
        padding: currentSettings.padding,
      });

      const dataUrl = svgUtils.svgToDataUrl(prepared.svgXml);
      item.thumbUrl = dataUrl;
      img.src = dataUrl;
      img.alt = tr('previewAlt', { title: item.fileName });

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

  function renderQueue() {
    const queueSec = document.getElementById('queue-section');
    const heading = document.getElementById('queue-heading');
    const list = document.getElementById('file-list');

    if (loadedItems.length === 0) {
      queueSec.hidden = true;
      list.textContent = '';
      return;
    }

    queueSec.hidden = false;
    heading.textContent = tr('converterFileListHeading', { count: loadedItems.length });
    list.textContent = '';

    for (const item of loadedItems) {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.setAttribute('data-selected', item.id === selectedId ? 'true' : 'false');

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'file-select-btn';

      const thumb = document.createElement('img');
      thumb.className = 'file-thumb';
      thumb.alt = '';
      if (item.thumbUrl) {
        thumb.src = item.thumbUrl;
      }

      const label = document.createElement('span');
      label.className = 'file-label';
      label.textContent = item.fileName;

      selectBtn.append(thumb, label);
      selectBtn.addEventListener('click', () => {
        selectedId = item.id;
        renderQueue();
        renderSelectedWorkspace();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'file-remove-btn';
      removeBtn.setAttribute('aria-label', tr('converterRemoveItem'));
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        loadedItems = loadedItems.filter((x) => x.id !== item.id);
        if (selectedId === item.id) {
          selectedId = loadedItems[0]?.id ?? null;
        }
        renderQueue();
        renderSelectedWorkspace();
      });

      li.append(selectBtn, removeBtn);
      list.append(li);
    }
  }

  function makeThumbUrl(svgText) {
    try {
      const { svgEl } = svgUtils.parseSvgString(svgText);
      const prepared = svgUtils.prepareSvgForRasterization(svgEl, { scale: 1, padding: 0 });
      return svgUtils.svgToDataUrl(prepared.svgXml);
    } catch {
      return '';
    }
  }

  function addSvgEntry({ svgText, hash, fileName }) {
    itemSeq += 1;
    const entry = {
      id: `svg-${itemSeq}`,
      svgText,
      hash,
      fileName,
      thumbUrl: makeThumbUrl(svgText),
    };
    loadedItems.unshift(entry);
    selectedId = entry.id;
  }

  async function ingestFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    let added = 0;
    let lastErr = '';

    for (const file of files) {
      try {
        const parsed = await svgUtils.readSvgFromFile(file);
        addSvgEntry(parsed);
        added += 1;
      } catch (err) {
        lastErr = err?.code === 'INVALID_SVG_FILE'
          ? tr('dropInvalidFile', { name: err.fileName || file.name })
          : tr('dropReadError', { error: err?.message || tr('unknownError') });
      }
    }

    renderQueue();
    renderSelectedWorkspace();

    if (lastErr && added === 0) {
      showGlobalStatus(lastErr, true);
    } else if (lastErr) {
      showGlobalStatus(lastErr, true);
    } else {
      showGlobalStatus('', false);
    }
  }

  async function handleCopy(format) {
    const item = getSelectedItem();
    if (!item) return;

    try {
      const res = await renderer.copySvgImageToClipboard(item.svgText, format, currentSettings);
      const msg = format === 'jpeg'
        ? tr('copiedJpg', { quality: currentSettings.jpgQuality, width: res.width, height: res.height })
        : tr('copiedPng', { width: res.width, height: res.height });
      showGlobalStatus(msg, false);
    } catch (err) {
      showGlobalStatus(tr('copyFailed', { error: err?.message || tr('unknownError') }), true);
    }
  }

  async function handleDownload(format) {
    const item = getSelectedItem();
    if (!item) return;

    try {
      const res = await renderer.downloadSvgImage(item.svgText, format, currentSettings, {
        sourceFilename: item.fileName,
        revokeDelayMs: 5000,
      });
      const msg = res.svgFilename
        ? tr('savedImageWithSvg', { ext: res.ext.toUpperCase(), width: res.width, height: res.height })
        : tr('savedImageOnly', { ext: res.ext.toUpperCase(), width: res.width, height: res.height });
      showGlobalStatus(msg, false);
    } catch (err) {
      showGlobalStatus(tr('saveFailed', { error: err?.message || tr('unknownError') }), true);
    }
  }

  async function handleBatchDownload(format) {
    if (loadedItems.length === 0) return;
    let savedCount = 0;

    try {
      for (const item of loadedItems) {
        await renderer.downloadSvgImage(item.svgText, format, currentSettings, {
          sourceFilename: item.fileName,
          revokeDelayMs: 5000,
          downloadGapMs: 180,
        });
        savedCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
      const ext = format === 'jpeg' ? 'JPG' : 'PNG';
      const msg = currentSettings.saveWithSvg
        ? tr('converterBatchDoneWithSvg', { count: savedCount, ext })
        : tr('converterBatchDone', { count: savedCount, ext });
      showGlobalStatus(msg, false);
    } catch (err) {
      showGlobalStatus(tr('saveFailed', { error: err?.message || tr('unknownError') }), true);
    }
  }

  async function initConverter() {
    currentSettings = await settingsApi.loadSettings();
    applySettingsToControls();
    applyLanguage();

    const dropArea = document.getElementById('drop-area');
    const dropText = document.getElementById('drop-main-text');
    const fileInput = document.getElementById('file-input');

    const setDragActive = (active) => {
      dropArea.setAttribute('data-dragover', active ? 'true' : 'false');
      dropText.textContent = active ? tr('dropZoneActive') : tr('converterDropMain');
    };

    dropArea.addEventListener('click', () => fileInput.click());
    dropArea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      const files = fileInput.files;
      if (files && files.length > 0) {
        void ingestFiles(files);
      }
      fileInput.value = '';
    });

    // Full-window drag & drop so Chrome never navigates to the dropped SVG file
    window.addEventListener('dragenter', (event) => {
      event.preventDefault();
      dragDepth += 1;
      setDragActive(true);
    });
    window.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    });
    window.addEventListener('dragleave', (event) => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDragActive(false);
      }
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      dragDepth = 0;
      setDragActive(false);
      if (event.dataTransfer?.files?.length) {
        void ingestFiles(event.dataTransfer.files);
      }
    });

    // Also allow pasting SVG code directly via Ctrl+V
    window.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain') || '';
      const extracted = svgUtils.extractSvgFromCode(text, 'svg');
      if (extracted.status === 'complete' && extracted.svgText) {
        addSvgEntry({
          svgText: extracted.svgText,
          hash: svgUtils.hashSvgText(extracted.svgText),
          fileName: `${tr('converterPastedSvg')}.svg`,
        });
        renderQueue();
        renderSelectedWorkspace();
        showGlobalStatus('', false);
      }
    });

    document.getElementById('btn-lang-toggle').addEventListener('click', async () => {
      const nextLang = currentLang === 'ja' ? 'en' : 'ja';
      currentSettings = await settingsApi.saveSettings({ language: nextLang });
      applySettingsToControls();
      applyLanguage();
    });

    document.getElementById('opt-scale').addEventListener('change', async (e) => {
      currentSettings = await settingsApi.saveSettings({ scale: Number(e.target.value) });
      renderSelectedWorkspace();
    });
    document.getElementById('opt-png-bg').addEventListener('change', async (e) => {
      currentSettings = await settingsApi.saveSettings({ pngBackground: e.target.value });
      renderSelectedWorkspace();
    });
    document.getElementById('opt-jpg-bg').addEventListener('change', async (e) => {
      currentSettings = await settingsApi.saveSettings({ jpgBgColor: e.target.value });
    });
    document.getElementById('opt-save-svg').addEventListener('change', async (e) => {
      currentSettings = await settingsApi.saveSettings({ saveWithSvg: e.target.checked });
    });

    document.getElementById('btn-copy-png').addEventListener('click', () => { void handleCopy('png'); });
    document.getElementById('btn-copy-jpg').addEventListener('click', () => { void handleCopy('jpeg'); });
    document.getElementById('btn-save-png').addEventListener('click', () => { void handleDownload('png'); });
    document.getElementById('btn-save-jpg').addEventListener('click', () => { void handleDownload('jpeg'); });

    document.getElementById('btn-batch-png').addEventListener('click', () => { void handleBatchDownload('png'); });
    document.getElementById('btn-batch-jpg').addEventListener('click', () => { void handleBatchDownload('jpeg'); });
    document.getElementById('btn-clear-all').addEventListener('click', () => {
      loadedItems = [];
      selectedId = null;
      renderQueue();
      renderSelectedWorkspace();
      showGlobalStatus('', false);
    });

    if (globalThis.chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') return;
        const partial = {};
        for (const [k, change] of Object.entries(changes)) {
          partial[k] = change.newValue;
        }
        currentSettings = settingsApi.sanitizeSettings({ ...currentSettings, ...partial });
        applySettingsToControls();
        applyLanguage();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    void initConverter();
  });
})();
