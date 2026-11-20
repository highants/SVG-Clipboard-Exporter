import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const coordinator = require('../src/background/coordinator.js');

function createMemoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async get(defaults) {
      const out = {};
      for (const [k, v] of Object.entries(defaults || {})) {
        out[k] = k in store ? store[k] : v;
      }
      return out;
    },
    async set(values) {
      Object.assign(store, values);
    },
  };
}

const SAMPLE_SVG = '<svg viewBox="0 0 120 80"><rect width="120" height="80" fill="#4f46e5"/></svg>';

test('explicit SVG copy opens popup, stores pendingSvg, and sets badge', async () => {
  const sessionStorage = createMemoryStorage();
  const syncStorage = createMemoryStorage({ monitorClipboard: true, promptMode: 'popup' });
  let popupOpened = 0;
  let overlayShown = 0;
  const badges = [];

  const res = await coordinator.handleClipboardText(
    SAMPLE_SVG,
    { trigger: 'explicit', tabId: 42 },
    {
      sessionStorage,
      syncStorage,
      openPopup: async () => { popupOpened += 1; },
      showOverlay: async () => { overlayShown += 1; return true; },
      setBadge: async (txt) => { badges.push(txt); },
      now: () => 10000,
    }
  );

  assert.equal(res.action, 'prompted');
  assert.equal(res.mode, 'popup');
  assert.equal(popupOpened, 1);
  assert.equal(overlayShown, 0);
  assert.deepEqual(badges, ['SVG']);

  const pending = await coordinator.getPendingSvg({ sessionStorage });
  assert.equal(pending.svgText, SAMPLE_SVG);
  assert.equal(pending.hash, res.hash);
});

test('falls back to in-page overlay when openPopup fails', async () => {
  const sessionStorage = createMemoryStorage();
  const syncStorage = createMemoryStorage({ monitorClipboard: true, promptMode: 'popup' });
  let overlayPayload = null;

  const res = await coordinator.handleClipboardText(
    SAMPLE_SVG,
    { trigger: 'explicit', tabId: 7 },
    {
      sessionStorage,
      syncStorage,
      openPopup: async () => { throw new Error('Failed to open popup.'); },
      showOverlay: async (payload) => { overlayPayload = payload; return true; },
      setBadge: async () => {},
      now: () => 10000,
    }
  );

  assert.equal(res.action, 'prompted');
  assert.equal(res.mode, 'overlay');
  assert.equal(overlayPayload.tabId, 7);
  assert.equal(overlayPayload.svgText, SAMPLE_SVG);
});

test('promptMode overlay skips openPopup and triggers overlay directly', async () => {
  const sessionStorage = createMemoryStorage();
  const syncStorage = createMemoryStorage({ monitorClipboard: true, promptMode: 'overlay' });
  let popupOpened = 0;
  let overlayShown = 0;

  const res = await coordinator.handleClipboardText(
    SAMPLE_SVG,
    { trigger: 'explicit', tabId: 9 },
    {
      sessionStorage,
      syncStorage,
      openPopup: async () => { popupOpened += 1; },
      showOverlay: async () => { overlayShown += 1; return true; },
      setBadge: async () => {},
      now: () => 10000,
    }
  );

  assert.equal(res.action, 'prompted');
  assert.equal(res.mode, 'overlay');
  assert.equal(popupOpened, 0);
  assert.equal(overlayShown, 1);
});

test('deduplicates rapid duplicate explicit copies and suppresses dismissed SVGs on passive focus', async () => {
  const sessionStorage = createMemoryStorage();
  const syncStorage = createMemoryStorage({ monitorClipboard: true, promptMode: 'popup' });
  let currentTime = 5000;
  const badges = [];

  const deps = {
    sessionStorage,
    syncStorage,
    openPopup: async () => {},
    showOverlay: async () => true,
    setBadge: async (txt) => { badges.push(txt); },
    now: () => currentTime,
  };

  const first = await coordinator.handleClipboardText(SAMPLE_SVG, { trigger: 'explicit' }, deps);
  assert.equal(first.action, 'prompted');

  // Within EXPLICIT_DEDUP_MS (1200ms) -> deduped
  currentTime = 5500;
  const rapidDup = await coordinator.handleClipboardText(SAMPLE_SVG, { trigger: 'explicit' }, deps);
  assert.equal(rapidDup.action, 'deduped');

  // Dismiss/clear pending SVG
  await coordinator.clearPendingSvg(first.hash, deps);
  assert.equal(await coordinator.getPendingSvg({ sessionStorage }), null);
  assert.equal(badges[badges.length - 1], '');

  // Passive focus check later with same SVG still in clipboard -> must stay suppressed
  currentTime = 20000;
  const passiveAfterDismiss = await coordinator.handleClipboardText(SAMPLE_SVG, { trigger: 'passive' }, deps);
  assert.equal(passiveAfterDismiss.action, 'deduped');

  // User explicitly copies the same SVG again later -> prompts again
  const explicitAgain = await coordinator.handleClipboardText(SAMPLE_SVG, { trigger: 'explicit' }, deps);
  assert.equal(explicitAgain.action, 'prompted');
});

test('respects monitorClipboard disabled flag and ignores non-SVG text', async () => {
  const sessionStorage = createMemoryStorage();
  const syncDisabled = createMemoryStorage({ monitorClipboard: false });

  const disabledRes = await coordinator.handleClipboardText(
    SAMPLE_SVG,
    { trigger: 'explicit' },
    { sessionStorage, syncStorage: syncDisabled, openPopup: async () => { throw new Error('should not run'); } }
  );
  assert.equal(disabledRes.action, 'disabled');

  const syncEnabled = createMemoryStorage({ monitorClipboard: true });
  const ignoredRes = await coordinator.handleClipboardText(
    'console.log("hello world");',
    { trigger: 'explicit' },
    { sessionStorage, syncStorage: syncEnabled }
  );
  assert.equal(ignoredRes.action, 'ignored');

  const hugeSvg = `<svg viewBox="0 0 10 10">${'a'.repeat(coordinator.MAX_SESSION_SVG_BYTES + 100)}</svg>`;
  const tooLargeRes = await coordinator.handleClipboardText(
    hugeSvg,
    { trigger: 'explicit' },
    { sessionStorage, syncStorage: syncEnabled }
  );
  assert.equal(tooLargeRes.action, 'ignored');
  assert.equal(tooLargeRes.reason, 'too-large');
});
