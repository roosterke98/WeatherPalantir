import * as d3 from 'd3';

/** Egy kocka-sor mögötti órák száma helyszínenként (a régió / ország sorai több helyszín óráit összesítik). */
export const hoursOf = (row) => row.hourCount / Math.max(1, row.locationCount);

/**
 * A kocka válaszából származtatott mérőszám: minden sorhoz a `fn(row)` értéke kerül `key` néven,
 * így a meglévő idősoros komponensek változtatás nélkül megjelenítik (pl. W/m² átlagból kWh/m² energia).
 */
export function deriveCube(cube, key, fn) {
  if (!cube) return null;
  return { ...cube, measures: [key], rows: cube.rows.map((r) => ({ ...r, values: { [key]: fn(r) } })) };
}

/** Tagonként (helyszín / régió / ország) időrendben halmozott érték. */
export function cumulativeCube(cube, source, key) {
  if (!cube) return null;
  const acc = new Map();
  const rows = [...cube.rows]
    .filter((r) => r.period)
    .sort((a, b) => d3.ascending(a.period, b.period))
    .map((r) => {
      const v = r.values[source];
      if (v == null) return { ...r, values: { [key]: null } };
      const sum = (acc.get(r.memberKey) ?? 0) + v;
      acc.set(r.memberKey, sum);
      return { ...r, values: { [key]: Math.round(sum * 100) / 100 } };
    });
  return { ...cube, measures: [key], rows };
}

/**
 * Összefoglaló érték a csempékhez: a tagok értékeinek átlaga, kiemelés esetén csak a kiemelt tagé.
 * Visszaadja az értéket és azt, hogy mire vonatkozik.
 */
export function summarize(items, focus, fn) {
  const picked = focus != null && items.some((m) => m.key === focus) ? items.filter((m) => m.key === focus) : items;
  const values = picked.map(fn).filter((v) => v != null && Number.isFinite(v));
  return {
    value: values.length ? d3.mean(values) : null,
    scope: picked.length === 1 ? picked[0].name : `${picked.length} tag átlaga`,
  };
}
