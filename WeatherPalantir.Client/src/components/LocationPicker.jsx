import { memberColor } from '../utils/colors.js';
import { useTheme } from '../utils/theme.js';

/**
 * A vizsgált helyszínek kijelölése: a gombok be- és kikapcsolják az egyes helyszíneket.
 * Ha egy sincs kijelölve, minden helyszín szerepel az elemzésben (a választott földrajzi szinten).
 */
export default function LocationPicker({ locations, selected, colorOrder, onToggle, onClear }) {
  useTheme(); // témaváltáskor a színminták is frissülnek
  if (locations.length < 2) return null;
  return (
    <div className="loc-picker" role="group" aria-label="Vizsgált helyszínek">
      <span className="muted small">Helyszínek</span>
      <button className={selected.length ? 'pick' : 'pick active'} aria-pressed={!selected.length} onClick={onClear}>
        Összes
      </button>
      {locations.map((l) => {
        const on = selected.includes(l.locationKey);
        return (
          <button key={l.locationKey} className={on ? 'pick active' : 'pick'} aria-pressed={on} onClick={() => onToggle(l.locationKey)}>
            {colorOrder && <span className="swatch" style={{ background: memberColor(l.locationKey, colorOrder) }} />}
            {l.name}
          </button>
        );
      })}
    </div>
  );
}
