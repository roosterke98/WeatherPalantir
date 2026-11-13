import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { useWidth } from '../hooks/useSize.js';
import { memberColor } from '../utils/colors.js';
import { formatValue } from '../utils/format.js';
import { axisTimeFormat, formatPeriod, grainInterval, parsePeriod } from '../utils/time.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/** Egyszerre ennyi paraméter hasonlítható össze. */
export const MAX_COMPARE = 4;

const PANEL_H = 112;
const TITLE_H = 20;
const GAP = 10;

/**
 * Több paraméter egyszerre, közös időtengelyen: paraméterenként egy panel saját értéktengellyel
 * (nincs kettős tengely), tagonként (helyszín / régió / ország) egy sorozat. A részletesség az elemzés
 * aktuális időbeli szintjét követi. Hover: közös szálkereszt; kattintás: időbeli lefúrás.
 */
export default function MultiMeasureChart({ params, paramsKey, measures, selected, onSelectedChange, order, forecastStart, onDrill }) {
  const theme = useTheme();
  const [wrapRef, width] = useWidth(900);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const margin = { top: 4, right: 16, bottom: 26, left: 52 };

  const options = measures.filter((m) => m.key !== 'windDirection');
  const defs = selected.map((k) => options.find((m) => m.key === k)).filter(Boolean);
  const selectedKey = defs.map((m) => m.key).join();

  const cube = useFetch(
    (signal) => (defs.length ? api.cube({ ...params, measures: defs.map((m) => m.key) }, signal) : Promise.resolve(null)),
    [paramsKey, selectedKey],
  );

  const { members, periods, lookup } = useMemo(() => {
    const rows = (cube.data?.rows ?? []).filter((r) => r.period);
    const groups = d3.group(rows, (r) => r.memberKey);
    const list = [...groups.entries()]
      .map(([key, rs]) => ({ key, name: rs[0].memberName, color: memberColor(key, order) }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const map = new Map(list.map((m) => [m.key, new Map(groups.get(m.key).map((r) => [+parsePeriod(r.period), r.values]))]));
    return { members: list, periods: (cube.data?.periods ?? []).map(parsePeriod), lookup: map };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a téma a memberColor() eredményét változtatja
  }, [cube.data, order, theme]);

  const dataGrain = cube.data?.grain ?? params.grain;
  const drawn = (cube.data?.measures ?? []).map((k) => options.find((m) => m.key === k)).filter(Boolean);
  const height = margin.top + drawn.length * (TITLE_H + PANEL_H + GAP) + margin.bottom;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!periods.length || !drawn.length) return;

    const innerW = width - margin.left - margin.right;
    const interval = grainInterval(dataGrain);
    const start = periods[0];
    const end = interval.offset(periods[periods.length - 1], 1);
    const x = d3.scaleTime([start, end], [0, innerW]);
    const mid = (p) => (x(p) + x(interval.offset(p, 1))) / 2;
    const fullRange = interval.range(start, end);
    const value = (m, p, def) => lookup.get(m.key).get(+p)?.[def.key] ?? null;

    const root = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const plotH = drawn.length * (TITLE_H + PANEL_H + GAP) - GAP;

    drawn.forEach((def, i) => {
      const top = i * (TITLE_H + PANEL_H + GAP) + TITLE_H;
      const g = root.append('g').attr('transform', `translate(0,${top})`);
      const values = members.flatMap((m) => periods.map((p) => value(m, p, def))).filter((v) => v != null);
      const ext = d3.extent(values);
      const zeroBased = def.chart !== 'line';
      const y = d3
        .scaleLinear(zeroBased ? [Math.min(0, ext[0] ?? 0), Math.max(ext[1] ?? 1, 0.1)] : [ext[0] ?? 0, ext[1] ?? 1], [PANEL_H, 0])
        .nice(4);

      g.append('text').attr('class', 'panel-title').attr('x', 0).attr('y', -7).text(`${def.label} (${def.unit})`);
      if (forecastStart && forecastStart < end) {
        const fx = Math.max(0, x(forecastStart));
        g.append('rect').attr('class', 'forecast-zone').attr('x', fx).attr('y', 0).attr('width', innerW - fx).attr('height', PANEL_H);
      }
      g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat('')).call((a) => a.select('.domain').remove());
      g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4).tickSizeOuter(0)).call((a) => a.select('.domain').remove());
      const last = i === drawn.length - 1;
      g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0,${PANEL_H})`)
        .call(d3.axisBottom(x).ticks(Math.max(2, innerW / 90)).tickFormat(last ? axisTimeFormat : '').tickSizeOuter(0));

      if (def.chart === 'bar') {
        const n = members.length;
        members.forEach((m, mi) => {
          g.append('g')
            .selectAll('rect')
            .data(periods.filter((p) => value(m, p, def) != null))
            .join('rect')
            .attr('class', 'bar')
            .attr('fill', m.color)
            .attr('x', (p) => {
              const slot = x(interval.offset(p, 1)) - x(p);
              const gap = slot > 6 ? 2 : 0;
              return x(p) + gap / 2 + mi * ((slot - gap) / n);
            })
            .attr('width', (p) => {
              const slot = x(interval.offset(p, 1)) - x(p);
              const gap = slot > 6 ? 2 : 0;
              return Math.max(1, (slot - gap) / n - (n > 1 && slot / n > 4 ? 1 : 0));
            })
            .attr('y', (p) => y(Math.max(0, value(m, p, def))))
            .attr('height', (p) => Math.abs(y(value(m, p, def)) - y(0)));
        });
      } else {
        members.forEach((m) => {
          const pts = fullRange.map((p) => [p, value(m, p, def)]);
          g.append('path')
            .attr('class', 'line')
            .attr('stroke', m.color)
            .attr('d', d3.line().defined((d) => d[1] != null).x((d) => mid(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX)(pts));
        });
      }
    });

    // Közös szálkereszt és tooltip az összes panelre
    const cross = root.append('line').attr('class', 'crosshair').attr('y1', 0).attr('y2', plotH).style('opacity', 0);
    const tip = d3.select(tipRef.current);
    const periodAt = (px) => {
      const t = interval.floor(x.invert(px));
      return periods.find((p) => +p === +t) ?? d3.least(periods, (p) => Math.abs(x(p) - px));
    };

    root
      .append('rect')
      .attr('class', 'hover-area')
      .attr('width', innerW)
      .attr('height', plotH)
      .style('cursor', dataGrain === 'hour' ? 'default' : 'pointer')
      .on('pointermove', (event) => {
        const p = periodAt(d3.pointer(event, root.node())[0]);
        if (!p) return;
        cross.attr('x1', mid(p)).attr('x2', mid(p)).style('opacity', 1);
        const head = drawn.map((d) => `<th>${d.label}</th>`).join('');
        const body = members
          .map(
            (m) =>
              `<tr><td><span class="swatch" style="background:${m.color}"></span>${m.name}</td>${drawn
                .map((d) => `<td class="num"><b>${formatValue(value(m, p, d), d)}</b></td>`)
                .join('')}</tr>`,
          )
          .join('');
        showTip(tip, event, wrapRef.current, `<strong>${formatPeriod(p, dataGrain)}</strong><table class="tip-table"><tr><th></th>${head}</tr>${body}</table>`);
      })
      .on('pointerleave', () => {
        cross.style('opacity', 0);
        tip.style('opacity', 0);
      })
      .on('click', (event) => {
        const p = periodAt(d3.pointer(event, root.node())[0]);
        if (p && dataGrain !== 'hour') onDrill(p);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, periods, lookup, width, dataGrain, forecastStart, onDrill, wrapRef, cube.data]);

  const addable = options.filter((m) => !selected.includes(m.key));

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="viz-tools">
        <div className="chips">
          {defs.map((m) => (
            <span key={m.key} className="chip">
              {m.label}
              <button aria-label={`${m.label} eltávolítása`} onClick={() => onSelectedChange(selected.filter((k) => k !== m.key))}>×</button>
            </span>
          ))}
        </div>
        <select
          value=""
          disabled={defs.length >= MAX_COMPARE}
          aria-label="Paraméter hozzáadása"
          title={defs.length >= MAX_COMPARE ? `Legfeljebb ${MAX_COMPARE} paraméter hasonlítható össze` : undefined}
          onChange={(e) => e.target.value && onSelectedChange([...selected, e.target.value])}
        >
          <option value="">+ Paraméter hozzáadása{defs.length >= MAX_COMPARE ? ` (legfeljebb ${MAX_COMPARE})` : ''}</option>
          {addable.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({m.unit})
            </option>
          ))}
        </select>
      </div>

      {members.length > 1 && (
        <div className="legend" role="list">
          {members.map((m) => (
            <span key={m.key} role="listitem" className="legend-item static">
              <span className="swatch" style={{ background: m.color }} />
              {m.name}
            </span>
          ))}
        </div>
      )}
      {cube.error && <div className="alert error">{cube.error.message}</div>}
      {cube.loading && <div className="overlay-loading">Frissítés…</div>}
      {!defs.length && <div className="empty">Válassz legalább egy paramétert.</div>}
      {!cube.loading && defs.length > 0 && !periods.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      <svg ref={svgRef} width={width} height={periods.length && drawn.length ? height : 0} role="img" aria-label="Paraméterek összehasonlítása közös időtengelyen" />
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}
