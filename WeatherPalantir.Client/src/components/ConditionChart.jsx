import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useWidth } from '../hooks/useSize.js';
import { categorical } from '../utils/colors.js';
import { conditionLabel, SEVERITY_HU } from '../utils/wmo.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/**
 * Az időjárási viszonyok (WMO kód) gyakorisága vízszintes oszlopokkal. Egy oszlopra kattintva
 * az adott viszony szűrőként (kockázás) kerül alkalmazásra a többi komponensre.
 */
export default function ConditionChart({ data, loading, selected, onToggle }) {
  const theme = useTheme();
  const [wrapRef, width] = useWidth(360);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const rows = (data ?? []).slice(0, 10);
  const barH = 22;
  const height = rows.length * (barH + 6) + 8;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!rows.length) return;
    const labelW = Math.min(170, width * 0.45);
    const total = d3.sum(data, (d) => d.hours);
    const x = d3.scaleLinear([0, d3.max(rows, (d) => d.hours)], [0, width - labelW - 56]);
    const color = categorical()[0];

    const row = svg
      .selectAll('g')
      .data(rows)
      .join('g')
      .attr('class', (d) => (selected.length && !selected.includes(d.weatherConditionKey) ? 'cond-row dim' : 'cond-row'))
      .attr('transform', (_, i) => `translate(0,${i * (barH + 6) + 4})`)
      .style('cursor', (d) => (d.weatherConditionKey == null ? 'default' : 'pointer'))
      .on('click', (_, d) => d.weatherConditionKey != null && onToggle(d.weatherConditionKey))
      .on('pointermove', (event, d) =>
        showTip(d3.select(tipRef.current), event, wrapRef.current,
          `<strong>${conditionLabel(d.weatherConditionKey, d.description)}</strong><br>${d.hours} óra (${d3.format('.1%')(d.hours / total)})<br><span class="muted">Súlyosság: ${SEVERITY_HU[d.severity] ?? '–'}</span>`),
      )
      .on('pointerleave', () => d3.select(tipRef.current).style('opacity', 0));

    row.append('rect').attr('class', 'hit').attr('width', width).attr('height', barH);
    row.append('text').attr('class', 'cond-label').attr('x', labelW - 8).attr('y', barH / 2 + 4).attr('text-anchor', 'end')
      .text((d) => conditionLabel(d.weatherConditionKey, d.description));
    row.append('path').attr('fill', color).attr('d', (d) => {
      const w = Math.max(2, x(d.hours));
      const r = Math.min(4, w / 2);
      return `M${labelW},3H${labelW + w - r}Q${labelW + w},3 ${labelW + w},${3 + r}V${barH - 3 - r}Q${labelW + w},${barH - 3} ${labelW + w - r},${barH - 3}H${labelW}Z`;
    });
    row.append('text').attr('class', 'cond-value').attr('x', (d) => labelW + Math.max(2, x(d.hours)) + 6).attr('y', barH / 2 + 4)
      .text((d) => d3.format('.0%')(d.hours / total));
  }, [data, rows, width, selected, onToggle, wrapRef, theme]);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {loading && <div className="overlay-loading">Frissítés…</div>}
      {!loading && !rows.length && <div className="empty">Nincs adat.</div>}
      <svg ref={svgRef} width={width} height={height} role="img" aria-label="Időjárási viszonyok gyakorisága" />
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}
