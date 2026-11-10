// Generates the extension icons (the three-tile Mosaic mark) as PNGs without any image library.
import { deflateSync } from 'node:zlib';
import { LOGO_TILES } from '../src/shared/types.ts';

const checksumTable = Array.from({ length: 256 }, (_unused, byte) => {
  let remainder = byte;
  for (let bit = 0; bit < 8; bit++) remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
  return remainder >>> 0;
});
const checksum = (bytes: Uint8Array) => {
  let remainder = 0xffffffff;
  for (const byte of bytes) remainder = checksumTable[(remainder ^ byte) & 0xff]! ^ (remainder >>> 8);
  return (remainder ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(12 + data.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, checksum(bytes.subarray(4, 8 + data.length)));
  return bytes;
}
function png(size: number) {
  const colors: [number, number, number][] = [
    [47, 129, 247],
    [63, 185, 80],
    [163, 113, 247],
  ];
  const raw = new Uint8Array(size * (size * 4 + 1));
  const scale = size / 16,
    radius = Math.max(1, Math.round(1.5 * scale));
  // Tile edges in pixels, so the mark stays crisp at every size.
  const tiles = LOGO_TILES.map(tile => ({
    left: Math.round(tile.left * scale),
    top: Math.round(tile.top * scale),
    right: Math.round((tile.left + tile.width) * scale),
    bottom: Math.round((tile.top + tile.height) * scale),
  }));
  for (let row = 0; row < size; row++) {
    raw[row * (size * 4 + 1)] = 0;
    for (let column = 0; column < size; column++) {
      const tileIndex = tiles.findIndex(
        tile => column >= tile.left && column < tile.right && row >= tile.top && row < tile.bottom,
      );
      if (tileIndex < 0) continue;
      const tile = tiles[tileIndex]!;
      const isOutsideCorner = (horizontal: number, vertical: number) =>
        horizontal < radius &&
        vertical < radius &&
        (radius - horizontal) ** 2 + (radius - vertical) ** 2 > radius * radius;
      const fromLeft = column - tile.left,
        fromTop = row - tile.top,
        fromRight = tile.right - 1 - column,
        fromBottom = tile.bottom - 1 - row;
      if (
        isOutsideCorner(fromLeft, fromTop) ||
        isOutsideCorner(fromRight, fromTop) ||
        isOutsideCorner(fromLeft, fromBottom) ||
        isOutsideCorner(fromRight, fromBottom)
      )
        continue;
      raw.set([...colors[tileIndex]!, 255], row * (size * 4 + 1) + 1 + column * 4);
    }
  }
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  return Buffer.concat(parts);
}
for (const size of [16, 48, 128]) await Bun.write(`src/icons/${size}.png`, png(size));
console.log('icons written');
