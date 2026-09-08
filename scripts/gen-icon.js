// Generates a 16x16 pokeball-ish PNG and prints it as a data URL (for the tray icon).
const zlib = require("zlib");

const W = 16;
const H = 16;
const px = Buffer.alloc(W * H * 4);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    let rgba = [0, 0, 0, 0];
    if (r <= 7.5) {
      if (r > 6.2) {
        rgba = [30, 30, 30, 255]; // outline
      } else if (Math.abs(dy) < 1.1) {
        rgba = [30, 30, 30, 255]; // horizontal band
      } else if (r < 1.6) {
        rgba = [240, 240, 240, 255]; // center button
      } else if (r < 2.8) {
        rgba = [30, 30, 30, 255]; // button ring
      } else if (dy < 0) {
        rgba = [222, 60, 60, 255]; // top half red
      } else {
        rgba = [245, 245, 245, 255]; // bottom half white
      }
    }
    px.set(rgba, (y * W + x) * 4);
  }
}

// raw scanlines with filter byte 0
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  px.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

console.log("data:image/png;base64," + png.toString("base64"));
