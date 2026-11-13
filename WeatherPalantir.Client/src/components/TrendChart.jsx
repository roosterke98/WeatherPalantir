import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { useWidth } from '../hooks/useSize.js';
import { memberColor } from '../utils/colors.js';
import { formatValue } from '../utils/format.js';
import { parsePeriod } from '../utils/time.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

const signed = d3.format('+,.2f');

/** Egy év akkor teljes, ha helyszínenként az órák legalább 95%-a be van töltve. */
const isComplete = (row, year) => {
  const expected = d3.timeDay.count(new Date(year, 0, 1), new Date(year + 1, 0, 1)) * 24;
  return row.hourCount / Math.max(1, row.locationCount) >= expected * 0.95;
};

/** Legkisebb négyzetek módszere: y = a + b·x. */
function regression(points) {
  if (points.length < 3) return null;
  const mx = d3.mean(points, (p) => p.year);
  const my = d3.mean(points, (p) => p.y);
  const sxx = d3.sum(points, (p) => (p.year - mx) ** 2);
  if (!sxx) return null;
  const slope = d3.sum(points, (p) => (p.year - mx) * (p.y - my)) / sxx;
  return { slope, at: (year) => my + slope * (year - mx) };
}

/**
 * Éves trend: tagonként (helyszín / régió / ország) az éves értékek és a rájuk illesztett lineáris trend,
 * a teljes betöltött időszakra. A csonka évek (pl. az első és a folyó év) torzítanák az éves értéket,
 * ezért kimaradnak. Az „eltérés” mód a tag saját többéves átlagához viszonyít,
 * így az eltérő szintű helyszínek is összevethetők.
 */
export default function TrendChart({ params, measure, range, order, onDrill }) {
  const theme = useTheme();
  const [wrapRef, width] = useWidth(900);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const [mode, setMode] = useState('value');
  const height = 300;
  const margin = { top: 16, right: 110, bottom: 28, left: 52 };
  const supported = measure.key !== 'windDirection';

  const history = { ...params, from: range.min?.slice(0, 10), to: range.max?.slice(0, 10), grain: 'year', measures: [measure.key] };
  const historyKey = JSON.stringify(history);
  const cube = useFetch((signal) => api.cube(history, signal), [historyKey], { enabled: supported && !!range.min });

  const { members, years, skipped } = useMemo(() => {
    const rows = (cube.data?.rows ?? []).filter((r) => r.period && r.values[measure.key] != null);
    const groups = d3.group(rows, (r) => r.memberKey);
    const list = [...groups.entries()]
      .map(([key, rs]) => {
        const raw = rs
          .map((r) => ({ year: parsePeriod(r.period).getFullYear(), value: r.values[measure.key], row: r }))
          .filter((p) => isComplete(p.row, p.year))
          .sort((a, b) => a.year - b.year);
        const mean = d3.mean(raw, (p) => p.value);
        const points = raw.map((p) => ({ year: p.year, value: p.value, y: mode === 'anomaly' ? p.value - mean : p.value }));
        return { key, name: rs[0].memberName, color: memberColor(key, order), points, mean, fit: regression(points) };
      })
      .filter((m) => m.points.length)
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const shown = [...new Set(list.flatMap((m) => m.points.map((p) => p.year)))].sort((a, b) => a - b);
    const allYears = [...new Set(rows.map((r) => parsePeriod(r.period).getFullYear()))].sort((a, b) => a - b);
    return { members: list, years: shown, skipped: allYears.filter((y) => !shown.includes(y)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a téma a memberColor() eredményét változtatja
  }, [cube.data, measure, order, mode, theme]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!years.length) return;

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const x = d3.scalePoint(years, [0, innerW]).padding(0.5);
    const all = members.flatMap((m) => m.points.map((p) => p.y));
    const ext = d3.extent(all);
    const zeroBased = mode === 'anomaly' || measure.chart !== 'line';
    const y = d3.scaleLinear(zeroBased ? [Math.min(0, ext[0]), Math.max(0, ext[1])] : ext, [innerH, 0]).nice(6);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat('')).call((a) => a.select('.domain').remove());
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickSizeOuter(0)).call((a) => a.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).tickSizeOuter(0));
    g.append('text').attr('class', 'axis-title').attr('x', -margin.left + 4).attr('y', -6).text(mode === 'anomaly' ? `${measure.unit} (eltérés)` : measure.unit);
    if (mode === 'anomaly') g.append('line').attr('class', 'zero-line').attr('x1', 0).attr('x2', innerW).attr('y1', y(0)).attr('y2', y(0));

    const line = d3.line().x((p) => x(p.year)).y((p) => y(p.y));
    for (const m of members) {
      if (m.fit) {
        const [a, b] = [m.points[0].year, m.points[m.points.length - 1].year];
        g.append('line')
          .attr('class', 'trend-line')
          .attr('stroke', m.color)
          .attr('x1', x(a)).attr('y1', y(m.fit.at(a)))
          .attr('x2', x(b)).attr('y2', y(m.fit.at(b)));
      }
      g.append('path').attr('class', 'line').attr('stroke', m.color).attr('d', line(m.points));
      g.append('g')
        .selectAll('circle')
        .data(m.points)
        .join('circle')
        .attr('class', 'dot')
        .attr('fill', m.color)
        .attr('cx', (p) => x(p.year))
        .attr('cy', (p) => y(p.y))
        .attr('r', 4);
    }

    // Közvetlen feliratok a sorozatok végén (legfeljebb 4 sorozatnál)
    if (members.length <= 4) {
      const labels = members
        .map((m) => {
          const lastPoint = m.points[m.points.length - 1];
          return { m, x: x(lastPoint.year), y: y(lastPoint.y) };
        })
        .sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
      g.append('g').selectAll('text').data(labels).join('text').attr('class', 'direct-label').attr('x', (d) => d.x + 10).attr('y', (d) => d.y + 4).text((d) => d.m.name);
    }

    const cross = g.append('line').attr('class', 'crosshair').attr('y1', 0).attr('y2', innerH).style('opacity', 0);
    const tip = d3.select(tipRef.current);
    const yearAt = (event) => d3.least(years, (yr) => Math.abs(x(yr) - d3.pointer(event, g.node())[0]));
    g.append('rect')
      .attr('class', 'hover-area')
      .attr('width', innerW)
      .attr('height', innerH)
      .style('cursor', 'pointer')
      .on('pointermove', (event) => {
        const yr = yearAt(event);
        cross.attr('x1', x(yr)).attr('x2', x(yr)).style('opacity', 1);
        const lines = [`<strong>${yr}</strong>`];
        for (const m of members) {
          const p = m.points.find((q) => q.year === yr);
          if (!p) continue;
          const diff = mode === 'anomaly' ? ` <span class="muted">(${signed(p.y)} az átlaghoz képest)</span>` : '';
          lines.push(`<span class="swatch" style="background:${m.color}"></span>${m.name}: <b>${formatValue(p.value, measure)}</b>${diff}`);
        }
        showTip(tip, event, wrapRef.current, lines.join('<br>'));
      })
      .on('pointerleave', () => {
        cross.style('opacity', 0);
        tip.style('opacity', 0);
      })
      .on('click', (event) => onDrill(new Date(yearAt(event), 0, 1), 'year'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, years, width, measure, mode, onDrill, wrapRef]);

  if (!supported) return <div className="empty">A szélirányhoz nem készül trend – válassz másik paramétert.</div>;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="viz-tools">
        <div className="segmented" role="radiogroup" aria-label="Megjelenített érték">
          <button role="radio" aria-checked={mode === 'value'} className={mode === 'value' ? 'active' : ''} onClick={() => setMode('value')}>
            Érték
          </button>
          <button role="radio" aria-checked={mode === 'anomaly'} className={mode === 'anomaly' ? 'active' : ''} onClick={() => setMode('anomaly')}>
            Eltérés az átlagtól
          </button>
        </div>
        <span className="muted small">
          Szaggatott vonal: lineáris trend{skipped.length ? ` · A csonka évek (${skipped.join(', ')}) kimaradnak` : ''}
        </span>
      </div>
      {members.length > 0 && (
        <div className="legend" role="list">
          {members.map((m) => (
            <span key={m.key} role="listitem" className="legend-item static">
              <span className="swatch" style={{ background: m.color }} />
              {m.name}
              {m.fit && <span className="muted">· {signed(m.fit.slope * 10)} {measure.unit} / évtized</span>}
            </span>
          ))}
        </div>
      )}
      {cube.error && <div className="alert error">{cube.error.message}</div>}
      {cube.loading && <div className="overlay-loading">Frissítés…</div>}
      {!cube.loading && !years.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      <svg ref={svgRef} width={width} height={years.length ? height : 0} role="img" aria-label={`${measure.label} éves trendje`} />
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}
