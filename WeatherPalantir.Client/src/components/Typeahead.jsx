import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { useDebounced } from '../hooks/useFetch.js';
import { formatInt } from '../utils/format.js';

/**
 * Typeahead (autocomplete) helyszínkereső. Gépelés közben (300 ms késleltetéssel) a backenden keresztül
 * az Open-Meteo Geocoding API-t kérdezi le. Billentyűzettel is kezelhető (↑ ↓ Enter Esc).
 */
export default function Typeahead({ onSelect }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const query = useDebounced(text.trim(), 300);
  const listId = useId();
  const boxRef = useRef(null);
  const chosenText = useRef(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .geocode(query, controller.signal)
      .then((r) => {
        setResults(r);
        setActive(r.findIndex((x) => !x.alreadyTracked));
        // A kiválasztás után beírt névre induló keresés ne nyissa újra a listát.
        setOpen(query !== chosenText.current);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(e.message);
        setResults([]);
        setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    const close = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  // Bármely ország helyszíne felvehető, csak a már nyilvántartott / sorban álló nem.
  const selectable = (r) => !r.alreadyTracked;
  const choose = (r) => {
    if (!r || !selectable(r)) return;
    onSelect(r);
    chosenText.current = r.name;
    setText(r.name);
    setOpen(false);
  };

  const move = (dir) => {
    if (!results.length) return;
    let i = active;
    for (let n = 0; n < results.length; n++) {
      i = (i + dir + results.length) % results.length;
      if (selectable(results[i])) break;
    }
    setActive(i);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="typeahead" ref={boxRef}>
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder="Település keresése (pl. Szeged, Linz)…"
        value={text}
        onChange={(e) => { chosenText.current = null; setText(e.target.value); setOpen(true); }}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {loading && <span className="typeahead-spinner" aria-label="Keresés…" />}
      {error && <div className="alert error small">{error}</div>}
      {open && query.length >= 2 && !loading && (
        <ul className="typeahead-list" id={listId} role="listbox">
          {!results.length && <li className="empty">Nincs találat</li>}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={!selectable(r)}
              className={[i === active ? 'active' : '', !selectable(r) ? 'disabled' : ''].join(' ')}
              onPointerEnter={() => selectable(r) && setActive(i)}
              onClick={() => choose(r)}
            >
              <div className="ta-main">
                <strong>{highlight(r.name, query)}</strong>
                <span className="muted">
                  {[r.admin1, r.country].filter(Boolean).join(', ')}
                  {r.population ? ` · ${formatInt(r.population)} fő` : ''}
                </span>
              </div>
              <div className="ta-side">
                {r.alreadyTracked ? (
                  <span className="badge neutral">Már szerepel</span>
                ) : r.supported ? (
                  <span className="badge good">{r.regionName}</span>
                ) : (
                  <span className="badge info" title="Az ország régióinak határait az ETL tölti be">Új ország</span>
                )}
                <span className="muted small">
                  {r.latitude.toFixed(3)}, {r.longitude.toFixed(3)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function highlight(name, query) {
  const i = name.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + query.length)}</mark>
      {name.slice(i + query.length)}
    </>
  );
}
