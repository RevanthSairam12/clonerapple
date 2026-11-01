'use client';

/**
 * JSON-path get/set used by the generic admin editor.
 * Paths look like "heroTiles[0].ctas[1].label" or "items[3].title".
 */

type Segment = string | number;

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    if (m[1] !== undefined) segments.push(m[1]);
    else if (m[2] !== undefined) segments.push(Number(m[2]));
  }
  return segments;
}

/** Read a value at path; returns undefined when any hop is missing. */
export function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of parsePath(path)) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

/**
 * Return a structurally-cloned object with value set at path, creating
 * intermediate objects/arrays as needed.
 */
export function setByPath<T>(obj: T, path: string, value: unknown): T {
  const segments = parsePath(path);
  const clone: unknown = structuredClone(obj ?? {});

  let cur: unknown = clone;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const nextSeg = isLast ? undefined : segments[i + 1];

    if (isLast) {
      if (typeof seg === 'number') {
        (cur as unknown[])[seg] = value;
      } else {
        (cur as Record<string, unknown>)[seg] = value;
      }
      break;
    }

    // ensure the next hop exists
    const existing = typeof seg === 'number' ? (cur as unknown[])[seg] : (cur as Record<string, unknown>)[seg];
    const needArray = typeof nextSeg === 'number';
    if (existing === undefined || existing === null || typeof existing !== 'object') {
      const fresh: unknown = needArray ? [] : {};
      if (typeof seg === 'number') (cur as unknown[])[seg] = fresh;
      else (cur as Record<string, unknown>)[seg] = fresh;
      cur = fresh;
    } else {
      cur = existing;
    }
  }

  return clone as T;
}
