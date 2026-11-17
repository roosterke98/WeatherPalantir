/** Összefoglaló csempék egy tematikus elemzés (napenergia, szélenergia, aszály) elején. */
export default function StatTiles({ items, loading }) {
  return (
    <div className="kpis">
      {items.map((t) => (
        <div key={t.label} className="kpi card" title={t.hint}>
          <span className="kpi-label">{t.label}</span>
          <span className="kpi-value">{loading && t.value == null ? '…' : t.value ?? '–'}</span>
          <span className="kpi-sub muted">{t.sub}</span>
        </div>
      ))}
    </div>
  );
}
