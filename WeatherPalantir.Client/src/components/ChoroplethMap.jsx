import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useWidth } from '../hooks/useSize.js';
import { fillScale } from '../utils/colors.js';
import { formatValue } from '../utils/format.js';
import { formatPeriod, parsePeriod } from '../utils/time.js';
import { useTheme } from '../utils/theme.js';

/**
 * Színezett (choropleth) térkép a régiók határaival (dm.DimRegion → GeoJSON).
 *  - színezés (fill): a kiválasztott paraméter színskálán,
 *  - jel (glyph): szélirány esetén irányvonalak, csapadéknál buborékok,
 *  - a csúszka aktuális periódusának értékei jelennek meg, a színskála a teljes időszakra rögzített.
 */
export default function ChoroplethMap({
  geo, locations, cube, loading, level, period, measure, secondary, selectedRegions, selectedLocations = [], selectMode = false,
  pickMode = false, picked = null, onPick, onRegionClick, onLocationClick,
}) {
  const [wrapRef, width] = useWidth(640);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const height = Math.max(300, Math.round(width * 0.52));
  const legendH = 46;

  // Melyik paraméter színez és melyik rajzol jelet.
  const fillMeasure = measure.mapEncodings.includes('fill') ? measure : secondary;
  const glyphMeasure = fillMeasure === measure ? secondary : measure;
  const speedArrows = fillMeasure?.colorScheme === 'wind' && glyphMeasure?.key === 'windDirection';

  const rows = cube?.level === level ? cube.rows : [];
  const rowsAtPeriod = useMemo(
    () => (period ? rows.filter((r) => r.period && +parsePeriod(r.period) === +period) : rows),
    [rows, period],
  );

  const theme = useTheme();
  // A vetület a megjelenített (kiválasztott) országokra / régióra illeszkedik, így lefúráskor a térkép ráközelít.
  const projection = useMemo(
    () => d3.geoMercator().fitExtent([[12, 12], [width - 12, height - 12]], geo.features.length ? geo : { type: 'Sphere' }),
    [geo, width, height],
  );

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const tip = d3.select(tipRef.current);
    const path = d3.geoPath(projection);
    const byMember = new Map(rowsAtPeriod.map((r) => [r.memberKey, r]));

    const rowForFeature = (f) => {
      if (level === 'region') return byMember.get(String(f.properties.regionKey));
      if (level === 'country') return byMember.get(f.properties.countryCode);
      if (level === 'all') return byMember.get('ALL');
      return null; // helyszín szinten a pontok hordozzák az értéket
    };

    const color = fillMeasure ? fillScale(fillMeasure.colorScheme, rows.map((r) => r.values[fillMeasure.key])) : null;
    const noData = getComputedStyle(svgRef.current).getPropertyValue('--map-nodata').trim() || '#e1e0d9';
    const fillOf = (row) => {
      const v = row?.values?.[fillMeasure?.key];
      return v != null && color ? color(v) : noData;
    };

    // --- Új helyszín felvétele: a kurzor alatti pont földrajzi koordinátái a vetület inverzéből ---
    const coordAt = (event) => {
      const [px, py] = d3.pointer(event, svgRef.current);
      if (py > height) return null; // a jelmagyarázat sávja
      const ll = projection.invert([px, py]);
      return ll && Math.abs(ll[1]) <= 90 ? { longitude: ll[0], latitude: ll[1] } : null;
    };
    const coordLine = (c) => `${formatCoord(c.latitude, 'É', 'D')}, ${formatCoord(c.longitude, 'K', 'Ny')}`;
    const pickTip = (event, title) => {
      const c = coordAt(event);
      if (!c) return tip.style('opacity', 0);
      const lines = [title ? `<strong>${title}</strong>` : null, coordLine(c), '<span class="muted">Kattintás: felvétel új helyszínként</span>'];
      showTip(tip, event, wrapRef.current, lines.filter(Boolean).join('<br>'));
    };
    svg
      .select('rect.pick-bg')
      .attr('width', width)
      .attr('height', height)
      .on('pointermove', pickMode ? (event) => pickTip(event, null) : null)
      .on('pointerleave', () => tip.style('opacity', 0));
    svg.on('click.pick', pickMode ? (event) => {
      const c = coordAt(event);
      if (c) onPick?.(c);
    } : null);

    // --- Régiók ---
    const regions = svg.select('g.regions').selectAll('path').data(geo.features, (f) => f.id);
    regions
      .join('path')
      .attr('d', path)
      .attr('class', (f) => (selectedRegions.includes(f.properties.regionKey) ? 'region selected' : 'region'))
      // Felvételi módban a kattintás továbbjut az svg-hez (koordináta), nem fúr le a régióba.
      .on('click', (_, f) => { if (!pickMode) onRegionClick(f); })
      .on('pointermove', (event, f) => {
        if (pickMode) return pickTip(event, `${f.properties.regionName}${f.properties.countryName ? `, ${f.properties.countryName}` : ''}`);
        const row = rowForFeature(f);
        const lines = [`<strong>${f.properties.regionName}</strong>`, `<span class="muted">${f.properties.countryName ?? ''}</span>`];
        if (row) {
          if (level !== 'region') lines.push(`<span class="muted">${row.memberName} összesítve</span>`);
          for (const m of [fillMeasure, glyphMeasure].filter(Boolean)) lines.push(`${m.label}: <b>${formatValue(row.values[m.key], m)}</b>`);
          lines.push(`<span class="muted">${row.locationCount} helyszín · ${row.hourCount} óra</span>`);
        } else if (level !== 'location') {
          lines.push('<span class="muted">Nincs adat ebben a periódusban</span>');
        }
        showTip(tip, event, wrapRef.current, lines.join('<br>'));
      })
      .on('pointerleave', () => tip.style('opacity', 0))
      .transition()
      .duration(250)
      .attr('fill', (f) => (level === 'location' ? noData : fillOf(rowForFeature(f))));

    // --- Jelek (glyph): szélirány nyilak vagy csapadék buborékok ---
    const anchor = (row) => {
      if (level === 'location') {
        const loc = locations.find((l) => String(l.locationKey) === row.memberKey);
        return loc ? projection([loc.longitude, loc.latitude]) : null;
      }
      const feats = geo.features.filter((f) =>
        level === 'region' ? String(f.properties.regionKey) === row.memberKey : level === 'country' ? f.properties.countryCode === row.memberKey : true,
      );
      if (!feats.length) return null;
      if (feats.length === 1) return path.centroid(feats[0]);
      return path.centroid({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: feats.flatMap((f) => f.geometry.coordinates) } });
    };

    const glyphRows = glyphMeasure ? rowsAtPeriod.filter((r) => r.values[glyphMeasure.key] != null) : [];
    const gGlyph = svg.select('g.glyphs');
    gGlyph.selectAll('*').remove();
    if (glyphMeasure?.key === 'windDirection') {
      // Szélsebesség színezése mellett a nyíl hossza a sebességgel arányos, egyébként egységes.
      const half = speedArrows
        ? d3.scaleLinear([0, d3.max(rows, (r) => r.values[fillMeasure.key]) || 1], [7, 22]).clamp(true)
        : () => 18;
      for (const r of glyphRows) {
        const p = anchor(r);
        if (!p) continue;
        const h = half(speedArrows ? r.values[fillMeasure.key] ?? 0 : 0);
        const d = `M0,${-h} L0,${h} M-6,${h - 8} L0,${h} L6,${h - 8}`;
        // A meteorológiai szélirány azt jelzi, honnan fúj; a nyíl a fújás irányába mutat.
        const g = gGlyph.append('g').attr('transform', `translate(${p[0]},${p[1]}) rotate(${r.values.windDirection + 180})`);
        g.append('path').attr('class', 'arrow-halo').attr('d', d);
        g.append('path').attr('class', 'arrow').attr('d', d);
      }
    } else if (glyphMeasure) {
      const max = d3.max(rows, (r) => r.values[glyphMeasure.key]) || 1;
      const radius = d3.scaleSqrt([0, max], [0, 24]);
      for (const r of glyphRows) {
        const p = anchor(r);
        if (!p) continue;
        gGlyph.append('circle').attr('class', 'bubble').attr('cx', p[0]).attr('cy', p[1]).attr('r', radius(r.values[glyphMeasure.key]));
      }
    }

    // --- Helyszínek ---
    // Minden helyszín egy átlátszatlan magból (a jelölő-/kijelölési kör) és egy nagyobb, a középponttól
    // kifelé egyre áttetszőbb udvarból áll; az udvar a kurzor alatt kiemelődik.
    const locRows = level === 'location' ? byMember : new Map();
    const core = level === 'location' ? 8 : 4.5;
    const locFill = (l) => (level === 'location' && locRows.has(String(l.locationKey)) ? fillOf(locRows.get(String(l.locationKey))) : null);
    const locs = svg
      .select('g.locations')
      .selectAll('g.loc')
      .data(locations.filter((l) => l.isActive), (l) => l.locationKey)
      .join((enter) => {
        const g = enter.append('g');
        g.append('circle').attr('class', 'loc-halo').attr('mask', 'url(#loc-fade)');
        g.append('circle').attr('class', 'location');
        return g;
      })
      .attr('class', (l) => (selectedLocations.includes(l.locationKey) ? 'loc selected' : 'loc'))
      .attr('transform', (l) => `translate(${projection([l.longitude, l.latitude])})`)
      .style('--halo', `${core * 3}px`)
      .style('--halo-hover', `${core * 3.6}px`);
    // Inline stílus, mert a CSS szabályok felülírnák a fill attribútumot.
    // Az udvar kissé sötétebb a magnál, hogy a világos adatszínek is kirajzolódjanak a szürke háttéren.
    locs.select('circle.loc-halo').style('fill', (l) => {
      const c = locFill(l);
      return c ? d3.color(c)?.darker(0.5)?.formatHex() ?? c : null;
    });
    locs
      .select('circle.location')
      .attr('class', (l) => (selectedLocations.includes(l.locationKey) ? 'location selected' : 'location'))
      .attr('r', core)
      .style('fill', (l) => locFill(l));
    locs
      .on('click', (event, l) => {
        event.stopPropagation();
        // Meglévő helyszín nem vehető fel újra.
        if (!pickMode) onLocationClick(l);
      })
      .on('pointermove', (event, l) => {
        const row = locRows.get(String(l.locationKey));
        const lines = [
          `<strong>${l.name ?? 'Helyszín'}</strong> <span class="muted">(${formatCoord(l.latitude, 'É', 'D')}, ${formatCoord(l.longitude, 'K', 'Ny')})</span>`,
          `<span class="muted">${l.regionName ?? ''}, ${l.countryName ?? ''}</span>`,
        ];
        if (row) for (const m of [fillMeasure, glyphMeasure].filter(Boolean)) lines.push(`${m.label}: <b>${formatValue(row.values[m.key], m)}</b>`);
        lines.push(
          `<span class="muted">${
            pickMode
              ? 'Már szerepel az adattárházban'
              : selectMode
              ? selectedLocations.includes(l.locationKey) ? 'Kattintás: kivétel a kijelölésből' : 'Kattintás: hozzáadás a kijelöléshez'
              : 'Kattintás: lefúrás a helyszínig'
          }</span>`,
        );
        showTip(tip, event, wrapRef.current, lines.join('<br>'));
      })
      .on('pointerleave', () => tip.style('opacity', 0));

    // --- A felvételre kiválasztott pont ---
    const gPick = svg.select('g.pick-marker');
    gPick.selectAll('*').remove();
    if (picked) {
      const p = projection([picked.longitude, picked.latitude]);
      if (p) {
        gPick.append('circle').attr('class', 'target-ring').attr('cx', p[0]).attr('cy', p[1]).attr('r', 14);
        gPick.append('circle').attr('class', 'target').attr('cx', p[0]).attr('cy', p[1]).attr('r', 6);
        if (picked.name) gPick.append('text').attr('class', 'target-label').attr('x', p[0] + 16).attr('y', p[1] + 4).text(picked.name);
      }
    }

    drawLegend(svg.select('g.legend'), width, height, color, fillMeasure, glyphMeasure, noData, speedArrows);
  }, [geo, locations, rows, rowsAtPeriod, level, projection, fillMeasure, glyphMeasure, speedArrows, selectedRegions, selectedLocations, selectMode, pickMode, picked, onPick, width, height, onRegionClick, onLocationClick, wrapRef, theme]);

  return (
    <div className={pickMode ? 'map-wrap picking' : selectMode ? 'map-wrap selecting' : 'map-wrap'} ref={wrapRef}>
      <div className="map-period">{period ? formatPeriod(period, cube?.grain) : ''}</div>
      {loading && <div className="overlay-loading">Frissítés…</div>}
      <svg ref={svgRef} width={width} height={height + legendH} role="img" aria-label={`Térkép: ${measure.label}`}>
        <defs>
          {/* A helyszínek udvarának maszkja: középen átlátszatlan, a széle felé fokozatosan elhalványul. */}
          <radialGradient id="loc-fade-grad">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="loc-fade" maskContentUnits="objectBoundingBox">
            <rect width="1" height="1" fill="url(#loc-fade-grad)" />
          </mask>
        </defs>
        {/* Felvételi módban a régiókon kívüli (üres) területre kattintva is meghatározható a koordináta. */}
        <rect className="pick-bg" />
        <g className="regions" />
        <g className="glyphs" />
        <g className="locations" />
        <g className="pick-marker" />
        <g className="legend" />
      </svg>
      <div ref={tipRef} className="tooltip" />
    </div>
  );
}

/** Földrajzi koordináta fokban, égtáj-betűvel (pl. 47.4979° É). */
export function formatCoord(v, pos, neg) {
  if (v == null) return '–';
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
}

export function showTip(tip, event, container, html) {
  const rect = container.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const flip = x > rect.width - 220;
  tip
    .html(html)
    .style('opacity', 1)
    .style('left', `${flip ? x - 14 : x + 14}px`)
    .style('top', `${y + 14}px`)
    .style('transform', flip ? 'translateX(-100%)' : 'none');
}

function drawLegend(g, width, height, color, fillMeasure, glyphMeasure, noData, speedArrows) {
  g.selectAll('*').remove();
  g.attr('transform', `translate(16, ${height + 8})`);
  let x = 0;
  if (color && fillMeasure) {
    const w = Math.min(260, width * 0.45);
    const id = 'map-gradient';
    const [lo, hi] = [color.domain()[0], color.domain()[color.domain().length - 1]];
    const grad = g.append('defs').append('linearGradient').attr('id', id);
    d3.range(0, 1.01, 0.1).forEach((t) => grad.append('stop').attr('offset', t).attr('stop-color', color(lo + t * (hi - lo))));
    g.append('text').attr('class', 'legend-title').attr('y', 0).text(`${fillMeasure.label} (${fillMeasure.unit})`);
    g.append('rect').attr('y', 6).attr('width', w).attr('height', 10).attr('rx', 2).attr('fill', `url(#${id})`);
    const axis = d3.scaleLinear([lo, hi], [0, w]);
    g.append('g')
      .attr('class', 'axis')
      .attr('transform', 'translate(0,16)')
      .call(d3.axisBottom(axis).ticks(5).tickSize(4))
      .call((a) => a.select('.domain').remove());
    x = w + 24;
  }
  const nd = g.append('g').attr('transform', `translate(${x},6)`);
  nd.append('rect').attr('width', 14).attr('height', 10).attr('rx', 2).attr('fill', noData).attr('class', 'nodata-swatch');
  nd.append('text').attr('class', 'legend-label').attr('x', 20).attr('y', 9).text('Nincs adat');
  x += 100;
  if (glyphMeasure) {
    const gl = g.append('g').attr('transform', `translate(${x},10)`);
    if (glyphMeasure.key === 'windDirection') {
      gl.append('path').attr('class', 'arrow').attr('d', 'M0,0 L22,0 M16,-5 L22,0 L16,5');
      gl.append('text').attr('class', 'legend-label').attr('x', 30).attr('y', 4).text(speedArrows ? 'Szélirány (a nyíl hossza a sebességgel arányos)' : 'Szélirány (fújás iránya)');
    } else {
      gl.append('circle').attr('class', 'bubble').attr('cx', 8).attr('cy', 0).attr('r', 8);
      gl.append('text').attr('class', 'legend-label').attr('x', 22).attr('y', 4).text(`${glyphMeasure.label} (buborék mérete)`);
    }
  }
}
