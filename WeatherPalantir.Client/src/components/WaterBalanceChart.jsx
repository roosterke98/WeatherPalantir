import { useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useWidth } from '../hooks/useSize.js';
import { activeFocus, balanceColors } from '../utils/colors.js';
import { formatValue } from '../utils/format.js';
import { axisTimeFormat, formatPeriod, grainInterval, parsePeriod } from '../utils/time.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/** Egyszerre ennyi tag (helyszín / régió / ország) kap saját panelt. */
const MAX_PANELS = 6;
const MM = { unit: 'mm' };

/**
 * Vízmérleg (csapadék − referencia párolgás) periódusonként, tagonként egy panellel. Az oszlop iránya és
 * színe az előjelet mutatja: a nullavonal fölött többlet, alatta hiány. Kattintás: időbeli lefúrás.
 */
export default function WaterBalanceChart({ cube, loading, order, focus, onFocus, onDrill }) {
  const theme = useTheme();
  const { panels, hidden, periods, extent } = useMemo(() => {
    const rows = (cube?.rows ?? []).filter((r) => r.period && r.values.waterBalance != null);
    const all = [...d3.group(rows, (r) => r.memberKey).entries()]
      .map(([key, rs]) => ({ key, name: rs[0].memberName, points: rs.map((r) => ({ period: parsePeriod(r.period), ...r.values })) }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return {
      panels: all.slice(0, MAX_PANELS),
      hidden: Math.max(0, all.length - MAX_PANELS),
      periods: (cube?.periods ?? []).map(parsePeriod),
      extent: d3.extent(rows, (r) => r.values.waterBalance),
    };
  }, [cube, order]);

  const colors = useMemo(() => balanceColors(), [theme]); // eslint-disable-line react-hooks/exhaustive-deps -- a színek témafüggők
  const active = activeFocus(focus, panels);
  const grain = cube?.grain ?? 'day';

  return (
    <div className="chart-wrap">
      <div className="legend" role="list">
        <span role="listitem" className="legend-item static"><span className="swatch" style={{ background: colors.surplus }} />Többlet (csapadék &gt; ET₀)</span>
        <span role="listitem" className="legend-item static"><span className="swatch" style={{ background: colors.deficit }} />Hiány (csapadék &lt; ET₀)</span>
      </div>
      {loading && <div className="overlay-loading">Frissítés…</div>}
      {!loading && !panels.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      {panels.length > 0 && (
        <div className="facets">
          {panels.map((p) => (
            <BalancePanel key={p.key} panel={p} periods={periods} extent={extent} grain={grain} colors={colors} showTitle={panels.length > 1} dim={active != null && p.key !== active} onTitle={onFocus} onDrill={grain === 'hour' ? null : onDrill} />
          ))}
        </div>
      )}
      {hidden > 0 && <p className="muted small">További {hidden} tag nem fért ki – jelölj ki kevesebb helyszínt.</p>}
    </div>
  );
}

function BalancePanel({ panel, periods, extent, grain, colors, showTitle, dim, onTitle, onDrill }) {
  const [wrapRef, width] = useWidth(480);
  const tipRef = useRef(null);
  const height = 220;
  const margin = { top: 16, right: 10, bottom: 26, left: 46 };
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const interval = grainInterval(grain);
  const x = d3.scaleTime([periods[0], interval.offset(periods[periods.length - 1], 1)], [0, innerW]);
  const y = d3.scaleLinear([Math.min(0, extent[0]), Math.max(0, extent[1])], [innerH, 0]).nice(5);
  const hide = () => d3.select(tipRef.current).style('opacity', 0);

  return (
    <figure className={dim ? 'facet dim' : 'facet'} ref={wrapRef}>
      {showTitle && (
        <figcaption>
          <button className="facet-title" onClick={() => onTitle(panel.key)} title="Csak ennek a kiemelése · újabb kattintás: vissza">
            {panel.name}
          </button>
        </figcaption>
      )}
      <svg width={width} height={height} role="img" aria-label={`Vízmérleg – ${panel.name}`} onPointerLeave={hide}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          <text className="axis-title" x={-margin.left + 4} y={-6}>mm</text>
          {y.ticks(5).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line className="grid-line" x2={innerW} />
              <text className="tick-label" x={-8} y={4} textAnchor="end">{d3.format(',~g')(t)}</text>
            </g>
          ))}
          {x.ticks(Math.max(2, innerW / 90)).map((t) => (
            <text key={+t} className="tick-label" x={x(t)} y={innerH + 17} textAnchor="middle">{axisTimeFormat(t)}</text>
          ))}
          {panel.points.map((p) => {
            const slot = x(interval.offset(p.period, 1)) - x(p.period);
            const gap = slot > 6 ? 2 : 0;
            const v = p.waterBalance;
            return (
              <rect
                key={+p.period}
                className={onDrill ? 'bar clickable' : 'bar'}
                x={x(p.period) + gap / 2}
                width={Math.max(1, slot - gap)}
                y={y(Math.max(0, v))}
                height={Math.max(1, Math.abs(y(v) - y(0)))}
                fill={v < 0 ? colors.deficit : colors.surplus}
                onClick={onDrill ? () => onDrill(p.period) : undefined}
                onPointerMove={(event) =>
                  showTip(d3.select(tipRef.current), event.nativeEvent, wrapRef.current,
                    `<strong>${formatPeriod(p.period, grain)}</strong><br>${panel.name}<br>Csapadék: <b>${formatValue(p.precipitation, MM)}</b><br>Referencia párolgás: <b>${formatValue(p.evapotranspiration, MM)}</b><br>Vízmérleg: <b>${v > 0 ? '+' : ''}${formatValue(v, MM)}</b>`)
                }
              />
            );
          })}
          <line className="zero-line" x2={innerW} y1={y(0)} y2={y(0)} />
        </g>
      </svg>
      <div ref={tipRef} className="tooltip" />
    </figure>
  );
}
