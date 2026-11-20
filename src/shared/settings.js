(() => {
  'use strict';

  const ALLOWED_SCALES = [1, 2, 3, 4];
  const ALLOWED_PNG_BACKGROUNDS = ['transparent', 'white', 'custom'];
  const ALLOWED_PADDINGS = [0, 8, 16, 32];
  const ALLOWED_PROMPT_MODES = ['popup', 'overlay'];
  const ALLOWED_LANGUAGES = ['auto', 'ja', 'en'];

  const DEFAULT_SETTINGS = Object.freeze({
    language: 'auto',
    monitorClipboard: true,
    promptMode: 'popup',
    saveWithSvg: false,
    scale: 2,
    jpgQuality: 92,
    jpgBgColor: '#FFFFFF',
    pngBackground: 'transparent',
    pngBgColor: '#FFFFFF',
    padding: 0,
  });

  function normalizeHexColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed.toUpperCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      const [, r, g, b] = trimmed.match(/^#(.)(.)(.)$/);
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return fallback;
  }

  function sanitizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};

    const language = ALLOWED_LANGUAGES.includes(src.language)
      ? src.language
      : DEFAULT_SETTINGS.language;

    const monitorClipboard = typeof src.monitorClipboard === 'boolean'
      ? src.monitorClipboard
      : DEFAULT_SETTINGS.monitorClipboard;

    const promptMode = ALLOWED_PROMPT_MODES.includes(src.promptMode)
      ? src.promptMode
      : DEFAULT_SETTINGS.promptMode;

    const saveWithSvg = typeof src.saveWithSvg === 'boolean'
      ? src.saveWithSvg
      : DEFAULT_SETTINGS.saveWithSvg;

    const numScale = Number(src.scale);
    const scale = ALLOWED_SCALES.includes(numScale)
      ? numScale
      : DEFAULT_SETTINGS.scale;

    const rawQuality = Number(src.jpgQuality);
    const jpgQuality = Number.isFinite(rawQuality)
      ? Math.min(100, Math.max(50, Math.round(rawQuality)))
      : DEFAULT_SETTINGS.jpgQuality;

    const jpgBgColor = normalizeHexColor(src.jpgBgColor, DEFAULT_SETTINGS.jpgBgColor);

    const pngBackground = ALLOWED_PNG_BACKGROUNDS.includes(src.pngBackground)
      ? src.pngBackground
      : DEFAULT_SETTINGS.pngBackground;

    const pngBgColor = normalizeHexColor(src.pngBgColor, DEFAULT_SETTINGS.pngBgColor);

    const numPadding = Number(src.padding);
    const padding = ALLOWED_PADDINGS.includes(numPadding)
      ? numPadding
      : DEFAULT_SETTINGS.padding;

    return {
      language,
      monitorClipboard,
      promptMode,
      saveWithSvg,
      scale,
      jpgQuality,
      jpgBgColor,
      pngBackground,
      pngBgColor,
      padding,
    };
  }

  async function loadSettings(storageArea = globalThis.chrome?.storage?.sync) {
    if (!storageArea || typeof storageArea.get !== 'function') {
      return { ...DEFAULT_SETTINGS };
    }
    try {
      const stored = await storageArea.get({ ...DEFAULT_SETTINGS });
      return sanitizeSettings(stored);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async function saveSettings(partial, storageArea = globalThis.chrome?.storage?.sync) {
    const current = await loadSettings(storageArea);
    const next = sanitizeSettings({ ...current, ...(partial || {}) });
    if (storageArea && typeof storageArea.set === 'function') {
      await storageArea.set(next);
    }
    return next;
  }

  async function resetSettings(storageArea = globalThis.chrome?.storage?.sync) {
    const defaults = { ...DEFAULT_SETTINGS };
    if (storageArea && typeof storageArea.set === 'function') {
      await storageArea.set(defaults);
    }
    return defaults;
  }

  const exported = {
    ALLOWED_SCALES,
    ALLOWED_PNG_BACKGROUNDS,
    ALLOWED_PADDINGS,
    ALLOWED_PROMPT_MODES,
    ALLOWED_LANGUAGES,
    DEFAULT_SETTINGS,
    normalizeHexColor,
    sanitizeSettings,
    loadSettings,
    saveSettings,
    resetSettings,
  };

  if (!globalThis.GeminiSvgExporter) {
    globalThis.GeminiSvgExporter = {};
  }
  globalThis.GeminiSvgExporter.settings = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})();
