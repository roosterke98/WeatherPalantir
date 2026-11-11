import { memberColor } from '../utils/colors.js';
import { useTheme } from '../utils/theme.js';
import { compassPoint } from '../utils/format.js';
import { formatPeriod, parsePeriod } from '../utils/time.js';

/** Iránytűszerű kijelzés tagonként a csúszka aktuális periódusának (vektoros átlag) szélirányával. */
export default function CompassPanel({ cube, period, grain, order }) {
  useTheme(); // témaváltáskor újrarenderel (a színek a témától függnek)
  const rows = (cube?.rows ?? []).filter((r) => period && r.period && +parsePeriod(r.period) === +period);
  return (
    <div className="compass-panel">
      <h3>Szélirány – {formatPeriod(period, grain)}</h3>
      <div className="compass-list">
        {!rows.length && <div className="empty">Nincs adat ebben a periódusban.</div>}
        {rows.map((r) => {
          const dir = r.values.windDirection;
          const color = memberColor(r.memberKey, order);
          return (
            <figure key={r.memberKey} className="compass">
              <svg viewBox="-60 -60 120 120" width="120" height="120" role="img" aria-label={`${r.memberName}: ${dir ?? '–'} fok`}>
                <circle r="50" className="compass-ring" />
                {[0, 90, 180, 270].map((a) => (
                  <line key={a} className="compass-tick" y1="-50" y2="-42" transform={`rotate(${a})`} />
                ))}
                <text className="compass-label" y="-30">É</text>
                {dir != null && (
                  // A tű a szél fújásának irányába mutat (meteorológiai irány + 180°).
                  <g transform={`rotate(${dir + 180})`}>
                    <path d="M0,-38 L7,6 L0,0 L-7,6 Z" fill={color} className="needle" />
                    <path d="M0,38 L5,0 L-5,0 Z" className="needle-tail" />
                  </g>
                )}
                <circle r="4" className="compass-hub" />
              </svg>
              <figcaption>
                <strong>{r.memberName}</strong>
                <span className="muted">{dir != null ? `${Math.round(dir)}° (${compassPoint(dir)}) felől` : '–'}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
