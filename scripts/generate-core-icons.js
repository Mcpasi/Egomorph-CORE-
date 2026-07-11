const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function makeIcon(size) {
  const rows = [];
  const center = size / 2;
  const outer = size * 0.34;
  const inner = size * 0.105;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const hexRadius = outer * (0.88 + 0.12 * Math.cos(6 * angle));
      const ring = Math.abs(distance - hexRadius) < size * 0.018;
      const spoke = distance > inner && distance < outer * 0.88 &&
        Math.min(...Array.from({ length: 6 }, (_, i) => Math.abs(Math.sin(angle - i * Math.PI / 3)))) < 0.035;
      const core = distance < inner;
      const glow = Math.max(0, 1 - distance / (outer * 1.45));
      const offset = 1 + x * 4;
      row[offset] = Math.round(7 + glow * 12);
      row[offset + 1] = Math.round(15 + glow * 28);
      row[offset + 2] = Math.round(22 + glow * 36);
      row[offset + 3] = 255;
      if (ring || spoke || core) {
        const mix = Math.max(0, Math.min(1, (x + y) / (size * 2)));
        row[offset] = Math.round(70 + 69 * mix);
        row[offset + 1] = Math.round(199 - 107 * mix);
        row[offset + 2] = Math.round(216 + 30 * mix);
      }
    }
    rows.push(row);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) fs.writeFileSync(path.join(root, `ego_icon_${size}.png`), makeIcon(size));
