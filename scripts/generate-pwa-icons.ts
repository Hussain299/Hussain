import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Create luxury dark institutional SVG icon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#17212D"/>
      <stop offset="50%" stop-color="#222B36"/>
      <stop offset="100%" stop-color="#0E141B"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#C4A574"/>
      <stop offset="100%" stop-color="#E8E5DE"/>
    </linearGradient>
    <linearGradient id="tealGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6C9D91"/>
      <stop offset="100%" stop-color="#72A98B"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background Base -->
  <rect width="512" height="512" rx="104" fill="url(#bgGrad)"/>
  <rect width="508" height="508" x="2" y="2" rx="102" fill="none" stroke="#354251" stroke-width="2"/>

  <!-- Inner Architectural Grid Rings -->
  <circle cx="256" cy="256" r="180" fill="none" stroke="#354251" stroke-width="1.5" stroke-dasharray="4 8" opacity="0.6"/>
  <circle cx="256" cy="256" r="130" fill="none" stroke="#6C9D91" stroke-width="1.5" opacity="0.3"/>

  <!-- Hexagonal Core Matrix -->
  <polygon points="256,120 374,188 374,324 256,392 138,324 138,188" fill="none" stroke="url(#goldGrad)" stroke-width="4" filter="url(#glow)"/>

  <!-- Signal Pulse Waveforms -->
  <path d="M170 256 L210 256 L235 195 L275 315 L300 256 L342 256" fill="none" stroke="url(#tealGrad)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Dynamic Causal Nodes -->
  <circle cx="256" cy="120" r="8" fill="#C4A574"/>
  <circle cx="374" cy="188" r="8" fill="#6C9D91"/>
  <circle cx="374" cy="324" r="8" fill="#72A98B"/>
  <circle cx="256" cy="392" r="8" fill="#C4A574"/>
  <circle cx="138" cy="324" r="8" fill="#6C9D91"/>
  <circle cx="138" cy="188" r="8" fill="#72A98B"/>
  <circle cx="256" cy="256" r="10" fill="#E8E5DE" filter="url(#glow)"/>

  <!-- Monogram Label -->
  <text x="256" y="445" font-family="JetBrains Mono, monospace" font-size="28" font-weight="900" fill="#E8E5DE" text-anchor="middle" letter-spacing="6">SIGNALFORGE</text>
  <text x="256" y="475" font-family="JetBrains Mono, monospace" font-size="14" font-weight="600" fill="#6C9D91" text-anchor="middle" letter-spacing="3">AUTONOMOUS ENGINE</text>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf-8');
console.log('Created public/icon.svg');

// 2. Programmatic High-Quality PNG Generator using standard deflate
function createPng(width: number, height: number, isMaskable: boolean = false): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
    table[i] = c;
  }

  function crc32(buf: Buffer): number {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  function makeChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const rawData = Buffer.alloc((width * 3 + 1) * height);
  let pos = 0;

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) / 2;
  const scale = width / 512;

  // Render stylized SignalForge emblem onto raw RGB buffer
  for (let y = 0; y < height; y++) {
    rawData[pos++] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Base background: Deep Navy (#17212D = 23, 33, 45) to Graphite (#222B36 = 34, 43, 54)
      const gradT = (x + y) / (width + height);
      let r = Math.round(23 + (34 - 23) * gradT);
      let g = Math.round(33 + (43 - 33) * gradT);
      let b = Math.round(45 + (54 - 45) * gradT);

      // Subtle Outer border ring if not maskable
      if (!isMaskable && dist > maxR * 0.95 && dist < maxR * 0.98) {
        r = 53; g = 66; b = 81; // Slate #354251
      }

      // Safe zone ring
      const safeRadius = maxR * (isMaskable ? 0.65 : 0.75);
      if (Math.abs(dist - safeRadius) < 1.5 * scale) {
        r = 108; g = 157; b = 145; // Muted Teal #6C9D91
      }

      // Central Hexagonal Outline
      // Approximate hexagon boundary: |dx| * 0.866 + |dy| * 0.5 < radius, and |dy| < radius
      const hexR = safeRadius * 0.7;
      const hexDist = Math.max(Math.abs(dy), Math.abs(dx) * 0.866025 + Math.abs(dy) * 0.5);
      if (Math.abs(hexDist - hexR) < 3 * scale) {
        r = 196; g = 165; b = 116; // Champagne Gold #C4A574
      }

      // Signal Pulse waveform line: y = cy when x in range, with a sharp spike at center
      const inWaveX = Math.abs(dx) < hexR * 0.8;
      if (inWaveX) {
        let waveY = 0;
        if (dx < -hexR * 0.2) waveY = 0;
        else if (dx < 0) waveY = (dx + hexR * 0.1) * -1.5; // upward spike
        else if (dx < hexR * 0.2) waveY = (dx - hexR * 0.1) * 2.0; // downward spike
        else waveY = 0;

        if (Math.abs(dy - waveY) < 3.5 * scale) {
          r = 114; g = 169; b = 139; // Soft Emerald #72A98B
        }
      }

      // Center glowing core dot
      if (dist < 8 * scale) {
        r = 232; g = 229; b = 222; // Soft Ivory #E8E5DE
      }

      rawData[pos++] = r;
      rawData[pos++] = g;
      rawData[pos++] = b;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Generate the required PNGs
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPng(192, 192, false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPng(512, 512, false));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPng(512, 512, true));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPng(180, 180, false));

console.log('Generated all PWA compliant icons in public/: 192x192, 512x512, maskable, apple-touch-icon.png');
