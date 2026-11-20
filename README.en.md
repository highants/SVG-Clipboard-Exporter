# SVG Clipboard Exporter — v2.1.0

English | [日本語](README.md)

A Chrome Extension (Manifest V3) that detects copied SVG code or dropped `.svg` files and converts them into crisp **PNG** or **JPG** images for clipboard copy or download.

## Features

- **Clipboard SVG Auto-Detection**:
  - Automatically detects SVG code copied via "Copy code" buttons (Gemini, ChatGPT, GitHub, etc. via `navigator.clipboard.writeText` / `write`), `Ctrl+C` (`copy` events), or external editors when returning focus to Chrome, and prompts you to convert it.
- **Japanese / English Language Switcher**:
  - Toggle between Japanese and English with one click using the **EN / 日本語** button in the popup or Drop Window header, or choose `Auto (Browser Default) / 日本語 / English` in settings. In-page dialogs and toast notifications update immediately.
- **Save Alongside `.svg` Mode**:
  - When "Also save .svg file on download" is enabled, saving a PNG or JPG also downloads the sanitized original `.svg` file (with XML declaration and `xmlns`) using the same base filename.
- **Direct SVG Drag & Drop Conversion**:
  - Drop `.svg` files directly into the popup's drop zone (or click to browse).
  - Use **Drop Window** to open a persistent converter window where you can drag and drop single or multiple `.svg` files directly from Windows Explorer or macOS Finder, preview, batch export PNG/JPG (+SVG), or paste SVG code with `Ctrl+V`.

## Installation

1. Open `chrome://extensions/` in Google Chrome.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `SVG-Clipboard-Exporter` folder.

## Permissions, Privacy & Security

This extension runs **100% locally** with zero external network requests, zero telemetry, and no persistent storage of your clipboard contents.

| Permission | Purpose |
| :--- | :--- |
| `storage` | Saves user preferences (scale, quality, background color, language, etc.) in `chrome.storage.sync`, and temporarily holds only the pending SVG in `chrome.storage.session` until converted or dismissed. |
| `clipboardRead` / `offscreen` | Locally checks clipboard text for SVG code when returning from external apps or when a `copy` event has no readable selection. Normal non-SVG text selections never trigger background clipboard reads or storage writes. |
| `clipboardWrite` | Writes the rendered PNG/JPG image to your clipboard when you click "Copy as PNG" or "Copy as JPG". |
| `content_scripts` (`http://*/*`, `https://*/*`) | Detects copy actions on web pages and shows the fallback in-page confirmation dialog when `chrome.action.openPopup()` cannot open. Unsolicited `postMessage` triggers from page scripts without active user interaction are blocked via User Activation checks. |

- **SVG Sanitization**: Before previewing, rasterizing, or saving `.svg` files, dangerous elements (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<meta>`, `<link>`, `<base>`, unsafe `<set>`/`<animate>` SMIL tags), `on*` event attributes, and `javascript:` / `vbscript:` / `data:text/html` URIs are stripped.

## Note on JPG Clipboard Copy

Chrome's standard Async Clipboard API (`navigator.clipboard.write`) only supports `image/png` as a standard image type and rejects standalone `image/jpeg` writes.

When you click **Copy as JPG**, the extension renders the SVG with your opaque background color and JPEG quality first, then re-encodes it into an OS-compatible `image/png` bitmap (alongside `web image/jpeg` where supported) so pasting works reliably across applications. Use **Save JPG** whenever you need a pure `.jpg` file.

## Running Tests

Run all unit tests using Node.js (v20+) with zero external dependencies:

```powershell
node --test tests/manifest.test.mjs tests/i18n.test.mjs tests/svg-utils.test.mjs tests/renderer.test.mjs tests/workflow.test.mjs
```

## Credits & License

- **Direction**: highants
- **Development**: Antigravity (Google Deepmind)
- **License**: [MIT License](LICENSE)
