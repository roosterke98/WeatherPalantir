import { daysBetween, GRAINS, LEVELS, MAX_HOURLY_DAYS } from '../utils/time.js';

function groupBy(list, key) {
  const map = new Map();
  for (const item of list) {
    if (!map.has(item[key])) map.set(item[key], []);
    map.get(item[key]).push(item);
  }
  return [...map.entries()];
}

/** Egy sorban: időszak, részletességi szintek, adattípus, elsődleges és másodlagos paraméter. */
export default function FilterBar({ state, dispatch, meta, measure, secondaryOptions, secondary }) {
  const min = meta.range.min?.slice(0, 10);
  const max = meta.range.max?.slice(0, 10);
  const days = daysBetween(state.from, state.to);
  const set = (patch) => dispatch({ type: 'set', patch });

  return (
    <div className="filter-bar card">
      <label className="field">
        <span>Kezdő dátum</span>
        <input type="date" value={state.from} min={min} max={state.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
      </label>
      <label className="field">
        <span>Záró dátum</span>
        <input type="date" value={state.to} min={state.from} max={max} onChange={(e) => e.target.value && set({ to: e.target.value })} />
      </label>

      <div className="field">
        <span>Időbeli szint</span>
        <div className="segmented" role="radiogroup" aria-label="Időbeli részletesség">
          {GRAINS.map((g) => {
            const disabled = g.key === 'hour' && days > MAX_HOURLY_DAYS;
            return (
              <button
                key={g.key}
                role="radio"
                aria-checked={state.grain === g.key}
                className={state.grain === g.key ? 'active' : ''}
                disabled={disabled}
                title={disabled ? `Órás bontás legfeljebb ${MAX_HOURLY_DAYS} napra` : undefined}
                onClick={() => set({ grain: g.key })}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span>Földrajzi szint</span>
        <div className="segmented" role="radiogroup" aria-label="Földrajzi részletesség">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              role="radio"
              aria-checked={state.level === l.key}
              className={state.level === l.key ? 'active' : ''}
              onClick={() => set({ level: l.key })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Adat</span>
        <select value={state.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="all">Múltbéli + előrejelzés</option>
          <option value="historical">Csak múltbéli</option>
          <option value="forecast">Csak előrejelzés</option>
        </select>
      </label>

      <label className="field grow">
        <span>Paraméter</span>
        <select value={measure.key} onChange={(e) => set({ measure: e.target.value })}>
          {groupBy(meta.measures, 'group').map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="field grow">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={state.secondaryOn}
            disabled={!secondaryOptions.length}
            onChange={(e) => set({ secondaryOn: e.target.checked })}
          />
          <span>Másodlagos paraméter a térképen</span>
        </label>
        <select
          value={secondary?.key ?? state.secondary}
          disabled={!state.secondaryOn}
          onChange={(e) => set({ secondary: e.target.value })}
          aria-label="Másodlagos paraméter"
        >
          {secondaryOptions.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({!measure.mapEncodings.includes('fill') ? 'színezés' : m.key === 'windDirection' ? 'irányvonal' : 'buborék'})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
