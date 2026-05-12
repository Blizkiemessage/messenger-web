#!/usr/bin/env node
/**
 * Generates pwa-192x192.png and pwa-512x512.png using only Node.js built-ins.
 * Run once: node web/scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dir, '..', 'public');

// ── Minimal PNG encoder ────────────────────────────────────────────────────
function int32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  return Buffer.concat([int32be(data.length), t, data, int32be(crc32(Buffer.concat([t, data])))]);
}

// ── Lightning bolt via two triangles (sign-of-cross-product method) ────────
function triSign(p1x, p1y, p2x, p2y, p3x, p3y) {
  return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
}
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = triSign(px, py, ax, ay, bx, by);
  const d2 = triSign(px, py, bx, by, cx, cy);
  const d3 = triSign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function inBolt(px, py, s) {
  const n = v => v * s;
  // Upper triangle: top-right → middle-left diagonal strip
  const upper = inTriangle(px, py,
    n(0.61), n(0.14),   // apex top-right
    n(0.31), n(0.54),   // bottom-left corner
    n(0.56), n(0.54),   // bottom-right corner
  );
  // Lower triangle: middle-right → bottom-left diagonal strip
  const lower = inTriangle(px, py,
    n(0.44), n(0.46),   // top-left corner
    n(0.69), n(0.46),   // top-right corner (apex)
    n(0.39), n(0.86),   // bottom-left
  );
  return upper || lower;
}

// ── PNG builder ────────────────────────────────────────────────────────────
function makeIcon(size) {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const IHDR = pngChunk('IHDR', Buffer.concat([
    int32be(size), int32be(size),
    Buffer.from([8, 2, 0, 0, 0]), // bit-depth=8, color-type=2 (RGB)
  ]));

  // Brand palette
  const BG   = [26,  26,  46];   // #1a1a2e — dark background
  const CIRC = [134, 59,  255];  // #863bff — purple circle
  const BOLT = [255, 255, 255];  // #ffffff — white bolt

  const half    = size / 2;
  const circR2  = (size * 0.42) ** 2;

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // PNG filter: None
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const c = dx * dx + dy * dy <= circR2
        ? (inBolt(x + 0.5, y + 0.5, size) ? BOLT : CIRC)
        : BG;
      row[1 + x * 3] = c[0];
      row[2 + x * 3] = c[1];
      row[3 + x * 3] = c[2];
    }
    rows.push(row);
  }

  const IDAT = pngChunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 }));
  const IEND = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([PNG_SIG, IHDR, IDAT, IEND]);
}

for (const size of [192, 512]) {
  const out = join(publicDir, `pwa-${size}x${size}.png`);
  writeFileSync(out, makeIcon(size));
  console.log(`✓  ${out}`);
}
