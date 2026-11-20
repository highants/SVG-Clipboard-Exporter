(() => {
  'use strict';

  async function readClipboardText() {
    const buffer = document.getElementById('clipboard-buffer');
    if (buffer) {
      buffer.value = '';
      buffer.focus();
      const pasted = document.execCommand('paste');
      if (pasted && buffer.value) {
        const text = buffer.value;
        buffer.value = '';
        return text;
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      return await navigator.clipboard.readText();
    }
    return '';
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== 'offscreen') {
      return undefined;
    }

    if (message.type === 'READ_CLIPBOARD_TEXT') {
      (async () => {
        try {
          const text = await readClipboardText();
          sendResponse({ text });
        } catch (err) {
          sendResponse({ text: '', error: err?.message || 'Clipboard read failed' });
        }
      })();
      return true;
    }

    return undefined;
  });
})();
