import { api } from './api.js';
import { useFetch } from './hooks/useFetch.js';
import AnalysisView from './views/AnalysisView.jsx';

/** Az alkalmazás egyszer tölti be a dimenziókat és metaadatokat, ezeket a nézet megkapja. */
async function loadMeta(signal) {
  const [measures, regions, locations, range, geo] = await Promise.all([
    api.measures(signal),
    api.regions(signal),
    api.locations(signal),
    api.range(signal),
    api.regionsGeoJson(signal),
  ]);
  return { measures, regions, locations, range, geo };
}

export default function App() {
  const meta = useFetch(loadMeta, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>WeatherPalantír</h1>
            <p>Meteorológiai adattárház és elemző felület</p>
          </div>
        </div>
      </header>

      <main className="app-main">
        {meta.error && <div className="alert error">A metaadatok betöltése sikertelen: {meta.error.message}</div>}
        {!meta.data && !meta.error && <div className="loading-block">Betöltés…</div>}
        {meta.data && <AnalysisView meta={meta.data} />}
      </main>
    </div>
  );
}
