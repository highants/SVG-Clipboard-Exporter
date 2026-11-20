'use strict';

importScripts(
  '../shared/settings.js',
  '../shared/svg-utils.js',
  './coordinator.js'
);

const { coordinator } = globalThis.GeminiSvgExporter;

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
let offscreenCreateLock = null;

async function setBadge(text) {
  try {
    await chrome.action.setBadgeText({ text: String(text || '') });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color: '#4F46E5' });
      if (typeof chrome.action.setBadgeTextColor === 'function') {
        await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
      }
    }
  } catch {
    // Ignore badge update failures during startup/shutdown
  }
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (existing.length > 0) return;

  if (offscreenCreateLock) {
    await offscreenCreateLock;
    return;
  }

  offscreenCreateLock = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['CLIPBOARD'],
        justification: 'クリップボードにコピーされたSVGコードを検出して画像変換を確認するため',
      });
    } finally {
      offscreenCreateLock = null;
    }
  })();

  await offscreenCreateLock;
}

async function readClipboardViaOffscreen() {
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'READ_CLIPBOARD_TEXT',
    });
    return typeof response?.text === 'string' ? response.text : '';
  } catch {
    return '';
  } finally {
    try {
      const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
      });
      if (existing.length > 0) {
        await chrome.offscreen.closeDocument();
      }
    } catch {
      // Ignore close race
    }
  }
}

async function showOverlayOnTab({ tabId, svgText, hash }) {
  let targetTabId = tabId;
  if (targetTabId == null) {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    targetTabId = activeTab?.id ?? null;
  }
  if (targetTabId == null) return false;

  try {
    await chrome.tabs.sendMessage(targetTabId, {
      type: 'SHOW_OVERLAY_PROMPT',
      svgText,
      hash,
    });
    return true;
  } catch {
    return false;
  }
}

function createRuntimeDeps() {
  return {
    openPopup: async () => {
      await chrome.action.openPopup();
    },
    showOverlay: showOverlayOnTab,
    setBadge,
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  await setBadge('');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen') {
    return undefined;
  }

  if (message.type === 'SVG_CLIPBOARD_DETECTED') {
    (async () => {
      try {
        const result = await coordinator.handleClipboardText(
          message.svgText,
          { trigger: message.trigger || 'explicit', tabId: sender.tab?.id ?? null },
          createRuntimeDeps()
        );
        sendResponse(result);
      } catch (err) {
        sendResponse({ action: 'error', error: err?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  if (message.type === 'READ_AND_CHECK_CLIPBOARD') {
    (async () => {
      try {
        const text = await readClipboardViaOffscreen();
        if (!text) {
          sendResponse({ action: 'empty' });
          return;
        }
        const result = await coordinator.handleClipboardText(
          text,
          { trigger: message.trigger || 'passive', tabId: sender.tab?.id ?? null },
          createRuntimeDeps()
        );
        sendResponse(result);
      } catch (err) {
        sendResponse({ action: 'error', error: err?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  if (message.type === 'GET_PENDING_SVG') {
    (async () => {
      try {
        const pendingSvg = await coordinator.getPendingSvg();
        sendResponse({ pendingSvg });
      } catch (err) {
        sendResponse({ pendingSvg: null, error: err?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  if (message.type === 'CLEAR_PENDING_SVG') {
    (async () => {
      try {
        const result = await coordinator.clearPendingSvg(message.hash, createRuntimeDeps());
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  return undefined;
});
