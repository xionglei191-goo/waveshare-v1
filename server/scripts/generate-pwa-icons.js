#!/usr/bin/env node
"use strict";

// Generates dependency-free PWA icons for the Family Hub management console.
// The icon evokes the round 1.85B screen: a glowing ring on a dark panel.
// Output: server/public/pwa/icons/icon-<size>.png (maskable, safe zone aware).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "pwa", "icons");

// Theme colors aligned with the companion dark UI.
const BG = [15, 20, 24]; // #0f1418 panel background
const RING = [94, 224, 181]; // #5ee0b5 accent
const RING_DIM = [46, 143, 115]; // dim accent
const DOT = [113, 168, 255]; // #71a8ff blue

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // Maskable safe zone: keep meaningful content within the central 80%.
  const contentR = size * 0.38; // outer ring radius
  const ringWidth = size * 0.07;
  const innerR = contentR - ringWidth;
  const dotR = size * 0.11;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Base background with a subtle vertical gradient.
      let color = mix(BG, [20, 34, 40], y / size);

      // Outer glowing ring.
      if (dist <= contentR && dist >= innerR) {
        const edge = Math.min(contentR - dist, dist - innerR);
        const t = Math.min(1, edge / (ringWidth * 0.5));
        color = mix(RING_DIM, RING, t);
      } else if (dist < innerR) {
        // Inner face slightly lighter than background.
        color = mix(BG, [26, 40, 47], 1 - dist / innerR);
      }

      // Center dot (voice/AI indicator).
      if (dist <= dotR) {
        const t = Math.min(1, (dotR - dist) / (dotR * 0.6));
        color = mix(color, DOT, t);
      }

      // Anti-alias the outer edge of the ring.
      let alpha = 255;

      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = alpha;
    }
  }
  return px;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Add filter byte (0) at the start of each scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of [192, 512]) {
    const rgba = drawIcon(size);
    const png = encodePng(size, rgba);
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(file, png);
    console.log(`wrote ${file} (${png.length} bytes)`);
  }
}

main();
