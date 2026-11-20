import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT_DIR, 'icons');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom > 0 ? clamp01((pax * bax + pay * bay) / denom) : 0;
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function blendPixel(dst, idx, sr, sg, sb, sa) {
  if (sa <= 0) return;
  const da = dst[idx + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  dst[idx] = Math.round((sr * sa + dst[idx] * da * (1 - sa)) / outA);
  dst[idx + 1] = Math.round((sg * sa + dst[idx + 1] * da * (1 - sa)) / outA);
  dst[idx + 2] = Math.round((sb * sa + dst[idx + 2] * da * (1 - sa)) / outA);
  dst[idx + 3] = Math.round(outA * 255);
}

/**
 * Render an antialiased rounded-square badge (#4F46E5 -> #06B6D4)
 * with a white vector image-frame glyph inside.
 */
function renderIconRgba(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = size <= 24 ? 6 : 4;
  const aa = 1.15 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (px + (sx + 0.5) / samples) / size; // 0..1
          const v = (py + (sy + 0.5) / samples) / size; // 0..1
          const cx = u - 0.5;
          const cy = v - 0.5;

          // Rounded square badge
          const dBadge = sdRoundedBox(cx, cy, 0.45, 0.45, 0.13);
          const badgeAlpha = 1 - smoothstep(-aa, aa, dBadge);

          if (badgeAlpha <= 0) continue;

          // Diagonal gradient #4F46E5 (79, 70, 229) -> #06B6D4 (6, 182, 212)
          const g = clamp01(0.55 * u + 0.45 * v);
          let r = 79 + (6 - 79) * g;
          let gr = 70 + (182 - 70) * g;
          let b = 229 + (212 - 229) * g;

          // Subtle top highlight
          const highlight = clamp01(1 - v * 2.4) * 0.12;
          r = r + (255 - r) * highlight;
          gr = gr + (255 - gr) * highlight;
          b = b + (255 - b) * highlight;

          // White outer vector frame (stroked rounded rect)
          const frameHalf = 0.255;
          const frameOuter = sdRoundedBox(cx, cy, frameHalf, frameHalf, 0.055);
          const strokeHalf = size <= 20 ? 0.042 : 0.032;
          const dFrame = Math.abs(frameOuter) - strokeHalf;
          const frameAlpha = 1 - smoothstep(-aa, aa, dFrame);

          // Vector mountain/curve path inside frame
          const dSeg1 = sdSegment(u, v, 0.30, 0.65, 0.43, 0.49);
          const dSeg2 = sdSegment(u, v, 0.43, 0.49, 0.52, 0.59);
          const dSeg3 = sdSegment(u, v, 0.52, 0.59, 0.63, 0.44);
          const dSeg4 = sdSegment(u, v, 0.63, 0.44, 0.70, 0.56);
          const dPath = Math.min(dSeg1, dSeg2, dSeg3, dSeg4) - (size <= 20 ? 0.036 : 0.028);
          const pathAlpha = 1 - smoothstep(-aa, aa, dPath);

          // Sun / Bezier anchor dot in top-left of frame
          const dDot = Math.hypot(u - 0.39, v - 0.38) - (size <= 20 ? 0.052 : 0.045);
          const dotAlpha = 1 - smoothstep(-aa, aa, dDot);

          const fgAlpha = Math.max(frameAlpha, pathAlpha, dotAlpha);
          r = r + (255 - r) * fgAlpha;
          gr = gr + (255 - gr) * fgAlpha;
          b = b + (255 - b) * fgAlpha;

          accR += r * badgeAlpha;
          accG += gr * badgeAlpha;
          accB += b * badgeAlpha;
          accA += badgeAlpha;
        }
      }

      const n = samples * samples;
      const outA = accA / n;
      const idx = (py * size + px) * 4;
      if (outA > 0) {
        blendPixel(
          rgba,
          idx,
          accR / accA,
          accG / accA,
          accB / accA,
          outA
        );
      }
    }
  }

  return rgba;
}

fs.mkdirSync(ICONS_DIR, { recursive: true });

for (const size of [16, 48, 128]) {
  const rgba = renderIconRgba(size);
  const png = encodePngRgba(size, size, rgba);
  const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${path.relative(ROOT_DIR, outPath)} (${size}x${size}, ${png.length} bytes)`);
}
