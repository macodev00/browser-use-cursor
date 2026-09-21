import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, crc]);
}

function png(size) {
  const raw = [];
  for (let y = 0; y < size; y += 1) {
    raw.push(0);
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size - 0.5;
      const ny = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(nx * nx + ny * ny);
      const inside = r < 0.42;
      const ring = r > 0.28 && r < 0.42;
      raw.push(inside ? (ring ? 125 : 14) : 15);
      raw.push(inside ? (ring ? 211 : 23) : 17);
      raw.push(inside ? (ring ? 252 : 42) : 21);
      raw.push(255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes = [16, 32, 48, 128];
const dirs = [
  join(process.cwd(), "extensions", "chromium", "icons"),
  join(process.cwd(), "extensions", "firefox", "icons"),
];

for (const dir of dirs) {
  await mkdir(dir, { recursive: true });
  for (const size of sizes) {
    await writeFile(join(dir, `icon${size}.png`), png(size));
  }
}

console.log("wrote extension icons");
