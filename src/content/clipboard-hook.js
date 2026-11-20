(() => {
  'use strict';

  if (globalThis.__gseClipboardHookInstalled) {
    return;
  }
  globalThis.__gseClipboardHookInstalled = true;

  const MESSAGE_SOURCE = 'gse-clipboard-hook';
  const MAX_TEXT_LENGTH = 5 * 1024 * 1024;

  function notifyIfSvgCandidate(text) {
    if (typeof text !== 'string') return;
    if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return;
    if (!text.toLowerCase().includes('<svg')) return;
    const origin = globalThis.location?.origin;
    const targetOrigin = origin && origin !== 'null' ? origin : '*';
    globalThis.postMessage({ source: MESSAGE_SOURCE, text }, targetOrigin);
  }

  const proto = globalThis.Clipboard?.prototype;
  if (!proto) return;

  if (typeof proto.writeText === 'function') {
    const originalWriteText = proto.writeText;
    proto.writeText = async function gseWrappedWriteText(text) {
      const result = await originalWriteText.call(this, text);
      try {
        notifyIfSvgCandidate(text);
      } catch {
        // Never disrupt host page clipboard writes
      }
      return result;
    };
  }

  if (typeof proto.write === 'function') {
    const originalWrite = proto.write;
    proto.write = async function gseWrappedWrite(items) {
      const result = await originalWrite.call(this, items);
      try {
        if (Array.isArray(items)) {
          for (const item of items) {
            const types = Array.isArray(item?.types) ? item.types : [];
            if (types.includes('text/plain') && !types.includes('image/png')) {
              const blob = await item.getType('text/plain');
              const text = await blob.text();
              notifyIfSvgCandidate(text);
              break;
            }
          }
        }
      } catch {
        // Never disrupt host page clipboard writes
      }
      return result;
    };
  }
})();
