import * as d3 from 'd3';
import { getTheme } from './theme.js';

// Referencia paletta (validált kategorikus sorrend). A színek CSS változókban is szerepelnek (styles.css),
// a D3 a futás közbeni témának megfelelő értéket olvassa ki.
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** Sötét felületű téma (sötét és alkony): a világosabb, sötét háttérre hangolt színlépcsők érvényesek. */
export const isDark = () => getTheme() !== 'light';

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

/** A kiemelésből kimaradó (kiszürkített) sorozatok színe. */
export const mutedSeries = () => (isDark() ? '#7d7f95' : '#b5b3ab');

/** A kiemelt tag kulcsa, ha szerepel a megjelenített tagok között; különben nincs kiemelés. */
export const activeFocus = (focus, members) => (focus != null && members.some((m) => m.key === focus) ? focus : null);

/** A térkép és a hőtérkép közös színskálája: hidegtől (lila, kék) a melegig (narancs, vörös). */
export const SPECTRAL = ['#5E4FA2', '#3288BD', '#66C2A5', '#ABDDA4', '#E6F598', '#FFFFBF', '#FEE08B', '#FDAE61', '#F46D43', '#D53E4F', '#9E0142'];

/**
 * Paramétercsoportonként saját, egy színárnyalatú skála, hogy a térkép és a hőtérkép ránézésre elárulja,
 * melyik mennyiséget mutatja (a hőmérséklet a fenti spektrális skálán marad). A lépcsők a világostól a sötétig
 * futnak; sötét felületen a sorrend megfordul (a nagyobb érték a világosabb), így a kis érték mindkét esetben
 * a háttérbe simul.
 */
const RAMPS = {
  // Csapadék: világoskéktől a sötétkékig
  precipitation: ['#e3f2fd', '#bbdefb', '#7fbfee', '#4298e0', '#1b6fc2', '#0f4c9c', '#08306b'],
  // Relatív páratartalom: (cián)kék színintenzitás
  humidity: ['#e4f7fb', '#b5e8f2', '#7fd3e6', '#42b9d4', '#1798b8', '#0b7494', '#064f69'],
  // Napsugárzás: sárgától a narancssárgáig
  radiation: ['#fffbd0', '#fff08a', '#ffd94a', '#fdb92e', '#f58f1c', '#e0650f', '#b54708'],
  // Felhőborítottság: szürke színintenzitás
  cloud: ['#f4f4f4', '#dcdcdc', '#bdbdbd', '#9a9a9a', '#787878', '#565656', '#383838'],
  // Szél: lila (a térképen irány-nyilakkal kiegészítve)
  wind: ['#f3e8fb', '#dcc4f2', '#c19be6', '#a370d6', '#8448c2', '#662a9f', '#481277'],
  pressure: ['#e4f4ef', '#b9e2d5', '#86cab6', '#52ae95', '#2a8f76', '#136e59', '#064d3d'],
  vpd: ['#fde6ee', '#f9c2d6', '#f397b6', '#e86a96', '#d2417a', '#a82662', '#771447'],
  evapotranspiration: ['#eef8e4', '#d0ebb8', '#a9d886', '#7dc05a', '#559f3a', '#357b27', '#1c561a'],
  visibility: ['#f7f5dc', '#e6e2a8', '#cfca76', '#b0ab4d', '#8c8a31', '#676a1f', '#454a12'],
};
RAMPS.snow = RAMPS.precipitation;
RAMPS.probability = RAMPS.precipitation;

/** Additív vagy arány jellegű mennyiségeknél (pl. csapadék) a nulla a skála alja. */
const ZERO_BASED = ['precipitation', 'snow', 'probability', 'cloud', 'humidity', 'radiation', 'wind', 'evapotranspiration', 'vpd'];

/** A vízmérleg két pólusa: hiány (barna) és többlet (zöldeskék). */
export const balanceColors = () => (isDark() ? { deficit: '#d8a657', surplus: '#5ab4ac' } : { deficit: '#bf812d', surplus: '#35978f' });

const surface2 = () => getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() || '#f3f2ee';

/** Egy paraméter színskálája a térképhez és a hőtérképhez: a legkisebb értéktől a legnagyobbig fut a skálán. */
export function fillScale(scheme, values) {
  const ext = d3.extent(values.filter((v) => v != null && Number.isFinite(v)));
  if (ext[0] == null) return null;
  let [lo, hi] = ext;
  if (scheme === 'balance') {
    // Előjeles mennyiség: divergens skála, a semleges közép a nulla, a két pólus szimmetrikus.
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    return d3.scaleDiverging([-m, 0, m], d3.interpolateRgbBasis(['#7a4406', '#bf812d', '#dfc27d', surface2(), '#80cdc1', '#35978f', '#01564f'])).clamp(true);
  }
  if (lo === hi) { lo -= 1; hi += 1; }
  const ramp = RAMPS[scheme];
  const steps = !ramp ? SPECTRAL : isDark() ? [...ramp].reverse() : ramp;
  return d3.scaleSequential([ZERO_BASED.includes(scheme) ? Math.min(0, lo) : lo, hi], d3.interpolateRgbBasis(steps)).clamp(true);
}

/** Szélrózsa sebességsávok – ordinális kék rámpa (felülethez legközelebbi lépés is ≥ 2:1 kontraszt). */
export const SPEED_BANDS = ['0–5', '5–15', '15–25', '25–40', '40+'];
export const speedBandColors = () => (isDark() ? ['#6da7ec', '#3987e5', '#256abf', '#1c5cab', '#cde2fb'] : ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b']);

export const STATUS = { Low: '#0ca30c', Mild: '#fab219', Moderate: '#ec835a', Severe: '#d03b3b', Extreme: '#d03b3b' };
