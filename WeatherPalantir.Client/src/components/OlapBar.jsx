import { useEffect, useRef, useState } from 'react';
import { conditionLabel } from '../utils/wmo.js';
import { GRAINS } from '../utils/time.js';
import { availableCountries, MAX_MAP_COUNTRIES } from '../views/analysisState.js';

/**
 * OLAP navigáció: földrajzi morzsamenü (felgöngyölítés), időbeli visszalépés,
 * valamint az aktív szeletelő / kockázó szűrők listája.
 */
export default function OlapBar({ state, dispatch, meta }) {
  const regionName = (k) => meta.regions.find((r) => r.regionKey === k)?.regionName ?? k;
  const manualRegions = state.regions.filter((k) => !state.geoPath.some((p) => p.level === 'region' && Number(p.key) === k));
  const pickedLocations = state.locations.filter((k) => !state.geoPath.some((p) => p.level === 'location' && Number(p.key) === k));
  const locationName = (k) => meta.locations.find((l) => l.locationKey === k)?.name ?? k;
  const hasFilters = state.geoPath.length || manualRegions.length || pickedLocations.length || state.conditions.length || state.kind !== 'all';
  const prevTime = state.timeStack[state.timeStack.length - 1];
  const countries = availableCountries(meta);
  const countryName = (c) => countries.find((x) => x.code === c)?.name ?? c;
  const addable = countries.filter((c) => !state.mapCountries.includes(c.code));
  const full = state.mapCountries.length >= MAX_MAP_COUNTRIES;

  return (
    <div className="olap-bar">
      <div className="country-picker" role="group" aria-label="Térképen megjelenített országok">
        <span className="muted small">Országok</span>
        {state.mapCountries.map((c) => (
          <span key={c} className="chip country">
            {countryName(c)}
            {state.mapCountries.length > 1 && (
              <button
                aria-label={`${countryName(c)} eltávolítása`}
                onClick={() => dispatch({ type: 'removeCountry', code: c, regionKeys: meta.regions.filter((r) => r.countryCode === c).map((r) => r.regionKey) })}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {addable.length > 0 && (
          <select
            className="add-country"
            value=""
            disabled={full}
            title={full ? `Legfeljebb ${MAX_MAP_COUNTRIES} ország jeleníthető meg egyszerre` : undefined}
            onChange={(e) => e.target.value && dispatch({ type: 'addCountry', code: e.target.value })}
            aria-label="Ország hozzáadása"
          >
            <option value="">{full ? `Max. ${MAX_MAP_COUNTRIES} ország` : '+ Ország hozzáadása'}</option>
            {addable.map((c) => (
              <option key={c.code} value={c.code}>{c.name}{c.hasData ? '' : ' (még nincs adat)'}</option>
            ))}
          </select>
        )}
      </div>

      <nav className="breadcrumb" aria-label="Földrajzi hierarchia">
        <button className="crumb" onClick={() => dispatch({ type: 'rollUpGeo', index: 0 })} disabled={!state.geoPath.length}>
          {state.mapCountries.length > 1 ? 'Kiválasztott országok' : 'Teljes ország'}
        </button>
        {state.geoPath.map((p, i) => (
          <span key={`${p.level}-${p.key}`} className="crumb-wrap">
            <span className="crumb-sep" aria-hidden="true">›</span>
            <button
              className="crumb"
              onClick={() => dispatch({ type: 'rollUpGeo', index: i + 1 })}
              disabled={i === state.geoPath.length - 1}
            >
              {p.name}
            </button>
          </span>
        ))}
      </nav>

      <button
        className="btn ghost"
        disabled={!prevTime}
        onClick={() => dispatch({ type: 'rollUpTime' })}
        title={prevTime ? `Vissza: ${prevTime.from} – ${prevTime.to}` : 'Nincs korábbi időszak'}
      >
        ↑ Időbeli felgöngyölítés
        {prevTime ? ` (${GRAINS.find((g) => g.key === prevTime.grain)?.label.toLowerCase()})` : ''}
      </button>

      <RegionPicker regions={meta.regions.filter((r) => state.countries.includes(r.countryCode))} selected={state.regions} onToggle={(k) => dispatch({ type: 'toggleRegion', key: k })} />

      <div className="chips">
        {state.kind !== 'all' && (
          <Chip onRemove={() => dispatch({ type: 'set', patch: { kind: 'all' } })}>
            {state.kind === 'forecast' ? 'Csak előrejelzés' : 'Csak múltbéli'}
          </Chip>
        )}
        {manualRegions.map((k) => (
          <Chip key={`r${k}`} onRemove={() => dispatch({ type: 'toggleRegion', key: k })}>
            {regionName(k)}
          </Chip>
        ))}
        {pickedLocations.map((k) => (
          <Chip key={`l${k}`} onRemove={() => dispatch({ type: 'toggleLocations', keys: [k] })}>
            {locationName(k)}
          </Chip>
        ))}
        {state.conditions.map((k) => (
          <Chip key={`c${k}`} onRemove={() => dispatch({ type: 'toggleCondition', key: k })}>
            {conditionLabel(k)}
          </Chip>
        ))}
        {hasFilters ? (
          <button className="btn link" onClick={() => dispatch({ type: 'clearFilters' })}>
            Szűrők törlése
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Chip({ children, onRemove }) {
  return (
    <span className="chip">
      {children}
      <button aria-label="Szűrő eltávolítása" onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

function RegionPicker({ regions, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const byCountry = regions.reduce((acc, r) => {
    (acc[r.countryName ?? r.countryCode] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="popover-wrap" ref={ref}>
      <button className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Régiók szűrése{selected.length ? ` (${selected.length})` : ''} ▾
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Régiók kiválasztása">
          {Object.entries(byCountry).map(([country, list]) => (
            <fieldset key={country}>
              <legend>{country}</legend>
              {list.map((r) => (
                <label key={r.regionKey} className="checkbox">
                  <input type="checkbox" checked={selected.includes(r.regionKey)} onChange={() => onToggle(r.regionKey)} />
                  <span>{r.regionName}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}
