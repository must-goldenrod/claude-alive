const cache = new Map<number, string>();

export function getSpriteDataUrl(paletteIndex: number, spriteCanvas: HTMLCanvasElement): string {
  const cached = cache.get(paletteIndex);
  if (cached) return cached;

  const url = spriteCanvas.toDataURL('image/png');
  cache.set(paletteIndex, url);
  return url;
}

export function clearSpriteCache(): void {
  cache.clear();
}
