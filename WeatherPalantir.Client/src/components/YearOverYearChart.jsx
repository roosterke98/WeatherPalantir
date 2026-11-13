import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { useWidth } from '../hooks/useSize.js';
import { isDark } from '../utils/colors.js';
import { formatValue } from '../utils/format.js';
import { parsePeriod } from '../utils/time.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

const MAX_PANELS = 6;
const MONTHS = d3.range(12);
const monthShort = (m) => d3.timeFormat('%b')(new Date(2000, m, 1));
const monthLong = (m) => d3.timeFormat('%B')(new Date(2000, m, 1));

/** Összegzett mennyiségnél (pl. csapadék) a csonka hónap összege félrevezető, ezért kimarad. */
const isComplete = (row, period) => {
  const expected = d3.timeDay.count(period, d3.timeMonth.offset(period, 1)) * 24;
  return row.hourCount / Math.max(1, row.locationCount) >= expected * 0.9;
};

/**
 * Éves összehasonlítás: a hónapok a vízszintes tengelyen, évenként egy vonal, így az évszakos menet
 * és az évek közötti eltérés egyszerre látszik. A teljes betöltött időszakot mutatja (az időszak-szűrőtől
 * függetlenül), tagonként (helyszín / régió / ország) külön panelen, közös értéktengellyel.
 * A jelmagyarázatban egy évre kattintva csak a kijelölt évek maradnak; az „Összes év” visszaállítja a nézetet.
 */
export default function YearOverYearChart({ params, measure, range, order, onDrill }) {
  const theme = useTheme();
  const [hoverYear, setHoverYear] = useState(null);
  const [picked, setPicked] = useState([]);
  const supported = measure.key !== 'windDirection';
  const history = { ...params, from: range.min?.slice(0, 10), to: range.max?.slice(0, 10), grain: 'month', measures: [measure.key] };
  const historyKey = JSON.stringify(history);
  const cube = useFetch((signal) => api.cube(history, signal), [historyKey], { enabled: supported && !!range.min });

  const model = useMemo(() => {
    const rows = (cube.data?.rows ?? [])
      .map((r) => ({ ...r, date: parsePeriod(r.period), value: r.values[measure.key] }))
      .filter((r) => r.period && r.value != null && (measure.aggregation !== 'sum' || isComplete(r, r.date)));
    const years = [...new Set(rows.map((r) => r.date.getFullYear()))].sort((a, b) => a - b);
    const groups = d3.group(rows, (r) => r.memberKey);
    const all = [...groups.entries()]
      .map(([key, rs]) => ({
        key,
        name: rs[0].memberName,
        byYear: d3.rollup(rs, (v) => v[0].value, (r) => r.date.getFullYear(), (r) => r.date.getMonth()),
        mean: d3.rollup(rs, (v) => d3.mean(v, (r) => r.value), (r) => r.date.getMonth()),
      }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

    // Az évek rendezett sorozat, ezért időrendben végigfutó, de jól elkülönülő színárnyalatokat kapnak
    // (kéktől a zöldön és sárgán át a vörösig); a világos felületen a halvány árnyalatok sötétebbek.
    const last = years[years.length - 1];
    const scale = d3.scaleLinear([years[0], Math.max(years[0] + 1, last)], [0.06, 0.94]);
    const yearColor = (yr) => {
      const c = d3.hsl(d3.interpolateTurbo(scale(yr)));
      if (!isDark() && c.l > 0.42) c.l = 0.42;
      if (isDark() && c.l < 0.55) c.l = 0.55;
      return c.formatHex();
    };
    return { panels: all.slice(0, MAX_PANELS), hidden: Math.max(0, all.length - MAX_PANELS), years, last, yearColor, extent: d3.extent(rows, (r) => r.value) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a színek témafüggők
  }, [cube.data, measure, order, theme]);

  if (!supported) return <div className="empty">A szélirányhoz nem készül éves összehasonlítás – válassz másik paramétert.</div>;

  const { panels, years, yearColor, extent, hidden } = model;
  const shownYears = picked.length ? years.filter((yr) => picked.includes(yr)) : years;
  const last = shownYears[shownYears.length - 1];
  const togglePicked = (yr) => setPicked((p) => (p.includes(yr) ? p.filter((x) => x !== yr) : [...p, yr]));

  return (
    <div className="chart-wrap">
      {cube.error && <div className="alert error">{cube.error.message}</div>}
      {cube.loading && <div className="overlay-loading">Frissítés…</div>}
      {!cube.loading && !panels.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      {panels.length > 0 && (
        <>
          <div className="legend" role="list" onPointerLeave={() => setHoverYear(null)}>
            {years.map((yr) => (
              <button
                key={yr}
                role="listitem"
                aria-pressed={picked.includes(yr)}
                className={`legend-item year${picked.includes(yr) ? ' picked' : ''}${(picked.length && !picked.includes(yr)) || (hoverYear != null && hoverYear !== yr) ? ' dim' : ''}`}
                title={picked.includes(yr) ? 'Kivétel a kijelölésből' : 'Csak a kijelölt évek megjelenítése'}
                onPointerEnter={() => setHoverYear(yr)}
                onFocus={() => setHoverYear(yr)}
                onBlur={() => setHoverYear(null)}
                onClick={() => togglePicked(yr)}
              >
                <span className="swatch" style={{ background: yearColor(yr) }} />
                {yr}
              </button>
            ))}
            <span role="listitem" className="legend-item static">
              <span className="swatch dashed" />
              többéves átlag
            </span>
            {picked.length > 0 && (
              <button className="btn small" onClick={() => setPicked([])}>
                ← Összes év
              </button>
            )}
          </div>
          <div className="facets">
            {panels.map((p) => (
              <YearPanel key={p.key} panel={p} years={shownYears} last={last} yearColor={yearColor} extent={extent} measure={measure} hoverYear={hoverYear} showTitle={panels.length > 1} onDrill={onDrill} />
            ))}
          </div>
          {measure.aggregation === 'sum' && <p className="muted small">A csonka (részben betöltött) hónapok összegei nem szerepelnek.</p>}
          {hidden > 0 && <p className="muted small">További {hidden} tag nem fért ki – szűkítsd a földrajzi szeletet.</p>}
        </>
      )}
    </div>
  );
}

function YearPanel({ panel, years, last, yearColor, extent, measure, hoverYear, showTitle, onDrill }) {
  const [wrapRef, width] = useWidth(480);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const height = 240;
  const margin = { top: 10, right: 40, bottom: 24, left: 44 };

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const x = d3.scalePoint(MONTHS, [0, innerW]).padding(0.4);
    const zeroBased = measure.chart !== 'line';
    const y = d3.scaleLinear(zeroBased ? [Math.min(0, extent[0]), Math.max(extent[1], 0.1)] : extent, [innerH, 0]).nice(5);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat('')).call((a) => a.select('.domain').remove());
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickSizeOuter(0)).call((a) => a.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).tickFormat(monthShort).tickSizeOuter(0));
    g.append('text').attr('class', 'axis-title').attr('x', -margin.left + 4).attr('y', -2).text(measure.unit);

    const line = d3.line().defined((d) => d[1] != null).x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX);
    // A kiemelt (vagy a legutóbbi) év kerül felülre.
    const hovering = hoverYear != null && years.includes(hoverYear);
    const top = hovering ? hoverYear : last;
    for (const yr of [...years].sort((a, b) => (a === top) - (b === top))) {
      const vals = panel.byYear.get(yr);
      if (!vals) continue;
      const pts = MONTHS.map((m) => [m, vals.get(m) ?? null]);
      const emphasized = yr === top;
      const faded = hovering && yr !== top;
      const series = g.append('g').attr('opacity', faded ? 0.18 : 1);
      series.append('path').attr('class', 'line').attr('stroke', yearColor(yr)).attr('stroke-width', emphasized ? 2.5 : 1.5).attr('d', line(pts));
      // Egyetlen hónapnyi (szakadozott) adat vonal nélkül is látszódjon.
      series
        .selectAll('circle')
        .data(pts.filter((d, i) => d[1] != null && (emphasized || (pts[i - 1]?.[1] == null && pts[i + 1]?.[1] == null))))
        .join('circle')
        .attr('class', 'dot')
        .attr('fill', yearColor(yr))
        .attr('cx', (d) => x(d[0]))
        .attr('cy', (d) => y(d[1]))
        .attr('r', emphasized ? 4 : 3);
      if (emphasized) {
        const end = [...pts].reverse().find((d) => d[1] != null);
        if (end) g.append('text').attr('class', 'direct-label').attr('x', x(end[0]) + 8).attr('y', y(end[1]) + 4).text(yr);
      }
    }
    g.append('path').attr('class', 'mean-line').attr('d', line(MONTHS.map((m) => [m, panel.mean.get(m) ?? null])));

    const cross = g.append('line').attr('class', 'crosshair').attr('y1', 0).attr('y2', innerH).style('opacity', 0);
    const tip = d3.select(tipRef.current);
    const monthAt = (event) => d3.least(MONTHS, (m) => Math.abs(x(m) - d3.pointer(event, g.node())[0]));
    g.append('rect')
      .attr('class', 'hover-area')
      .attr('width', innerW)
      .attr('height', innerH)
      .style('cursor', 'pointer')
      .on('pointermove', (event) => {
        const m = monthAt(event);
        cross.attr('x1', x(m)).attr('x2', x(m)).style('opacity', 1);
        const lines = [`<strong>${panel.name} · ${monthLong(m)}</strong>`];
        for (const yr of [...years].reverse()) {
          const v = panel.byYear.get(yr)?.get(m);
          if (v != null) lines.push(`<span class="swatch" style="background:${yearColor(yr)}"></span>${yr}: <b>${formatValue(v, measure)}</b>`);
        }
        lines.push(`<span class="muted">Többéves átlag: ${formatValue(panel.mean.get(m), measure)}</span>`);
        showTip(tip, event, wrapRef.current, lines.join('<br>'));
      })
      .on('pointerleave', () => {
        cross.style('opacity', 0);
        tip.style('opacity', 0);
      })
      .on('click', (event) => {
        // Kattintás: lefúrás a kiemelt (alapból a legutóbbi) év adott hónapjába.
        const m = monthAt(event);
        const yr = [top, ...[...years].reverse()].find((c) => panel.byYear.get(c)?.get(m) != null);
        if (yr != null) onDrill(new Date(yr, m, 1), 'month');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, years, last, yearColor, extent, measure, hoverYear, width, onDrill, wrapRef]);

  return (
    <figure className="facet" ref={wrapRef}>
      {showTitle && <figcaption>{panel.name}</figcaption>}
      <svg ref={svgRef} width={width} height={height} role="img" aria-label={`${measure.label} évenként, havi bontásban – ${panel.name}`} />
      <div ref={tipRef} className="tooltip" />
    </figure>
  );
}
