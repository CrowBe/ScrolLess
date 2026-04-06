import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BRAND = {
  bg: [18, 18, 18, 255],
  teal: [77, 182, 172],
  coral: [255, 95, 138],
  glyph: [18, 18, 18, 255],
};

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writePng(filePath, width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
}

function writeIco(filePath, pngData) {
  // ICO with one PNG image entry (32x32).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width
  entry.writeUInt8(32, 1); // height
  entry.writeUInt8(0, 2); // palette size
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngData.length, 8); // bytes in resource
  entry.writeUInt32LE(header.length + entry.length, 12); // offset

  fs.writeFileSync(filePath, Buffer.concat([header, entry, pngData]));
}

function renderIcon(size) {
  const data = Buffer.alloc(size * size * 4);
  const radiusRect = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;
  const circleR = size * 0.375;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nearestX = Math.max(radiusRect, Math.min(x, size - radiusRect));
      const nearestY = Math.max(radiusRect, Math.min(y, size - radiusRect));
      const inRoundRect = (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radiusRect ** 2;

      if (!inRoundRect) {
        data[idx + 3] = 0;
        continue;
      }

      data[idx] = BRAND.bg[0];
      data[idx + 1] = BRAND.bg[1];
      data[idx + 2] = BRAND.bg[2];
      data[idx + 3] = 255;

      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);

      if (dist <= circleR) {
        const t = Math.min(1, Math.max(0, (x + y) / (2 * (size - 1))));
        data[idx] = Math.round(BRAND.teal[0] + (BRAND.coral[0] - BRAND.teal[0]) * t);
        data[idx + 1] = Math.round(BRAND.teal[1] + (BRAND.coral[1] - BRAND.teal[1]) * t);
        data[idx + 2] = Math.round(BRAND.teal[2] + (BRAND.coral[2] - BRAND.teal[2]) * t);
      }

      // Stylized S built from two curved bands.
      const nx = dx / circleR;
      const ny = dy / circleR;
      const topArc = Math.hypot(nx + 0.15, ny + 0.35);
      const bottomArc = Math.hypot(nx - 0.12, ny - 0.35);
      const topBand = topArc > 0.52 && topArc < 0.76 && ny < 0.02 && nx > -0.75 && nx < 0.55;
      const bottomBand = bottomArc > 0.52 && bottomArc < 0.76 && ny > -0.02 && nx > -0.55 && nx < 0.75;
      const connector = Math.abs(nx) < 0.18 && Math.abs(ny) < 0.16;

      if ((topBand || bottomBand || connector) && dist < circleR * 0.92) {
        data[idx] = BRAND.glyph[0];
        data[idx + 1] = BRAND.glyph[1];
        data[idx + 2] = BRAND.glyph[2];
        data[idx + 3] = BRAND.glyph[3];
      }
    }
  }

  return data;
}

const root = process.cwd();
const outDir = path.join(root, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: path.join(root, 'public', 'favicon-16.png'), size: 16 },
  { file: path.join(root, 'public', 'favicon-32.png'), size: 32 },
  { file: path.join(root, 'public', 'apple-touch-icon.png'), size: 180 },
  { file: path.join(outDir, 'icon-192.png'), size: 192 },
  { file: path.join(outDir, 'icon-512.png'), size: 512 },
];

for (const target of targets) {
  const rgba = renderIcon(target.size);
  writePng(target.file, target.size, target.size, rgba);
  console.log(`Generated ${path.relative(root, target.file)}`);
}

const faviconPngPath = path.join(root, 'public', 'favicon-32.png');
const faviconIcoPath = path.join(root, 'public', 'favicon.ico');
writeIco(faviconIcoPath, fs.readFileSync(faviconPngPath));
console.log(`Generated ${path.relative(root, faviconIcoPath)}`);
