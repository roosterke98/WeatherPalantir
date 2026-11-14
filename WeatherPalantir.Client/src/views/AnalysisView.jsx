import { useEffect, useMemo, useReducer, useState } from 'react';
import { api, cubeParams } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { createInitialState, memberOrder, pathFor, reducer } from './analysisState.js';
import { parsePeriod } from '../utils/time.js';
import FilterBar from '../components/FilterBar.jsx';
import OlapBar from '../components/OlapBar.jsx';
import ChoroplethMap from '../components/ChoroplethMap.jsx';
import TimeSlider from '../components/TimeSlider.jsx';
import KpiCards from '../components/KpiCards.jsx';
import TimeSeriesChart from '../components/TimeSeriesChart.jsx';
import WindRose from '../components/WindRose.jsx';
import CompassPanel from '../components/CompassPanel.jsx';
import ConditionChart from '../components/ConditionChart.jsx';
import MultiMeasureChart from '../components/MultiMeasureChart.jsx';
import Heatmap, { heatmapMode } from '../components/Heatmap.jsx';
import ConditionTimeline from '../components/ConditionTimeline.jsx';
import YearOverYearChart from '../components/YearOverYearChart.jsx';
import TrendChart from '../components/TrendChart.jsx';
import PivotTable from '../components/PivotTable.jsx';
import LocationPicker from '../components/LocationPicker.jsx';

/** A kiválasztott paraméter négy nézete egy kártyán, füleken. */
const VIEWS = [
  { key: 'series', label: 'Idősor' },
  { key: 'heatmap', label: 'Hőtérkép' },
  { key: 'yoy', label: 'Éves összehasonlítás' },
  { key: 'trend', label: 'Éves trend' },
];

export default function AnalysisView({ meta }) {
  const [state, dispatch] = useReducer(reducer, meta, createInitialState);
  const measuresByKey = useMemo(() => Object.fromEntries(meta.measures.map((m) => [m.key, m])), [meta.measures]);
  const measure = measuresByKey[state.measure];
  const [compareMeasures, setCompareMeasures] = useState(['temperature', 'precipitation', 'windSpeed', 'cloudCover']);
  const [view, setView] = useState('series');
  const [selectMode, setSelectMode] = useState(false);

  // Másodlagos paraméter csak olyan lehet, amely vizuálisan nem takarja az elsődlegeset:
  // színezés (fill) mellé jel (glyph: irányvonal, buborék), jel mellé színezés.
  const primaryEncoding = measure.mapEncodings.includes('fill') ? 'fill' : 'glyph';
  const secondaryOptions = meta.measures.filter(
    (m) => m.key !== measure.key && m.mapEncodings.includes(primaryEncoding === 'fill' ? 'glyph' : 'fill'),
  );
  const secondary = state.secondaryOn ? secondaryOptions.find((m) => m.key === state.secondary) ?? secondaryOptions[0] : null;

  useEffect(() => {
    if (state.secondaryOn && secondary && secondary.key !== state.secondary) {
      dispatch({ type: 'set', patch: { secondary: secondary.key } });
    }
  }, [state.secondaryOn, secondary, state.secondary]);

  const cubeMeasures = [measure.key, secondary?.key].filter(Boolean);
  const baseParams = cubeParams(state);
  const key = JSON.stringify(baseParams);

  const cube = useFetch((signal) => api.cube({ ...baseParams, measures: cubeMeasures }, signal), [key, cubeMeasures.join()]);
  const conditions = useFetch((signal) => api.conditions({ ...baseParams, conditions: [] }, signal), [key]);
  const needsWind = measure.key === 'windDirection';
  const windRose = useFetch((signal) => api.windRose(baseParams, signal), [key], { enabled: needsWind });

  const tableKey = state.tableMeasures.join();
  const table = useFetch(
    (signal) =>
      state.tableMeasures.length
        ? Promise.all([
            api.cube({ ...baseParams, grain: 'all', measures: state.tableMeasures }, signal),
            api.cube({ ...baseParams, grain: 'all', level: 'all', measures: state.tableMeasures }, signal),
          ])
        : Promise.resolve(null),
    [key, tableKey],
  );

  // Csúszka: az aktuális részletességi szint periódusai között halad.
  const periods = useMemo(() => (cube.data?.periods ?? []).map(parsePeriod), [cube.data]);
  const [periodIdx, setPeriodIdx] = useState(0);
  useEffect(() => {
    if (!periods.length) return;
    const now = new Date();
    let idx = periods.findLastIndex((p) => p <= now);
    if (idx < 0) idx = periods.length - 1;
    setPeriodIdx(idx);
  }, [periods]);
  const currentPeriod = periods[Math.min(periodIdx, periods.length - 1)] ?? null;

  const order = useMemo(() => memberOrder(state.level, meta), [state.level, meta]);
  const forecastStart = meta.range.forecastMin ? parsePeriod(meta.range.historicalMax ?? meta.range.forecastMin) : null;

  const drillTime = (period, grain) =>
    dispatch({ type: 'drillTime', period, grain, min: meta.range.min?.slice(0, 10), max: meta.range.max?.slice(0, 10) });
  const drillGeo = (memberKey) => state.level !== 'all' && dispatch({ type: 'drillGeo', path: pathFor(state.level, memberKey, meta) });

  // A térképen csak a kiválasztott országok (lefúrás után csak a kiválasztott ország / régió) látszanak.
  const focusCountry = state.geoPath.find((p) => p.level === 'country')?.key;
  const focusRegion = state.geoPath.find((p) => p.level === 'region')?.key;
  const visibleGeo = useMemo(() => {
    const show = (cc, rk) => (focusRegion ? String(rk) === focusRegion : focusCountry ? cc === focusCountry : state.mapCountries.includes(cc));
    return {
      geo: { type: 'FeatureCollection', features: meta.geo.features.filter((f) => show(f.properties.countryCode, f.properties.regionKey)) },
      locations: meta.locations.filter((l) => show(l.countryCode, l.regionKey)),
    };
  }, [meta.geo, meta.locations, state.mapCountries, focusCountry, focusRegion]);

  // Helyszínek kijelölése: a térkép kijelölő módjában és a grafikonok helyszínválasztójában ugyanaz a halmaz.
  const pickable = useMemo(() => visibleGeo.locations.filter((l) => l.isActive).sort((a, b) => a.locationKey - b.locationKey), [visibleGeo]);
  const toggleLocations = (keys) => dispatch({ type: 'toggleLocations', keys });
  const highlightedRegions = useMemo(
    () => [...new Set([...state.regions, ...meta.locations.filter((l) => state.locations.includes(l.locationKey)).map((l) => l.regionKey)])],
    [state.regions, state.locations, meta.locations],
  );
  const picker = (
    <LocationPicker
      locations={pickable}
      selected={state.locations}
      colorOrder={state.level === 'location' ? order : null}
      onToggle={(k) => toggleLocations([k])}
      onClear={() => dispatch({ type: 'clearLocations' })}
    />
  );
  const viewHint = {
    series: needsWind
      ? 'Az iránytű a csúszka aktuális periódusát mutatja'
      : `${state.grain !== 'hour' ? 'Kattintás: lefúrás a periódusba · ' : ''}Húzás: időszak kijelölése`,
    heatmap: `A felbontás az időbeli szintet követi${heatmapMode(state.grain) !== 'hour' ? ' · Kattintás egy cellára: lefúrás' : ''}`,
    yoy: 'A teljes betöltött időszak, havi bontásban · Kattintás egy évre: kijelölés · Kattintás a grafikonra: lefúrás a hónapba',
    trend: 'A teljes betöltött időszak, éves bontásban · Kattintás: lefúrás az évre',
  }[view];

  return (
    <div className="analysis">
      <div className="analysis-sticky">
        <FilterBar state={state} dispatch={dispatch} meta={meta} measure={measure} secondaryOptions={secondaryOptions} secondary={secondary} />
        <OlapBar state={state} dispatch={dispatch} meta={meta} />
      </div>

      {cube.error && <div className="alert error">{cube.error.message}</div>}

      <section className="grid-top">
        <div className="card map-card">
          <div className="card-head">
            <h2>Térkép – {measure.label}{secondary ? ` + ${secondary.label}` : ''}</h2>
            <div className="card-tools">
              <span className="muted small">
                {selectMode
                  ? 'Kattintás egy megyére vagy helyszínre: kijelölés / kivétel'
                  : `Kattintás egy helyszínre: lefúrás a helyszínig · ${
                      !focusCountry && state.mapCountries.length > 1 ? 'országra: szűkítés' : 'megyére / tartományra: szűkítés'
                    }`}
              </span>
              {state.locations.length > 0 && selectMode && (
                <button className="btn small" onClick={() => dispatch({ type: 'clearLocations' })}>Kijelölés törlése</button>
              )}
              <button
                className={selectMode ? 'btn small toggle active' : 'btn small toggle'}
                aria-pressed={selectMode}
                title="Bekapcsolva a térkép elemeire kattintva jelölheted ki a vizsgált helyszíneket"
                onClick={() => setSelectMode((m) => !m)}
              >
                {selectMode ? '✓ Helyszínek kijelölése' : 'Helyszínek kijelölése'}
                {state.locations.length > 0 && selectMode ? ` (${state.locations.length})` : ''}
              </button>
            </div>
          </div>
          <ChoroplethMap
            geo={visibleGeo.geo}
            locations={visibleGeo.locations}
            cube={cube.data}
            loading={cube.loading}
            level={state.level}
            period={currentPeriod}
            measure={measure}
            secondary={secondary}
            selectedRegions={highlightedRegions}
            selectedLocations={state.locations}
            selectMode={selectMode}
            onRegionClick={(feature) =>
              selectMode
                ? toggleLocations(pickable.filter((l) => l.regionKey === feature.properties.regionKey).map((l) => l.locationKey))
                : dispatch({ type: 'mapClick', path: pathFor('region', feature.properties.regionKey, meta) })
            }
            onLocationClick={(loc) =>
              selectMode ? toggleLocations([loc.locationKey]) : dispatch({ type: 'mapClick', path: pathFor('location', loc.locationKey, meta) })
            }
          />
          <TimeSlider periods={periods} index={periodIdx} onChange={setPeriodIdx} grain={state.grain} forecastStart={forecastStart} />
        </div>

        <div className="side-col">
          <KpiCards cube={cube.data} period={currentPeriod} grain={state.grain} measure={measure} secondary={secondary} />
          <div className="card">
            <div className="card-head">
              <h2>Időjárási viszonyok</h2>
              <span className="muted small">Kattintás: szűrés</span>
            </div>
            <ConditionChart
              data={conditions.data}
              loading={conditions.loading}
              selected={state.conditions}
              onToggle={(k) => dispatch({ type: 'toggleCondition', key: k })}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{measure.label} ({measure.unit})</h2>
          <span className="muted small">{viewHint}</span>
        </div>
        <div className="viz-tools">
          <div className="segmented" role="tablist" aria-label="A paraméter nézetei">
            {VIEWS.map((v) => (
              <button key={v.key} role="tab" aria-selected={view === v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>
                {v.key === 'series' && needsWind ? 'Szélrózsa és iránytű' : v.label}
              </button>
            ))}
          </div>
          {picker}
        </div>
        {view === 'heatmap' ? (
          <Heatmap params={baseParams} paramsKey={key} measure={measure} order={order} onDrill={drillTime} />
        ) : view === 'yoy' ? (
          <YearOverYearChart params={baseParams} measure={measure} range={meta.range} order={order} onDrill={drillTime} />
        ) : view === 'trend' ? (
          <TrendChart params={baseParams} measure={measure} range={meta.range} order={order} onDrill={drillTime} />
        ) : needsWind ? (
          <div className="wind-grid">
            <WindRose data={windRose.data} loading={windRose.loading} />
            <CompassPanel cube={cube.data} period={currentPeriod} grain={state.grain} order={order} />
          </div>
        ) : (
          <TimeSeriesChart
            cube={cube.data}
            loading={cube.loading}
            measure={measure}
            grain={state.grain}
            order={order}
            currentPeriod={currentPeriod}
            forecastStart={forecastStart}
            onDrill={(period) => drillTime(period)}
            onBrush={(start, end) => dispatch({ type: 'brushTime', start, end })}
            onMemberClick={(m) => drillGeo(m.key)}
            onPeriodSelect={(p) => {
              const i = periods.findIndex((x) => +x === +p);
              if (i >= 0) setPeriodIdx(i);
            }}
          />
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Paraméterek összehasonlítása</h2>
          <span className="muted small">
            Közös időtengely, paraméterenként külön értéktengely{state.grain !== 'hour' ? ' · Kattintás: lefúrás a periódusba' : ''}
          </span>
        </div>
        <div className="viz-tools">{picker}</div>
        <MultiMeasureChart
          params={baseParams}
          paramsKey={key}
          measures={meta.measures}
          selected={compareMeasures}
          onSelectedChange={setCompareMeasures}
          order={order}
          forecastStart={forecastStart}
          onDrill={(period) => drillTime(period)}
        />
      </section>


      <section className="card">
        <div className="card-head">
          <h2>Időjárási viszonyok megoszlása</h2>
          <span className="muted small">Az órák aránya periódusonként · Súlyosság → viszony</span>
        </div>
        <ConditionTimeline
          params={baseParams}
          paramsKey={key}
          selected={state.conditions}
          onToggle={(k) => dispatch({ type: 'toggleCondition', key: k })}
        />
      </section>


      <section className="card">
        <div className="card-head">
          <h2>Aggregált táblázat</h2>
          <span className="muted small">A teljes kijelölt időszakra, a választott földrajzi szinten</span>
        </div>
        <PivotTable
          measures={meta.measures}
          selected={state.tableMeasures}
          onSelectedChange={(tableMeasures) => dispatch({ type: 'set', patch: { tableMeasures } })}
          pivot={state.pivot}
          onPivot={() => dispatch({ type: 'set', patch: { pivot: !state.pivot } })}
          data={table.data}
          loading={table.loading}
          error={table.error}
          level={state.level}
          onMemberClick={(m) => drillGeo(m.key)}
        />
      </section>
    </div>
  );
}
