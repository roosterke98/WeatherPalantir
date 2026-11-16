import { useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useWidth } from '../hooks/useSize.js';
import { categorical, mutedSeries } from '../utils/colors.js';
import { formatInt } from '../utils/format.js';
import { conditionLabel, SEVERITIES, SEVERITY_COLORS, SEVERITY_HU } from '../utils/wmo.js';
import { showTip } from './ChoroplethMap.jsx';
import { useTheme } from '../utils/theme.js';

/** Kördiagramon legfeljebb ennyi szelet kap saját színt, a többi az „Egyéb” szeletbe kerül. */
const MAX_SLICES = 8;
/** Sávdiagramon ennyi sor látszik. */
const MAX_BARS = 10;

const pct = d3.format('.0%');
const pct1 = d3.format('.1%');

/**
 * Az időjárási viszonyok gyakorisága a kijelölt szeletben, kördiagramként vagy sávdiagramként,
 * az egyes viszonyok (WMO kód) vagy a súlyossági csoportok (Severity) szintjén.
 * Kattintás: az adott viszony – súlyosság szinten a csoport összes viszonya – szűrőként kerül a többi komponensre.
 */
export default function ConditionChart({ data, loading, selected, onToggle, onToggleMany }) {
  const theme = useTheme();
  const [wrapRef, width] = useWidth(360);
  const tipRef = useRef(null);
  const [level, setLevel] = useState('condition');
  const [mode, setMode] = useState('pie');

  const { items, total } = useMemo(() => {
    const rows = [...(data ?? [])].sort((a, b) => b.hours - a.hours);
    const sum = d3.sum(rows, (d) => d.hours);
    const palette = categorical();
    if (level === 'severity') {
      const groups = d3.group(rows, (d) => d.severity ?? 'Unknown');
      const list = [...SEVERITIES, 'Unknown']
        .filter((s) => groups.has(s))
        .map((s) => ({
          id: s,
          label: SEVERITY_HU[s] ?? 'Ismeretlen',
          hours: d3.sum(groups.get(s), (d) => d.hours),
          color: SEVERITY_COLORS[s] ?? mutedSeries(),
          keys: groups.get(s).map((d) => d.weatherConditionKey).filter((k) => k != null),
          detail: `${groups.get(s).length} viszony`,
        }));
      return { items: list, total: sum };
    }
    const limit = mode === 'pie' ? MAX_SLICES - 1 : MAX_BARS;
    const fold = mode === 'pie' && rows.length > MAX_SLICES;
    const shown = fold ? rows.slice(0, limit) : rows.slice(0, mode === 'pie' ? MAX_SLICES : MAX_BARS);
    const list = shown.map((d, i) => ({
      id: `c${d.weatherConditionKey}`,
      label: conditionLabel(d.weatherConditionKey, d.description),
      hours: d.hours,
      color: mode === 'pie' ? palette[i % palette.length] : palette[0],
      keys: d.weatherConditionKey == null ? [] : [d.weatherConditionKey],
      detail: `Súlyosság: ${SEVERITY_HU[d.severity] ?? '–'}`,
    }));
    if (fold) {
      const rest = rows.slice(limit);
      list.push({ id: 'other', label: 'Egyéb', hours: d3.sum(rest, (d) => d.hours), color: mutedSeries(), keys: [], detail: `${rest.length} további viszony` });
    }
    return { items: list, total: sum };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a paletta témafüggő
  }, [data, level, mode, theme]);

  const dimmed = (item) => selected.length > 0 && !item.keys.some((k) => selected.includes(k));
  const activate = (item) => {
    if (!item.keys.length) return;
    if (item.keys.length === 1) onToggle(item.keys[0]);
    else onToggleMany(item.keys);
  };
  const tip = (event, item) =>
    showTip(d3.select(tipRef.current), event.nativeEvent ?? event, wrapRef.current,
      `<strong>${item.label}</strong><br>${formatInt(item.hours)} óra (${pct1(item.hours / (total || 1))})<br><span class="muted">${item.detail}</span>`);
  const hideTip = () => d3.select(tipRef.current).style('opacity', 0);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="viz-tools">
        <div className="segmented" role="radiogroup" aria-label="A dimenzió szintje">
          <button role="radio" aria-checked={level === 'condition'} className={level === 'condition' ? 'active' : ''} onClick={() => setLevel('condition')}>Viszony</button>
          <button role="radio" aria-checked={level === 'severity'} className={level === 'severity' ? 'active' : ''} onClick={() => setLevel('severity')}>Súlyosság</button>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Megjelenítés">
          <button role="radio" aria-checked={mode === 'pie'} className={mode === 'pie' ? 'active' : ''} onClick={() => setMode('pie')}>Kördiagram</button>
          <button role="radio" aria-checked={mode === 'bars'} className={mode === 'bars' ? 'active' : ''} onClick={() => setMode('bars')}>Sávok</button>
        </div>
      </div>
      {loading && <div className="overlay-loading">Frissítés…</div>}
      {!loading && !items.length && <div className="empty">Nincs adat.</div>}
      {items.length > 0 && mode === 'pie' && <Pie items={items} total={total} width={width} dimmed={dimmed} onPick={activate} onTip={tip} onLeave={hideTip} />}
      {items.length > 0 && mode === 'bars' && <Bars items={items} total={total} width={width} dimmed={dimmed} onPick={activate} onTip={tip} onLeave={hideTip} />}
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}

function Pie({ items, total, width, dimmed, onPick, onTip, onLeave }) {
  const size = Math.max(150, Math.min(210, width * 0.5));
  const r = size / 2;
  const arcs = d3.pie().sort(null).value((d) => d.hours)(items);
  const arc = d3.arc().innerRadius(r * 0.56).outerRadius(r - 2).padAngle(items.length > 1 ? 0.012 : 0).cornerRadius(2);
  return (
    <div className="pie-wrap">
      <svg width={size} height={size} role="img" aria-label="Időjárási viszonyok megoszlása kördiagramon">
        <g transform={`translate(${r},${r})`}>
          {arcs.map((a) => (
            <path
              key={a.data.id}
              className={dimmed(a.data) ? 'pie-slice dim' : 'pie-slice'}
              d={arc(a)}
              fill={a.data.color}
              style={{ cursor: a.data.keys.length ? 'pointer' : 'default' }}
              onClick={() => onPick(a.data)}
              onPointerMove={(e) => onTip(e, a.data)}
              onPointerLeave={onLeave}
            />
          ))}
          <text className="pie-total" y="-2">{formatInt(total)}</text>
          <text className="pie-total-label" y="14">óra</text>
        </g>
      </svg>
      <ul className="pie-legend">
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={`legend-item${item.keys.length ? '' : ' static'}${dimmed(item) ? ' dim' : ''}`}
              onClick={() => onPick(item)}
              title={item.keys.length ? 'Szűrés' : undefined}
            >
              <span className="swatch" style={{ background: item.color }} />
              <span className="pie-name">{item.label}</span>
              <span className="pie-share">{pct(item.hours / (total || 1))}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bars({ items, total, width, dimmed, onPick, onTip, onLeave }) {
  const barH = 22;
  const height = items.length * (barH + 6) + 8;
  const labelW = Math.min(170, width * 0.45);
  const x = d3.scaleLinear([0, d3.max(items, (d) => d.hours) || 1], [0, Math.max(10, width - labelW - 56)]);
  return (
    <svg width={width} height={height} role="img" aria-label="Időjárási viszonyok gyakorisága">
      {items.map((item, i) => {
        const w = Math.max(2, x(item.hours));
        const rr = Math.min(4, w / 2);
        return (
          <g
            key={item.id}
            className={dimmed(item) ? 'cond-row dim' : 'cond-row'}
            transform={`translate(0,${i * (barH + 6) + 4})`}
            style={{ cursor: item.keys.length ? 'pointer' : 'default' }}
            onClick={() => onPick(item)}
            onPointerMove={(e) => onTip(e, item)}
            onPointerLeave={onLeave}
          >
            <rect className="hit" width={width} height={barH} />
            <text className="cond-label" x={labelW - 8} y={barH / 2 + 4} textAnchor="end">{item.label}</text>
            <path
              fill={item.color}
              d={`M${labelW},3H${labelW + w - rr}Q${labelW + w},3 ${labelW + w},${3 + rr}V${barH - 3 - rr}Q${labelW + w},${barH - 3} ${labelW + w - rr},${barH - 3}H${labelW}Z`}
            />
            <text className="cond-value" x={labelW + w + 6} y={barH / 2 + 4}>{pct(item.hours / (total || 1))}</text>
          </g>
        );
      })}
    </svg>
  );
}
