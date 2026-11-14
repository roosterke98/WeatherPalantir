import { useMemo } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { GRAINS } from '../utils/time.js';
import { useTheme } from '../utils/theme.js';

/** Egyszerre ennyi tag (helyszín / régió / ország) kap saját mátrixot. */
const MAX_PANELS = 6;
/** Ennél kevesebb közös periódusból nem számolunk együtthatót. */
const MIN_PAIRS = 3;

const fmt = (r) => d3.format('.2f')(r).replace('-', '−').replace('.', ',');

/** Pearson-féle korrelációs együttható a két sorozat közös (nem hiányzó) pontjain. */
function pearson(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null);
  if (pairs.length < MIN_PAIRS) return { r: null, n: pairs.length };
  const mx = d3.mean(pairs, (p) => p[0]);
  const my = d3.mean(pairs, (p) => p[1]);
  const sxy = d3.sum(pairs, (p) => (p[0] - mx) * (p[1] - my));
  const sxx = d3.sum(pairs, (p) => (p[0] - mx) ** 2);
  const syy = d3.sum(pairs, (p) => (p[1] - my) ** 2);
  return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n: pairs.length };
}

/**
 * Korrelációs mátrix a kiválasztott paraméterek között: tagonként (helyszín / régió / ország) egy mátrix,
 * az elemzés aktuális időbeli szintjén számolva (pl. napi értékek között). Divergens színezés:
 * kék = ellentétes, piros = együtt mozgó, a semleges közép a 0.
 */
export default function CorrelationMatrix({ params, paramsKey, measures, selected, order }) {
  const theme = useTheme();
  const defs = selected.map((k) => measures.find((m) => m.key === k && m.key !== 'windDirection')).filter(Boolean);
  const selectedKey = defs.map((m) => m.key).join();

  const cube = useFetch(
    (signal) => (defs.length > 1 ? api.cube({ ...params, measures: defs.map((m) => m.key) }, signal) : Promise.resolve(null)),
    [paramsKey, selectedKey],
  );

  const { panels, hidden, color } = useMemo(() => {
    const rows = (cube.data?.rows ?? []).filter((r) => r.period);
    const keys = (cube.data?.measures ?? []).filter((k) => defs.some((d) => d.key === k));
    const all = [...d3.group(rows, (r) => r.memberKey).entries()]
      .map(([key, rs]) => ({
        key,
        name: rs[0].memberName,
        cells: keys.map((a) => keys.map((b) => (a === b ? { r: 1, n: rs.length, self: true } : pearson(rs.map((r) => r.values[a]), rs.map((r) => r.values[b]))))),
      }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const neutral = getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() || '#f3f2ee';
    return {
      panels: all.slice(0, MAX_PANELS),
      hidden: Math.max(0, all.length - MAX_PANELS),
      color: d3.scaleDiverging([-1, 0, 1], d3.interpolateRgbBasis(['#1c5cab', '#3987e5', neutral, '#e34948', '#a32f2f'])).clamp(true),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a semleges középszín témafüggő
  }, [cube.data, selectedKey, order, theme]);

  const drawn = (cube.data?.measures ?? []).map((k) => defs.find((d) => d.key === k)).filter(Boolean);
  const grainLabel = GRAINS.find((g) => g.key === (cube.data?.grain ?? params.grain))?.label.toLowerCase() ?? '';
  const textOn = (bg) => (d3.hsl(bg).l > 0.55 ? '#0b0b0b' : '#ffffff');

  if (defs.length < 2) return <div className="empty">A korrelációhoz válassz legalább két paramétert.</div>;

  return (
    <div className="chart-wrap">
      {cube.error && <div className="alert error">{cube.error.message}</div>}
      {cube.loading && <div className="overlay-loading">Frissítés…</div>}
      {!cube.loading && !panels.length && <div className="empty">Nincs adat a kijelölt szeletben.</div>}
      {panels.length > 0 && (
        <>
          <div className="heat-legend">
            <span className="small">Pearson-féle r</span>
            <span className="small muted">−1</span>
            <span className="heat-ramp" style={{ background: `linear-gradient(to right, ${d3.range(-1, 1.01, 0.1).map((v) => color(v)).join(',')})` }} />
            <span className="small muted">+1</span>
            <span className="small muted heat-caption">Az értékek {grainLabel} szintű bontásban · kék: ellentétes, piros: együtt mozgó</span>
          </div>
          <div className="corr-grid">
            {panels.map((p) => (
              <figure key={p.key} className="facet">
                {panels.length > 1 && <figcaption>{p.name}</figcaption>}
                <table className="corr-table">
                  <thead>
                    <tr>
                      <th />
                      {drawn.map((m) => (
                        <th key={m.key} scope="col">{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {drawn.map((a, i) => (
                      <tr key={a.key}>
                        <th scope="row">{a.label}</th>
                        {drawn.map((b, j) => {
                          const c = p.cells[i]?.[j];
                          if (!c || c.r == null) {
                            return <td key={b.key} className="corr-cell na" title={`${a.label} × ${b.label}: túl kevés közös adat`}>–</td>;
                          }
                          const bg = color(c.r);
                          return (
                            <td
                              key={b.key}
                              className={c.self ? 'corr-cell self' : 'corr-cell'}
                              style={c.self ? undefined : { background: bg, color: textOn(bg) }}
                              title={c.self ? a.label : `${a.label} × ${b.label}: r = ${fmt(c.r)} (${c.n} ${grainLabel} alapján)`}
                            >
                              {fmt(c.r)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </figure>
            ))}
          </div>
          {hidden > 0 && <p className="muted small">További {hidden} tag nem fért ki – jelölj ki kevesebb helyszínt.</p>}
        </>
      )}
    </div>
  );
}
