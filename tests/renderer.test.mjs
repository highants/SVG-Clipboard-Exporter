import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const renderer = require('../src/shared/renderer.js');

function createMockSvgDomMocks() {
  class MockAttrElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.localName = tagName;
      this.nodeName = tagName;
      this.nodeType = 1;
      this.attrs = new Map([
        ['viewBox', '0 0 100 50'],
        ['width', '100'],
        ['height', '50'],
      ]);
      this.children = [];
    }
    get attributes() {
      return [...this.attrs.entries()].map(([name, value]) => ({ name, value }));
    }
    getAttribute(k) {
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
    }
    removeAttribute(k) {
      this.attrs.delete(k);
    }
    cloneNode() {
      const c = new MockAttrElement(this.tagName);
      c.attrs = new Map(this.attrs);
      return c;
    }
  }

  class MockDOMParser {
    parseFromString() {
      const root = new MockAttrElement('svg');
      return {
        documentElement: root,
        getElementsByTagName: () => [],
      };
    }
  }

  class MockXMLSerializer {
    serializeToString(el) {
      const attrs = [...el.attrs.entries()].map(([k, v]) => `${k}="${v}"`).join(' ');
      return `<svg ${attrs}></svg>`;
    }
  }

  class MockImage {
    set src(val) {
      this._src = val;
      queueMicrotask(() => {
        this.naturalWidth = 200;
        this.naturalHeight = 100;
        this.onload?.();
      });
    }
    get src() {
      return this._src;
    }
  }

  function createCanvas(width, height) {
    const ops = [];
    const ctx = {
      fillStyle: '',
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillRect(x, y, w, h) {
        ops.push({ op: 'fillRect', fillStyle: ctx.fillStyle, x, y, w, h });
      },
      clearRect(x, y, w, h) {
        ops.push({ op: 'clearRect', x, y, w, h });
      },
      drawImage(img, x, y, w, h) {
        ops.push({ op: 'drawImage', x, y, w, h });
      },
    };
    return {
      width,
      height,
      ops,
      getContext: () => ctx,
      toBlob(cb, mimeType, quality) {
        const blob = new Blob([`${mimeType}:${quality ?? ''}`], { type: mimeType });
        blob._ops = ops;
        blob._dims = { width, height };
        cb(blob);
      },
    };
  }

  return {
    DOMParserCtor: MockDOMParser,
    XMLSerializerCtor: MockXMLSerializer,
    ImageCtor: MockImage,
    createCanvas,
    createImageBitmap: async () => ({ width: 200, height: 100, close() {} }),
  };
}

test('resolveBackgroundColor enforces opaque background for JPEG and respects PNG mode', () => {
  assert.equal(renderer.resolveBackgroundColor('png', { pngBackground: 'transparent' }), null);
  assert.equal(renderer.resolveBackgroundColor('png', { pngBackground: 'white' }), '#FFFFFF');
  assert.equal(
    renderer.resolveBackgroundColor('png', { pngBackground: 'custom', pngBgColor: '#123456' }),
    '#123456'
  );
  assert.equal(
    renderer.resolveBackgroundColor('jpeg', { pngBackground: 'transparent', jpgBgColor: '#F8FAFC' }),
    '#F8FAFC'
  );
  assert.equal(renderer.resolveBackgroundColor('jpg', {}), '#FFFFFF');
});

test('copySvgImageToClipboard writes image/png synchronously inside user turn', async () => {
  const mocks = createMockSvgDomMocks();
  let writtenItems = null;

  class MockClipboardItem {
    constructor(data) {
      this.data = data;
    }
    static supports() {
      return false;
    }
  }

  const clipboard = {
    async write(items) {
      writtenItems = items;
      for (const item of items) {
        for (const key of Object.keys(item.data)) {
          const val = item.data[key];
          if (val && typeof val.then === 'function') {
            item.data[key] = await val;
          }
        }
      }
    },
  };

  const result = await renderer.copySvgImageToClipboard(
    '<svg viewBox="0 0 100 50"></svg>',
    'png',
    { scale: 2, padding: 0, pngBackground: 'transparent' },
    { ...mocks, clipboard, ClipboardItemCtor: MockClipboardItem }
  );

  assert.equal(writtenItems.length, 1);
  assert.ok('image/png' in writtenItems[0].data);
  assert.equal(writtenItems[0].data['image/png'].type, 'image/png');
  assert.equal(result.width, 200);
  assert.equal(result.height, 100);
  assert.equal(result.jpegCompatMode, false);
});

test('copySvgImageToClipboard for JPEG writes OS-compatible PNG plus web image/jpeg and falls back cleanly', async () => {
  const mocks = createMockSvgDomMocks();
  const capturedWrites = [];

  class MockClipboardItemWithCustom {
    constructor(data) {
      this.data = data;
    }
    static supports(mime) {
      return mime === 'web image/jpeg';
    }
  }

  const clipboardSuccess = {
    async write(items) {
      const resolved = {};
      for (const [k, v] of Object.entries(items[0].data)) {
        resolved[k] = await v;
      }
      capturedWrites.push(resolved);
    },
  };

  const res1 = await renderer.copySvgImageToClipboard(
    '<svg viewBox="0 0 100 50"></svg>',
    'jpeg',
    { scale: 2, padding: 0, jpgQuality: 85, jpgBgColor: '#FFFFFF' },
    { ...mocks, clipboard: clipboardSuccess, ClipboardItemCtor: MockClipboardItemWithCustom }
  );

  assert.equal(capturedWrites.length, 1);
  assert.equal(capturedWrites[0]['image/png'].type, 'image/png');
  assert.equal(capturedWrites[0]['web image/jpeg'].type, 'image/jpeg');
  assert.equal(res1.jpegCompatMode, true);
  assert.equal(res1.includesWebJpeg, true);

  // Simulate browser rejecting custom 'web image/jpeg' write -> falls back to plain 'image/png'
  let attempt = 0;
  const fallbackWrites = [];
  const clipboardFallback = {
    async write(items) {
      attempt += 1;
      const keys = Object.keys(items[0].data);
      if (attempt === 1 && keys.includes('web image/jpeg')) {
        throw new Error('Custom format rejected');
      }
      const resolved = {};
      for (const [k, v] of Object.entries(items[0].data)) {
        resolved[k] = await v;
      }
      fallbackWrites.push(resolved);
    },
  };

  const res2 = await renderer.copySvgImageToClipboard(
    '<svg viewBox="0 0 100 50"></svg>',
    'jpeg',
    { scale: 2, padding: 0, jpgQuality: 90, jpgBgColor: '#111827' },
    { ...mocks, clipboard: clipboardFallback, ClipboardItemCtor: MockClipboardItemWithCustom }
  );

  assert.equal(fallbackWrites.length, 1);
  assert.deepEqual(Object.keys(fallbackWrites[0]), ['image/png']);
  assert.equal(fallbackWrites[0]['image/png'].type, 'image/png');
  assert.equal(res2.jpegCompatMode, true);
  assert.equal(res2.includesWebJpeg, false);
});

test('downloadSvgImage saves matching .svg alongside raster image when saveWithSvg is enabled', async () => {
  const mocks = createMockSvgDomMocks();
  const downloaded = [];
  const createdBlobs = new Map();
  let seq = 0;

  const mockUrl = {
    createObjectURL(blob) {
      seq += 1;
      const url = `blob:mock-${seq}`;
      createdBlobs.set(url, blob);
      return url;
    },
    revokeObjectURL() {},
  };

  const mockDoc = {
    body: {
      append() {},
    },
    createElement() {
      const el = {
        href: '',
        download: '',
        style: {},
        click() {
          downloaded.push({ filename: el.download, blob: createdBlobs.get(el.href) });
        },
        remove() {},
      };
      return el;
    },
  };

  const fixedDate = new Date(2026, 10, 20, 15, 10, 30);

  // saveWithSvg: false -> only PNG
  const resSingle = await renderer.downloadSvgImage(
    '<svg viewBox="0 0 100 50"></svg>',
    'png',
    { scale: 2, padding: 0, pngBackground: 'transparent', saveWithSvg: false },
    {
      ...mocks,
      URL: mockUrl,
      document: mockDoc,
      now: fixedDate,
      sourceFilename: 'sample-chart.svg',
      downloadGapMs: 0,
      setTimeout: () => {},
    }
  );
  assert.equal(resSingle.filename, 'sample-chart-20261120-151030.png');
  assert.equal(resSingle.svgFilename, null);
  assert.equal(downloaded.length, 1);

  // saveWithSvg: true -> JPG + matching .svg
  downloaded.length = 0;
  const resPair = await renderer.downloadSvgImage(
    '<svg viewBox="0 0 100 50"></svg>',
    'jpeg',
    { scale: 2, padding: 0, jpgQuality: 90, jpgBgColor: '#FFFFFF', saveWithSvg: true },
    {
      ...mocks,
      URL: mockUrl,
      document: mockDoc,
      now: fixedDate,
      sourceFilename: 'sample-chart.svg',
      downloadGapMs: 0,
      setTimeout: () => {},
    }
  );

  assert.equal(resPair.filename, 'sample-chart-20261120-151030.jpg');
  assert.equal(resPair.svgFilename, 'sample-chart-20261120-151030.svg');
  assert.equal(downloaded.length, 2);
  assert.equal(downloaded[0].filename, 'sample-chart-20261120-151030.jpg');
  assert.equal(downloaded[0].blob.type, 'image/jpeg');
  assert.equal(downloaded[1].filename, 'sample-chart-20261120-151030.svg');
  assert.equal(downloaded[1].blob.type, 'image/svg+xml;charset=utf-8');
  const svgOut = await downloaded[1].blob.text();
  assert.ok(svgOut.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.ok(svgOut.includes('xmlns="http://www.w3.org/2000/svg"'));
});
