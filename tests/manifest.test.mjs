import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function collectFiles(dir, extFilter) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, extFilter));
    } else if (!extFilter || entry.name.endsWith(extFilter)) {
      results.push(full);
    }
  }
  return results;
}

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(buf.length >= 24, `PNG file too small: ${filePath}`);
  assert.ok(buf.subarray(0, 8).equals(pngSig), `Invalid PNG signature: ${filePath}`);
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR', `Missing IHDR chunk: ${filePath}`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

test('manifest.json conforms to MV3 clipboard-triggered architecture and all referenced files exist', () => {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('clipboardRead'));
  assert.ok(manifest.permissions.includes('clipboardWrite'));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(!manifest.permissions.includes('<all_urls>'));

  assert.equal(manifest.background?.service_worker, 'src/background/service-worker.js');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, manifest.background.service_worker)));

  assert.equal(manifest.action?.default_popup, 'src/popup/popup.html');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, manifest.action.default_popup)));

  for (const [sizeStr, relPath] of Object.entries(manifest.icons || {})) {
    const fullPath = path.join(ROOT_DIR, relPath);
    assert.ok(fs.existsSync(fullPath), `Missing icon: ${relPath}`);
    const dims = readPngDimensions(fullPath);
    const expected = Number(sizeStr);
    assert.equal(dims.width, expected, `${relPath} width mismatch`);
    assert.equal(dims.height, expected, `${relPath} height mismatch`);
  }

  for (const [sizeStr, relPath] of Object.entries(manifest.action?.default_icon || {})) {
    const fullPath = path.join(ROOT_DIR, relPath);
    assert.ok(fs.existsSync(fullPath), `Missing action icon: ${relPath}`);
    const dims = readPngDimensions(fullPath);
    const expected = Number(sizeStr);
    assert.equal(dims.width, expected, `${relPath} action width mismatch`);
    assert.equal(dims.height, expected, `${relPath} action height mismatch`);
  }

  assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 2);
  const [mainHook, isolatedScript] = manifest.content_scripts;
  assert.equal(mainHook.world, 'MAIN');
  assert.equal(mainHook.run_at, 'document_start');
  assert.deepEqual(mainHook.matches, ['https://*/*', 'http://*/*']);
  assert.deepEqual(isolatedScript.matches, ['https://*/*', 'http://*/*']);
  assert.ok(isolatedScript.js.includes('src/shared/i18n.js'));

  for (const cs of manifest.content_scripts) {
    for (const rel of [...(cs.js || []), ...(cs.css || [])]) {
      assert.ok(fs.existsSync(path.join(ROOT_DIR, rel)), `Missing content script asset: ${rel}`);
    }
  }

  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'src/offscreen/offscreen.html')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'src/offscreen/offscreen.js')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'src/converter/converter.html')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'src/converter/converter.css')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'src/converter/converter.js')));
});

test('HTML extension pages contain no inline scripts or inline event handlers', () => {
  const htmlFiles = [
    path.join(ROOT_DIR, 'src', 'popup', 'popup.html'),
    path.join(ROOT_DIR, 'src', 'converter', 'converter.html'),
    path.join(ROOT_DIR, 'src', 'offscreen', 'offscreen.html'),
  ];

  const inlineScriptRegex = /<script(?![^>]*\bsrc=)[^>]*>/i;
  const inlineHandlerRegex = /\son[a-z]+\s*=/i;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    assert.equal(inlineScriptRegex.test(html), false, `Inline <script> found in ${file}`);
    assert.equal(inlineHandlerRegex.test(html), false, `Inline on* handler found in ${file}`);
  }

  for (const uiFile of [htmlFiles[0], htmlFiles[1]]) {
    const html = fs.readFileSync(uiFile, 'utf8');
    assert.ok(html.includes('<meta name="color-scheme" content="light dark">'), `Missing color-scheme meta in ${uiFile}`);
  }
});

test('offscreen.js does not call restricted chrome.* APIs', () => {
  const offscreenJs = fs.readFileSync(path.join(ROOT_DIR, 'src/offscreen/offscreen.js'), 'utf8');
  assert.equal(/chrome\.(?:downloads|tabs|action|storage|windows)\b/.test(offscreenJs), false);
});

test('content.js enforces user-activation check, safe DOM measurement, and avoids Gemini code-block scanning', () => {
  const contentJs = fs.readFileSync(path.join(ROOT_DIR, 'src/content/content.js'), 'utf8');
  assert.equal(contentJs.includes('code-block'), false);
  assert.equal(contentJs.includes('querySelectorAll(\'pre'), false);
  assert.ok(contentJs.includes('stripUnsafeDomMeasurementNodes'));
  assert.ok(contentJs.includes('hasRecentUserActivation'));
});

test('repository includes LICENSE, .gitignore, bilingual READMEs with switch links, matching version, and required credits', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  const licensePath = path.join(ROOT_DIR, 'LICENSE');
  const gitignorePath = path.join(ROOT_DIR, '.gitignore');
  const readmePath = path.join(ROOT_DIR, 'README.md');
  const readmeEnPath = path.join(ROOT_DIR, 'README.en.md');

  assert.ok(fs.existsSync(licensePath), 'Missing LICENSE');
  assert.ok(fs.existsSync(gitignorePath), 'Missing .gitignore');
  assert.ok(fs.existsSync(readmeEnPath), 'Missing README.en.md');

  const license = fs.readFileSync(licensePath, 'utf8');
  assert.ok(license.includes('MIT License'));
  assert.ok(license.includes('Copyright (c) 2026 highants'));

  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  assert.ok(gitignore.includes('*.pem'));
  assert.ok(gitignore.includes('.env'));

  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.ok(readme.includes(`v${manifest.version}`), 'README version must match manifest.json');
  assert.ok(readme.includes('[English](README.en.md)'), 'README.md must link to README.en.md');
  assert.ok(readme.includes('highants'), 'README must credit highants');
  assert.ok(readme.includes('Antigravity (Google Deepmind)'), 'README must credit Antigravity (Google Deepmind)');

  const readmeEn = fs.readFileSync(readmeEnPath, 'utf8');
  assert.ok(readmeEn.includes(`v${manifest.version}`), 'README.en.md version must match manifest.json');
  assert.ok(readmeEn.includes('[日本語](README.md)'), 'README.en.md must link to README.md');
  assert.ok(readmeEn.includes('highants'), 'README.en.md must credit highants');
  assert.ok(readmeEn.includes('Antigravity (Google Deepmind)'), 'README.en.md must credit Antigravity (Google Deepmind)');
});

test('source JS files use async/await with no .then() chains', () => {
  const jsFiles = collectFiles(path.join(ROOT_DIR, 'src'), '.js');
  assert.ok(jsFiles.length >= 10);

  for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    assert.equal(
      /\.then\s*\(/.test(src),
      false,
      `Found forbidden .then() chain in ${path.relative(ROOT_DIR, file)}`
    );
  }
});
