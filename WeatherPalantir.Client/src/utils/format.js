import * as d3 from 'd3';

const f1 = d3.format(',.1f');
const f0 = d3.format(',.0f');

export function formatValue(value, measure) {
  if (value == null || !Number.isFinite(value)) return '–';
  if (measure?.key === 'windDirection') return `${f0(value)}° ${compassPoint(value)}`;
  const text = Math.abs(value) >= 100 ? f0(value) : f1(value);
  return measure?.unit ? `${text} ${measure.unit}` : text;
}

const POINTS = ['É', 'ÉÉK', 'ÉK', 'KÉK', 'K', 'KDK', 'DK', 'DDK', 'D', 'DDNy', 'DNy', 'NyDNy', 'Ny', 'NyÉNy', 'ÉNy', 'ÉÉNy'];
export const compassPoint = (deg) => POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
export const SECTOR_LABELS = POINTS;

export const formatDateTime = d3.timeFormat('%Y.%m.%d. %H:%M:%S');
export const formatInt = d3.format(',d');
