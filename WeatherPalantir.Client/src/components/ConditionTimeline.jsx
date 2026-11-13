import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { useWidth } from '../hooks/useSize.js';
import { categorical, isDark } from '../utils/colors.js';
import { formatInt } from '../utils/format.js';
import { axisTimeFormat, formatPeriod, grainInterval, parsePeriod } from '../utils/time.js';
import { conditionLabel, SEVERITY_HU } from '../utils/wmo.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/** A DimWeatherCondition hierarchiája: súlyosság (Severity) → időjárási viszony (WMO kód). */
const SEVERITIES = ['Low', 'Mild', 'Moderate', 'Severe', 'Extreme', 'Unknown'];
const SEVERITY_COLORS = { Low: '#0ca30c', Mild: '#fab219', Moderate: '#ec835a', Severe: '#d03b3b', Extreme: '#a3238e' };
const severityLabel = (s) => SEVERITY_HU[s] ?? 'Ismeretlen';
const neutral = () => (isDark() ? '#6b74a8' : '#b5b3ab');

/** Viszony szinten legfeljebb ennyi sorozat kap saját színt, a többi az „Egyéb” csoportba kerül. */
const MAX_SERIES = 8;

const pct = d3.format('.1%');

/**
 * Az időjárási viszonyok megoszlása időben: periódusonként halmozott oszlop, az órák arányával.
 * A dimenzió mentén lefúrható (súlyossági csoport → a csoport viszonyai) és felgöngyölíthető;
 * viszony szinten a kattintás az adott viszonyra szűri a többi komponenst.
 */
export default function ConditionTimeline({ params, paramsKey, selected, onToggle }) {
  const theme = useTheme();
  const [wrapRef, width] = useWidth(900);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const [level, setLevel] = useState('severity');
  const [severity, setSeverity] = useState(null);
  const height = 300;
  const margin = { top: 12, right: 16, bottom: 30, left: 52 };

  // A megoszlás a viszony-szűrőtől függetlenül látszik, a kiválasztott viszonyok kiemelve.
  const series = useFetch((signal) => api.conditionSeries({ ...params, conditions: [] }, signal), [paramsKey]);

  const model = useMemo(() => {
    const rows = (series.data ?? []).filter((r) => r.period);
    const sevOf = (r) => r.severity ?? 'Unknown';
    const periods = [...new Set(rows.map((r) => +parsePeriod(r.period)))].sort((a, b) => a - b).map((t) => new Date(t));
    const totals = d3.rollup(rows, (rs) => d3.sum(rs, (r) => r.hours), (r) => +parsePeriod(r.period));

    let items;
    let idOf;
    if (level === 'severity') {
      const present = new Set(rows.map(sevOf));
      items = SEVERITIES.filter((s) => present.has(s)).map((s) => ({ id: s, label: severityLabel(s), color: SEVERITY_COLORS[s] ?? neutral(), severity: s }));
      idOf = sevOf;
    } else {
      const inScope = rows.filter((r) => !severity || sevOf(r) === severity);
      const hours = d3.rollup(inScope, (rs) => d3.sum(rs, (r) => r.hours), (r) => r.weatherConditionKey);
      const info = new Map(inScope.map((r) => [r.weatherConditionKey, r]));
      let keys = [...hours.keys()].sort((a, b) => (a ?? 1e9) - (b ?? 1e9));
      let other = false;
      if (keys.length > MAX_SERIES) {
        const keep = new Set([...hours.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SERIES - 1).map(([k]) => k));
        keys = keys.filter((k) => keep.has(k));
        other = true;
      }
      const palette = categorical();
      items = keys.map((k, i) => ({
        id: `c${k}`,
        conditionKey: k,
        label: conditionLabel(k, info.get(k).description),
        color: palette[i % palette.length],
        severity: sevOf(info.get(k)),
      }));
      if (other) items.push({ id: 'other', label: 'Egyéb', color: neutral() });
      const known = new Set(keys);
      idOf = (r) => (severity && sevOf(r) !== severity ? null : known.has(r.weatherConditionKey) ? `c${r.weatherConditionKey}` : 'other');
    }

    // Periódusonként az egyes sorozatok óraszáma.
    const cells = new Map();
    for (const r of rows) {
      const id = idOf(r);
      if (id == null) continue;
      const t = +parsePeriod(r.period);
      if (!cells.has(t)) cells.set(t, new Map());
      cells.get(t).set(id, (cells.get(t).get(id) ?? 0) + r.hours);
    }
    return { periods, totals, items, cells };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a paletta témafüggő
  }, [series.data, level, severity, theme]);

  const drillSeverity = (s) => {
    setSeverity(s);
    setLevel('condition');
  };
  const rollUp = () => {
    setSeverity(null);
    setLevel('severity');
  };
  const activate = (item) => {
    if (level === 'severity') drillSeverity(item.severity);
    else if (item.conditionKey != null) onToggle(item.conditionKey);
  };
  const dimmed = (item) => level === 'condition' && selected.length > 0 && !selected.includes(item.conditionKey);
  const grain = params.grain;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const { periods, totals, items, cells } = model;
    if (!periods.length || !items.length) return;

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const interval = grainInterval(grain);
    const start = periods[0];
    const end = interval.offset(periods[periods.length - 1], 1);
    const x = d3.scaleTime([start, end], [0, innerW]);
    const share = (p, item) => (cells.get(+p)?.get(item.id) ?? 0) / (totals.get(+p) || 1);

    const stacks = periods.map((p) => {
      let acc = 0;
      const segs = items.map((item) => {
        const v = share(p, item);
        const seg = { p, item, y0: acc, y1: acc + v, v };
        acc += v;
        return seg;
      });
      return { p, segs, sum: acc };
    });
    const yMax = level === 'severity' ? 1 : Math.max(0.01, d3.max(stacks, (s) => s.sum));
    const y = d3.scaleLinear([0, yMax], [innerH, 0]);
    if (level !== 'severity') y.nice(5);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat('')).call((a) => a.select('.domain').remove());
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')).tickSizeOuter(0)).call((a) => a.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(Math.max(2, innerW / 90)).tickFormat(axisTimeFormat).tickSizeOuter(0));

    const tip = d3.select(tipRef.current);
    const slot = (p) => x(interval.offset(p, 1)) - x(p);
    const col = g
      .selectAll('g.cond-col')
      .data(stacks)
      .join('g')
      .attr('class', 'cond-col')
      .attr('transform', (s) => `translate(${x(s.p) + (slot(s.p) > 6 ? 1 : 0)},0)`)
      .on('pointermove', (event, s) => {
        const total = totals.get(+s.p) ?? 0;
        const lines = [`<strong>${formatPeriod(s.p, grain)}</strong>`];
        for (const seg of [...s.segs].reverse()) {
          if (!seg.v) continue;
          lines.push(`<span class="swatch" style="background:${seg.item.color}"></span>${seg.item.label}: <b>${formatInt(Math.round(seg.v * total))} óra</b> (${pct(seg.v)})`);
        }
        lines.push(`<span class="muted">Összesen ${formatInt(total)} óra</span>`);
        showTip(tip, event, wrapRef.current, lines.join('<br>'));
      })
      .on('pointerleave', () => tip.style('opacity', 0));

    col
      .selectAll('rect')
      .data((s) => s.segs.filter((seg) => seg.v > 0))
      .join('rect')
      .attr('class', (seg) => (dimmed(seg.item) ? 'cond-seg dim' : 'cond-seg'))
      .attr('fill', (seg) => seg.item.color)
      .attr('width', (seg) => Math.max(1, slot(seg.p) - (slot(seg.p) > 6 ? 2 : 0)))
      .attr('y', (seg) => y(seg.y1))
      .attr('height', (seg) => Math.max(0, y(seg.y0) - y(seg.y1) - (slot(seg.p) > 6 && y(seg.y0) - y(seg.y1) > 3 ? 1 : 0)))
      .style('cursor', (seg) => (level === 'severity' || seg.item.conditionKey != null ? 'pointer' : 'default'))
      .on('click', (_, seg) => activate(seg.item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, width, grain, selected, wrapRef]);

  const { items, periods } = model;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="viz-tools">
        <div className="segmented" role="radiogroup" aria-label="A dimenzió szintje">
          <button role="radio" aria-checked={level === 'severity'} className={level === 'severity' ? 'active' : ''} onClick={rollUp}>
            Súlyosság
          </button>
          <button
            role="radio"
            aria-checked={level === 'condition'}
            className={level === 'condition' ? 'active' : ''}
            onClick={() => {
              setSeverity(null);
              setLevel('condition');
            }}
          >
            Viszony
          </button>
        </div>
        <nav className="breadcrumb" aria-label="Időjárási viszony hierarchia">
          <button className="crumb" disabled={level === 'severity'} onClick={rollUp}>Súlyossági csoportok</button>
          {level === 'condition' && (
            <>
              <span className="crumb-sep">›</span>
              <button className="crumb" disabled>{severity ? severityLabel(severity) : 'Minden viszony'}</button>
            </>
          )}
        </nav>
        {level === 'condition' && <button className="btn ghost" onClick={rollUp}>↑ Felgöngyölítés</button>}
        <span className="muted small">{level === 'severity' ? 'Kattintás egy csoportra: lefúrás a viszonyaira' : 'Kattintás egy viszonyra: szűrés'}</span>
      </div>

      {items.length > 0 && (
        <div className="legend" role="list">
          {items.map((item) => {
            const clickable = level === 'severity' || item.conditionKey != null;
            return (
              <button
                key={item.id}
                role="listitem"
                className={`legend-item${clickable ? '' : ' static'}${dimmed(item) ? ' dim' : ''}`}
                onClick={clickable ? () => activate(item) : undefined}
                title={level === 'severity' ? 'Lefúrás a csoport viszonyaira' : clickable ? 'Szűrés erre a viszonyra' : undefined}
              >
                <span className="swatch" style={{ background: item.color }} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
      {series.error && <div className="alert error">{series.error.message}</div>}
      {series.loading && <div className="overlay-loading">Frissítés…</div>}
      {!series.loading && !periods.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      {!series.loading && periods.length > 0 && !items.length && <div className="empty">Ebben a csoportban nincs előforduló viszony.</div>}
      <svg ref={svgRef} width={width} height={periods.length && items.length ? height : 0} role="img" aria-label="Időjárási viszonyok megoszlása időben" />
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}
