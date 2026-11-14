import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useFetch } from './hooks/useFetch.js';
import { setTheme, useTheme } from './utils/theme.js';
import AnalysisView from './views/AnalysisView.jsx';
import NewLocationView from './views/NewLocationView.jsx';
import ErrorLogView from './views/ErrorLogView.jsx';

const TABS = [
  { key: 'analysis', label: 'Elemzés', icon: 'M3 20h18M6 16V10M11 16V5M16 16v-8M21 16v-4' },
  { key: 'locations', label: 'Új helyszín', icon: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 7v5M9.5 9.5h5' },
  { key: 'log', label: 'ETL napló', icon: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5' },
];

const NAV_KEY = 'wp-nav-open';
const readNavOpen = () => {
  try {
    return localStorage.getItem(NAV_KEY) !== '0';
  } catch {
    return true;
  }
};

/** Az alkalmazás egyszer tölti be a dimenziókat és metaadatokat, ezeket minden nézet megkapja. */
async function loadMeta(signal) {
  const [measures, regions, locations, range] = await Promise.all([
    api.measures(signal),
    api.regions(signal),
    api.locations(signal),
    api.range(signal),
  ]);
  return { measures, regions, locations, range };
}

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="icon">
    <path d={d} />
  </svg>
);

export default function App() {
  const [tab, setTab] = useState('analysis');
  const [navOpen, setNavOpen] = useState(readNavOpen);
  const theme = useTheme();
  const meta = useFetch(loadMeta, []);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_KEY, navOpen ? '1' : '0');
    } catch {
      /* nem kritikus */
    }
  }, [navOpen]);

  const current = TABS.find((t) => t.key === tab);

  return (
    <div className={navOpen ? 'app nav-open' : 'app'}>
      <header className="app-header">
        <button
          className="btn icon nav-toggle"
          aria-label={navOpen ? 'Menü elrejtése' : 'Menü megjelenítése'}
          aria-expanded={navOpen}
          aria-controls="side-nav"
          onClick={() => setNavOpen((o) => !o)}
        >
          <Icon d={navOpen ? 'M15 5l-7 7 7 7' : 'M4 6h16M4 12h16M4 18h16'} />
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>WeatherPalantír</h1>
            <p>Meteorológiai adattárház és elemző felület · {current.label}</p>
          </div>
        </div>
        <button
          className="btn theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Váltás világos módra' : 'Váltás sötét módra'}
          title={theme === 'dark' ? 'Világos mód' : 'Sötét mód'}
        >
          <Icon
            d={
              theme === 'dark'
                ? 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
                : 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'
            }
          />
          <span>{theme === 'dark' ? 'Világos' : 'Sötét'}</span>
        </button>
      </header>

      <div className="app-body">
        <aside id="side-nav" className="side-nav" hidden={!navOpen}>
          <nav role="tablist" aria-orientation="vertical" aria-label="Nézetek">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'side-tab active' : 'side-tab'}
                onClick={() => {
                  setTab(t.key);
                  if (window.matchMedia('(max-width: 900px)').matches) setNavOpen(false);
                }}
              >
                <Icon d={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

        <main className="app-main">
          {meta.error && <div className="alert error">A metaadatok betöltése sikertelen: {meta.error.message}</div>}
          {!meta.data && !meta.error && <div className="loading-block">Betöltés…</div>}
          {meta.data && (
            <>
              {/* A nézetek rejtve is megmaradnak, így tabváltáskor nem vész el az elemzés állapota. */}
              <div hidden={tab !== 'analysis'}><AnalysisView meta={meta.data} /></div>
              <div hidden={tab !== 'locations'}>
                <NewLocationView meta={meta.data} onLocationsChanged={meta.reload} active={tab === 'locations'} />
              </div>
              <div hidden={tab !== 'log'}><ErrorLogView active={tab === 'log'} /></div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
