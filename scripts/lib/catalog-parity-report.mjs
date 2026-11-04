/** Report only: never resolve ambiguity by choosing a row or changing catalogue data. */
export function compareSpecs(staticSpecs, databaseSpecs, normaliseKey) {
  const known = new Set(['material', 'weight', 'thickness', 'magneticHold', 'dropProtection', 'warranty'].map(normaliseKey));
  const identity = label => {
    const raw = String(label ?? '').trim();
    const key = normaliseKey(raw);
    return known.has(key) ? `known:${key}` : `literal:${raw}`;
  };
  const group = rows => {
    const groups = new Map();
    for (const row of rows) {
      const key = identity(row.label);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return groups;
  };
  const left = group(staticSpecs);
  const right = group(databaseSpecs);
  const diffs = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key) ?? [];
    const b = right.get(key) ?? [];
    const label = String(a[0]?.label ?? b[0]?.label ?? '');
    if (a.length > 1 || b.length > 1) {
      diffs.push({ field: `spec "${label}" ambiguous label collision`, static: `${a.length} rows`, db: `${b.length} rows` });
    } else if (!b.length) {
      diffs.push({ field: `spec "${label}" missing in DB`, static: a[0].value, db: '(missing; no value assumed)' });
    } else if (!a.length) {
      diffs.push({ field: `spec "${label}" only in DB`, static: '(none)', db: b[0].value });
    } else if (String(a[0].value ?? '').trim() !== String(b[0].value ?? '').trim()) {
      diffs.push({ field: `spec "${label}"`, static: a[0].value, db: b[0].value });
    }
  }
  return diffs;
}
