import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useWidth } from '../hooks/useSize.js';
import { memberColor } from '../utils/colors.js';
import { formatValue } from '../utils/format.js';
import { axisTimeFormat, formatPeriod, grainInterval, parsePeriod } from '../utils/time.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

const roundedTopBar = (x, y, w, h, r) => {
  r = Math.min(r, w / 2, Math.abs(h));
  if (h <= 0 || w <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

/**
 * Idősoros grafikon a paraméter típusához illő megjelenéssel (vonal / terület / oszlop).
 * Egy tengely, tagonként (helyszín / régió / ország) egy sorozat, entitáshoz kötött színekkel.
 * Interakciók: hover – szálkereszt és tooltip; kattintás – időbeli lefúrás; húzás – időszak kijelölése.
 */
export default function TimeSeriesChart({ cube, loading, measure, grain, order, currentPeriod, forecastStart, onDrill, onBrush, onMemberClick, onPeriodSelect }) {
  const theme = useTheme();
  const [wrapRef, width] = useWidth(900);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const height = 320;
  const margin = { top: 16, right: 110, bottom: 30, left: 52 };

  const { members, periods, byMember } = useMemo(() => {
    const rows = (cube?.rows ?? []).filter((r) => r.period);
    const map = d3.group(rows, (r) => r.memberKey);
    const list = [...map.entries()]
      .map(([key, rs]) => ({ key, name: rs[0].memberName, color: memberColor(key, order) }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const lookup = new Map(list.map((m) => [m.key, new Map(map.get(m.key).map((r) => [+parsePeriod(r.period), r.values[measure.key]]))]));
    return { members: list, periods: (cube?.periods ?? []).map(parsePeriod), byMember: lookup };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a téma a memberColor() eredményét változtatja
  }, [cube, order, measure.key, theme]);

  // Az ábrán használt grain a ténylegesen betöltött adaté (a válasz megérkezéséig a régit mutatjuk).
  const dataGrain = cube?.grain ?? grain;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!periods.length) return;

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const interval = grainInterval(dataGrain);
    const start = periods[0];
    const end = interval.offset(periods[periods.length - 1], 1);
    const x = d3.scaleTime([start, end], [0, innerW]);
    const mid = (p) => (x(p) + x(interval.offset(p, 1))) / 2;

    const allValues = members.flatMap((m) => [...byMember.get(m.key).values()]).filter((v) => v != null);
    const isBar = measure.chart === 'bar';
    const ext = d3.extent(allValues);
    const yDomain = isBar || measure.chart === 'area' ? [Math.min(0, ext[0] ?? 0), Math.max(ext[1] ?? 1, 0.1)] : [ext[0] ?? 0, ext[1] ?? 1];
    const y = d3.scaleLinear(yDomain, [innerH, 0]).nice();

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Előrejelzési zóna
    if (forecastStart && forecastStart < end) {
      const fx = Math.max(0, x(forecastStart));
      g.append('rect').attr('class', 'forecast-zone').attr('x', fx).attr('y', 0).attr('width', innerW - fx).attr('height', innerH);
      g.append('text').attr('class', 'zone-label').attr('x', fx + 6).attr('y', 12).text('Előrejelzés');
    }

    // Rács és tengelyek (recesszív)
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat(''))
      .call((a) => a.select('.domain').remove());
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickSizeOuter(0))
      .call((a) => a.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(Math.max(2, innerW / 90)).tickFormat(axisTimeFormat).tickSizeOuter(0));
    g.append('text').attr('class', 'axis-title').attr('x', -margin.left + 4).attr('y', -4).text(measure.unit);

    const series = g.append('g');
    if (isBar) {
      const slot = (p) => x(interval.offset(p, 1)) - x(p);
      const n = members.length;
      members.forEach((m, i) => {
        const vals = byMember.get(m.key);
        series
          .append('g')
          .selectAll('path')
          .data(periods.filter((p) => vals.get(+p) != null))
          .join('path')
          .attr('class', 'bar')
          .attr('fill', m.color)
          .attr('d', (p) => {
            const s = slot(p);
            const gap = s > 6 ? 2 : 0;
            const bw = Math.max(1, (s - gap) / n - (n > 1 && s / n > 4 ? 2 : 0));
            const bx = x(p) + gap / 2 + i * ((s - gap) / n);
            const v = vals.get(+p);
            return roundedTopBar(bx, y(Math.max(0, v)), bw, Math.abs(y(v) - y(0)), 4);
          });
      });
    } else {
      // A teljes periódus-sorozaton haladunk, így a hiányzó periódusoknál (pl. be nem töltött napok) a vonal megszakad.
      const fullRange = interval.range(start, end);
      members.forEach((m) => {
        const vals = byMember.get(m.key);
        const pts = fullRange.map((p) => [p, vals.get(+p) ?? null]);
        if (measure.chart === 'area') {
          series
            .append('path')
            .attr('class', 'area')
            .attr('fill', m.color)
            .attr('fill-opacity', members.length > 1 ? 0.08 : 0.16)
            .attr('d', d3.area().defined((d) => d[1] != null).x((d) => mid(d[0])).y0(y(Math.max(0, y.domain()[0]))).y1((d) => y(d[1])).curve(d3.curveMonotoneX)(pts));
        }
        series
          .append('path')
          .attr('class', 'line')
          .attr('stroke', m.color)
          .attr('d', d3.line().defined((d) => d[1] != null).x((d) => mid(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX)(pts));
        if (periods.length <= 45) {
          series
            .append('g')
            .selectAll('circle')
            .data(pts.filter((d) => d[1] != null))
            .join('circle')
            .attr('class', 'dot')
            .attr('fill', m.color)
            .attr('cx', (d) => mid(d[0]))
            .attr('cy', (d) => y(d[1]))
            .attr('r', 4);
        }
      });

      // Közvetlen feliratok a sorozatok végén (legfeljebb 4 sorozatnál)
      if (members.length <= 4) {
        const labels = members
          .map((m) => {
            const last = [...periods].reverse().find((p) => byMember.get(m.key).get(+p) != null);
            return last ? { m, x: mid(last), y: y(byMember.get(m.key).get(+last)) } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.y - b.y);
        for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
        g.append('g')
          .selectAll('text')
          .data(labels)
          .join('text')
          .attr('class', 'direct-label')
          .attr('x', innerW + 8)
          .attr('y', (d) => d.y + 4)
          .text((d) => d.m.name);
      }
    }

    // Aktuális periódus (csúszka) jelölése
    if (currentPeriod) {
      const cx = mid(currentPeriod);
      g.append('line').attr('class', 'current-marker').attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', innerH);
    }

    // Szálkereszt + tooltip + brush
    const cross = g.append('line').attr('class', 'crosshair').attr('y1', 0).attr('y2', innerH).style('opacity', 0);
    const tip = d3.select(tipRef.current);
    const periodAt = (px) => {
      const t = interval.floor(x.invert(px));
      return periods.find((p) => +p === +t) ?? d3.least(periods, (p) => Math.abs(x(p) - px));
    };

    const brush = d3
      .brushX()
      .extent([[0, 0], [innerW, innerH]])
      .on('end', (event) => {
        if (!event.sourceEvent) return;
        if (event.selection && event.selection[1] - event.selection[0] > 6) {
          const [a, b] = event.selection.map(x.invert);
          g.select('.brush').call(brush.move, null);
          onBrush(interval.floor(a), d3.timeDay.offset(interval.ceil(b), -1));
          return;
        }
        const [px] = d3.pointer(event.sourceEvent, g.node());
        const p = periodAt(px);
        if (!p) return;
        if (dataGrain === 'hour') onPeriodSelect(p);
        else onDrill(p);
      });

    g.append('g')
      .attr('class', 'brush')
      .call(brush)
      .on('pointermove', (event) => {
        const [px] = d3.pointer(event, g.node());
        const p = periodAt(px);
        if (!p) return;
        cross.attr('x1', mid(p)).attr('x2', mid(p)).style('opacity', 1);
        const lines = [`<strong>${formatPeriod(p, dataGrain)}</strong>`];
        for (const m of members) {
          lines.push(`<span class="swatch" style="background:${m.color}"></span>${m.name}: <b>${formatValue(byMember.get(m.key).get(+p), measure)}</b>`);
        }
        showTip(tip, event, wrapRef.current, lines.join('<br>'));
      })
      .on('pointerleave', () => {
        cross.style('opacity', 0);
        tip.style('opacity', 0);
      });
  }, [members, periods, byMember, width, measure, dataGrain, currentPeriod, forecastStart, onBrush, onDrill, onPeriodSelect, wrapRef]);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {members.length > 1 && (
        <div className="legend" role="list">
          {members.map((m) => (
            <button key={m.key} role="listitem" className="legend-item" onClick={() => onMemberClick(m)} title="Lefúrás erre a tagra">
              <span className="swatch" style={{ background: m.color }} />
              {m.name}
            </button>
          ))}
        </div>
      )}
      {loading && <div className="overlay-loading">Frissítés…</div>}
      {!loading && !periods.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      <svg ref={svgRef} width={width} height={height} role="img" aria-label={`${measure.label} idősor`} />
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}
