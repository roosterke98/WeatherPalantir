import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { SPEED_BANDS, speedBandColors } from '../utils/colors.js';
import { SECTOR_LABELS } from '../utils/format.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/** Szélrózsa: 16 égtáj szerinti gyakoriság, sebességsávonként halmozva (a kijelölt szelet összes órája). */
export default function WindRose({ data, loading }) {
  const theme = useTheme();
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const wrapRef = useRef(null);
  const size = 360;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!data?.length) return;

    const colors = speedBandColors();
    const total = d3.sum(data, (d) => d.hours);
    const sectors = d3.range(16).map((s) => {
      const bands = d3.range(5).map((b) => data.find((d) => d.sector === s && d.speedBand === b)?.hours ?? 0);
      return { s, bands, total: d3.sum(bands) };
    });
    const outer = size / 2 - 34;
    const inner = 18;
    const r = d3.scaleSqrt([0, d3.max(sectors, (d) => d.total) || 1], [inner, outer]);
    const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);

    // Recesszív kör-rács
    const ticks = r.ticks(4).filter((t) => t > 0);
    g.append('g').selectAll('circle').data(ticks).join('circle').attr('class', 'polar-grid').attr('r', r);
    g.append('g').selectAll('text').data(ticks).join('text').attr('class', 'polar-tick').attr('y', (t) => -r(t) - 2)
      .text((t) => `${d3.format('.0%')(t / total)}`);

    const step = (2 * Math.PI) / 16;
    const arc = d3.arc().padAngle(0.03).cornerRadius(2);
    sectors.forEach((sec) => {
      let acc = 0;
      sec.bands.forEach((h, b) => {
        if (!h) return;
        const a0 = sec.s * step - step / 2;
        g.append('path')
          .attr('class', 'rose-seg')
          .attr('fill', colors[b])
          .attr('d', arc({ innerRadius: r(acc), outerRadius: r(acc + h), startAngle: a0, endAngle: a0 + step }))
          .on('pointermove', (event) =>
            showTip(d3.select(tipRef.current), event, wrapRef.current,
              `<strong>${SECTOR_LABELS[sec.s]}</strong> felől<br>${SPEED_BANDS[b]} km/h: <b>${h} óra</b> (${d3.format('.1%')(h / total)})<br><span class="muted">Irány összesen: ${d3.format('.1%')(sec.total / total)}</span>`),
          )
          .on('pointerleave', () => d3.select(tipRef.current).style('opacity', 0));
        acc += h;
      });
    });

    g.append('g').selectAll('text').data(['É', 'K', 'D', 'Ny']).join('text').attr('class', 'compass-label')
      .attr('x', (_, i) => Math.sin(i * Math.PI / 2) * (outer + 18))
      .attr('y', (_, i) => -Math.cos(i * Math.PI / 2) * (outer + 18) + 4)
      .text((d) => d);
  }, [data, theme]);

  return (
    <div className="windrose" ref={wrapRef}>
      <h3>Szélrózsa (gyakoriság irány és sebesség szerint)</h3>
      {loading && <div className="overlay-loading">Frissítés…</div>}
      {!loading && !data?.length && <div className="empty">Nincs szélirány adat.</div>}
      <svg ref={svgRef} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Szélrózsa" />
      <div className="legend">
        {SPEED_BANDS.map((b, i) => (
          <span key={b} className="legend-item static">
            <span className="swatch" style={{ background: speedBandColors()[i] }} />
            {b} km/h
          </span>
        ))}
      </div>
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}
