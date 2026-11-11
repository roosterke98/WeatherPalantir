import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useDebounced, useFetch } from '../hooks/useFetch.js';
import { useWidth } from '../hooks/useSize.js';
import { categorical } from '../utils/colors.js';
import { formatDateTime } from '../utils/format.js';
import { axisTimeFormat, parsePeriod } from '../utils/time.js';
import { showTip } from '../components/ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/** Az ETL (SSIS) folyamat során a meta.ErrorLog táblába írt hibák naplója szűréssel és napi idővonallal. */
export default function ErrorLogView({ active }) {
  const [filters, setFilters] = useState({ from: '', to: '', package: '', search: '' });
  const search = useDebounced(filters.search, 300);
  const [expanded, setExpanded] = useState(() => new Set());
  const packages = useFetch((signal) => api.errorPackages(signal), [active]);
  const log = useFetch(
    (signal) => api.errorLog({ from: filters.from, to: filters.to, package: filters.package, search, top: 1000 }, signal),
    [filters.from, filters.to, filters.package, search, active],
    { enabled: active },
  );
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const rows = log.data ?? [];

  const toggle = (id) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="errorlog">
      <div className="filter-bar card">
        <label className="field"><span>Kezdő dátum</span><input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>Záró dátum</span><input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="field">
          <span>Csomag (SSIS package)</span>
          <select value={filters.package} onChange={(e) => set({ package: e.target.value })}>
            <option value="">Összes</option>
            {(packages.data ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="field grow"><span>Keresés</span><input type="search" placeholder="Komponens vagy hibaüzenet…" value={filters.search} onChange={(e) => set({ search: e.target.value })} /></label>
        <button className="btn" onClick={log.reload}>Frissítés</button>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Hibák naponta</h2>
          <span className="muted small">{rows.length} bejegyzés</span>
        </div>
        <ErrorTimeline rows={rows} />
      </section>

      <section className="card">
        <div className="card-head"><h2>Hibanapló (meta.ErrorLog)</h2>{log.loading && <span className="muted small">Betöltés…</span>}</div>
        {log.error && <div className="alert error">{log.error.message}</div>}
        <div className="table-scroll">
          <table className="data-table log-table">
            <thead>
              <tr><th>#</th><th>Időpont</th><th>Csomag</th><th>Komponens</th><th>Hibaüzenet</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = expanded.has(r.logId);
                return (
                  <tr key={r.logId} className={open ? 'open' : ''} onClick={() => toggle(r.logId)}>
                    <td>{r.logId}</td>
                    <td className="nowrap">{r.executionDate ? formatDateTime(parsePeriod(r.executionDate)) : '–'}</td>
                    <td><span className="badge neutral">{r.packageName ?? '–'}</span></td>
                    <td>{r.componentName ?? '–'}</td>
                    <td className={open ? 'msg wrap' : 'msg clamp'} title={open ? undefined : 'Kattintson a teljes üzenethez'}>{r.errorMessage}</td>
                  </tr>
                );
              })}
              {!log.loading && !rows.length && <tr><td colSpan={5} className="empty">Nincs a szűrésnek megfelelő hiba.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ErrorTimeline({ rows }) {
  const theme = useTheme();
  const [ref, width] = useWidth(800);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const height = 150;

  const days = useMemo(() => {
    const valid = rows.filter((r) => r.executionDate);
    return d3.rollups(valid, (v) => v.length, (r) => +d3.timeDay.floor(parsePeriod(r.executionDate))).map(([d, n]) => ({ day: new Date(d), n }));
  }, [rows]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!days.length) return;
    const m = { top: 10, right: 16, bottom: 26, left: 36 };
    const [d0, d1] = d3.extent(days, (d) => d.day);
    const x = d3.scaleTime([d3.timeDay.offset(d0, -1), d3.timeDay.offset(d1, 2)], [m.left, width - m.right]);
    const y = d3.scaleLinear([0, d3.max(days, (d) => d.n)], [height - m.bottom, m.top]).nice();
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(width - m.left - m.right)).tickFormat('')).call((a) => a.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4, 'd')).call((a) => a.select('.domain').remove());
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.bottom})`)      // Napi bontású ábra: a tengelyen csak egész napok szerepeljenek.
      .call(d3.axisBottom(x).ticks(d3.timeDay.every(Math.max(1, Math.ceil(d3.timeDay.count(...x.domain()) / (width / 90))))).tickFormat(axisTimeFormat).tickSizeOuter(0));
    const bw = Math.max(3, Math.min(24, x(d3.timeDay.offset(d0, 1)) - x(d0) - 2));
    svg.append('g').selectAll('rect').data(days).join('rect')
      .attr('fill', categorical()[7]).attr('rx', 2)
      .attr('x', (d) => x(d.day) + 1).attr('width', bw).attr('y', (d) => y(d.n)).attr('height', (d) => y(0) - y(d.n))
      .on('pointermove', (e, d) => showTip(d3.select(tipRef.current), e, ref.current, `<strong>${d3.timeFormat('%Y. %b %-d.')(d.day)}</strong><br>${d.n} hiba`))
      .on('pointerleave', () => d3.select(tipRef.current).style('opacity', 0));
  }, [days, width, ref, theme]);

  return (
    <div className="chart-wrap" ref={ref}>
      {!days.length && <div className="empty">Nincs megjeleníthető hiba.</div>}
      <svg ref={svgRef} width={width} height={days.length ? height : 0} role="img" aria-label="Hibák száma naponta" />
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}
