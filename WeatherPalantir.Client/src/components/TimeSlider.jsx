import { useEffect, useState } from 'react';
import { formatPeriod, GRAINS } from '../utils/time.js';

/**
 * A kijelölt időszak periódusai között léptető csúszka, amely az aktuális részletességi szinthez
 * (óra / nap / hónap / év) igazodik. Lejátszás gombbal animálható.
 */
export default function TimeSlider({ periods, index, onChange, grain, forecastStart }) {
  const [playing, setPlaying] = useState(false);
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
    }, grain === 'hour' ? 250 : 500);
    return () => clearInterval(id);
  }, [playing, last, grain, onChange]);

  useEffect(() => setPlaying(false), [periods]);

  if (!periods.length) return <div className="time-slider muted small">Nincs megjeleníthető periódus a kijelölt időszakban.</div>;

  const current = periods[Math.min(index, last)];
  const isForecast = forecastStart && current > forecastStart;
  const grainLabel = GRAINS.find((g) => g.key === grain)?.label.toLowerCase();

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
      <div className="slider-label">
        <strong>{formatPeriod(current, grain)}</strong>
        <span className="muted small">
          {index + 1} / {periods.length} {grainLabel}
          {isForecast ? ' · előrejelzés' : ''}
        </span>
      </div>
    </div>
  );
}
