import * as d3 from 'd3';

export const GRAINS = [
  { key: 'hour', label: 'Óra' },
  { key: 'day', label: 'Nap' },
  { key: 'month', label: 'Hónap' },
  { key: 'year', label: 'Év' },
];

export const LEVELS = [
  { key: 'all', label: 'Összesen' },
  { key: 'country', label: 'Ország' },
  { key: 'region', label: 'Régió (megye)' },
  { key: 'location', label: 'Helyszín' },
];

export const MAX_HOURLY_DAYS = 93;

const isoDay = d3.timeFormat('%Y-%m-%d');

export const toIsoDate = (d) => isoDay(d);
export const parseIsoDate = (s) => d3.timeParse('%Y-%m-%d')(s);
/** A backend „2026-10-01T00:00:00” formátumú (zóna nélküli) helyi időt küld. */
export const parsePeriod = (s) => new Date(s);

export const daysBetween = (from, to) => Math.round((parseIsoDate(to) - parseIsoDate(from)) / 864e5) + 1;

export const grainInterval = (grain) =>
  ({ hour: d3.timeHour, day: d3.timeDay, month: d3.timeMonth, year: d3.timeYear })[grain] ?? d3.timeDay;

const fmt = {
  hour: d3.timeFormat('%Y. %b %-d. %H:00'),
  day: d3.timeFormat('%Y. %b %-d. (%a)'),
  month: d3.timeFormat('%Y. %B'),
  year: d3.timeFormat('%Y'),
};
export const formatPeriod = (date, grain) => (date ? (fmt[grain] ?? fmt.day)(date) : '–');

/** Tengelyfeliratok magyar, 24 órás formában (a D3 alapértelmezett de./du. formátuma helyett). */
const axisFmt = {
  hour: d3.timeFormat('%H:%M'),
  day: d3.timeFormat('%b %-d.'),
  month: d3.timeFormat('%B'),
  year: d3.timeFormat('%Y'),
};
export function axisTimeFormat(date) {
  if (d3.timeDay(date) < date) return axisFmt.hour(date);
  if (d3.timeMonth(date) < date) return axisFmt.day(date);
  if (d3.timeYear(date) < date) return axisFmt.month(date);
  return axisFmt.year(date);
}

/** A drill-down következő (finomabb) szintje. */
export const finerGrain = (grain) => ({ year: 'month', month: 'day', day: 'hour' })[grain] ?? null;

/** Egy periódus [kezdet, vége] napjai ISO formában, az adatok tartományára vágva. */
export function periodRange(date, grain, min, max) {
  const interval = grainInterval(grain);
  const start = interval.floor(date);
  const end = d3.timeDay.offset(interval.offset(start, 1), -1);
  const clampedStart = min && start < min ? min : start;
  const clampedEnd = max && end > max ? max : end;
  return [toIsoDate(clampedStart), toIsoDate(clampedEnd)];
}

/** Egy időtartományhoz illő alapértelmezett részletességi szint. */
export function suggestGrain(from, to) {
  const days = daysBetween(from, to);
  if (days <= 7) return 'hour';
  if (days <= 400) return 'day';
  if (days <= 365 * 4) return 'month';
  return 'year';
}
