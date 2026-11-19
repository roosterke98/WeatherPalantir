import { useEffect, useRef, useState } from 'react';
import { formatPeriod, GRAINS } from '../utils/time.js';

/** Lejátszási sebesség (lépés / másodperc): 0,25 és 4 között, 0,25-ös léptékkel. */
const SPEED_MIN = 0.25;
const SPEED_MAX = 4;
const SPEED_STEP = 0.25;
const SPEED_KEY = 'wp.sliderSpeed';
const speedText = (v) => `${String(v).replace('.', ',')}×`;

function loadSpeed() {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v >= SPEED_MIN && v <= SPEED_MAX && Number.isInteger(v / SPEED_STEP) ? v : 1;
  } catch {
    return 1;
  }
}

/** Sebességmérő ikon. */
const SpeedIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 12a6 6 0 1 1 11 0" />
    <path d="M8 10.5 11 6" />
    <circle cx="8" cy="10.5" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

/** Ikonos gomb, amely egy kis felugró csúszkán állítja a lejátszási sebességet. */
function SpeedControl({ speed, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="speed-control" ref={ref}>
      <button
        type="button"
        className={`btn icon${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Lejátszási sebesség: ${speedText(speed)} lépés/mp`}
        title={`Lejátszási sebesség: ${speedText(speed)} lépés/mp`}
      >
        <SpeedIcon />
      </button>
      {open && (
        <div className="speed-popover card" role="dialog" aria-label="Lejátszási sebesség">
          <div className="speed-head">
            <span className="muted small">Sebesség</span>
            <strong>{speedText(speed)} lépés/mp</strong>
          </div>
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={speed}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="Lejátszási sebesség (lépés/mp)"
            aria-valuetext={`${speedText(speed)} lépés másodpercenként`}
            autoFocus
          />
          <div className="speed-scale muted small">
            <span>{speedText(SPEED_MIN)}</span>
            <span>{speedText(SPEED_MAX)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A kijelölt időszak periódusai között léptető csúszka, amely az aktuális részletességi szinthez
 * (óra / nap / hónap / év) igazodik. Lejátszás gombbal, állítható sebességgel animálható.
 * Az aktuális dátumra kattintva az időszak arra a periódusra szűkíthető (újabb kattintásra visszaáll).
 */
export default function TimeSlider({ periods, index, onChange, grain, forecastStart, focused, onFocusPeriod }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(loadSpeed);
  const last = periods.length - 1;

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      onChange((i) => {
        if (i >= last) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, last, speed, onChange]);

  useEffect(() => setPlaying(false), [periods]);

  const changeSpeed = (v) => {
    setSpeed(v);
    try {
      localStorage.setItem(SPEED_KEY, String(v));
    } catch {
      /* a tárolás nem kötelező */
    }
  };

  if (!periods.length) return <div className="time-slider muted small">Nincs megjeleníthető periódus a kijelölt időszakban.</div>;

  const current = periods[Math.min(index, last)];
  const isForecast = forecastStart && current > forecastStart;
  const grainLabel = GRAINS.find((g) => g.key === grain)?.label.toLowerCase();
  const focusTitle = focused ? 'Vissza az eredeti időszakra' : 'Időszak szűkítése erre a periódusra';

  return (
    <div className="time-slider">
      <button
        className="btn icon"
        onClick={() => {
          if (!playing && index >= last) onChange(0);
          setPlaying((p) => !p);
        }}
        aria-label={playing ? 'Szünet' : 'Lejátszás'}
        title={playing ? 'Szünet' : 'Lejátszás'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="btn icon" onClick={() => onChange(Math.max(0, index - 1))} disabled={index <= 0} aria-label="Előző periódus">
        ‹
      </button>
      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={Math.min(index, last)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`Periódus (${grainLabel})`}
        aria-valuetext={formatPeriod(current, grain)}
      />
      <button className="btn icon" onClick={() => onChange(Math.min(last, index + 1))} disabled={index >= last} aria-label="Következő periódus">
        ›
      </button>
      <SpeedControl speed={speed} onChange={changeSpeed} />
      <div className="slider-label">
        <button
          type="button"
          className={`slider-date${focused ? ' active' : ''}`}
          onClick={() => {
            setPlaying(false);
            onFocusPeriod?.(current);
          }}
          aria-pressed={!!focused}
          title={focusTitle}
        >
          {formatPeriod(current, grain)}
          <span aria-hidden="true">{focused ? ' ↺' : ''}</span>
        </button>
        <span className="muted small">
          {index + 1} / {periods.length} {grainLabel}
          {isForecast ? ' · előrejelzés' : ''}
          {focused ? ' · szűkített időszak' : ''}
        </span>
      </div>
    </div>
  );
}
