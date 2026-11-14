import * as d3 from 'd3';
import { daysBetween, finerGrain, MAX_HOURLY_DAYS, parseIsoDate, parsePeriod, periodRange, suggestGrain, toIsoDate } from '../utils/time.js';

/**
 * Az elemző nézet OLAP állapota és műveletei:
 *  - roll-up / drill-down az idő (év → hónap → nap → óra) és a földrajz (ország → régió → helyszín) hierarchiájában,
 *  - slice: egy dimenzióérték rögzítése (pl. egy megye, csak előrejelzés),
 *  - dice: több dimenzió menti szűrés egyszerre (régiók, időjárási viszonyok, időszak).
 */

const NEXT_LEVEL = { all: 'country', country: 'region', region: 'location', location: 'location' };

/** A térképen egyszerre megjeleníthető országok legnagyobb száma. */
export const MAX_MAP_COUNTRIES = 3;

/** Az adattárházban szereplő országok (a régiókból), elöl azok, amelyekhez már tartozik helyszín. */
export function availableCountries(meta) {
  const withData = new Set(meta.locations.map((l) => l.countryCode));
  const map = new Map();
  for (const r of meta.regions) if (!map.has(r.countryCode)) map.set(r.countryCode, { code: r.countryCode, name: r.countryName ?? r.countryCode, hasData: withData.has(r.countryCode) });
  return [...map.values()].sort((a, b) => b.hasData - a.hasData || a.name.localeCompare(b.name, 'hu'));
}

export function createInitialState(meta) {
  const max = parsePeriod(meta.range.max ?? new Date());
  const histMax = parsePeriod(meta.range.historicalMax ?? meta.range.max ?? new Date());
  const from = toIsoDate(d3.timeDay.offset(histMax, -30));
  const to = toIsoDate(max);
  // Alapból egy ország látszik: a legkorábban felvett aktív helyszín országa.
  const first = [...meta.locations].filter((l) => l.isActive).sort((a, b) => a.locationKey - b.locationKey)[0];
  const mapCountries = [first?.countryCode ?? availableCountries(meta)[0]?.code].filter(Boolean);
  return {
    from,
    to,
    grain: 'day',
    level: 'region',
    kind: 'all',
    measure: 'temperature',
    secondaryOn: false,
    secondary: 'windDirection',
    mapCountries,
    countries: mapCountries,
    regions: [],
    locations: [],
    conditions: [],
    geoPath: [],
    timeStack: [],
    tableMeasures: ['temperature', 'precipitation', 'windSpeed', 'relativeHumidity'],
    pivot: false,
  };
}

/** Órás bontás csak rövid időszakra engedélyezett – hosszabb időszaknál napi szintre vált. */
function normalize(s) {
  if (s.from > s.to) s = { ...s, to: s.from };
  if (s.grain === 'hour' && daysBetween(s.from, s.to) > MAX_HOURLY_DAYS) s = { ...s, grain: 'day' };
  return s;
}

/**
 * A földrajzi útvonalból (morzsamenü) adódó szűrők. Ha nincs kiválasztott ország az útvonalban,
 * a térképen megjelenített országok összessége a szelet.
 */
function withPath(state, geoPath, level) {
  const country = geoPath.find((p) => p.level === 'country');
  const region = geoPath.find((p) => p.level === 'region');
  const location = geoPath.find((p) => p.level === 'location');
  return {
    ...state,
    geoPath,
    level,
    countries: country ? [country.key] : state.mapCountries,
    regions: region ? [Number(region.key)] : geoPath.length ? [] : state.regions,
    locations: location ? [Number(location.key)] : [],
  };
}

const rootLevel = (s) => (s.mapCountries.length > 1 ? 'country' : 'region');

/** Egy dimenziótag teljes földrajzi útvonala (ország › régió › helyszín) a metaadatokból. */
export function pathFor(level, key, meta) {
  const regionOf = (rk) => meta.regions.find((r) => r.regionKey === Number(rk));
  const countryNode = (code) => ({ level: 'country', key: code, name: meta.regions.find((r) => r.countryCode === code)?.countryName ?? code });
  if (level === 'country') return [countryNode(key)];
  if (level === 'region') {
    const r = regionOf(key);
    return r ? [countryNode(r.countryCode), { level: 'region', key: String(r.regionKey), name: r.regionName }] : [];
  }
  if (level === 'location') {
    const l = meta.locations.find((x) => x.locationKey === Number(key));
    if (!l) return [];
    return [...pathFor('region', l.regionKey, meta), { level: 'location', key: String(l.locationKey), name: l.name }];
  }
  return [];
}

export function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return normalize({ ...state, ...action.patch });

    case 'setRange':
      return normalize({ ...state, from: action.from, to: action.to, grain: action.grain ?? state.grain });

    // Időbeli lefúrás: a kattintott periódusra szűkít, eggyel finomabb bontással.
    // A periódus szintje (action.grain) eltérhet az aktuálistól, pl. éves nézetben egy hónapra kattintva.
    case 'drillTime': {
      const grain = action.grain ?? state.grain;
      const next = finerGrain(grain);
      if (!next) return state;
      const [from, to] = periodRange(action.period, grain, parseIsoDate(action.min), parseIsoDate(action.max));
      return normalize({
        ...state,
        timeStack: [...state.timeStack, { from: state.from, to: state.to, grain: state.grain }],
        from,
        to,
        grain: next,
      });
    }

    // Kijelölés (brush) a grafikonon: időszak kockázása.
    case 'brushTime': {
      const from = toIsoDate(action.start);
      const to = toIsoDate(action.end);
      if (from === state.from && to === state.to) return state;
      return normalize({
        ...state,
        timeStack: [...state.timeStack, { from: state.from, to: state.to, grain: state.grain }],
        from,
        to,
        grain: suggestGrain(from, to),
      });
    }

    case 'rollUpTime': {
      if (!state.timeStack.length) return state;
      const prev = state.timeStack[state.timeStack.length - 1];
      return normalize({ ...state, ...prev, timeStack: state.timeStack.slice(0, -1) });
    }

    // Földrajzi lefúrás egy tagra a teljes útvonalával (ország → régiói, régió → helyszínei, helyszín → szeletelés).
    case 'drillGeo': {
      if (!action.path.length) return state;
      const last = action.path[action.path.length - 1];
      return withPath(state, action.path, NEXT_LEVEL[last.level]);
    }

    /**
     * Kattintás a térképen egy régióra vagy helyszínre (action.path: ország › régió [› helyszín]):
     *  - helyszínre kattintva egy lépésben a helyszínig fúr le (a térkép a helyszín régiójára közelít),
     *  - régióra kattintva: ha több ország látszik, először csak a kattintott ország marad a térképen,
     *    ha már egy ország látszik, a régióra (megyére) szűkít.
     */
    case 'mapClick': {
      const [country, region, location] = action.path;
      if (!country) return state;
      if (location) return withPath(state, [country, region, location], 'location');
      const focusedCountry = state.geoPath.find((p) => p.level === 'country');
      const focusedRegion = state.geoPath.find((p) => p.level === 'region');
      if (!focusedCountry && state.mapCountries.length > 1) {
        return withPath(state, [country], ['country', 'all'].includes(state.level) ? 'region' : state.level);
      }
      if (region && focusedRegion?.key !== region.key) return withPath(state, [country, region], 'location');
      return state;
    }

    // Felgöngyölítés a morzsamenü egy szintjére.
    case 'rollUpGeo': {
      const geoPath = state.geoPath.slice(0, action.index);
      const last = geoPath[geoPath.length - 1];
      // A lefúrásból származó régió-szűrő a felgöngyölítéssel megszűnik.
      const drilled = state.geoPath.find((p) => p.level === 'region');
      const base = drilled ? { ...state, regions: state.regions.filter((r) => r !== Number(drilled.key)) } : state;
      return withPath(base, geoPath, last ? NEXT_LEVEL[last.level] : rootLevel(state));
    }

    // Ország hozzáadása a térképhez (legfeljebb 3) – az összes hozzáadott ország látszik.
    case 'addCountry': {
      if (state.mapCountries.includes(action.code) || state.mapCountries.length >= MAX_MAP_COUNTRIES) return state;
      const s = { ...state, mapCountries: [...state.mapCountries, action.code] };
      return withPath(s, [], state.level);
    }

    case 'removeCountry': {
      if (state.mapCountries.length <= 1 || !state.mapCountries.includes(action.code)) return state;
      const s = {
        ...state,
        mapCountries: state.mapCountries.filter((c) => c !== action.code),
        regions: state.regions.filter((r) => !action.regionKeys.includes(r)),
      };
      const keep = state.geoPath[0]?.key === action.code ? [] : state.geoPath;
      const last = keep[keep.length - 1];
      // Egyetlen országnál az ország szintű bontás egy tagot adna, ezért régió szintre vált.
      const level = !last && s.mapCountries.length === 1 && state.level === 'country' ? 'region' : state.level;
      return withPath(s, keep, level);
    }

    case 'toggleRegion': {
      const regions = state.regions.includes(action.key)
        ? state.regions.filter((r) => r !== action.key)
        : [...state.regions, action.key];
      const geoPath = state.geoPath.filter((p) => p.level === 'country');
      return { ...withPath(state, geoPath, state.level), regions };
    }

    case 'toggleCondition': {
      const conditions = state.conditions.includes(action.key)
        ? state.conditions.filter((c) => c !== action.key)
        : [...state.conditions, action.key];
      return { ...state, conditions };
    }

    case 'clearFilters':
      return { ...withPath({ ...state, regions: [] }, [], rootLevel(state)), conditions: [], kind: 'all' };

    default:
      return state;
  }
}

/** A térképhez, táblázathoz és grafikonokhoz használt tagok (sorozatok) stabil sorrendje – a színezéshez. */
// Csak azok a tagok kapnak színhelyet, amelyekhez tartozik helyszín (adat), a helyszínek kulcs szerinti sorrendjében,
// így a kategorikus paletta az első helyektől töltődik fel és nem ismétlődik feleslegesen.
export function memberOrder(level, meta) {
  const locs = [...meta.locations].sort((a, b) => a.locationKey - b.locationKey);
  const unique = (xs) => [...new Set(xs.filter((x) => x != null).map(String))];
  if (level === 'location') return unique(locs.map((l) => l.locationKey));
  if (level === 'region') return unique([...locs.map((l) => l.regionKey), ...meta.regions.map((r) => r.regionKey)]);
  if (level === 'country') return unique([...locs.map((l) => l.countryCode), ...meta.regions.map((r) => r.countryCode)]);
  return ['ALL'];
}
