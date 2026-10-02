/**
 * DJ, 26 Aug 2026: dependency-free QR encoder for the booth's crowd-link
 * code. Byte mode, versions 1-3 only (up to 53 bytes at EC L, 42 at EC M) —
 * a LAN crowd URL is ~32 bytes, so the single-EC-block versions are enough
 * and the whole block-interleaving apparatus stays out. Mask pattern 0 is
 * applied unconditionally (any correctly-declared mask is a valid QR; mask
 * scoring only optimises scanner comfort). Output is an SVG string sized in
 * viewBox units with a 4-module quiet zone, colours left to the caller.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number) {
  let poly = [1];
  for (let d = 0; d < degree; d += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i += 1) {
      next[i] ^= gfMul(poly[i], GF_EXP[d]);
      next[i + 1] ^= poly[i];
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLength: number) {
  // rsGeneratorPoly builds ascending (constant term first); the synthetic
  // division below indexes it as descending-with-monic-leading, so reverse.
  const gen = rsGeneratorPoly(ecLength).reverse();
  const remainder = new Array(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < gen.length - 1; i += 1) {
        remainder[i] ^= gfMul(gen[i + 1], factor);
      }
    }
  }
  return remainder;
}

// Single-EC-block versions only. [version, ecLevel]: data codewords, ec codewords.
const VERSIONS: Array<{ version: number; size: number; level: "L" | "M"; data: number; ec: number; formatBits: number }> = [
  { version: 1, size: 21, level: "M", data: 16, ec: 10, formatBits: 0b00 << 3 },
  { version: 2, size: 25, level: "M", data: 28, ec: 16, formatBits: 0b00 << 3 },
  { version: 3, size: 29, level: "M", data: 44, ec: 26, formatBits: 0b00 << 3 },
  { version: 3, size: 29, level: "L", data: 55, ec: 15, formatBits: 0b01 << 3 },
];
const ALIGNMENT_CENTRE: Record<number, number | null> = { 1: null, 2: 18, 3: 22 };

function bchFormat(levelBits: number, mask: number) {
  // 5 data bits: 2 EC-level bits then 3 mask bits, BCH(15,5) + fixed XOR.
  const data = (levelBits << 3) | mask;
  let value = data << 10;
  const generator = 0b10100110111;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (value & (1 << bit)) value ^= generator << (bit - 10);
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}
const LEVEL_BITS: Record<"L" | "M", number> = { L: 0b01, M: 0b00 };

export function qrSvg(text: string, options: { fill?: string; background?: string } = {}) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const spec = VERSIONS.find((candidate) => bytes.length <= candidate.data - 2 && (candidate.level === "M" || bytes.length > 42 - 2));
  if (!spec) throw new Error(`Text too long for the supported QR versions (${bytes.length} bytes)`);
  const size = spec.size;

  // --- data bitstream: mode 0100, 8-bit count (versions 1-9), data, terminator, pad
  const bits: number[] = [];
  const pushBits = (value: number, count: number) => {
    for (let bit = count - 1; bit >= 0; bit -= 1) bits.push((value >> bit) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const byte of bytes) pushBits(byte, 8);
  const capacityBits = spec.data * 8;
  pushBits(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let b = 0; b < 8; b += 1) value = (value << 1) | bits[i + b];
    codewords.push(value);
  }
  const pads = [0xec, 0x11];
  for (let i = 0; codewords.length < spec.data; i += 1) codewords.push(pads[i % 2]);
  const allCodewords = [...codewords, ...rsEncode(codewords, spec.ec)];

  // --- matrix scaffolding: null = free for data, true/false = fixed function module
  const matrix: Array<Array<boolean | null>> = Array.from({ length: size }, () => new Array(size).fill(null));
  const setFixed = (row: number, col: number, value: boolean) => {
    if (row >= 0 && row < size && col >= 0 && col < size) matrix[row][col] = value;
  };
  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setFixed(row + r, col + c, dark);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);
  const centre = ALIGNMENT_CENTRE[spec.version];
  if (centre !== null) {
    for (let r = -2; r <= 2; r += 1) {
      for (let c = -2; c <= 2; c += 1) {
        setFixed(centre + r, centre + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
      }
    }
  }
  for (let i = 8; i < size - 8; i += 1) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }
  matrix[size - 8][8] = true; // dark module
  // reserve format info areas (filled after masking)
  const formatCells: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) { formatCells.push([i, 8]); formatCells.push([8, i]); }
  }
  formatCells.push([8, 7]);
  for (let i = 0; i < 8; i += 1) formatCells.push([size - 1 - i, 8]);
  for (let i = 0; i < 8; i += 1) formatCells.push([8, size - 1 - i]);
  for (const [r, c] of formatCells) { if (matrix[r][c] === null) matrix[r][c] = false; }

  // --- data placement: two-column zigzag from bottom right, mask 0 applied inline
  let bitIndex = 0;
  const totalBits = allCodewords.length * 8;
  const dataBit = (index: number) => (allCodewords[index >> 3] >> (7 - (index & 7))) & 1;
  let upward = true;
  for (let colPair = size - 1; colPair > 0; colPair -= 2) {
    if (colPair === 6) colPair = 5; // timing column is skipped entirely
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [colPair, colPair - 1]) {
        if (matrix[row][col] !== null) continue;
        const bit = bitIndex < totalBits ? dataBit(bitIndex) : 0;
        bitIndex += 1;
        const masked = (row + col) % 2 === 0 ? bit ^ 1 : bit;
        matrix[row][col] = masked === 1;
      }
    }
    upward = !upward;
  }

  // --- format info for (level, mask 0), written in both required locations
  const format = bchFormat(LEVEL_BITS[spec.level], 0);
  // Bit 14 (MSB) lands at (8,0) — the spec's placement runs MSB-first along
  // the module positions. Verified against zbar: LSB-first scans as nothing.
  const formatBit = (index: number) => ((format >> (14 - index)) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) matrix[8][i] = formatBit(i);
  matrix[8][7] = formatBit(6);
  matrix[8][8] = formatBit(7);
  matrix[7][8] = formatBit(8);
  for (let i = 9; i <= 14; i += 1) matrix[14 - i][8] = formatBit(i);
  for (let i = 0; i <= 6; i += 1) matrix[size - 1 - i][8] = formatBit(i);
  for (let i = 7; i <= 14; i += 1) matrix[8][size - 15 + i] = formatBit(i);

  // --- SVG
  const quiet = 4;
  const total = size + quiet * 2;
  const fill = options.fill ?? "#0b0f0d";
  const background = options.background ?? "#f4fff9";
  const cells: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (matrix[row][col]) cells.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}"><rect width="${total}" height="${total}" fill="${background}"/><path d="${cells.join("")}" fill="${fill}"/></svg>`;
}
