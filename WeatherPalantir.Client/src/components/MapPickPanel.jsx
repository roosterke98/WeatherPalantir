import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatCoord } from './ChoroplethMap.jsx';

const norm = (s) => (s ?? '').trim().toLocaleLowerCase('hu');

/**
 * Javasolt név a térképen kijelölt ponthoz. Alapesetben a BigDataCloud „locality” értéke; ha ilyen nevű
 * helyszín már van (egy településnévhez több helyszín is tartozhat), a várossal, végső esetben
 * a kerekített koordinátákkal egészül ki, hogy a listákban megkülönböztethető legyen.
 */
function suggestName(geo, point, taken) {
  const base = geo.locality || geo.city || geo.principalSubdivision || '';
  if (!base || !taken.has(norm(base))) return { name: base, clash: null };
  const withCity = geo.city && norm(geo.city) !== norm(base) ? `${base}, ${geo.city}` : null;
  const name = withCity && !taken.has(norm(withCity))
    ? withCity
    : `${base} (${point.latitude.toFixed(3)}, ${point.longitude.toFixed(3)})`;
  return { name, clash: base };
}

/**
 * A térképen kattintással kijelölt pont felvétele új helyszínként: a nevét fordított geokódolással oldja fel,
 * a név szerkeszthető, majd a pont a meta.NewLocation betöltési sorba kerül (az ETL a következő óra egészkor tölti be).
 */
export default function MapPickPanel({ point, takenNames, onResolved, onDone, onCancel }) {
  const [geo, setGeo] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [clash, setClash] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setGeo(null);
    setError(null);
    setName('');
    setClash(null);
    api
      .reverseGeocode(point.latitude, point.longitude, controller.signal)
      .then((g) => {
        setGeo(g);
        const s = suggestName(g, point, takenNames);
        setName(s.name);
        setClash(s.clash);
        onResolved?.(s.name);
      })
      .catch((e) => e.name !== 'AbortError' && setError(e.message));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- csak új pontnál kell újra feloldani
  }, [point.latitude, point.longitude]);

  const noCountry = geo && !geo.countryCode;
  const nameTaken = name && takenNames.has(norm(name));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await api.addNewLocation({
        latitude: point.latitude,
        longitude: point.longitude,
        countryCode: geo.countryCode,
        cityName: name.trim(),
      });
      onDone(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pick-panel" role="dialog" aria-label="Új helyszín felvétele a térképről">
      <div className="pick-head">
        <strong>Új helyszín a térképről</strong>
        <span className="muted small">
          {formatCoord(point.latitude, 'É', 'D')}, {formatCoord(point.longitude, 'K', 'Ny')}
        </span>
      </div>
      {!geo && !error && <p className="muted small">Név feloldása (BigDataCloud)…</p>}
      {geo && (
        <>
          <dl>
            <dt>Település (locality)</dt><dd>{geo.locality || <span className="muted">–</span>}</dd>
            {geo.city && geo.city !== geo.locality && (<><dt>Város / járás</dt><dd>{geo.city}</dd></>)}
            <dt>Régió</dt><dd>{geo.principalSubdivision || '–'}</dd>
            <dt>Ország</dt><dd>{geo.countryName ? `${geo.countryName} (${geo.countryCode})` : '–'}</dd>
          </dl>
          {noCountry ? (
            <div className="alert error">A kijelölt pont nem esik egyetlen ország területére sem, így nem vehető fel.</div>
          ) : (
            <>
              <label className="field">
                <span>Helyszín neve</span>
                <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </label>
              {clash && (
                <div className="alert info small">
                  „{clash}” nevű helyszín már szerepel. Egy településnévhez több helyszín is tartozhat, ezért a helyszínt
                  a koordinátái azonosítják; a megkülönböztethetőség kedvéért kiegészített nevet javaslunk.
                </div>
              )}
              {!clash && nameTaken && <div className="alert info small">Ilyen nevű helyszín már van – érdemes megkülönböztető nevet adni.</div>}
            </>
          )}
        </>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="actions">
        <button className="btn primary small" onClick={submit} disabled={!geo || noCountry || !name.trim() || saving}>
          {saving ? 'Mentés…' : 'Hozzáadás a betöltési sorhoz'}
        </button>
        <button className="btn ghost small" onClick={onCancel}>Mégse</button>
      </div>
    </div>
  );
}
