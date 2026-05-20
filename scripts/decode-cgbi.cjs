// Decodes an Apple CgBI PNG (what actool emits into the .app bundle) back
// to a normal PNG so we can eyeball whether the SHIPPED app icon is the
// real logo. CgBI quirks: a CgBI chunk before IHDR, IDAT is raw-deflate
// (no zlib header), pixels are BGRA with premultiplied alpha.
const fs = require('fs');
const zlib = require('zlib');
const sharp = require('sharp');

const src = process.argv[2];
const out = process.argv[3] || 'store-assets/_decoded-icon.png';
const buf = fs.readFileSync(src);

let pos = 8,
  width,
  height,
  isCgBI = false;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'CgBI') isCgBI = true;
  else if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  pos += 12 + len;
}
const comp = Buffer.concat(idat);
const raw = isCgBI ? zlib.inflateRawSync(comp) : zlib.inflateSync(comp);

const bpp = 4,
  stride = width * bpp;
const px = Buffer.alloc(height * stride);
let rp = 0;
for (let y = 0; y < height; y++) {
  const f = raw[rp++];
  for (let x = 0; x < stride; x++) {
    const cur = raw[rp++];
    const a = x >= bpp ? px[y * stride + x - bpp] : 0;
    const b = y > 0 ? px[(y - 1) * stride + x] : 0;
    const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
    let v;
    if (f === 0) v = cur;
    else if (f === 1) v = cur + a;
    else if (f === 2) v = cur + b;
    else if (f === 3) v = cur + ((a + b) >> 1);
    else {
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
    }
    px[y * stride + x] = v & 0xff;
  }
}
// BGRA premultiplied → RGBA straight
for (let i = 0; i < px.length; i += 4) {
  const b = px[i],
    g = px[i + 1],
    r = px[i + 2],
    al = px[i + 3];
  if (isCgBI && al > 0 && al < 255) {
    px[i] = Math.min(255, Math.round((r * 255) / al));
    px[i + 1] = Math.min(255, Math.round((g * 255) / al));
    px[i + 2] = Math.min(255, Math.round((b * 255) / al));
  } else {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
}
sharp(px, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(out)
  .then(() => console.log(`decoded ${src} → ${out} (${width}x${height}, CgBI=${isCgBI})`));
