import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const svgUtils = require('../src/shared/svg-utils.js');
const settings = require('../src/shared/settings.js');

function createMockElement(tagName, attrs = {}, children = [], textContent = '') {
  const attrMap = new Map(Object.entries(attrs));
  const el = {
    tagName,
    localName: tagName.toLowerCase(),
    nodeName: tagName,
    nodeType: 1,
    textContent,
    parentNode: null,
    children: [],
    get attributes() {
      return [...attrMap.entries()].map(([name, value]) => ({ name, value }));
    },
    getAttribute(name) {
      return attrMap.has(name) ? attrMap.get(name) : null;
    },
    setAttribute(name, value) {
      attrMap.set(name, String(value));
    },
    removeAttribute(name) {
      attrMap.delete(name);
    },
    cloneNode(deep = false) {
      const clonedAttrs = Object.fromEntries(attrMap.entries());
      const clonedChildren = deep ? el.children.map((c) => c.cloneNode(true)) : [];
      return createMockElement(tagName, clonedAttrs, clonedChildren, textContent);
    },
    remove() {
      if (!el.parentNode) return;
      el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
      el.parentNode = null;
    },
    querySelector(sel) {
      const lower = sel.toLowerCase();
      for (const child of el.children) {
        if (child.localName === lower) return child;
        const nested = child.querySelector(sel);
        if (nested) return nested;
      }
      return null;
    },
  };

  for (const child of children) {
    child.parentNode = el;
    el.children.push(child);
  }
  return el;
}

test('extractSvgFromCode detects complete, incomplete, and non-SVG blocks accurately', () => {
  const pure = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
  assert.deepEqual(svgUtils.extractSvgFromCode(pure, 'svg'), {
    status: 'complete',
    svgText: pure,
  });

  const withProlog = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- header -->\n${pure}\n<!-- footer -->`;
  assert.deepEqual(svgUtils.extractSvgFromCode(withProlog, 'xml'), {
    status: 'complete',
    svgText: pure,
  });

  const unmarked = `  \n${pure}\n  `;
  assert.deepEqual(svgUtils.extractSvgFromCode(unmarked, ''), {
    status: 'complete',
    svgText: pure,
  });

  const streaming = '<svg viewBox="0 0 100 100"><rect x="0" y="0"';
  assert.deepEqual(svgUtils.extractSvgFromCode(streaming, 'svg'), {
    status: 'incomplete',
    svgText: null,
  });

  const reactComponent = `import React from 'react';
export function Icon() {
  return (<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>);
}`;
  assert.deepEqual(svgUtils.extractSvgFromCode(reactComponent, 'tsx'), {
    status: 'none',
    svgText: null,
  });

  const htmlDoc = `<!DOCTYPE html><html><body>${pure}</body></html>`;
  assert.deepEqual(svgUtils.extractSvgFromCode(htmlDoc, 'html'), {
    status: 'none',
    svgText: null,
  });

  const plainJs = 'const sum = (a, b) => a + b;';
  assert.deepEqual(svgUtils.extractSvgFromCode(plainJs, 'javascript'), {
    status: 'none',
    svgText: null,
  });
});

test('repairXmlEntities escapes bare ampersands while keeping valid entities', () => {
  const dirty = '<svg><text>Tom & Jerry &amp; Co &#123; &#x1F600;</text>\x00</svg>';
  const fixed = svgUtils.repairXmlEntities(dirty);
  assert.equal(fixed, '<svg><text>Tom &amp; Jerry &amp; Co &#123; &#x1F600;</text></svg>');
});

test('parseCssLength, parseViewBox, and resolveSvgDimensions cover all sizing modes', () => {
  assert.equal(svgUtils.parseCssLength('240px'), 240);
  assert.equal(svgUtils.parseCssLength('100'), 100);
  assert.equal(svgUtils.parseCssLength('2in'), 192);
  assert.equal(svgUtils.parseCssLength('100%'), null);
  assert.equal(svgUtils.parseCssLength('auto'), null);
  assert.equal(svgUtils.parseCssLength('0'), null);

  assert.deepEqual(svgUtils.parseViewBox('0 0 400 200'), { minX: 0, minY: 0, width: 400, height: 200 });
  assert.equal(svgUtils.parseViewBox('0 0 0 200'), null);

  const elBoth = createMockElement('svg', { width: '320px', height: '160px' });
  assert.deepEqual(svgUtils.resolveSvgDimensions(elBoth), {
    width: 320,
    height: 160,
    viewBox: { minX: 0, minY: 0, width: 320, height: 160 },
    isFallback: false,
  });

  const elPercentWithVb = createMockElement('svg', { width: '100%', height: '100%', viewBox: '0 0 500 250' });
  assert.deepEqual(svgUtils.resolveSvgDimensions(elPercentWithVb), {
    width: 500,
    height: 250,
    viewBox: { minX: 0, minY: 0, width: 500, height: 250 },
    isFallback: false,
  });

  const elOneDim = createMockElement('svg', { width: '1000', viewBox: '0 0 400 200' });
  assert.deepEqual(svgUtils.resolveSvgDimensions(elOneDim), {
    width: 1000,
    height: 500,
    viewBox: { minX: 0, minY: 0, width: 400, height: 200 },
    isFallback: false,
  });

  const elNoDims = createMockElement('svg', {});
  const measured = svgUtils.resolveSvgDimensions(elNoDims, () => ({ x: 10, y: 20, width: 120, height: 60 }));
  assert.deepEqual(measured, {
    width: 120,
    height: 60,
    viewBox: { minX: 10, minY: 20, width: 120, height: 60 },
    isFallback: false,
  });

  const fallback = svgUtils.resolveSvgDimensions(elNoDims);
  assert.equal(fallback.isFallback, true);
  assert.equal(fallback.width, 800);
  assert.equal(fallback.height, 600);
});

test('computeOutputMetrics scales padding and clamps oversized canvases safely', () => {
  const normal = svgUtils.computeOutputMetrics({ width: 400, height: 300 }, 2, 16);
  assert.equal(normal.innerWidth, 800);
  assert.equal(normal.innerHeight, 600);
  assert.equal(normal.padPx, 32);
  assert.equal(normal.canvasWidth, 864);
  assert.equal(normal.canvasHeight, 664);
  assert.equal(normal.wasClamped, false);

  const clamped = svgUtils.computeOutputMetrics({ width: 5000, height: 4000 }, 4, 32);
  assert.equal(clamped.wasClamped, true);
  assert.ok(clamped.canvasWidth <= svgUtils.MAX_CANVAS_SIDE);
  assert.ok(clamped.canvasHeight <= svgUtils.MAX_CANVAS_SIDE);
  assert.ok(clamped.canvasWidth * clamped.canvasHeight <= svgUtils.MAX_CANVAS_PIXELS);
});

test('utf8ToBase64 encodes Japanese SVG text without throwing', () => {
  const svg = '<svg><text>こんにちはSVG🚀</text></svg>';
  const encoded = svgUtils.utf8ToBase64(svg);
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  assert.equal(decoded, svg);
});

test('sanitizeSvgElement removes scripts, event handlers, dangerous URIs, SMIL attacks, and unsafe tags', () => {
  const scriptEl = createMockElement('script', {}, [], 'alert(1)');
  const metaEl = createMockElement('meta', { 'http-equiv': 'refresh', content: '0;url=https://evil.example' });
  const smilEvent = createMockElement('set', { attributeName: 'onbegin', to: 'alert(1)' });
  const smilHref = createMockElement('animate', { attributeName: 'href', values: ' #ok ; \tJavaScript:alert(1)' });
  const rectEl = createMockElement('rect', {
    width: '10',
    height: '10',
    onclick: 'evil()',
    style: 'background:url(javascript:alert(1))',
  });
  const linkEl = createMockElement('a', { href: ' \t\nJaVaScRiPt:alert(1)' });
  const vbLink = createMockElement('a', { href: 'vbscript:msgbox(1)' });
  const badXlink = createMockElement('use', { 'xlink:href': '  data:text/html,<script>' });
  const safePath = createMockElement('path', { d: 'M0 0L10 10', style: 'fill:#4f46e5' });
  const svgRoot = createMockElement(
    'svg',
    { viewBox: '0 0 100 100', onload: 'evilLoad()' },
    [scriptEl, metaEl, smilEvent, smilHref, rectEl, linkEl, vbLink, badXlink, safePath]
  );

  const sanitized = svgUtils.sanitizeSvgElement(svgRoot);
  assert.equal(sanitized.getAttribute('onload'), null);
  assert.equal(sanitized.children.some((c) => ['script', 'meta', 'set', 'animate'].includes(c.localName)), false);
  const cleanRect = sanitized.children.find((c) => c.localName === 'rect');
  assert.equal(cleanRect.getAttribute('onclick'), null);
  assert.equal(cleanRect.getAttribute('style'), null);
  const links = sanitized.children.filter((c) => c.localName === 'a');
  assert.equal(links[0].getAttribute('href'), null);
  assert.equal(links[1].getAttribute('href'), null);
  const cleanUse = sanitized.children.find((c) => c.localName === 'use');
  assert.equal(cleanUse.getAttribute('xlink:href'), null);
  const keptPath = sanitized.children.find((c) => c.localName === 'path');
  assert.equal(keptPath.getAttribute('style'), 'fill:#4f46e5');
});

test('stripUnsafeDomMeasurementNodes removes style, foreignObject, image, feImage, and external use', () => {
  const styleEl = createMockElement('style', {}, [], '@import url("https://evil.example/a.css");');
  const foEl = createMockElement('foreignObject', {}, []);
  const imgEl = createMockElement('image', { href: 'https://evil.example/track.png' });
  const feImgEl = createMockElement('feImage', { href: 'https://evil.example/t.png' });
  const extUse = createMockElement('use', { href: 'https://evil.example/sprite.svg#a' });
  const localUse = createMockElement('use', { href: '#local-symbol' });
  const circle = createMockElement('circle', { cx: '10', cy: '10', r: '5' });
  const svgRoot = createMockElement('svg', {}, [styleEl, foEl, imgEl, feImgEl, extUse, localUse, circle]);

  const safe = svgUtils.stripUnsafeDomMeasurementNodes(svgRoot);
  assert.equal(safe.children.some((c) => ['style', 'foreignobject', 'image', 'feimage'].includes(c.localName)), false);
  const uses = safe.children.filter((c) => c.localName === 'use');
  assert.equal(uses.length, 1);
  assert.equal(uses[0].getAttribute('href'), '#local-symbol');
  assert.ok(safe.children.find((c) => c.localName === 'circle'));
});

test('buildExportFilename prefers dropped sourceFilename over title and sanitizes forbidden chars', () => {
  const fixedDate = new Date(2026, 10, 20, 14, 5, 9);
  const titleEl = createMockElement('title', {}, [], 'System: Architecture <v2> / Flow?');
  const svgWithTitle = createMockElement('svg', {}, [titleEl]);
  assert.equal(
    svgUtils.buildExportFilename(svgWithTitle, 'png', fixedDate),
    'System_-Architecture-_v2_-_-Flow-20261120-140509.png'
  );

  assert.equal(
    svgUtils.buildExportFilename(svgWithTitle, 'jpg', fixedDate, 'diagram-v1.svg'),
    'diagram-v1-20261120-140509.jpg'
  );

  const svgNoTitle = createMockElement('svg', {});
  assert.equal(
    svgUtils.buildExportFilename(svgNoTitle, '.JPG', fixedDate),
    'svg-export-20261120-140509.jpg'
  );
});

test('prepareCleanSvgDocument sanitizes scripts, guarantees xmlns, and adds XML header', () => {
  const scriptEl = createMockElement('script', {}, [], 'alert(1)');
  const rectEl = createMockElement('rect', { width: '10', height: '10' });
  const svgRoot = createMockElement('svg', { viewBox: '0 0 100 100', onclick: 'evil()' }, [scriptEl, rectEl]);

  class MockXMLSerializer {
    serializeToString(el) {
      const attrs = el.attributes.map((a) => `${a.name}="${a.value}"`).join(' ');
      const kids = el.children.map((c) => `<${c.localName}/>`).join('');
      return `<svg ${attrs}>${kids}</svg>`;
    }
  }

  const out = svgUtils.prepareCleanSvgDocument(svgRoot, MockXMLSerializer);
  assert.ok(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.ok(out.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.equal(out.includes('onclick'), false);
  assert.equal(out.includes('<script'), false);
  assert.ok(out.includes('<rect/>'));
});

test('readSvgFromFile loads valid .svg files and rejects non-SVG files', async () => {
  const validFile = {
    name: 'icon.svg',
    type: 'image/svg+xml',
    async text() {
      return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
    },
  };
  const loaded = await svgUtils.readSvgFromFile(validFile);
  assert.equal(loaded.fileName, 'icon.svg');
  assert.ok(loaded.svgText.startsWith('<svg'));
  assert.ok(loaded.hash.length > 0);

  const invalidFile = {
    name: 'photo.png',
    type: 'image/png',
    async text() {
      return 'PNGDATA';
    },
  };
  await assert.rejects(
    async () => svgUtils.readSvgFromFile(invalidFile),
    (err) => err.code === 'INVALID_SVG_FILE'
  );

  const oversizedFile = {
    name: 'huge.svg',
    type: 'image/svg+xml',
    size: svgUtils.MAX_SVG_INPUT_BYTES + 1,
    async text() {
      return '<svg></svg>';
    },
  };
  await assert.rejects(
    async () => svgUtils.readSvgFromFile(oversizedFile),
    (err) => err.code === 'SVG_TOO_LARGE'
  );
});

test('hashSvgText produces deterministic distinct hashes', () => {
  const a = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
  const b = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>';
  assert.equal(svgUtils.hashSvgText(a), svgUtils.hashSvgText(a));
  assert.notEqual(svgUtils.hashSvgText(a), svgUtils.hashSvgText(b));
});

test('settings.sanitizeSettings clamps quality and validates language, saveWithSvg, hex colors, promptMode, and presets', () => {
  const sanitized = settings.sanitizeSettings({
    language: 'fr',
    monitorClipboard: 'yes',
    promptMode: 'invalid-mode',
    saveWithSvg: true,
    scale: 99,
    jpgQuality: 10,
    jpgBgColor: '#abc',
    pngBackground: 'invalid',
    pngBgColor: 'not-a-color',
    padding: 12,
  });

  assert.deepEqual(sanitized, {
    language: 'auto',
    monitorClipboard: true,
    promptMode: 'popup',
    saveWithSvg: true,
    scale: 2,
    jpgQuality: 50,
    jpgBgColor: '#AABBCC',
    pngBackground: 'transparent',
    pngBgColor: '#FFFFFF',
    padding: 0,
  });
});
