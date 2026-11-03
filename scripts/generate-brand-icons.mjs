// Génère les icônes raster de Cotiasso (favicon.ico, PNG) à partir du dessin du symbole
// (apps/web/public/favicon.svg). Aucune dépendance : les formes sont simples, on les
// rastérise ici avec un sur-échantillonnage. À relancer si le dessin du symbole change :
//   node scripts/generate-brand-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public");

const BLUE = [0x15, 0x65, 0xc0];
const WHITE = [255, 255, 255];
const AMBER = [0xff, 0xca, 0x28];

// Dessin sur une grille de 64 × 64 (voir favicon.svg).
const ARC = { cx: 32, cy: 32, r: 20, half: 3.5 };
// Extrémités de l'arc, exactement sur le cercle (≈ 45, 17 et 45, 47 dans le SVG).
const END_ANGLE = Math.atan2(-15, 13);
ARC.a = [ARC.cx + ARC.r * Math.cos(END_ANGLE), ARC.cy + ARC.r * Math.sin(END_ANGLE)];
ARC.b = [ARC.a[0], 2 * ARC.cy - ARC.a[1]];
const DOT = { x: 46, y: 32, r: 6 };

function inRoundedRect(x, y, radius) {
  if (radius === 0) return x >= 0 && x <= 64 && y >= 0 && y <= 64;
  if (x < 0 || x > 64 || y < 0 || y > 64) return false;
  const nx = Math.min(x, 64 - x);
  const ny = Math.min(y, 64 - y);
  if (nx >= radius || ny >= radius) return true;
  return Math.hypot(radius - nx, radius - ny) <= radius;
}

function inArc(x, y) {
  const dx = x - ARC.cx;
  const dy = y - ARC.cy;
  const endAngle = Math.atan2(ARC.a[1] - ARC.cy, ARC.a[0] - ARC.cx); // ≈ -49°
  const angle = Math.atan2(dy, dx);
  // L'arc couvre tous les angles sauf l'ouverture à droite (|angle| < 49°).
  const open = Math.abs(angle) < Math.abs(endAngle);
  const distance = open
    ? Math.min(Math.hypot(x - ARC.a[0], y - ARC.a[1]), Math.hypot(x - ARC.b[0], y - ARC.b[1]))
    : Math.abs(Math.hypot(dx, dy) - ARC.r);
  return distance <= ARC.half;
}

/** Couleur [r,g,b,a] du point (x, y) de la grille 64 × 64, ou null hors du symbole. */
function sample(x, y, radius) {
  if (!inRoundedRect(x, y, radius)) return null;
  if (Math.hypot(x - DOT.x, y - DOT.y) <= DOT.r) return AMBER;
  if (inArc(x, y)) return WHITE;
  return BLUE;
}

function render(size, radius) {
  const ss = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((px + (sx + 0.5) / ss) * 64) / size, ((py + (sy + 0.5) / ss) * 64) / size, radius);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
        pixels[i + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}
function png(size, radius) {
  const pixels = render(size, radius);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits par canal
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO contenant des PNG (pris en charge par tous les navigateurs actuels). */
function ico(sizes) {
  const images = sizes.map((size) => png(size, 14));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry[0] = size;
    entry[1] = size;
    entry.writeUInt16LE(1, 4); // plans
    entry.writeUInt16LE(32, 6); // bits par pixel
    entry.writeUInt32LE(images[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return entry;
  });
  return Buffer.concat([head, ...entries, ...images]);
}

writeFileSync(join(outDir, "favicon.ico"), ico([16, 32, 48]));
// iOS arrondit lui-même l'icône d'écran d'accueil : pleine page, sans angles.
writeFileSync(join(outDir, "apple-touch-icon.png"), png(180, 0));
writeFileSync(join(outDir, "icon-192.png"), png(192, 14));
writeFileSync(join(outDir, "icon-512.png"), png(512, 14));
console.log("Icônes générées dans", outDir);
