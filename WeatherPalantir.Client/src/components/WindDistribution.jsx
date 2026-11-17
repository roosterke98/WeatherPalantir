import { useRef, useState } from 'react';
import * as d3 from 'd3';
import { useWidth } from '../hooks/useSize.js';
import { activeFocus, mutedSeries } from '../utils/colors.js';
import { showTip } from './ChoroplethMap.jsx';

/** Egy általános szélturbina jellemző sebességei (m/s): indulási, névleges és leállási. */
export const TURBINE = { cutIn: 3, rated: 12, cutOut: 25 };
/** A hatványtörvény kitevője nyílt, sík terepre (1/7). */
export const SHEAR = 0.143;
const AIR_DENSITY = 1.225;

/** A 10 m-en mért sebesség átszámítása a toronymagasságra (hatványtörvény). */
export const heightFactor = (height) => (height / 10) ** SHEAR;

/** Egyszerűsített teljesítménygörbe: a névleges teljesítmény hányada adott szélsebességnél. */
function powerFraction(v) {
  if (v < TURBINE.cutIn || v >= TURBINE.cutOut) return 0;
  if (v >= TURBINE.rated) return 1;
  return (v ** 3 - TURBINE.cutIn ** 3) / (TURBINE.rated ** 3 - TURBINE.cutIn ** 3);
}

/**
 * A szélsebesség-eloszlásból (1 km/h-s osztályok, 10 m-en) tagonként számolt mutatók a toronymagasságra:
 * átlagsebesség, teljesítménysűrűség (½ρv³ átlaga), becsült kihasználtság és az üzemi tartományba eső órák aránya.
 */
export function windStats(rows, height) {
  const k = heightFactor(height);
  return [...d3.group(rows ?? [], (r) => r.memberKey).entries()].map(([key, rs]) => {
    const total = d3.sum(rs, (r) => r.hours) || 1;
    const speed = (r) => ((r.bin + 0.5) / 3.6) * k;
    // Egy km/h-s osztály órái arányosan oszlanak szét az általa lefedett m/s-os osztályok között,
    // különben az átváltás fűrészfogas eloszlást adna.
    const classes = new Map();
    for (const r of rs) {
      const lo = (r.bin / 3.6) * k;
      const hi = ((r.bin + 1) / 3.6) * k;
      for (let c = Math.floor(lo); c < hi; c++) {
        const part = (Math.min(hi, c + 1) - Math.max(lo, c)) / (hi - lo);
        classes.set(c, (classes.get(c) ?? 0) + (r.hours * part) / total);
      }
    }
    return {
      key,
      name: rs[0].memberName,
      mean: d3.sum(rs, (r) => r.hours * speed(r)) / total,
      density: d3.sum(rs, (r) => r.hours * 0.5 * AIR_DENSITY * speed(r) ** 3) / total,
      capacity: d3.sum(rs, (r) => r.hours * powerFraction(speed(r))) / total,
      operating: d3.sum(rs, (r) => (speed(r) >= TURBINE.cutIn && speed(r) < TURBINE.cutOut ? r.hours : 0)) / total,
      classes,
    };
  });
}

const pct = d3.format('.1%');

/**
 * Szélsebesség-eloszlás: az órák aránya 1 m/s-os sebességosztályonként, tagonként egy vonallal.
 * A függőleges jelölők a turbina indulási, névleges és leállási sebességét mutatják.
 */
export default function WindDistribution({ stats, colorOf, height: hub, focus, onFocus, loading }) {
  const [wrapRef, width] = useWidth(900);
  const tipRef = useRef(null);
  const [hover, setHover] = useState(null);
  const height = 300;
  const margin = { top: 26, right: 16, bottom: 40, left: 46 };
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;

  const active = activeFocus(focus, stats);
  const maxClass = Math.max(TURBINE.rated + 2, d3.max(stats, (s) => d3.max(s.classes.keys())) ?? 0);
  const x = d3.scaleLinear([0, maxClass + 1], [0, innerW]);
  const y = d3.scaleLinear([0, d3.max(stats, (s) => d3.max(s.classes.values())) || 0.1], [innerH, 0]).nice(5);
  const classes = d3.range(0, maxClass + 1);
  const pathOf = (s) => d3.line().x((c) => x(c + 0.5)).y((c) => y(s.classes.get(c) ?? 0)).curve(d3.curveMonotoneX)(classes);
  const series = [...stats].map((s) => ({ ...s, color: colorOf(s.key), dim: active != null && s.key !== active })).sort((a, b) => b.dim - a.dim);
  const shown = series.filter((s) => !s.dim);
  const marks = [
    { v: TURBINE.cutIn, label: 'indulás' },
    { v: TURBINE.rated, label: 'névleges' },
    { v: TURBINE.cutOut, label: 'leállás' },
  ].filter((m) => m.v <= maxClass + 1);

  const move = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const c = Math.max(0, Math.min(maxClass, Math.floor(x.invert(event.clientX - rect.left))));
    setHover(c);
    const lines = [`<strong>${c}–${c + 1} m/s</strong> <span class="muted">(${hub} m magasan)</span>`, ...stats.filter((s) => active == null || s.key === active).map((s) => `<span class="swatch" style="background:${colorOf(s.key)}"></span>${s.name}: <b>${pct(s.classes.get(c) ?? 0)}</b>`)];
    showTip(d3.select(tipRef.current), event.nativeEvent, wrapRef.current, lines.join('<br>'));
  };
  const leave = () => {
    setHover(null);
    d3.select(tipRef.current).style('opacity', 0);
  };

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {stats.length > 1 && (
        <div className="legend" role="list">
          {stats.map((s) => (
            <button
              key={s.key}
              role="listitem"
              className={active != null && s.key !== active ? 'legend-item dim' : 'legend-item'}
              aria-pressed={s.key === active}
              title={active == null ? 'Csak ennek a megjelenítése' : 'Vissza az eredeti kijelöléshez'}
              onClick={() => onFocus(s.key)}
            >
              <span className="swatch" style={{ background: colorOf(s.key) }} />
              {s.name}
              <span className="muted">· {d3.format('.1f')(s.mean)} m/s · {d3.format('.0%')(s.capacity)}</span>
            </button>
          ))}
        </div>
      )}
      {loading && <div className="overlay-loading">Frissítés…</div>}
      {!loading && !stats.length && <div className="empty">Nincs szélsebesség adat a kijelölt szeletben.</div>}
      {stats.length > 0 && (
        <svg width={width} height={height} role="img" aria-label="A szélsebesség eloszlása">
          <g transform={`translate(${margin.left},${margin.top})`}>
            <text className="axis-title" x={-margin.left + 4} y={-14}>órák aránya</text>
            <rect className="operating-zone" x={x(TURBINE.cutIn)} width={Math.max(0, x(Math.min(TURBINE.cutOut, maxClass + 1)) - x(TURBINE.cutIn))} height={innerH} />
            {y.ticks(5).map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line className="grid-line" x2={innerW} />
                <text className="tick-label" x={-8} y={4} textAnchor="end">{d3.format('.0%')(t)}</text>
              </g>
            ))}
            {x.ticks(Math.min(maxClass + 1, Math.max(4, innerW / 50))).map((t) => (
              <text key={t} className="tick-label" x={x(t)} y={innerH + 17} textAnchor="middle">{t}</text>
            ))}
            <text className="axis-title" x={innerW} y={innerH + 34} textAnchor="end">szélsebesség {hub} m magasan (m/s)</text>
            <line className="axis-line" x2={innerW} y1={innerH} y2={innerH} />
            {marks.map((m) => (
              <g key={m.label} transform={`translate(${x(m.v)},0)`}>
                <line className="ref-line" y1={-4} y2={innerH} />
                <text className="ref-label" y={-8} textAnchor="middle">{m.label} ({m.v} m/s)</text>
              </g>
            ))}
            {series.map((s) => (
              <path key={s.key} className="line" d={pathOf(s)} stroke={s.dim ? mutedSeries() : s.color} opacity={s.dim ? 0.45 : 1} />
            ))}
            {hover != null && <line className="crosshair" x1={x(hover + 0.5)} x2={x(hover + 0.5)} y2={innerH} />}
            {hover != null && shown.map((s) => <circle key={s.key} className="dot" r={4} cx={x(hover + 0.5)} cy={y(s.classes.get(hover) ?? 0)} fill={s.color} />)}
            <rect className="hover-area" width={innerW} height={innerH} onPointerMove={move} onPointerLeave={leave} />
          </g>
        </svg>
      )}
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}
