import { useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { useWidth } from '../hooks/useSize.js';
import { fillScale } from '../utils/colors.js';
import { formatValue } from '../utils/format.js';
import { formatPeriod, parsePeriod } from '../utils/time.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/** Egyszerre ennyi tag (helyszín / régió / ország) kap saját panelt. */
const MAX_PANELS = 6;

const shortMonth = d3.timeFormat('%b');

/**
 * A hőtérkép felbontása az időbeli szinthez igazodik:
 *  - év / hónap: sor = év, oszlop = hónap,
 *  - nap: sor = hónap, oszlop = a hónap napja,
 *  - óra: sor = nap, oszlop = a nap órája.
 */
const MODES = {
  month: {
    cellGrain: 'month',
    cols: d3.range(12).map((m) => shortMonth(new Date(2000, m, 1))),
    row: (p) => d3.timeYear(p),
    col: (p) => p.getMonth(),
    rowLabel: d3.timeFormat('%Y'),
    colEvery: 1,
    caption: 'Sor: év · Oszlop: hónap',
  },
  day: {
    cellGrain: 'day',
    cols: d3.range(1, 32).map(String),
    row: (p) => d3.timeMonth(p),
    col: (p) => p.getDate() - 1,
    rowLabel: d3.timeFormat('%Y. %b'),
    colEvery: 2,
    caption: 'Sor: hónap · Oszlop: nap',
  },
  hour: {
    cellGrain: 'hour',
    cols: d3.range(24).map(String),
    row: (p) => d3.timeDay(p),
    col: (p) => p.getHours(),
    rowLabel: d3.timeFormat('%b %-d.'),
    colEvery: 3,
    caption: 'Sor: nap · Oszlop: óra',
  },
};

export const heatmapMode = (grain) => (grain === 'hour' ? 'hour' : grain === 'day' ? 'day' : 'month');

/**
 * Hőtérkép tagonként (helyszín / régió / ország) egy panellel, közös színskálával, így a helyszínek
 * és az évek mintázatai egymás mellett olvashatók. Kattintás egy cellára: időbeli lefúrás a cella periódusába.
 */
export default function Heatmap({ params, paramsKey, measure, order, onDrill }) {
  const theme = useTheme();
  const mode = MODES[heatmapMode(params.grain)];
  const supported = measure.key !== 'windDirection';

  const cube = useFetch(
    (signal) => api.cube({ ...params, grain: mode.cellGrain, measures: [measure.key] }, signal),
    [paramsKey, mode.cellGrain, measure.key],
    { enabled: supported },
  );

  const { panels, rowKeys, color, hidden } = useMemo(() => {
    const data = cube.data?.grain === mode.cellGrain ? cube.data : null;
    const rows = (data?.rows ?? []).filter((r) => r.period && r.values[measure.key] != null);
    const groups = d3.group(rows, (r) => r.memberKey);
    const all = [...groups.entries()]
      .map(([key, rs]) => ({
        key,
        name: rs[0].memberName,
        cells: rs.map((r) => {
          const period = parsePeriod(r.period);
          return { period, row: +mode.row(period), col: mode.col(period), value: r.values[measure.key] };
        }),
      }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return {
      panels: all.slice(0, MAX_PANELS),
      hidden: Math.max(0, all.length - MAX_PANELS),
      rowKeys: [...new Set(rows.map((r) => +mode.row(parsePeriod(r.period))))].sort((a, b) => a - b),
      color: fillScale(measure.colorScheme, rows.map((r) => r.values[measure.key])),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a színskála semleges középpontja témafüggő
  }, [cube.data, mode, measure, order, theme]);

  if (!supported) return <div className="empty">A szélirányhoz nem készül hőtérkép – válassz másik paramétert.</div>;

  const clickable = mode.cellGrain !== 'hour';

  return (
    <div className="chart-wrap">
      {cube.error && <div className="alert error">{cube.error.message}</div>}
      {cube.loading && <div className="overlay-loading">Frissítés…</div>}
      {!cube.loading && !panels.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      {panels.length > 0 && color && (
        <>
          <ColorLegend color={color} measure={measure} caption={mode.caption} />
          <div className="facets">
            {panels.map((p) => (
              <HeatPanel key={p.key} panel={p} mode={mode} rowKeys={rowKeys} color={color} measure={measure} showTitle={panels.length > 1} onCell={clickable ? onDrill : null} />
            ))}
          </div>
          {hidden > 0 && <p className="muted small">További {hidden} tag nem fért ki – szűkítsd a földrajzi szeletet.</p>}
        </>
      )}
    </div>
  );
}

function HeatPanel({ panel, mode, rowKeys, color, measure, showTitle, onCell }) {
  const [wrapRef, width] = useWidth(480);
  const tipRef = useRef(null);
  const labelW = 62;
  const headH = 18;
  const nCols = mode.cols.length;
  const cellW = (width - labelW) / nCols;
  const rowH = Math.max(5, Math.min(22, Math.floor(440 / Math.max(1, rowKeys.length))));
  const gap = cellW >= 8 && rowH >= 8 ? 2 : cellW >= 4 && rowH >= 6 ? 1 : 0;
  const labelEvery = Math.ceil(13 / rowH);
  const colEvery = cellW >= 16 ? 1 : Math.max(mode.colEvery, Math.ceil(16 / cellW));
  const rowIndex = new Map(rowKeys.map((k, i) => [k, i]));
  const height = headH + rowKeys.length * rowH;
  const hide = () => d3.select(tipRef.current).style('opacity', 0);

  return (
    <figure className="facet" ref={wrapRef}>
      {showTitle && <figcaption>{panel.name}</figcaption>}
      <svg width={width} height={height} role="img" aria-label={`${measure.label} hőtérkép – ${panel.name}`} onPointerLeave={hide}>
        {mode.cols.map((c, i) =>
          i % colEvery === 0 ? (
            <text key={c} className="heat-label" x={labelW + (i + 0.5) * cellW} y={headH - 6} textAnchor="middle">{c}</text>
          ) : null,
        )}
        {rowKeys.map((k, i) =>
          i % labelEvery === 0 ? (
            <text key={k} className="heat-label" x={labelW - 6} y={headH + i * rowH + rowH / 2 + 4} textAnchor="end">{mode.rowLabel(new Date(k))}</text>
          ) : null,
        )}
        {panel.cells.map((c) => (
          <rect
            key={+c.period}
            className={onCell ? 'heat-cell clickable' : 'heat-cell'}
            x={labelW + c.col * cellW + gap / 2}
            y={headH + rowIndex.get(c.row) * rowH + gap / 2}
            width={Math.max(1, cellW - gap)}
            height={Math.max(1, rowH - gap)}
            rx={gap ? 2 : 0}
            fill={color(c.value)}
            onClick={onCell ? () => onCell(c.period, mode.cellGrain) : undefined}
            onPointerMove={(event) =>
              showTip(d3.select(tipRef.current), event.nativeEvent, wrapRef.current,
                `<strong>${formatPeriod(c.period, mode.cellGrain)}</strong><br>${panel.name}<br>${measure.label}: <b>${formatValue(c.value, measure)}</b>`)
            }
          />
        ))}
      </svg>
      <div ref={tipRef} className="tooltip" />
    </figure>
  );
}

function ColorLegend({ color, measure, caption }) {
  const domain = color.domain();
  const [lo, hi] = [domain[0], domain[domain.length - 1]];
  const stops = d3.range(0, 1.001, 0.1).map((t) => color(lo + t * (hi - lo)));
  return (
    <div className="heat-legend">
      <span className="small">{measure.label} ({measure.unit})</span>
      <span className="small muted">{formatValue(lo, null)}</span>
      <span className="heat-ramp" style={{ background: `linear-gradient(to right, ${stops.join(',')})` }} />
      <span className="small muted">{formatValue(hi, null)}</span>
      <span className="small muted heat-caption">{caption}</span>
    </div>
  );
}
