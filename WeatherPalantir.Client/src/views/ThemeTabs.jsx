import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { memberColor } from '../utils/colors.js';
import { cumulativeCube, deriveCube, hoursOf, summarize } from '../utils/derive.js';
import { useTheme } from '../utils/theme.js';
import DiurnalChart from '../components/DiurnalChart.jsx';
import Heatmap, { heatmapMode } from '../components/Heatmap.jsx';
import MultiMeasureChart from '../components/MultiMeasureChart.jsx';
import StatTiles from '../components/StatTiles.jsx';
import TimeSeriesChart from '../components/TimeSeriesChart.jsx';
import TrendChart from '../components/TrendChart.jsx';
import WaterBalanceChart from '../components/WaterBalanceChart.jsx';
import WindDistribution, { SHEAR, TURBINE, windStats } from '../components/WindDistribution.jsx';
import WindRose from '../components/WindRose.jsx';
import YearOverYearChart from '../components/YearOverYearChart.jsx';

const n0 = d3.format(',.0f');
const n1 = d3.format(',.1f');
const n2 = d3.format(',.2f');
const p0 = d3.format('.0%');
const signed = (v) => `${v > 0 ? '+' : ''}${n0(v)}`;
const show = (v, f, unit) => (v == null ? null : `${f(v)}${unit ? ` ${unit}` : ''}`);

function Card({ title, hint, children }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {hint && <span className="muted small">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** A fül paramétereinek megjelenítése a fenti térképen (a térkép az elsődleges paramétert követi). */
function MapLinks({ ctx, keys, children }) {
  return (
    <div className="theme-tools">
      <span className="muted small">Megjelenítés a térképen:</span>
      {keys.map((k) => (
        <button key={k} className={ctx.mapMeasure === k ? 'btn small toggle active' : 'btn small toggle'} aria-pressed={ctx.mapMeasure === k} onClick={() => ctx.showOnMap(k)}>
          {ctx.byKey[k].label}
        </button>
      ))}
      {children}
    </div>
  );
}

/** A teljes kijelölt időszak összesített értékei tagonként (helyszín / régió / ország). */
function useTotals(ctx, measures) {
  const res = useFetch((signal) => api.cube({ ...ctx.params, grain: 'all', measures }, signal), [ctx.paramsKey, measures.join()]);
  const members = useMemo(() => (res.data?.rows ?? []).map((r) => ({ key: r.memberKey, name: r.memberName, row: r, v: r.values })), [res.data]);
  return { members, loading: res.loading, error: res.error };
}

const drillHint = (ctx) => (ctx.grain !== 'hour' ? 'Kattintás: lefúrás a periódusba · ' : '');
const seriesProps = (ctx) => ({
  grain: ctx.grain,
  order: ctx.order,
  currentPeriod: ctx.currentPeriod,
  forecastStart: ctx.forecastStart,
  onDrill: ctx.drillTime,
  onBrush: ctx.onBrush,
  onPeriodSelect: ctx.onPeriodSelect,
  focus: ctx.focus,
  onFocus: ctx.onFocus,
});
const cubeProps = (ctx) => ({ params: ctx.params, order: ctx.order, focus: ctx.focus, onFocus: ctx.onFocus });
const panelProps = (ctx) => ({ ...cubeProps(ctx), paramsKey: ctx.paramsKey, measures: ctx.meta.measures, forecastStart: ctx.forecastStart, onDrill: ctx.drillTime, fixed: true });
const heatHint = (ctx) => `A felbontás az időbeli szintet követi${heatmapMode(ctx.grain) !== 'hour' ? ' · Kattintás egy cellára: lefúrás' : ''}`;

/* ------------------------------------------------------------------ Napenergia */

/** A rendszer teljesítménytényezője (performance ratio) a becsült fotovoltaikus hozamhoz. */
const PERFORMANCE_RATIO = 0.8;
const SOLAR_ENERGY = { key: 'solarEnergy', label: 'Besugárzott energia', unit: 'kWh/m²', chart: 'bar' };

export function SolarTab({ ctx }) {
  const { byKey, focus } = ctx;
  const totals = useTotals(ctx, ['shortwaveRadiation', 'directNormalIrradiance', 'diffuseHorizontalIrradiance', 'cloudCover']);
  const series = useFetch((signal) => api.cube({ ...ctx.params, measures: ['shortwaveRadiation'] }, signal), [ctx.paramsKey]);
  // Az átlagos besugárzás (W/m²) és az órák számának szorzata a vízszintes felületre jutó energia (kWh/m²).
  const energyCube = useMemo(
    () => deriveCube(series.data, SOLAR_ENERGY.key, (r) => (r.values.shortwaveRadiation == null ? null : Math.round(r.values.shortwaveRadiation * hoursOf(r)) / 1000)),
    [series.data],
  );

  const energy = summarize(totals.members, focus, (m) => (m.v.shortwaveRadiation == null ? null : (m.v.shortwaveRadiation * hoursOf(m.row)) / 1000));
  const daily = summarize(totals.members, focus, (m) => (m.v.shortwaveRadiation == null ? null : (m.v.shortwaveRadiation * 24) / 1000));
  const diffuse = summarize(totals.members, focus, (m) => (m.v.shortwaveRadiation ? m.v.diffuseHorizontalIrradiance / m.v.shortwaveRadiation : null));
  const cloud = summarize(totals.members, focus, (m) => m.v.cloudCover);
  const tiles = [
    { label: 'Besugárzott energia az időszakban', value: show(energy.value, n0, 'kWh/m²'), sub: energy.scope, hint: 'A globálsugárzás (GHI) időbeli összege vízszintes felületre' },
    { label: 'Napi átlagos besugárzás', value: show(daily.value, n2, 'kWh/m²'), sub: 'egyben a csúcs-napórák száma naponta' },
    { label: 'Becsült napelemes hozam', value: show(energy.value == null ? null : energy.value * PERFORMANCE_RATIO, n0, 'kWh/kWp'), sub: `${p0(PERFORMANCE_RATIO)} rendszerhatásfokkal, vízszintes síkra` },
    { label: 'Szórt sugárzás aránya', value: show(diffuse.value, p0), sub: 'DHI / GHI – a magasabb érték felhősebb időt jelez' },
    { label: 'Átlagos felhőzet', value: show(cloud.value, n0, '%'), sub: cloud.scope },
  ];
  const ghi = byKey.shortwaveRadiation;

  return (
    <div role="tabpanel" aria-label="Napenergia">
      <MapLinks ctx={ctx} keys={['shortwaveRadiation', 'directNormalIrradiance', 'diffuseHorizontalIrradiance', 'cloudCover']} />
      {totals.error && <div className="alert error">{totals.error.message}</div>}
      <StatTiles items={tiles} loading={totals.loading} />
      <Card title="Besugárzott energia periódusonként (kWh/m²)" hint={`${drillHint(ctx)}Húzás: időszak kijelölése`}>
        {series.error && <div className="alert error">{series.error.message}</div>}
        <TimeSeriesChart cube={energyCube} loading={series.loading} measure={SOLAR_ENERGY} {...seriesProps(ctx)} />
      </Card>
      <Card title="A napsugárzás átlagos napi alakulása (W/m²)" hint="A kijelölt időszak óránkénti átlagai · globál-, direkt és szórt sugárzás">
        <DiurnalChart {...cubeProps(ctx)} paramsKey={ctx.paramsKey} defs={[ghi, byKey.directNormalIrradiance, byKey.diffuseHorizontalIrradiance]} />
      </Card>
      <Card title="Besugárzás, felhőzet és hőmérséklet" hint={`Közös időtengely, paraméterenként külön értéktengely${ctx.grain !== 'hour' ? ' · Kattintás: lefúrás' : ''}`}>
        <MultiMeasureChart {...panelProps(ctx)} selected={['shortwaveRadiation', 'cloudCover', 'temperature']} />
      </Card>
      <Card title={`Hőtérkép – ${ghi.label} (${ghi.unit})`} hint={heatHint(ctx)}>
        <Heatmap {...cubeProps(ctx)} paramsKey={ctx.paramsKey} measure={ghi} onDrill={ctx.drillTime} />
      </Card>
      <Card title={`Évszakos menet – ${ghi.label} (${ghi.unit})`} hint="A teljes betöltött időszak, havi bontásban, évenként">
        <YearOverYearChart {...cubeProps(ctx)} measure={ghi} range={ctx.meta.range} onDrill={ctx.drillTime} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Szélenergia */

const HUB_HEIGHTS = [10, 80, 100, 120];

export function WindTab({ ctx }) {
  const theme = useTheme();
  const { byKey, focus, order } = ctx;
  const [hub, setHub] = useState(100);
  const histogram = useFetch((signal) => api.histogram({ ...ctx.params, measures: ['windSpeed'], bin: 1 }, signal), [ctx.paramsKey]);
  const rose = useFetch((signal) => api.windRose(ctx.params, signal), [ctx.paramsKey]);
  const totals = useTotals(ctx, ['windGusts']);

  const stats = useMemo(
    () => windStats(histogram.data, hub).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
    [histogram.data, hub, order],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a téma a memberColor() eredményét változtatja
  const colorOf = useMemo(() => (key) => memberColor(key, order), [order, theme]);

  const mean = summarize(stats, focus, (s) => s.mean);
  const density = summarize(stats, focus, (s) => s.density);
  const capacity = summarize(stats, focus, (s) => s.capacity);
  const operating = summarize(stats, focus, (s) => s.operating);
  const gust = summarize(totals.members, focus, (m) => m.v.windGusts);
  const at = hub === 10 ? '10 m-en (mért)' : `${hub} m-re becsülve`;
  const tiles = [
    { label: 'Átlagos szélsebesség', value: show(mean.value, n1, 'm/s'), sub: `${at} · ${mean.scope}` },
    { label: 'Teljesítménysűrűség', value: show(density.value, n0, 'W/m²'), sub: 'a szélben rejlő teljesítmény (½·ρ·v³ átlaga)' },
    { label: 'Becsült kihasználtság', value: show(capacity.value, p0), sub: 'általános turbina-teljesítménygörbével' },
    { label: 'Üzemi tartományban töltött idő', value: show(operating.value, p0), sub: `${TURBINE.cutIn}–${TURBINE.cutOut} m/s közötti órák aránya` },
    { label: 'Legerősebb széllökés', value: show(gust.value, n0, 'km/h'), sub: `10 m-en · ${gust.scope}` },
  ];
  const speed = byKey.windSpeed;

  return (
    <div role="tabpanel" aria-label="Szélenergia">
      <MapLinks ctx={ctx} keys={['windSpeed', 'windGusts']}>
        <span className="muted small theme-gap">Toronymagasság:</span>
        <div className="segmented" role="radiogroup" aria-label="Toronymagasság">
          {HUB_HEIGHTS.map((h) => (
            <button key={h} role="radio" aria-checked={hub === h} className={hub === h ? 'active' : ''} onClick={() => setHub(h)}>
              {h} m
            </button>
          ))}
        </div>
      </MapLinks>
      {histogram.error && <div className="alert error">{histogram.error.message}</div>}
      <StatTiles items={tiles} loading={histogram.loading} />
      <Card
        title="A szélsebesség eloszlása"
        hint={`Az órák aránya 1 m/s-os osztályonként · ${hub === 10 ? 'a 10 m-en mért sebesség' : `a 10 m-es mérésből hatványtörvénnyel (α = ${String(SHEAR).replace('.', ',')}) ${hub} m-re számítva`}`}
      >
        <WindDistribution stats={stats} colorOf={colorOf} height={hub} focus={focus} onFocus={ctx.onFocus} loading={histogram.loading} />
        <p className="muted small">
          A jelmagyarázat tagonként az átlagsebességet és a becsült kihasználtságot mutatja. A becslés egy általános turbinára vonatkozik
          (indulás {TURBINE.cutIn} m/s, névleges teljesítmény {TURBINE.rated} m/s-tól, leállás {TURBINE.cutOut} m/s felett), tájékoztató jellegű.
        </p>
      </Card>
      <Card title="Szélirány és napi menet" hint="Szélrózsa a kijelölt szelet összes órájára · A szélsebesség óránkénti átlaga a nap folyamán (10 m)">
        <div className="wind-grid">
          <WindRose data={rose.data} loading={rose.loading} />
          <DiurnalChart {...cubeProps(ctx)} paramsKey={ctx.paramsKey} defs={[speed]} />
        </div>
      </Card>
      <Card title="Szélsebesség és széllökés" hint={`Közös időtengely${ctx.grain !== 'hour' ? ' · Kattintás: lefúrás a periódusba' : ''}`}>
        <MultiMeasureChart {...panelProps(ctx)} selected={['windSpeed', 'windGusts']} />
      </Card>
      <Card title={`Hőtérkép – ${speed.label} (${speed.unit})`} hint={heatHint(ctx)}>
        <Heatmap {...cubeProps(ctx)} paramsKey={ctx.paramsKey} measure={speed} onDrill={ctx.drillTime} />
      </Card>
      <Card title={`Évszakos menet – ${speed.label} (${speed.unit})`} hint="A teljes betöltött időszak, havi bontásban, évenként">
        <YearOverYearChart {...cubeProps(ctx)} measure={speed} range={ctx.meta.range} onDrill={ctx.drillTime} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Aszály */

const CUMULATIVE = { key: 'cumulativeBalance', label: 'Halmozott vízmérleg', unit: 'mm', chart: 'line' };

/** Az ariditási index (csapadék / referencia párolgás) UNEP szerinti osztályai. */
function aridityClass(index) {
  if (index == null) return '';
  if (index < 0.05) return 'hiperarid';
  if (index < 0.2) return 'arid';
  if (index < 0.5) return 'szemiarid';
  if (index < 0.65) return 'száraz szubhumid';
  return 'humid';
}

export function DroughtTab({ ctx }) {
  const { byKey, focus } = ctx;
  const totals = useTotals(ctx, ['precipitation', 'evapotranspiration', 'waterBalance', 'vapourPressureDeficit']);
  const series = useFetch(
    (signal) => api.cube({ ...ctx.params, measures: ['precipitation', 'evapotranspiration', 'waterBalance'] }, signal),
    [ctx.paramsKey],
  );
  const cumulative = useMemo(() => cumulativeCube(series.data, 'waterBalance', CUMULATIVE.key), [series.data]);
  const deficitShare = useMemo(() => {
    const groups = d3.group((series.data?.rows ?? []).filter((r) => r.values.waterBalance != null), (r) => r.memberKey);
    return [...groups.entries()].map(([key, rs]) => ({ key, name: rs[0].memberName, share: rs.filter((r) => r.values.waterBalance < 0).length / rs.length }));
  }, [series.data]);

  const rain = summarize(totals.members, focus, (m) => m.v.precipitation);
  const et0 = summarize(totals.members, focus, (m) => m.v.evapotranspiration);
  const balance = summarize(totals.members, focus, (m) => m.v.waterBalance);
  const aridity = summarize(totals.members, focus, (m) => (m.v.evapotranspiration ? m.v.precipitation / m.v.evapotranspiration : null));
  const deficit = summarize(deficitShare, focus, (m) => m.share);
  const vpd = summarize(totals.members, focus, (m) => m.v.vapourPressureDeficit);
  const tiles = [
    { label: 'Csapadék az időszakban', value: show(rain.value, n0, 'mm'), sub: rain.scope },
    { label: 'Referencia párolgás (ET₀)', value: show(et0.value, n0, 'mm'), sub: 'a légkör párologtató igénye (FAO Penman–Monteith)' },
    { label: 'Vízmérleg', value: balance.value == null ? null : `${signed(balance.value)} mm`, sub: balance.value == null ? '' : balance.value < 0 ? 'vízhiány: a párolgás meghaladja a csapadékot' : 'víztöbblet: a csapadék fedezi a párolgást' },
    { label: 'Ariditási index (csapadék / ET₀)', value: show(aridity.value, n2), sub: `${aridityClass(aridity.value)} · az osztályozás éves léptékre érvényes` },
    { label: 'Vízhiányos periódusok aránya', value: show(deficit.value, p0), sub: 'ahol a vízmérleg negatív' },
    { label: 'Átlagos telítési hiány (VPD)', value: show(vpd.value, n2, 'kPa'), sub: 'a levegő szárító hatása' },
  ];
  const wb = byKey.waterBalance;

  return (
    <div role="tabpanel" aria-label="Aszály">
      <MapLinks ctx={ctx} keys={['waterBalance', 'precipitation', 'evapotranspiration', 'vapourPressureDeficit']} />
      {(totals.error || series.error) && <div className="alert error">{(totals.error || series.error).message}</div>}
      <StatTiles items={tiles} loading={totals.loading} />
      <Card title="Vízmérleg periódusonként (csapadék − ET₀, mm)" hint={`A nullavonal fölött többlet, alatta hiány${ctx.grain !== 'hour' ? ' · Kattintás: lefúrás a periódusba' : ''}`}>
        <WaterBalanceChart cube={series.data} loading={series.loading} order={ctx.order} focus={focus} onFocus={ctx.onFocus} onDrill={ctx.drillTime} />
      </Card>
      <Card title="Halmozott vízmérleg (mm)" hint={`Az időszak kezdetétől összegezve – a tartósan süllyedő görbe kialakuló aszályt jelez · ${drillHint(ctx)}Húzás: időszak kijelölése`}>
        <TimeSeriesChart cube={cumulative} loading={series.loading} measure={CUMULATIVE} {...seriesProps(ctx)} />
      </Card>
      <Card title="Csapadék, párolgás és telítési hiány" hint={`Közös időtengely, paraméterenként külön értéktengely${ctx.grain !== 'hour' ? ' · Kattintás: lefúrás' : ''}`}>
        <MultiMeasureChart {...panelProps(ctx)} selected={['precipitation', 'evapotranspiration', 'vapourPressureDeficit']} />
      </Card>
      <Card title={`Hőtérkép – ${wb.label} (${wb.unit})`} hint={heatHint(ctx)}>
        <Heatmap {...cubeProps(ctx)} paramsKey={ctx.paramsKey} measure={wb} onDrill={ctx.drillTime} />
      </Card>
      <Card title={`Évszakos menet – ${wb.label} (${wb.unit})`} hint="A teljes betöltött időszak, havi bontásban, évenként">
        <YearOverYearChart {...cubeProps(ctx)} measure={wb} range={ctx.meta.range} onDrill={ctx.drillTime} />
      </Card>
      <Card title={`Éves trend – ${wb.label} (${wb.unit})`} hint="A teljes betöltött időszak, éves bontásban · Kattintás: lefúrás az évre">
        <TrendChart {...cubeProps(ctx)} measure={wb} range={ctx.meta.range} onDrill={ctx.drillTime} />
      </Card>
    </div>
  );
}
