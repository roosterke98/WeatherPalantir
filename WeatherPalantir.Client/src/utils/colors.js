import * as d3 from 'd3';
import { getTheme } from './theme.js';

// Referencia paletta (validált kategorikus sorrend). A színek CSS változókban is szerepelnek (styles.css),
// a D3 a futás közbeni témának megfelelő értéket olvassa ki.
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export const isDark = () => getTheme() === 'dark';

export const categorical = () => (isDark() ? DARK : LIGHT);

/**
 * Egy entitás színe a dimenzióban elfoglalt stabil helyéből adódik (nem az aktuális rangsorból),
 * így szűréskor a megmaradó sorozatok nem színeződnek át. 8 felett a színek ismétlődnek,
 * ilyenkor a jelmagyarázat és a felirat hordozza az azonosítást.
 */
export function memberColor(memberKey, orderedKeys) {
  const palette = categorical();
  const i = orderedKeys.indexOf(String(memberKey));
  return palette[(i < 0 ? 0 : i) % palette.length];
}

const BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const RED = ['#fbd5d4', '#f6b1b0', '#ef8b8a', '#e66767', '#e34948', '#c43a3a', '#a32f2f', '#7f2424'];
const ORANGE = ['#fde3d5', '#f9c2a6', '#f39d75', '#eb6834', '#d95926', '#b4471c', '#8a3714'];
const AQUA = ['#d3f2e6', '#a3e3cb', '#6bcfaa', '#1baf7a', '#199e70', '#12805a', '#0b5f43'];
const VIOLET = ['#e5e1fa', '#c7bff2', '#a79be9', '#9085e9', '#6250d6', '#4a3aa7', '#352a7a'];
const GRAY = ['#f0efec', '#d6d5cf', '#b5b3ab', '#898781', '#6b6964', '#52514e', '#383835'];

const ramp = (steps) => d3.interpolateRgbBasis(steps);

/** Egy paraméter színskálája a térképhez (szekvenciális vagy divergens). */
export function fillScale(scheme, values) {
  const ext = d3.extent(values.filter((v) => v != null && Number.isFinite(v)));
  if (ext[0] == null) return null;
  let [lo, hi] = ext;
  if (lo === hi) { lo -= 1; hi += 1; }

  if (scheme === 'temperature') {
    // Divergens kék ↔ piros, semleges szürke középponttal (0 °C, ha a tartomány átnyúlik rajta).
    const mid = lo < 0 && hi > 0 ? 0 : (lo + hi) / 2;
    const neutral = isDark() ? '#4f5683' : '#f0efec';
    return d3.scaleDiverging([lo, mid, hi], d3.interpolateRgbBasis(['#104281', '#3987e5', neutral, '#e34948', '#7f2424'])).clamp(true);
  }

  const interpolator = {
    precipitation: ramp(BLUE),
    snow: ramp(VIOLET),
    probability: ramp(BLUE),
    wind: ramp(AQUA),
    radiation: ramp(ORANGE),
    humidity: ramp(BLUE),
    cloud: ramp(GRAY),
    visibility: ramp(AQUA),
  }[scheme] ?? ramp(BLUE);

  // Additív mennyiségeknél (csapadék) a nulla a skála alja.
  const zeroBased = ['precipitation', 'snow', 'probability', 'cloud', 'humidity'].includes(scheme);
  return d3.scaleSequential([zeroBased ? Math.min(0, lo) : lo, hi], interpolator).clamp(true);
}

/** Szélrózsa sebességsávok – ordinális kék rámpa (felülethez legközelebbi lépés is ≥ 2:1 kontraszt). */
export const SPEED_BANDS = ['0–5', '5–15', '15–25', '25–40', '40+'];
export const speedBandColors = () => (isDark() ? ['#6da7ec', '#3987e5', '#256abf', '#1c5cab', '#cde2fb'] : ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b']);

export const STATUS = { Low: '#0ca30c', Mild: '#fab219', Moderate: '#ec835a', Severe: '#d03b3b', Extreme: '#d03b3b' };
