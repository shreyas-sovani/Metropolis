/** Perp ids set in `getPerpetualExistsBitmap` (four 256-bit words). */
export function perpIdsFromBitmap(bitmap: readonly bigint[]): number[] {
  const ids: number[] = [];
  for (let word = 0; word < bitmap.length; word++) {
    let bits = bitmap[word] ?? 0n;
    let bit = 0;
    while (bits > 0n) {
      if ((bits & 1n) === 1n) ids.push(word * 256 + bit);
      bits >>= 1n;
      bit += 1;
    }
  }
  return ids;
}
