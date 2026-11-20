(() => {
  'use strict';

  const EXPLICIT_DEDUP_MS = 1200;
  const MAX_SESSION_SVG_BYTES = 2 * 1024 * 1024; // 2 MB cap for chrome.storage.session
  const SESSION_KEYS = Object.freeze({
    pendingSvg: 'pendingSvg',
    lastPromptedHash: 'lastPromptedHash',
    lastPromptedAt: 'lastPromptedAt',
    lastHandledHash: 'lastHandledHash',
  });

  function getDeps(overrides = {}) {
    const settingsApi = overrides.settingsApi
      || globalThis.GeminiSvgExporter?.settings
      || (typeof require === 'function' ? require('../shared/settings.js') : null);
    const svgUtils = overrides.svgUtils
      || globalThis.GeminiSvgExporter?.svgUtils
      || (typeof require === 'function' ? require('../shared/svg-utils.js') : null);

    if (!settingsApi || !svgUtils) {
      throw new Error('共有モジュール (settings / svgUtils) の読み込みに失敗しました');
    }

    return {
      settingsApi,
      svgUtils,
      sessionStorage: overrides.sessionStorage || globalThis.chrome?.storage?.session,
      syncStorage: overrides.syncStorage || globalThis.chrome?.storage?.sync,
      openPopup: overrides.openPopup,
      showOverlay: overrides.showOverlay,
      setBadge: overrides.setBadge,
      now: overrides.now || (() => Date.now()),
    };
  }

  async function readSessionState(sessionStorage) {
    if (!sessionStorage || typeof sessionStorage.get !== 'function') {
      return {
        pendingSvg: null,
        lastPromptedHash: '',
        lastPromptedAt: 0,
        lastHandledHash: '',
      };
    }
    const stored = await sessionStorage.get({
      [SESSION_KEYS.pendingSvg]: null,
      [SESSION_KEYS.lastPromptedHash]: '',
      [SESSION_KEYS.lastPromptedAt]: 0,
      [SESSION_KEYS.lastHandledHash]: '',
    });
    return {
      pendingSvg: stored[SESSION_KEYS.pendingSvg] || null,
      lastPromptedHash: String(stored[SESSION_KEYS.lastPromptedHash] || ''),
      lastPromptedAt: Number(stored[SESSION_KEYS.lastPromptedAt] || 0),
      lastHandledHash: String(stored[SESSION_KEYS.lastHandledHash] || ''),
    };
  }

  async function handleClipboardText(rawText, options = {}, overrides = {}) {
    const deps = getDeps(overrides);
    const trigger = options.trigger === 'passive' ? 'passive' : 'explicit';
    const tabId = options.tabId ?? null;

    const currentSettings = await deps.settingsApi.loadSettings(deps.syncStorage);
    if (!currentSettings.monitorClipboard) {
      return { action: 'disabled' };
    }

    const extracted = deps.svgUtils.extractSvgFromCode(rawText);
    if (extracted.status !== 'complete' || !extracted.svgText) {
      return { action: 'ignored', reason: extracted.status };
    }

    const svgText = extracted.svgText;
    if (svgText.length > MAX_SESSION_SVG_BYTES) {
      return { action: 'ignored', reason: 'too-large' };
    }
    const hash = deps.svgUtils.hashSvgText(svgText);
    const session = await readSessionState(deps.sessionStorage);
    const nowMs = deps.now();

    if (trigger === 'passive') {
      if (hash === session.lastHandledHash || hash === session.lastPromptedHash) {
        return { action: 'deduped', hash };
      }
    } else if (hash === session.lastPromptedHash && (nowMs - session.lastPromptedAt) < EXPLICIT_DEDUP_MS) {
      return { action: 'deduped', hash };
    }

    const pendingSvg = {
      svgText,
      hash,
      detectedAt: nowMs,
      trigger,
    };

    if (deps.sessionStorage && typeof deps.sessionStorage.set === 'function') {
      await deps.sessionStorage.set({
        [SESSION_KEYS.pendingSvg]: pendingSvg,
        [SESSION_KEYS.lastPromptedHash]: hash,
        [SESSION_KEYS.lastPromptedAt]: nowMs,
      });
    }

    if (typeof deps.setBadge === 'function') {
      await deps.setBadge('SVG');
    }

    if (currentSettings.promptMode === 'popup' && typeof deps.openPopup === 'function') {
      try {
        await deps.openPopup();
        return { action: 'prompted', mode: 'popup', hash };
      } catch {
        // Fallback to in-page overlay when Chrome refuses programmatic openPopup()
      }
    }

    if (typeof deps.showOverlay === 'function') {
      const shown = await deps.showOverlay({ tabId, svgText, hash });
      if (shown) {
        return { action: 'prompted', mode: 'overlay', hash };
      }
    }

    return { action: 'badge-only', hash };
  }

  async function clearPendingSvg(hash, overrides = {}) {
    const deps = getDeps(overrides);
    const session = await readSessionState(deps.sessionStorage);
    const handledHash = String(hash || session.pendingSvg?.hash || session.lastPromptedHash || '');

    if (deps.sessionStorage && typeof deps.sessionStorage.set === 'function') {
      await deps.sessionStorage.set({
        [SESSION_KEYS.pendingSvg]: null,
        [SESSION_KEYS.lastHandledHash]: handledHash,
      });
    }

    if (typeof deps.setBadge === 'function') {
      await deps.setBadge('');
    }

    return { ok: true, handledHash };
  }

  async function getPendingSvg(overrides = {}) {
    const deps = getDeps(overrides);
    const session = await readSessionState(deps.sessionStorage);
    return session.pendingSvg;
  }

  const exported = {
    EXPLICIT_DEDUP_MS,
    MAX_SESSION_SVG_BYTES,
    SESSION_KEYS,
    handleClipboardText,
    clearPendingSvg,
    getPendingSvg,
  };

  if (!globalThis.GeminiSvgExporter) {
    globalThis.GeminiSvgExporter = {};
  }
  globalThis.GeminiSvgExporter.coordinator = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})();
