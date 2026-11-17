import { useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { useWidth } from '../hooks/useSize.js';
import { activeFocus, categorical, memberColor, mutedSeries } from '../utils/colors.js';
import { formatValue } from '../utils/format.js';
import { parsePeriod } from '../utils/time.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/** Több paraméter esetén egyszerre ennyi tag (helyszín / régió / ország) kap saját panelt. */
const MAX_PANELS = 6;
const HOURS = d3.range(24);
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

/**
 * Átlagos napi menet: a kijelölt időszak óránkénti értékeinek átlaga a nap órái (0–23) szerint,
 * területdiagramként. Egy paraméternél a sorozatok a tagok (helyszín / régió / ország) egy közös ábrán;
 * több paraméternél (pl. globál-, direkt és szórt sugárzás) tagonként egy panel, a sorozatok a paraméterek.
 */
export default function DiurnalChart({ params, paramsKey, defs, order, focus, onFocus }) {
  const theme = useTheme();
  const keys = defs.map((d) => d.key);
  const cube = useFetch(
    (signal) => api.cube({ ...params, grain: 'hourOfDay', measures: keys }, signal),
    [paramsKey, keys.join()],
  );

  const members = useMemo(() => {
    const rows = (cube.data?.rows ?? []).filter((r) => r.period);
    return [...d3.group(rows, (r) => r.memberKey).entries()]
      .map(([key, rs]) => ({
        key,
        name: rs[0].memberName,
        color: memberColor(key, order),
        byHour: new Map(rs.map((r) => [parsePeriod(r.period).getHours(), r.values])),
      }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a téma a memberColor() eredményét változtatja
  }, [cube.data, order, theme]);

  const active = activeFocus(focus, members);
  const single = defs.length === 1;
  const palette = categorical();
  const unit = defs[0].unit;
  const zeroBased = defs.some((d) => d.chart !== 'line');

  // Egy paraméter: egy panel, tagonként egy sorozat. Több paraméter: tagonként egy panel, paraméterenként egy sorozat.
  const panels = single
    ? [{
        key: 'all',
        name: defs[0].label,
        series: [...members]
          .map((m) => ({ key: m.key, name: m.name, color: m.color, dim: active != null && m.key !== active, values: HOURS.map((h) => m.byHour.get(h)?.[defs[0].key] ?? null) }))
          .sort((a, b) => b.dim - a.dim),
      }]
    : members.slice(0, MAX_PANELS).map((m) => ({
        key: m.key,
        name: m.name,
        dim: active != null && m.key !== active,
        series: defs.map((d, i) => ({ key: d.key, name: d.label, color: palette[i % palette.length], dim: false, values: HOURS.map((h) => m.byHour.get(h)?.[d.key] ?? null) })),
      }));
  const hidden = single ? 0 : Math.max(0, members.length - MAX_PANELS);
  const all = panels.flatMap((p) => p.series.flatMap((s) => s.values)).filter((v) => v != null);
  const ext = d3.extent(all);
  // A forrásadat elhanyagolható negatív értékei (pl. −0,02 W/m² éjszaka) nem nyitnak negatív tartományt.
  const low = (ext[0] ?? 0) > -0.01 * Math.abs(ext[1] ?? 1) ? 0 : ext[0];
  const domain = zeroBased ? [Math.min(0, low), Math.max(ext[1] ?? 1, 0.1)] : [ext[0] ?? 0, ext[1] ?? 1];

  return (
    <div className="chart-wrap">
      <div className="legend" role="list">
        {single
          ? members.length > 1 && members.map((m) => (
              <button
                key={m.key}
                role="listitem"
                className={active != null && m.key !== active ? 'legend-item dim' : 'legend-item'}
                aria-pressed={m.key === active}
                title={active == null ? 'Csak ennek a megjelenítése' : 'Vissza az eredeti kijelöléshez'}
                onClick={() => onFocus(m.key)}
              >
                <span className="swatch" style={{ background: m.color }} />
                {m.name}
              </button>
            ))
          : defs.map((d, i) => (
              <span key={d.key} role="listitem" className="legend-item static">
                <span className="swatch" style={{ background: palette[i % palette.length] }} />
                {d.label}
              </span>
            ))}
      </div>
      {cube.error && <div className="alert error">{cube.error.message}</div>}
      {cube.loading && <div className="overlay-loading">Frissítés…</div>}
      {!cube.loading && !all.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      {all.length > 0 && (
        <div className={single ? '' : 'facets'}>
          {panels.map((p) => (
            <DiurnalPanel key={p.key} panel={p} domain={domain} unit={unit} measure={defs[0]} showTitle={!single && panels.length > 1} onTitle={onFocus} />
          ))}
        </div>
      )}
      {hidden > 0 && <p className="muted small">További {hidden} tag nem fért ki – jelölj ki kevesebb helyszínt.</p>}
    </div>
  );
}

function DiurnalPanel({ panel, domain, unit, measure, showTitle, onTitle }) {
  const [wrapRef, width] = useWidth(480);
  const tipRef = useRef(null);
  const [hover, setHover] = useState(null);
  const height = 240;
  const margin = { top: 16, right: 12, bottom: 26, left: 46 };
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const x = d3.scaleLinear([0, 23], [0, innerW]);
  const y = d3.scaleLinear(domain, [innerH, 0]).nice(5);
  const line = d3.line().defined((v) => v != null).x((_, h) => x(h)).y((v) => y(v)).curve(d3.curveMonotoneX);
  const area = d3.area().defined((v) => v != null).x((_, h) => x(h)).y0(y(Math.max(0, y.domain()[0]))).y1((v) => y(v)).curve(d3.curveMonotoneX);
  const fillOpacity = panel.series.length > 3 ? 0.06 : 0.16;
  const shown = panel.series.filter((s) => !s.dim);

  const move = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const h = Math.max(0, Math.min(23, Math.round(x.invert(event.clientX - rect.left))));
    setHover(h);
    const lines = [`<strong>${hourLabel(h)}</strong>`, ...shown.map((s) => `<span class="swatch" style="background:${s.color}"></span>${s.name}: <b>${formatValue(s.values[h], measure)}</b>`)];
    showTip(d3.select(tipRef.current), event.nativeEvent, wrapRef.current, lines.join('<br>'));
  };
  const leave = () => {
    setHover(null);
    d3.select(tipRef.current).style('opacity', 0);
  };

  return (
    <figure className={panel.dim ? 'facet dim' : 'facet'} ref={wrapRef}>
      {showTitle && (
        <figcaption>
          <button className="facet-title" onClick={() => onTitle(panel.key)} title="Csak ennek a kiemelése · újabb kattintás: vissza">
            {panel.name}
          </button>
        </figcaption>
      )}
      <svg width={width} height={height} role="img" aria-label={`Átlagos napi menet – ${panel.name}`}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          <text className="axis-title" x={-margin.left + 4} y={-6}>{unit}</text>
          {y.ticks(5).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line className="grid-line" x2={innerW} />
              <text className="tick-label" x={-8} y={4} textAnchor="end">{d3.format(',~g')(t)}</text>
            </g>
          ))}
          {d3.range(0, 24, innerW < 320 ? 6 : 3).map((h) => (
            <text key={h} className="tick-label" x={x(h)} y={innerH + 17} textAnchor="middle">{hourLabel(h)}</text>
          ))}
          <line className="axis-line" x2={innerW} y1={innerH} y2={innerH} />
          {panel.series.map((s) => (
            <g key={s.key}>
              {!s.dim && <path d={area(s.values)} fill={s.color} fillOpacity={fillOpacity} />}
              <path className="line" d={line(s.values)} stroke={s.dim ? mutedSeries() : s.color} opacity={s.dim ? 0.45 : 1} />
            </g>
          ))}
          {hover != null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y2={innerH} />}
          {hover != null && shown.map((s) => s.values[hover] != null && <circle key={s.key} className="dot" r={4} cx={x(hover)} cy={y(s.values[hover])} fill={s.color} />)}
          <rect className="hover-area" width={innerW} height={innerH} onPointerMove={move} onPointerLeave={leave} />
        </g>
      </svg>
      <div ref={tipRef} className="tooltip" />
    </figure>
  );
}
