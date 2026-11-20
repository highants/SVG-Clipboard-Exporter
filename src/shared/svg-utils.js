(() => {
  'use strict';

  const MAX_CANVAS_SIDE = 8192;
  const MAX_CANVAS_PIXELS = 33554432; // 33.5 MP (browser safe limit)
  const MAX_SVG_INPUT_BYTES = 5 * 1024 * 1024; // 5 MB safety limit
  const FALLBACK_WIDTH = 800;
  const FALLBACK_HEIGHT = 600;

  const NON_SVG_LANGUAGE_HINTS = new Set([
    'js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx',
    'py', 'python', 'rb', 'ruby', 'go', 'rust', 'java',
    'c', 'cpp', 'csharp', 'cs', 'php', 'sh', 'bash', 'zsh',
    'powershell', 'ps1', 'sql', 'json', 'yaml', 'yml',
    'css', 'scss', 'less', 'markdown', 'md',
  ]);

  const UNIT_TO_PX = Object.freeze({
    '': 1,
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    em: 16,
    rem: 16,
  });

  function stripXmlPreambleNoise(prefix) {
    return prefix
      .replace(/<\?xml[\s\S]*?\?>/gi, '')
      .replace(/<!DOCTYPE\s+svg[\s\S]*?>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
  }

  function stripTrailingComments(suffix) {
    return suffix.replace(/<!--[\s\S]*?-->/g, '').trim();
  }

  function looksLikeNonSvgCode(text) {
    return (
      /\b(?:import|export)\s+(?:\{|type\s+|\*|\w+\s+from\b)/m.test(text) ||
      /\b(?:function|const|let|var)\s+[A-Za-z_$][\w$]*\s*(?:=|\()/m.test(text) ||
      /return\s*\(/m.test(text) ||
      /\bclassName\s*=/.test(text) ||
      /<!DOCTYPE\s+html/i.test(text) ||
      /<(?:html|head|body)\b/i.test(text)
    );
  }

  /**
   * Extract a standalone SVG document from a Gemini code block string.
   * Returns { status: 'complete' | 'incomplete' | 'none', svgText: string | null }.
   */
  function extractSvgFromCode(rawText, languageHint = '') {
    if (typeof rawText !== 'string' || rawText.length > MAX_SVG_INPUT_BYTES) {
      return { status: 'none', svgText: null };
    }

    const normalized = rawText
      .replace(/[\uFEFF\u200B\u200C\u200D]/g, '')
      .trim();

    if (!normalized) {
      return { status: 'none', svgText: null };
    }

    const hint = String(languageHint || '').trim().toLowerCase();
    if (hint && NON_SVG_LANGUAGE_HINTS.has(hint)) {
      return { status: 'none', svgText: null };
    }

    const openMatch = /<svg(?:\s|>|\/)/i.exec(normalized);
    if (!openMatch) {
      return { status: 'none', svgText: null };
    }

    const startIdx = openMatch.index;
    const prefix = normalized.slice(0, startIdx);

    if (looksLikeNonSvgCode(normalized)) {
      return { status: 'none', svgText: null };
    }

    if (stripXmlPreambleNoise(prefix) !== '') {
      return { status: 'none', svgText: null };
    }

    const closeMatches = [...normalized.matchAll(/<\/svg\s*>/gi)];
    if (closeMatches.length === 0) {
      // Streaming response has opened <svg> but not yet closed </svg>
      return { status: 'incomplete', svgText: null };
    }

    const lastClose = closeMatches[closeMatches.length - 1];
    const endIdx = lastClose.index + lastClose[0].length;
    const suffix = normalized.slice(endIdx);

    if (stripTrailingComments(suffix) !== '') {
      return { status: 'none', svgText: null };
    }

    return {
      status: 'complete',
      svgText: normalized.slice(startIdx, endIdx),
    };
  }

  function repairXmlEntities(svgText) {
    if (typeof svgText !== 'string') return '';
    // Remove illegal XML 1.0 control characters and escape bare ampersands
    return svgText
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  }

  function hasParserError(doc) {
    if (!doc || !doc.documentElement) return true;
    const rootName = (doc.documentElement.localName || doc.documentElement.nodeName || '').toLowerCase();
    if (rootName !== 'svg') return true;
    if (typeof doc.getElementsByTagName === 'function') {
      const errors = doc.getElementsByTagName('parsererror');
      if (errors && errors.length > 0) return true;
    }
    if (typeof doc.querySelector === 'function') {
      if (doc.querySelector('parsererror')) return true;
    }
    return false;
  }

  function parseSvgString(svgText, DOMParserCtor = globalThis.DOMParser) {
    if (typeof DOMParserCtor !== 'function') {
      throw new Error('DOMParser が利用できません');
    }
    if (typeof svgText !== 'string' || !svgText.trim()) {
      throw new Error('空のSVGコードです');
    }

    const parser = new DOMParserCtor();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    if (!hasParserError(doc)) {
      return { doc, svgEl: doc.documentElement, repaired: false };
    }

    const repairedText = repairXmlEntities(svgText);
    const repairedDoc = parser.parseFromString(repairedText, 'image/svg+xml');
    if (!hasParserError(repairedDoc)) {
      return { doc: repairedDoc, svgEl: repairedDoc.documentElement, repaired: true };
    }

    throw new Error('SVGのXML構文を解析できませんでした');
  }

  function walkElements(root, visitor) {
    if (!root) return;
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      visitor(node);
      const children = node.children || node.childNodes || [];
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child && (child.nodeType === undefined || child.nodeType === 1)) {
          stack.push(child);
        }
      }
    }
  }

  function getAttributeList(el) {
    if (!el || !el.attributes) return [];
    return Array.from(el.attributes);
  }

  function isBlockedTag(name) {
    const lower = String(name || '').toLowerCase();
    return (
      lower === 'script' ||
      lower === 'iframe' ||
      lower === 'object' ||
      lower === 'embed' ||
      lower === 'audio' ||
      lower === 'video' ||
      lower === 'applet' ||
      lower === 'base' ||
      lower === 'link' ||
      lower === 'meta'
    );
  }

  function isSmilAnimationTag(name) {
    const lower = String(name || '').toLowerCase();
    return (
      lower === 'set' ||
      lower === 'animate' ||
      lower === 'animatetransform' ||
      lower === 'animatemotion'
    );
  }

  function isDangerousUri(value) {
    // Strip ASCII control characters and whitespace before scheme inspection
    const compact = String(value || '').replace(/[\x00-\x20\u00A0]+/g, '').toLowerCase();
    return (
      compact.startsWith('javascript:') ||
      compact.startsWith('vbscript:') ||
      compact.startsWith('data:text/html')
    );
  }

  function hasDangerousCss(styleValue) {
    const text = String(styleValue || '');
    return /@import\b|expression\s*\(|javascript\s*:|vbscript\s*:/i.test(text);
  }

  function sanitizeSvgElement(svgEl) {
    if (!svgEl || typeof svgEl.cloneNode !== 'function') {
      throw new Error('有効なSVG要素ではありません');
    }

    const cloned = svgEl.cloneNode(true);
    const toRemove = [];

    walkElements(cloned, (el) => {
      const tagName = el.localName || el.tagName || el.nodeName || '';
      if (isBlockedTag(tagName)) {
        toRemove.push(el);
        return;
      }

      // Block SMIL elements that mutate event handlers or inject dangerous URI attributes
      if (isSmilAnimationTag(tagName)) {
        const targetAttr = String(el.getAttribute?.('attributeName') || '').trim().toLowerCase();
        if (/^on/i.test(targetAttr)) {
          toRemove.push(el);
          return;
        }
        if (targetAttr === 'href' || targetAttr === 'xlink:href' || targetAttr === 'src') {
          const toVal = el.getAttribute?.('to') || '';
          const fromVal = el.getAttribute?.('from') || '';
          const valuesVal = el.getAttribute?.('values') || '';
          const parts = [toVal, fromVal, ...String(valuesVal).split(';')];
          if (parts.some((p) => isDangerousUri(p))) {
            toRemove.push(el);
            return;
          }
        }
      }

      for (const attr of getAttributeList(el)) {
        const attrName = String(attr.name || '');
        const lowerName = attrName.toLowerCase();
        const attrVal = String(attr.value || '').trim();

        if (/^on/i.test(attrName)) {
          el.removeAttribute(attrName);
          continue;
        }

        if (
          lowerName === 'href' ||
          lowerName === 'xlink:href' ||
          lowerName === 'src' ||
          lowerName === 'action' ||
          lowerName === 'formaction'
        ) {
          if (isDangerousUri(attrVal)) {
            el.removeAttribute(attrName);
          }
          continue;
        }

        if (lowerName === 'style' && hasDangerousCss(attrVal)) {
          el.removeAttribute(attrName);
        }
      }
    });

    for (const node of toRemove) {
      if (typeof node.remove === 'function') {
        node.remove();
      } else if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }
    }

    return cloned;
  }

  /**
   * Strip elements that could leak network requests or bleed CSS into a host page
   * when temporarily mounting a sanitized SVG into live DOM for getBBox() measurement.
   */
  function stripUnsafeDomMeasurementNodes(svgEl) {
    const cloned = sanitizeSvgElement(svgEl);
    const toRemove = [];

    walkElements(cloned, (el) => {
      const tag = String(el.localName || el.tagName || el.nodeName || '').toLowerCase();
      if (tag === 'style' || tag === 'foreignobject' || tag === 'image' || tag === 'feimage') {
        toRemove.push(el);
        return;
      }
      if (tag === 'use') {
        const href = String(el.getAttribute?.('href') || el.getAttribute?.('xlink:href') || '').trim();
        if (href && !href.startsWith('#')) {
          toRemove.push(el);
        }
      }
    });

    for (const node of toRemove) {
      if (typeof node.remove === 'function') {
        node.remove();
      } else if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }
    }

    return cloned;
  }

  function parseCssLength(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.endsWith('%') || trimmed.toLowerCase() === 'auto') {
      return null;
    }
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|rem)?$/i.exec(trimmed);
    if (!match) return null;

    const num = Number(match[1]);
    const unit = (match[2] || '').toLowerCase();
    const factor = UNIT_TO_PX[unit];
    if (!Number.isFinite(num) || !factor) return null;

    const px = num * factor;
    return Number.isFinite(px) && px > 0 ? px : null;
  }

  function parseViewBox(viewBoxStr) {
    if (typeof viewBoxStr !== 'string') return null;
    const parts = viewBoxStr
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return null;
    }

    const [minX, minY, width, height] = parts;
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { minX, minY, width, height };
  }

  function resolveSvgDimensions(svgEl, measureBBoxFn) {
    const widthAttr = svgEl.getAttribute?.('width') ?? null;
    const heightAttr = svgEl.getAttribute?.('height') ?? null;
    const viewBoxAttr = svgEl.getAttribute?.('viewBox') ?? null;

    const w = parseCssLength(widthAttr);
    const h = parseCssLength(heightAttr);
    const vb = parseViewBox(viewBoxAttr);

    if (w !== null && h !== null) {
      return {
        width: w,
        height: h,
        viewBox: vb || { minX: 0, minY: 0, width: w, height: h },
        isFallback: false,
      };
    }

    if (vb !== null) {
      if (w !== null) {
        return {
          width: w,
          height: (w * vb.height) / vb.width,
          viewBox: vb,
          isFallback: false,
        };
      }
      if (h !== null) {
        return {
          width: (h * vb.width) / vb.height,
          height: h,
          viewBox: vb,
          isFallback: false,
        };
      }
      return {
        width: vb.width,
        height: vb.height,
        viewBox: vb,
        isFallback: false,
      };
    }

    if (typeof measureBBoxFn === 'function') {
      try {
        const box = measureBBoxFn(svgEl);
        if (box && Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0) {
          const minX = Number.isFinite(box.x) ? box.x : 0;
          const minY = Number.isFinite(box.y) ? box.y : 0;
          const width = Math.max(1, box.width);
          const height = Math.max(1, box.height);
          return {
            width,
            height,
            viewBox: { minX, minY, width, height },
            isFallback: false,
          };
        }
      } catch {
        // Fallback below if measuring throws
      }
    }

    return {
      width: FALLBACK_WIDTH,
      height: FALLBACK_HEIGHT,
      viewBox: { minX: 0, minY: 0, width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT },
      isFallback: true,
    };
  }

  function computeOutputMetrics(baseDims, scale = 2, padding = 0) {
    const baseWidth = Math.max(1, Number(baseDims?.width) || FALLBACK_WIDTH);
    const baseHeight = Math.max(1, Number(baseDims?.height) || FALLBACK_HEIGHT);
    const requestedScale = Math.max(0.1, Number(scale) || 1);
    const basePadding = Math.max(0, Number(padding) || 0);

    const totalBaseWidth = baseWidth + basePadding * 2;
    const totalBaseHeight = baseHeight + basePadding * 2;

    let effectiveScale = requestedScale;
    let wasClamped = false;

    const maxScaleBySide = Math.min(
      MAX_CANVAS_SIDE / totalBaseWidth,
      MAX_CANVAS_SIDE / totalBaseHeight
    );
    const maxScaleByArea = Math.sqrt(
      MAX_CANVAS_PIXELS / (totalBaseWidth * totalBaseHeight)
    );
    const maxAllowedScale = Math.min(maxScaleBySide, maxScaleByArea);

    if (effectiveScale > maxAllowedScale) {
      effectiveScale = maxAllowedScale;
      wasClamped = true;
    }

    let padPx = Math.round(basePadding * effectiveScale);
    let innerWidth = Math.max(1, Math.round(baseWidth * effectiveScale));
    let innerHeight = Math.max(1, Math.round(baseHeight * effectiveScale));

    let canvasWidth = innerWidth + padPx * 2;
    let canvasHeight = innerHeight + padPx * 2;

    // Guard rounding edge cases against hard canvas limits
    while (
      canvasWidth > MAX_CANVAS_SIDE ||
      canvasHeight > MAX_CANVAS_SIDE ||
      canvasWidth * canvasHeight > MAX_CANVAS_PIXELS
    ) {
      wasClamped = true;
      if (padPx > 0 && canvasWidth - 2 >= 1 && canvasHeight - 2 >= 1) {
        padPx = Math.max(0, padPx - 1);
      } else {
        const shrink = Math.min(
          MAX_CANVAS_SIDE / canvasWidth,
          MAX_CANVAS_SIDE / canvasHeight,
          Math.sqrt(MAX_CANVAS_PIXELS / (canvasWidth * canvasHeight)),
          0.99
        );
        innerWidth = Math.max(1, Math.floor(innerWidth * shrink));
        innerHeight = Math.max(1, Math.floor(innerHeight * shrink));
      }
      canvasWidth = innerWidth + padPx * 2;
      canvasHeight = innerHeight + padPx * 2;
    }

    return {
      innerWidth,
      innerHeight,
      padPx,
      canvasWidth,
      canvasHeight,
      effectiveScale,
      wasClamped,
    };
  }

  function hasXlinkAttribute(rootEl) {
    let found = false;
    walkElements(rootEl, (el) => {
      if (found) return;
      for (const attr of getAttributeList(el)) {
        if (String(attr.name || '').startsWith('xlink:')) {
          found = true;
          return;
        }
      }
    });
    return found;
  }

  function stripConflictingStyleDimensions(styleValue) {
    if (typeof styleValue !== 'string' || !styleValue.trim()) return '';
    return styleValue
      .split(';')
      .map((decl) => decl.trim())
      .filter((decl) => {
        if (!decl) return false;
        const prop = decl.split(':')[0]?.trim().toLowerCase();
        return prop !== 'width' && prop !== 'height' && prop !== 'max-width' && prop !== 'max-height';
      })
      .join('; ');
  }

  function stripExternalDependencies(svgEl) {
    const cloned = svgEl.cloneNode(true);
    const toRemove = [];

    walkElements(cloned, (el) => {
      const tag = String(el.localName || el.tagName || el.nodeName || '').toLowerCase();
      if (tag === 'foreignobject') {
        toRemove.push(el);
        return;
      }
      if (tag === 'image') {
        const href = el.getAttribute?.('href') || el.getAttribute?.('xlink:href') || '';
        if (/^https?:/i.test(href.trim())) {
          toRemove.push(el);
        }
      }
    });

    for (const node of toRemove) {
      if (typeof node.remove === 'function') {
        node.remove();
      } else if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }
    }
    return cloned;
  }

  function prepareSvgForRasterization(svgEl, options = {}) {
    const {
      scale = 2,
      padding = 0,
      measureBBoxFn = null,
      XMLSerializerCtor = globalThis.XMLSerializer,
      stripUnsafeForCanvas = false,
    } = options;

    let sanitized = sanitizeSvgElement(svgEl);
    if (stripUnsafeForCanvas) {
      sanitized = stripExternalDependencies(sanitized);
    }

    const baseDims = resolveSvgDimensions(sanitized, measureBBoxFn);
    const metrics = computeOutputMetrics(baseDims, scale, padding);

    if (!sanitized.getAttribute?.('xmlns')) {
      sanitized.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (hasXlinkAttribute(sanitized) && !sanitized.getAttribute?.('xmlns:xlink')) {
      sanitized.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }

    const vb = baseDims.viewBox;
    sanitized.setAttribute('viewBox', `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`);
    sanitized.setAttribute('width', String(metrics.innerWidth));
    sanitized.setAttribute('height', String(metrics.innerHeight));

    const existingStyle = sanitized.getAttribute?.('style');
    if (existingStyle) {
      const cleanedStyle = stripConflictingStyleDimensions(existingStyle);
      if (cleanedStyle) {
        sanitized.setAttribute('style', cleanedStyle);
      } else {
        sanitized.removeAttribute('style');
      }
    }

    let svgXml;
    if (typeof XMLSerializerCtor === 'function') {
      svgXml = new XMLSerializerCtor().serializeToString(sanitized);
    } else if (typeof sanitized.outerHTML === 'string') {
      svgXml = sanitized.outerHTML;
    } else {
      throw new Error('XMLSerializer が利用できません');
    }

    return {
      svgXml,
      baseDims,
      metrics,
      sanitizedEl: sanitized,
    };
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(String(str));
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function svgToDataUrl(svgXml) {
    return `data:image/svg+xml;base64,${utf8ToBase64(svgXml)}`;
  }

  function extractSvgTitle(svgEl) {
    if (!svgEl) return '';
    let titleText = '';
    const children = svgEl.children || svgEl.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const name = String(child?.localName || child?.tagName || child?.nodeName || '').toLowerCase();
      if (name === 'title') {
        titleText = String(child.textContent || '').trim();
        break;
      }
    }
    if (!titleText && typeof svgEl.querySelector === 'function') {
      const found = svgEl.querySelector('title');
      titleText = String(found?.textContent || '').trim();
    }
    return titleText;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function sanitizeFileStem(rawName) {
    return String(rawName || '')
      .replace(/\.svg$/i, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 48);
  }

  function buildExportBasename(svgEl, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const stamp = [
      now.getFullYear(),
      pad2(now.getMonth() + 1),
      pad2(now.getDate()),
    ].join('') + '-' + [
      pad2(now.getHours()),
      pad2(now.getMinutes()),
      pad2(now.getSeconds()),
    ].join('');

    const fromFile = sanitizeFileStem(options.sourceFilename);
    const fromTitle = sanitizeFileStem(extractSvgTitle(svgEl));
    const prefix = fromFile || fromTitle || 'svg-export';
    return `${prefix}-${stamp}`;
  }

  function buildExportFilename(svgEl, ext, now = new Date(), sourceFilename = '') {
    const cleanExt = String(ext || 'png').replace(/^\./, '').toLowerCase();
    const base = buildExportBasename(svgEl, { now, sourceFilename });
    return `${base}.${cleanExt}`;
  }

  function prepareCleanSvgDocument(svgEl, XMLSerializerCtor = globalThis.XMLSerializer) {
    const sanitized = sanitizeSvgElement(svgEl);
    if (!sanitized.getAttribute?.('xmlns')) {
      sanitized.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (hasXlinkAttribute(sanitized) && !sanitized.getAttribute?.('xmlns:xlink')) {
      sanitized.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }

    let serialized;
    if (typeof XMLSerializerCtor === 'function') {
      serialized = new XMLSerializerCtor().serializeToString(sanitized);
    } else if (typeof sanitized.outerHTML === 'string') {
      serialized = sanitized.outerHTML;
    } else {
      throw new Error('XMLSerializer が利用できません');
    }

    if (/^\s*<\?xml\b/i.test(serialized)) {
      return serialized;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
  }

  async function readSvgFromFile(file) {
    if (!file || typeof file.text !== 'function') {
      throw new Error('Invalid file object');
    }
    const name = String(file.name || 'dropped.svg');
    if (Number.isFinite(file.size) && file.size > MAX_SVG_INPUT_BYTES) {
      const err = new Error(`File exceeds maximum size (${MAX_SVG_INPUT_BYTES} bytes): ${name}`);
      err.code = 'SVG_TOO_LARGE';
      err.fileName = name;
      throw err;
    }
    const mime = String(file.type || '').toLowerCase();
    const looksLikeSvgFile = /\.svg$/i.test(name) || mime === 'image/svg+xml' || mime === 'text/xml' || mime === 'application/xml' || mime === '';
    if (!looksLikeSvgFile) {
      const err = new Error(`Not an SVG file: ${name}`);
      err.code = 'INVALID_SVG_FILE';
      err.fileName = name;
      throw err;
    }

    const rawText = await file.text();
    if (rawText.length > MAX_SVG_INPUT_BYTES) {
      const err = new Error(`File exceeds maximum size (${MAX_SVG_INPUT_BYTES} bytes): ${name}`);
      err.code = 'SVG_TOO_LARGE';
      err.fileName = name;
      throw err;
    }
    const extracted = extractSvgFromCode(rawText, 'svg');
    if (extracted.status !== 'complete' || !extracted.svgText) {
      const err = new Error(`Invalid SVG content: ${name}`);
      err.code = 'INVALID_SVG_FILE';
      err.fileName = name;
      throw err;
    }

    return {
      svgText: extracted.svgText,
      hash: hashSvgText(extracted.svgText),
      fileName: name,
    };
  }

  function hashSvgText(svgText) {
    const str = String(svgText || '');
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 ^= ch;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= ch + (i & 0xff);
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    return `${str.length.toString(16)}-${h1.toString(16).padStart(8, '0')}-${h2.toString(16).padStart(8, '0')}`;
  }

  const exported = {
    MAX_CANVAS_SIDE,
    MAX_CANVAS_PIXELS,
    MAX_SVG_INPUT_BYTES,
    FALLBACK_WIDTH,
    FALLBACK_HEIGHT,
    extractSvgFromCode,
    hashSvgText,
    repairXmlEntities,
    parseSvgString,
    sanitizeSvgElement,
    stripUnsafeDomMeasurementNodes,
    parseCssLength,
    parseViewBox,
    resolveSvgDimensions,
    computeOutputMetrics,
    prepareSvgForRasterization,
    prepareCleanSvgDocument,
    readSvgFromFile,
    utf8ToBase64,
    svgToDataUrl,
    extractSvgTitle,
    buildExportBasename,
    buildExportFilename,
  };

  if (!globalThis.GeminiSvgExporter) {
    globalThis.GeminiSvgExporter = {};
  }
  globalThis.GeminiSvgExporter.svgUtils = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})();
