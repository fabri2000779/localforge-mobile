// One-off: turn the existing rounded/transparent icon into a full-bleed,
// OPAQUE, square 1024 source suitable for iOS (which forbids alpha and
// applies its own corner mask). Zoom-crop pushes the pre-baked rounded
// corners off-frame, then flatten+removeAlpha guarantees no transparency.
//   node scripts/make-app-icon.cjs [src] [out] [zoom]
const sharp = require('sharp');

const SRC = process.argv[2] || 'src-tauri/icons/icon.png';
const OUT = process.argv[3] || 'src-tauri/icons/app-icon.png';
const SIZE = 1024;
const ZOOM = parseFloat(process.argv[4] || '1.22'); // overscan to drop rounding
const BG = { r: 9, g: 13, b: 26 }; // dark navy ~ the card background

(async () => {
  const big = Math.round(SIZE * ZOOM);
  const off = Math.round((big - SIZE) / 2);
  await sharp(SRC)
    .resize(big, big, { fit: 'fill' })
    .extract({ left: off, top: off, width: SIZE, height: SIZE })
    .flatten({ background: BG })
    .removeAlpha()
    .png()
    .toFile(OUT);
  const m = await sharp(OUT).metadata();
  console.log(`wrote ${OUT} ${m.width}x${m.height} channels=${m.channels} hasAlpha=${m.hasAlpha}`);
})();
