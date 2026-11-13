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

/** A térkép és a hőtérkép közös színskálája: hidegtől (lila, kék) a melegig (narancs, vörös). */
export const SPECTRAL = ['#5E4FA2', '#3288BD', '#66C2A5', '#ABDDA4', '#E6F598', '#FFFFBF', '#FEE08B', '#FDAE61', '#F46D43', '#D53E4F', '#9E0142'];

/** Additív vagy arány jellegű mennyiségeknél (pl. csapadék) a nulla a skála alja. */
const ZERO_BASED = ['precipitation', 'snow', 'probability', 'cloud', 'humidity'];

/** Egy paraméter színskálája a térképhez és a hőtérképhez: a legkisebb értéktől a legnagyobbig fut a skálán. */
export function fillScale(scheme, values) {
  const ext = d3.extent(values.filter((v) => v != null && Number.isFinite(v)));
  if (ext[0] == null) return null;
  let [lo, hi] = ext;
  if (lo === hi) { lo -= 1; hi += 1; }
  return d3.scaleSequential([ZERO_BASED.includes(scheme) ? Math.min(0, lo) : lo, hi], d3.interpolateRgbBasis(SPECTRAL)).clamp(true);
}

/** Szélrózsa sebességsávok – ordinális kék rámpa (felülethez legközelebbi lépés is ≥ 2:1 kontraszt). */
export const SPEED_BANDS = ['0–5', '5–15', '15–25', '25–40', '40+'];
export const speedBandColors = () => (isDark() ? ['#6da7ec', '#3987e5', '#256abf', '#1c5cab', '#cde2fb'] : ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b']);

export const STATUS = { Low: '#0ca30c', Mild: '#fab219', Moderate: '#ec835a', Severe: '#d03b3b', Extreme: '#d03b3b' };
