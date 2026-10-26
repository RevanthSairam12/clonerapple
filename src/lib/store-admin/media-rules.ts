/** Pure media validation: type sniffing, dimensions, filenames. No I/O. */

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'video/webm',
  'video/mp4',
] as const;
export type MediaMime = (typeof ALLOWED_MEDIA_TYPES)[number];

export const MEDIA_EXTENSIONS: Record<MediaMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

export function isAllowedMediaType(value: unknown): value is MediaMime {
  return typeof value === 'string' && (ALLOWED_MEDIA_TYPES as readonly string[]).includes(value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/**
 * Sniff the real content type from magic bytes. The browser-sent Content-Type
 * is never trusted: a renamed HTML file must not become a served image.
 */
export function sniffMime(bytes: Uint8Array): MediaMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  if (
    bytes.length >= 6 &&
    (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 4, 4) === 'ftyp' &&
    (ascii(bytes, 8, 4).startsWith('avif') || ascii(bytes, 8, 4).startsWith('avis'))
  ) {
    return 'image/avif';
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    return 'video/mp4';
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trim().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml';
  return null;
}

/** Pixel dimensions for common raster formats. `null` when unknown (SVG, video). */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: IHDR width/height are big-endian at offsets 16 and 20.
  if (bytes.length >= 24 && ascii(bytes, 1, 3) === 'PNG') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF: little-endian at 6 and 8.
  if (bytes.length >= 10 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    return {
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
    };
  }
  // JPEG: walk the marker chain to the first SOF segment.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        };
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2) break;
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

/** Strip any path component: uploads keep only a display filename. */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const trimmed = base.trim().replace(/[\u0000-\u001f]/g, '');
  return trimmed.slice(0, 200) || 'upload';
}

export function altError(alt: unknown): string | null {
  if (alt === undefined || alt === null) return null;
  if (typeof alt !== 'string') return 'Alt text must be text.';
  if (alt.trim().length > 300) return 'Alt text must be 300 characters or fewer.';
  return null;
}
