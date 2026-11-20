(() => {
  'use strict';

  const ns = globalThis.GeminiSvgExporter;
  if (!ns || !ns.settings || !ns.i18n || !ns.svgUtils || !ns.renderer) {
    return;
  }

  const { settings: settingsApi, i18n, svgUtils, renderer } = ns;

  const HOOK_SOURCE = 'gse-clipboard-hook';
  const PASSIVE_CHECK_THROTTLE_MS = 1200;
  const USER_GESTURE_WINDOW_MS = 2000;
  const TOAST_DURATION_MS = 4000;

  let currentSettings = { ...settingsApi.DEFAULT_SETTINGS };
  let currentLang = 'ja';
  let currentTheme = 'dark';
  let lastPassiveCheckAt = 0;
  let lastUserInputAt = 0;
  let lastAnnouncement = '';
  let activePromptState = null;

  const activeToasts = [];

  function tr(key, params) {
    return i18n.t(currentLang, key, params);
  }

  function detectPageTheme() {
    const candidates = [document.body, document.documentElement];
    for (const el of candidates) {
      if (!el) continue;
      const bg = globalThis.getComputedStyle(el).backgroundColor;
      const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(bg);
      if (rgb) {
        const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
        if (alpha > 0.1) {
          const lum = 0.2126 * Number(rgb[1]) + 0.7152 * Number(rgb[2]) + 0.0722 * Number(rgb[3]);
          return lum < 128 ? 'dark' : 'light';
        }
      }
    }
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    currentTheme = detectPageTheme();
    const dialog = document.getElementById('gse-prompt-dialog');
    if (dialog) {
      dialog.setAttribute('data-gse-theme', currentTheme);
    }
    const toastRegion = document.getElementById('gse-toast-region');
    if (toastRegion) {
      toastRegion.setAttribute('data-gse-theme', currentTheme);
    }
  }

  function measureSvgBBoxInPage(svgEl) {
    if (!document.body) return null;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:-9999px;visibility:hidden;pointer-events:none;inline-size:0;block-size:0;overflow:hidden;';
    let imported;
    try {
      const safeForDom = svgUtils.stripUnsafeDomMeasurementNodes(svgEl);
      imported = document.importNode(safeForDom, true);
    } catch {
      return null;
    }
    if (!imported.getAttribute('xmlns')) {
      imported.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    host.append(imported);
    document.body.append(host);
    try {
      const box = imported.getBBox?.();
      if (!box || box.width <= 0 || box.height <= 0) return null;
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    } finally {
      host.remove();
    }
  }

  async function safeSendRuntimeMessage(payload) {
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch {
      return null;
    }
  }

  function getToastRegion() {
    let region = document.getElementById('gse-toast-region');
    if (region) {
      region.setAttribute('aria-label', tr('toastRegionAria'));
      return region;
    }

    region = document.createElement('div');
    region.id = 'gse-toast-region';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', tr('toastRegionAria'));
    region.setAttribute('data-gse-theme', currentTheme);

    const liveRegion = document.createElement('div');
    liveRegion.className = 'gse-sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.id = 'gse-toast-live';
    region.append(liveRegion);

    document.body.append(region);
    return region;
  }

  function announceMessage(message) {
    let text = String(message || '').trim();
    if (!text) return;

    if (typeof document.ariaNotify === 'function') {
      try {
        document.ariaNotify(text);
        return;
      } catch {
        // Fall through to aria-live region
      }
    }

    if (text === lastAnnouncement) {
      text += '\u00A0';
    }
    lastAnnouncement = text;

    getToastRegion();
    const live = document.getElementById('gse-toast-live');
    if (live) {
      live.textContent = '';
      requestAnimationFrame(() => {
        live.textContent = text;
      });
    }
  }

  function repositionToasts() {
    let offset = 0;
    for (let i = activeToasts.length - 1; i >= 0; i--) {
      const item = activeToasts[i];
      item.el.style.setProperty('--gse-toast-offset', `${offset}px`);
      const h = item.el.offsetHeight || 44;
      offset += h + 10;
    }
  }

  function dismissToast(entry, restoreFocus = false) {
    const idx = activeToasts.indexOf(entry);
    if (idx === -1) return;

    clearTimeout(entry.timer);
    const hadFocus = entry.el.contains(document.activeElement);
    activeToasts.splice(idx, 1);

    try {
      if (typeof entry.el.hidePopover === 'function' && entry.el.matches(':popover-open')) {
        entry.el.hidePopover();
      } else {
        entry.el.classList.remove(':popover-open');
      }
    } catch {
      entry.el.classList.remove(':popover-open');
    }

    entry.el.remove();
    repositionToasts();

    if (restoreFocus && hadFocus) {
      const nextToast = activeToasts[activeToasts.length - 1];
      if (nextToast) {
        nextToast.closeBtn.focus();
      } else if (entry.priorFocus && entry.priorFocus.isConnected) {
        entry.priorFocus.focus();
      }
    }
  }

  function showToast(message, variant = 'success') {
    const region = getToastRegion();
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const toast = document.createElement('div');
    toast.className = 'gse-toast';
    toast.setAttribute('popover', 'manual');
    toast.setAttribute('data-variant', variant);

    const msgEl = document.createElement('span');
    msgEl.className = 'gse-toast-msg';
    msgEl.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gse-toast-close';
    closeBtn.setAttribute('aria-label', tr('btnCloseToast'));
    closeBtn.textContent = '✕';

    toast.append(msgEl, closeBtn);
    region.append(toast);

    const entry = {
      el: toast,
      closeBtn,
      priorFocus,
      timer: null,
      paused: false,
    };

    const scheduleDismiss = () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (!entry.paused && !toast.contains(document.activeElement)) {
          dismissToast(entry, false);
        }
      }, TOAST_DURATION_MS);
    };

    toast.addEventListener('focusin', () => {
      entry.paused = true;
      clearTimeout(entry.timer);
    });
    toast.addEventListener('focusout', () => {
      entry.paused = false;
      if (!toast.contains(document.activeElement)) {
        scheduleDismiss();
      }
    });
    toast.addEventListener('pointerenter', () => {
      entry.paused = true;
      clearTimeout(entry.timer);
    });
    toast.addEventListener('pointerleave', () => {
      entry.paused = false;
      if (!toast.contains(document.activeElement)) {
        scheduleDismiss();
      }
    });
    closeBtn.addEventListener('click', () => dismissToast(entry, true));

    activeToasts.push(entry);

    try {
      if (typeof toast.showPopover === 'function') {
        toast.showPopover();
      } else {
        toast.classList.add(':popover-open');
      }
    } catch {
      toast.classList.add(':popover-open');
    }

    repositionToasts();
    scheduleDismiss();
    announceMessage(message);

    while (activeToasts.length > 3) {
      dismissToast(activeToasts[0], false);
    }
  }

  function closePromptDialog(clearPending = false) {
    const dialog = document.getElementById('gse-prompt-dialog');
    if (dialog) {
      try {
        if (typeof dialog.hidePopover === 'function' && dialog.matches(':popover-open')) {
          dialog.hidePopover();
        } else {
          dialog.classList.remove(':popover-open');
        }
      } catch {
        dialog.classList.remove(':popover-open');
      }
    }

    const hash = activePromptState?.hash || '';
    activePromptState = null;

    if (clearPending && hash) {
      void safeSendRuntimeMessage({ type: 'CLEAR_PENDING_SVG', hash });
    }
  }

  function applyDialogStrings(dialog) {
    if (!dialog) return;
    dialog.querySelector('#gse-prompt-title').textContent = tr('overlayTitle');
    dialog.querySelector('.gse-btn-close').setAttribute('aria-label', tr('btnClose'));
    dialog.querySelector('.gse-dialog-question').textContent = tr('overlayQuestion');
    dialog.querySelector('.gse-scale-text').textContent = tr('scaleLabel');
    dialog.querySelector('.gse-scale-select').setAttribute('aria-label', tr('quickScaleAria'));
    dialog.querySelector('.gse-save-svg-text').textContent = tr('saveWithSvgShort');
    dialog.querySelector('[data-action="copy-png"]').textContent = tr('btnCopyPng');
    dialog.querySelector('[data-action="copy-jpg"]').textContent = tr('btnCopyJpg');
    dialog.querySelector('[data-action="download-png"]').textContent = tr('btnSavePng');
    dialog.querySelector('[data-action="download-jpg"]').textContent = tr('btnSaveJpg');
    dialog.querySelector('[data-action="dismiss"].gse-btn').textContent = tr('btnDismiss');
  }

  function updateOverlayPreview(dialog, state) {
    const scale = state.scaleOverride ?? currentSettings.scale;
    const img = dialog.querySelector('.gse-preview-img');
    const dimsEl = dialog.querySelector('.gse-dims');

    try {
      const { svgEl } = svgUtils.parseSvgString(state.svgText);
      const prepared = svgUtils.prepareSvgForRasterization(svgEl, {
        scale,
        padding: currentSettings.padding,
        measureBBoxFn: measureSvgBBoxInPage,
      });

      img.src = svgUtils.svgToDataUrl(prepared.svgXml);
      img.alt = tr('previewAlt', { title: svgUtils.extractSvgTitle(svgEl) || 'SVG' });
      const baseW = Math.round(prepared.baseDims.width);
      const baseH = Math.round(prepared.baseDims.height);
      dimsEl.textContent = `${baseW}×${baseH} → ${prepared.metrics.canvasWidth}×${prepared.metrics.canvasHeight}px`;
    } catch (err) {
      img.removeAttribute('src');
      dimsEl.textContent = tr('previewUnavailable', { error: err?.message || tr('unknownError') });
    }
  }

  function setDialogStatus(dialog, text, isError = false) {
    const statusEl = dialog.querySelector('.gse-dialog-status');
    if (!statusEl) return;
    let msg = String(text || '');
    if (msg && msg === lastAnnouncement) {
      msg += '\u00A0';
    }
    if (msg) lastAnnouncement = msg;

    statusEl.setAttribute('data-state', isError ? 'error' : 'success');
    statusEl.setAttribute('data-visible', msg ? 'true' : 'false');
    statusEl.textContent = '';
    requestAnimationFrame(() => {
      statusEl.textContent = msg;
    });
  }

  function ensurePromptDialog() {
    let dialog = document.getElementById('gse-prompt-dialog');
    if (dialog) {
      applyDialogStrings(dialog);
      return dialog;
    }

    dialog = document.createElement('dialog');
    dialog.id = 'gse-prompt-dialog';
    dialog.className = 'gse-dialog';
    dialog.setAttribute('popover', 'manual');
    dialog.setAttribute('aria-labelledby', 'gse-prompt-title');
    dialog.setAttribute('data-gse-theme', currentTheme);

    const header = document.createElement('div');
    header.className = 'gse-dialog-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'gse-dialog-title-wrap';
    const badge = document.createElement('span');
    badge.className = 'gse-badge';
    badge.textContent = 'SVG';
    const title = document.createElement('h2');
    title.id = 'gse-prompt-title';
    title.className = 'gse-dialog-title';
    titleWrap.append(badge, title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gse-btn-close';
    closeBtn.dataset.action = 'dismiss';
    closeBtn.textContent = '✕';

    header.append(titleWrap, closeBtn);

    const question = document.createElement('p');
    question.className = 'gse-dialog-question';

    const previewBox = document.createElement('div');
    previewBox.className = 'gse-preview-box';
    const previewImg = document.createElement('img');
    previewImg.className = 'gse-preview-img';
    previewBox.append(previewImg);

    const metaRow = document.createElement('div');
    metaRow.className = 'gse-meta-row';
    const dims = document.createElement('span');
    dims.className = 'gse-dims';

    const scaleWrap = document.createElement('label');
    scaleWrap.className = 'gse-scale-wrap';
    const scaleText = document.createElement('span');
    scaleText.className = 'gse-scale-text';
    const scaleSelect = document.createElement('select');
    scaleSelect.className = 'gse-scale-select';
    for (const s of settingsApi.ALLOWED_SCALES) {
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = `${s}x`;
      scaleSelect.append(opt);
    }
    scaleWrap.append(scaleText, scaleSelect);
    metaRow.append(dims, scaleWrap);

    const saveSvgRow = document.createElement('label');
    saveSvgRow.className = 'gse-save-svg-row';
    const saveSvgCheck = document.createElement('input');
    saveSvgCheck.type = 'checkbox';
    saveSvgCheck.className = 'gse-save-svg-check';
    const saveSvgText = document.createElement('span');
    saveSvgText.className = 'gse-save-svg-text';
    saveSvgRow.append(saveSvgCheck, saveSvgText);

    const primaryRow = document.createElement('div');
    primaryRow.className = 'gse-actions-primary';

    const copyPngBtn = document.createElement('button');
    copyPngBtn.type = 'button';
    copyPngBtn.className = 'gse-btn gse-btn-primary';
    copyPngBtn.dataset.action = 'copy-png';

    const copyJpgBtn = document.createElement('button');
    copyJpgBtn.type = 'button';
    copyJpgBtn.className = 'gse-btn gse-btn-primary';
    copyJpgBtn.dataset.action = 'copy-jpg';

    primaryRow.append(copyPngBtn, copyJpgBtn);

    const secondaryRow = document.createElement('div');
    secondaryRow.className = 'gse-actions-secondary';

    const savePngBtn = document.createElement('button');
    savePngBtn.type = 'button';
    savePngBtn.className = 'gse-btn';
    savePngBtn.dataset.action = 'download-png';

    const saveJpgBtn = document.createElement('button');
    saveJpgBtn.type = 'button';
    saveJpgBtn.className = 'gse-btn';
    saveJpgBtn.dataset.action = 'download-jpg';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gse-btn';
    cancelBtn.dataset.action = 'dismiss';

    secondaryRow.append(savePngBtn, saveJpgBtn, cancelBtn);

    const status = document.createElement('p');
    status.className = 'gse-dialog-status';
    status.setAttribute('role', 'status');

    dialog.append(header, question, previewBox, metaRow, saveSvgRow, primaryRow, secondaryRow, status);
    applyDialogStrings(dialog);

    scaleSelect.addEventListener('change', () => {
      if (!activePromptState) return;
      const parsed = Number(scaleSelect.value);
      activePromptState.scaleOverride = settingsApi.ALLOWED_SCALES.includes(parsed) ? parsed : null;
      updateOverlayPreview(dialog, activePromptState);
    });

    saveSvgCheck.addEventListener('change', async () => {
      currentSettings = await settingsApi.saveSettings({ saveWithSvg: saveSvgCheck.checked });
    });

    dialog.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn || !activePromptState) return;
      void handleOverlayAction(dialog, btn, activePromptState);
    });

    document.body.append(dialog);
    return dialog;
  }

  async function handleOverlayAction(dialog, button, state) {
    const action = button.dataset.action;
    if (action === 'dismiss') {
      closePromptDialog(true);
      return;
    }

    const effectiveSettings = {
      ...currentSettings,
      scale: state.scaleOverride ?? currentSettings.scale,
    };

    if (action === 'copy-png' || action === 'copy-jpg') {
      const format = action === 'copy-jpg' ? 'jpeg' : 'png';
      try {
        const res = await renderer.copySvgImageToClipboard(
          state.svgText,
          format,
          effectiveSettings,
          { measureBBoxFn: measureSvgBBoxInPage }
        );
        const msg = format === 'jpeg'
          ? tr('copiedJpg', { quality: effectiveSettings.jpgQuality, width: res.width, height: res.height })
          : tr('copiedPng', { width: res.width, height: res.height });
        closePromptDialog(true);
        showToast(msg, 'success');
      } catch (err) {
        button.setAttribute('data-failed', '');
        setDialogStatus(dialog, tr('copyFailed', { error: err?.message || tr('unknownError') }), true);
      }
      return;
    }

    if (action === 'download-png' || action === 'download-jpg') {
      const format = action === 'download-jpg' ? 'jpeg' : 'png';
      try {
        const res = await renderer.downloadSvgImage(
          state.svgText,
          format,
          effectiveSettings,
          { measureBBoxFn: measureSvgBBoxInPage }
        );
        const msg = res.svgFilename
          ? tr('savedImageWithSvg', { ext: res.ext.toUpperCase(), width: res.width, height: res.height })
          : tr('savedImageOnly', { ext: res.ext.toUpperCase(), width: res.width, height: res.height });
        closePromptDialog(true);
        showToast(msg, 'success');
      } catch (err) {
        setDialogStatus(dialog, tr('saveFailed', { error: err?.message || tr('unknownError') }), true);
      }
    }
  }

  function showOverlayPrompt(svgText, hash) {
    applyTheme();
    const dialog = ensurePromptDialog();
    activePromptState = {
      svgText,
      hash,
      scaleOverride: null,
    };

    const scaleSelect = dialog.querySelector('.gse-scale-select');
    if (scaleSelect) {
      scaleSelect.value = String(currentSettings.scale);
    }
    const saveSvgCheck = dialog.querySelector('.gse-save-svg-check');
    if (saveSvgCheck) {
      saveSvgCheck.checked = Boolean(currentSettings.saveWithSvg);
    }
    for (const btn of dialog.querySelectorAll('.gse-btn')) {
      btn.removeAttribute('data-copied');
      btn.removeAttribute('data-failed');
    }
    setDialogStatus(dialog, '', false);
    updateOverlayPreview(dialog, activePromptState);

    try {
      if (typeof dialog.showPopover === 'function') {
        if (!dialog.matches(':popover-open')) {
          dialog.showPopover();
        }
      } else {
        dialog.classList.add(':popover-open');
      }
    } catch {
      dialog.classList.add(':popover-open');
    }
  }

  function handleDetectedText(rawText, trigger) {
    if (!currentSettings.monitorClipboard) return;
    const extracted = svgUtils.extractSvgFromCode(rawText);
    if (extracted.status !== 'complete' || !extracted.svgText) return;

    void safeSendRuntimeMessage({
      type: 'SVG_CLIPBOARD_DETECTED',
      svgText: extracted.svgText,
      trigger,
    });
  }

  function requestPassiveClipboardCheck() {
    if (!currentSettings.monitorClipboard) return;
    const now = Date.now();
    if (now - lastPassiveCheckAt < PASSIVE_CHECK_THROTTLE_MS) return;
    lastPassiveCheckAt = now;

    void safeSendRuntimeMessage({
      type: 'READ_AND_CHECK_CLIPBOARD',
      trigger: 'passive',
    });
  }

  function hasRecentUserActivation() {
    if (globalThis.navigator?.userActivation?.isActive) {
      return true;
    }
    return (Date.now() - lastUserInputAt) <= USER_GESTURE_WINDOW_MS;
  }

  async function init() {
    currentSettings = await settingsApi.loadSettings();
    currentLang = i18n.resolveLanguage(currentSettings.language);
    applyTheme();

    const recordUserInput = () => {
      lastUserInputAt = Date.now();
    };
    document.addEventListener('pointerdown', recordUserInput, true);
    document.addEventListener('keydown', recordUserInput, true);

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (!event.data || event.data.source !== HOOK_SOURCE) return;
      if (typeof event.data.text !== 'string') return;
      if (event.data.text.length > svgUtils.MAX_SVG_INPUT_BYTES) return;
      // Ignore unsolicited postMessages from page scripts without active user interaction
      if (!hasRecentUserActivation()) return;
      handleDetectedText(event.data.text, 'explicit');
    });

    document.addEventListener('copy', (event) => {
      if (!currentSettings.monitorClipboard) return;
      const directText = event.clipboardData?.getData('text/plain') || '';
      const selectedText = globalThis.getSelection?.()?.toString() || '';
      const candidate = directText || selectedText;

      if (candidate) {
        const extracted = svgUtils.extractSvgFromCode(candidate);
        if (extracted.status === 'complete' && extracted.svgText) {
          setTimeout(() => {
            void safeSendRuntimeMessage({
              type: 'SVG_CLIPBOARD_DETECTED',
              svgText: extracted.svgText,
              trigger: 'explicit',
            });
          }, 60);
        }
        // Normal non-SVG text was selected: do not trigger unnecessary offscreen clipboard read
        return;
      }

      // Only fall back to offscreen clipboard read when copy event had no readable selection
      setTimeout(() => {
        void safeSendRuntimeMessage({
          type: 'READ_AND_CHECK_CLIPBOARD',
          trigger: 'explicit',
        });
      }, 100);
    }, true);

    window.addEventListener('focus', () => {
      requestPassiveClipboardCheck();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestPassiveClipboardCheck();
      }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === 'SHOW_OVERLAY_PROMPT' && typeof message.svgText === 'string') {
        showOverlayPrompt(message.svgText, message.hash || '');
        sendResponse({ ok: true });
      }
      return undefined;
    });

    if (globalThis.chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') return;
        const partial = {};
        for (const [k, change] of Object.entries(changes)) {
          partial[k] = change.newValue;
        }
        currentSettings = settingsApi.sanitizeSettings({
          ...currentSettings,
          ...partial,
        });
        currentLang = i18n.resolveLanguage(currentSettings.language);

        const dialog = document.getElementById('gse-prompt-dialog');
        if (dialog) {
          applyDialogStrings(dialog);
          const saveSvgCheck = dialog.querySelector('.gse-save-svg-check');
          if (saveSvgCheck) {
            saveSvgCheck.checked = Boolean(currentSettings.saveWithSvg);
          }
          if (activePromptState) {
            if (activePromptState.scaleOverride === null) {
              const sel = dialog.querySelector('.gse-scale-select');
              if (sel) sel.value = String(currentSettings.scale);
            }
            updateOverlayPreview(dialog, activePromptState);
          }
        }
      });
    }

    const mediaQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    mediaQuery?.addEventListener('change', applyTheme);
  }

  void init();
})();
