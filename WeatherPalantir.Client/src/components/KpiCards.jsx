import * as d3 from 'd3';
import { formatValue } from '../utils/format.js';
import { formatPeriod, parsePeriod } from '../utils/time.js';

/** Összefoglaló értékek az aktuális periódusra (a tagok közötti átlag, minimum, maximum) és a teljes időszakra. */
export default function KpiCards({ cube, period, grain, measure, secondary }) {
  const rows = cube?.rows ?? [];
  const atPeriod = period ? rows.filter((r) => r.period && +parsePeriod(r.period) === +period) : [];
  const vals = (list, key) => list.map((r) => ({ v: r.values[key], name: r.memberName })).filter((x) => x.v != null);

  const cur = vals(atPeriod, measure.key);
  const all = vals(rows, measure.key);
  const isDirection = measure.key === 'windDirection';
  const minItem = d3.least(cur, (x) => x.v);
  const maxItem = d3.greatest(cur, (x) => x.v);
  const minAll = d3.least(all, (x) => x.v);
  const maxAll = d3.greatest(all, (x) => x.v);

  return (
    <div className="kpis">
      <div className="kpi card">
        <span className="kpi-label">{measure.label} · {formatPeriod(period, grain)}</span>
        <span className="kpi-value">{isDirection ? formatValue(cur[0]?.v, measure) : formatValue(d3.mean(cur, (x) => x.v), measure)}</span>
        <span className="kpi-sub muted">{isDirection ? (cur[0]?.name ?? '') : `${cur.length} tag átlaga`}</span>
      </div>
      {!isDirection && (
        <div className="kpi card">
          <span className="kpi-label">Tartomány a periódusban</span>
          <span className="kpi-value small-value">
            {formatValue(minItem?.v, measure)} – {formatValue(maxItem?.v, measure)}
          </span>
          <span className="kpi-sub muted">
            {minItem && maxItem && minItem.name !== maxItem.name ? `${minItem.name} → ${maxItem.name}` : minItem?.name ?? ''}
          </span>
        </div>
      )}
      {!isDirection && (
        <div className="kpi card">
          <span className="kpi-label">Szélsőértékek a teljes időszakban</span>
          <span className="kpi-value small-value">
            {formatValue(minAll?.v, measure)} – {formatValue(maxAll?.v, measure)}
          </span>
          <span className="kpi-sub muted">{cube?.periods?.length ?? 0} periódus</span>
        </div>
      )}
      {secondary && (
        <div className="kpi card">
          <span className="kpi-label">{secondary.label} · aktuális</span>
          <span className="kpi-value">{formatValue(secondary.key === 'windDirection' ? vals(atPeriod, secondary.key)[0]?.v : d3.mean(vals(atPeriod, secondary.key), (x) => x.v), secondary)}</span>
          <span className="kpi-sub muted">másodlagos paraméter</span>
        </div>
      )}
    </div>
  );
}
