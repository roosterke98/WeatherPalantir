import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../api.js';
import { useFetch } from '../hooks/useFetch.js';
import { useWidth } from '../hooks/useSize.js';
import { formatDateTime } from '../utils/format.js';
import { parsePeriod } from '../utils/time.js';
import Typeahead from '../components/Typeahead.jsx';
import { useTheme } from '../utils/theme.js';

const NO_GEO = { type: 'FeatureCollection', features: [] };
const STATUS_HU = { Pending: 'Várakozik', Processing: 'Feldolgozás alatt', Completed: 'Kész', Failed: 'Hiba', Error: 'Hiba' };
const STATUS_CLASS = { Pending: 'warn', Processing: 'info', Completed: 'good', Failed: 'bad', Error: 'bad' };

/**
 * Új helyszín felvétele: a kiválasztott település a meta.NewLocation táblába kerül „Pending” állapotban,
 * ahonnan az ETL folyamat tölti be a múltbéli és előrejelzési adatait az adattárházba.
 */
export default function NewLocationView({ meta, onLocationsChanged, active }) {
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const queue = useFetch((signal) => api.newLocations(signal), [active]);

  // A térképhez csak azoknak az országoknak a határai kellenek, ahol már van helyszín, illetve ahová a kiválasztott pont esik.
  const selectedCountry = meta.regions.find((r) => r.regionKey === selected?.regionKey)?.countryCode;
  const countries = [...new Set([...meta.locations.map((l) => l.countryCode), selectedCountry].filter(Boolean))].sort();
  const geo = useFetch(() => api.regionsGeoJson(countries), [countries.join()], { enabled: active });

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    try {
      const created = await api.addNewLocation({
        latitude: selected.latitude,
        longitude: selected.longitude,
        countryCode: selected.countryCode,
        cityName: selected.name,
      });
      setMessage({
        type: 'success',
        text: `${created.cityName} felvéve a betöltési sorba (#${created.queueId}). Az ETL a következő óra egészkor (${nextEtlRun().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}) tölti be.`,
      });
      setSelected(null);
      queue.reload();
      onLocationsChanged?.();
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="newloc">
      <section className="card">
        <div className="card-head">
          <h2>Új helyszín hozzáadása</h2>
          <span className="muted small">Forrás: Open-Meteo Geocoding API</span>
        </div>
        <p className="muted">
          Kezdje el gépelni a település nevét. Bármely ország helyszíne felvehető – ha az ország még nem szerepel
          az adattárházban, az ETL a helyszínnel együtt betölti az ország régióinak (megyéinek) térképét is.
        </p>
        <EtlSchedule />

        <div className="newloc-grid">
          <div>
            <Typeahead onSelect={(r) => { setSelected(r); setMessage(null); }} />
            {selected && (
              <div className="selected-place">
                <h3>{selected.name}</h3>
                <dl>
                  <dt>Régió</dt>
                  <dd>{selected.regionName ?? <span className="badge info">Új ország – a térképet az ETL tölti be</span>}</dd>
                  <dt>Ország</dt><dd>{selected.country} ({selected.countryCode})</dd>
                  <dt>Koordináták</dt><dd>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</dd>
                  {selected.elevation != null && (<><dt>Tengerszint feletti magasság</dt><dd>{Math.round(selected.elevation)} m</dd></>)}
                </dl>
                <div className="actions">
                  <button className="btn primary" onClick={submit} disabled={saving}>
                    {saving ? 'Mentés…' : 'Hozzáadás a betöltési sorhoz'}
                  </button>
                  <button className="btn ghost" onClick={() => setSelected(null)}>Mégse</button>
                </div>
              </div>
            )}
            {message && <div className={`alert ${message.type}`}>{message.text}</div>}
          </div>
          <PlaceMap geo={geo.data ?? NO_GEO} locations={meta.locations} queue={queue.data ?? []} selected={selected} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Betöltési sor (meta.NewLocation)</h2>
          <button className="btn ghost" onClick={queue.reload}>Frissítés</button>
        </div>
        {queue.error && <div className="alert error">{queue.error.message}</div>}
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Település</th><th>Ország</th><th className="num">Szélesség</th><th className="num">Hosszúság</th>
                <th>Állapot</th><th>Kérés ideje</th><th>Befejezés</th><th>Hibaüzenet</th>
              </tr>
            </thead>
            <tbody>
              {(queue.data ?? []).map((q) => (
                <tr key={q.queueId}>
                  <td>{q.queueId}</td>
                  <td>{q.cityName ?? '–'}</td>
                  <td>{q.countryCode}</td>
                  <td className="num">{q.latitude.toFixed(4)}</td>
                  <td className="num">{q.longitude.toFixed(4)}</td>
                  <td><span className={`badge ${STATUS_CLASS[q.status] ?? 'neutral'}`}>{STATUS_HU[q.status] ?? q.status}</span></td>
                  <td>{formatDateTime(parsePeriod(q.requestDate))}</td>
                  <td>{q.finishDate ? formatDateTime(parsePeriod(q.finishDate)) : '–'}</td>
                  <td className="wrap">{q.errorMessage ?? ''}</td>
                </tr>
              ))}
              {queue.data && !queue.data.length && (
                <tr><td colSpan={9} className="empty">A sor üres.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Az ETL minden óra egészkor fut – a következő futás időpontja. */
function nextEtlRun(now = new Date()) {
  return d3.timeHour.ceil(new Date(+now + 1));
}

/** Az ETL ütemezésének kijelzése percenként frissülő visszaszámlálással. */
function EtlSchedule() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  const next = nextEtlRun(now);
  const mins = Math.max(1, Math.ceil((next - now) / 60000));
  return (
    <div className="etl-schedule" role="status">
      <svg viewBox="0 0 24 24" width="20" height="20" className="icon" aria-hidden="true">
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
      </svg>
      <div>
        <strong>Az ETL minden óra egészkor fut.</strong>{' '}
        A következő betöltés <b>{next.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</b>-kor indul
        <span className="muted"> ({mins} perc múlva)</span> – ekkor dolgozza fel a sorban várakozó helyszíneket.
      </div>
    </div>
  );
}

/** Áttekintő térkép: a régiók, a meglévő és a sorban álló helyszínek, valamint a kiválasztott pont. */
function PlaceMap({ geo, locations, queue, selected }) {
  const theme = useTheme();
  const [ref, width] = useWidth(420);
  const svgRef = useRef(null);
  const height = Math.round(width * 0.55);
  // A vetület a régiókra és minden megjelenített pontra illeszkedik, így más ország helyszíne is látszik.
  const projection = useMemo(() => {
    const pts = [selected, ...queue.filter((q) => q.status !== 'Completed')]
      .filter(Boolean)
      .map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] } }));
    return d3.geoMercator().fitExtent([[24, 24], [width - 24, height - 24]], { type: 'FeatureCollection', features: [...geo.features, ...pts] });
  }, [geo, width, height, selected, queue]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!geo.features.length) return; // a határok még töltődnek
    const path = d3.geoPath(projection);
    svg.append('g').selectAll('path').data(geo.features).join('path').attr('class', 'region static')
      .classed('highlight', (f) => selected?.regionKey === f.properties.regionKey).attr('d', path);
    const pt = (lon, lat) => projection([lon, lat]);
    const pending = queue.filter((q) => q.status !== 'Completed');
    svg.append('g').selectAll('circle').data(locations).join('circle').attr('class', 'location')
      .attr('r', 4.5).attr('cx', (l) => pt(l.longitude, l.latitude)[0]).attr('cy', (l) => pt(l.longitude, l.latitude)[1])
      .append('title').text((l) => l.name);
    svg.append('g').selectAll('circle').data(pending).join('circle').attr('class', 'location pending')
      .attr('r', 4.5).attr('cx', (q) => pt(q.longitude, q.latitude)[0]).attr('cy', (q) => pt(q.longitude, q.latitude)[1])
      .append('title').text((q) => `${q.cityName} (várakozik)`);
    if (selected) {
      const [x, y] = pt(selected.longitude, selected.latitude);
      svg.append('circle').attr('class', 'target-ring').attr('cx', x).attr('cy', y).attr('r', 12);
      svg.append('circle').attr('class', 'target').attr('cx', x).attr('cy', y).attr('r', 5);
      svg.append('text').attr('class', 'target-label').attr('x', x + 14).attr('y', y + 4).text(selected.name);
    }
  }, [geo, locations, queue, selected, projection, theme]);

  return (
    <div ref={ref} className="place-map">
      <svg ref={svgRef} width={width} height={height} role="img" aria-label="Helyszínek térképe" />
      <div className="legend">
        <span className="legend-item static"><span className="swatch dot" /> Betöltött helyszín</span>
        <span className="legend-item static"><span className="swatch dot pending" /> Betöltésre vár</span>
        <span className="legend-item static"><span className="swatch dot target" /> Kiválasztott</span>
      </div>
    </div>
  );
}
