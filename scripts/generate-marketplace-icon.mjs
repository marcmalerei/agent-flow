import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const size = 256;
const pixels = Buffer.alloc(size * size * 4);

const colors = {
  background: [15, 18, 22, 255],
  grid: [74, 92, 111, 82],
  blue: [55, 148, 255, 255],
  purple: [183, 117, 255, 255],
  green: [102, 199, 117, 255],
  orange: [234, 151, 43, 255],
  text: [238, 242, 247, 255]
};

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (Math.round(y) * size + Math.round(x)) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function blendPixel(x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (Math.round(y) * size + Math.round(x)) * 4;
  const sourceAlpha = (color[3] / 255) * alpha;
  const inverse = 1 - sourceAlpha;
  pixels[offset] = Math.round(color[0] * sourceAlpha + pixels[offset] * inverse);
  pixels[offset + 1] = Math.round(color[1] * sourceAlpha + pixels[offset + 1] * inverse);
  pixels[offset + 2] = Math.round(color[2] * sourceAlpha + pixels[offset + 2] * inverse);
  pixels[offset + 3] = 255;
}

function fillRect(x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) setPixel(xx, yy, color);
  }
}

function roundedRect(x, y, width, height, radius, fill, stroke, strokeWidth = 3) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      const dx = xx < x + radius ? x + radius - xx : xx > x + width - radius ? xx - (x + width - radius) : 0;
      const dy = yy < y + radius ? y + radius - yy : yy > y + height - radius ? yy - (y + height - radius) : 0;
      if (dx * dx + dy * dy <= radius * radius) setPixel(xx, yy, fill);
    }
  }

  for (let inset = 0; inset < strokeWidth; inset += 1) {
    line(x + radius, y + inset, x + width - radius, y + inset, stroke, 1);
    line(x + radius, y + height - 1 - inset, x + width - radius, y + height - 1 - inset, stroke, 1);
    line(x + inset, y + radius, x + inset, y + height - radius, stroke, 1);
    line(x + width - 1 - inset, y + radius, x + width - 1 - inset, y + height - radius, stroke, 1);
    arc(x + radius, y + radius, radius - inset, Math.PI, Math.PI * 1.5, stroke);
    arc(x + width - radius, y + radius, radius - inset, Math.PI * 1.5, 0, stroke);
    arc(x + width - radius, y + height - radius, radius - inset, 0, Math.PI * 0.5, stroke);
    arc(x + radius, y + height - radius, radius - inset, Math.PI * 0.5, Math.PI, stroke);
  }
}

function line(x1, y1, x2, y2, color, width = 3) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 0; i <= steps; i += 1) {
    const x = x1 + (dx * i) / steps;
    const y = y1 + (dy * i) / steps;
    for (let yy = -width; yy <= width; yy += 1) {
      for (let xx = -width; xx <= width; xx += 1) {
        const distance = Math.sqrt(xx * xx + yy * yy);
        if (distance <= width) blendPixel(x + xx, y + yy, color, 1 - distance / (width + 1));
      }
    }
  }
}

function arc(cx, cy, radius, start, end, color) {
  const step = 1 / Math.max(radius, 1);
  const normalizedEnd = end < start ? end + Math.PI * 2 : end;
  for (let angle = start; angle <= normalizedEnd; angle += step) {
    blendPixel(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, color);
  }
}

function circle(cx, cy, radius, color) {
  for (let yy = -radius; yy <= radius; yy += 1) {
    for (let xx = -radius; xx <= radius; xx += 1) {
      const distance = Math.sqrt(xx * xx + yy * yy);
      if (distance <= radius) blendPixel(cx + xx, cy + yy, color, 1 - distance / (radius + 1));
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const body = Buffer.concat([typeBuffer, data]);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(body), 8 + data.length);
  return output;
}

function pngEncode() {
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

fillRect(0, 0, size, size, colors.background);
for (let y = 22; y < size; y += 26) {
  for (let x = 22; x < size; x += 26) blendPixel(x, y, colors.grid);
}

line(74, 92, 128, 72, colors.blue, 2);
line(74, 92, 128, 160, colors.green, 2);
line(128, 72, 182, 116, colors.purple, 2);
line(128, 160, 182, 116, colors.orange, 2);

roundedRect(34, 62, 80, 60, 12, [20, 24, 30, 255], colors.blue, 4);
roundedRect(88, 132, 80, 60, 12, [20, 24, 30, 255], colors.green, 4);
roundedRect(142, 86, 80, 60, 12, [20, 24, 30, 255], colors.purple, 4);
roundedRect(88, 40, 80, 60, 12, [20, 24, 30, 255], colors.orange, 4);

circle(74, 92, 8, colors.blue);
circle(128, 72, 8, colors.orange);
circle(128, 160, 8, colors.green);
circle(182, 116, 8, colors.purple);

// Minimal "AF" mark built from block strokes.
fillRect(60, 82, 8, 24, colors.text);
fillRect(68, 82, 20, 7, colors.text);
fillRect(68, 94, 16, 6, colors.text);
fillRect(103, 61, 8, 24, colors.text);
fillRect(111, 61, 22, 7, colors.text);
fillRect(111, 73, 17, 6, colors.text);

const outputPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'media', 'icon.png');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, pngEncode());
console.log(outputPath);
