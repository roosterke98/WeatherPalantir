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
export default function ChoroplethMap({ geo, locations, cube, loading, level, period, measure, secondary, selectedRegions, onRegionClick, onLocationClick }) {
  const [wrapRef, width] = useWidth(640);
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const height = Math.max(300, Math.round(width * 0.52));
  const legendH = 46;

  // Melyik paraméter színez és melyik rajzol jelet.
  const fillMeasure = measure.mapEncodings.includes('fill') ? measure : secondary;
  const glyphMeasure = fillMeasure === measure ? secondary : measure;

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

    // --- Régiók ---
    const regions = svg.select('g.regions').selectAll('path').data(geo.features, (f) => f.id);
    regions
      .join('path')
      .attr('d', path)
      .attr('class', (f) => (selectedRegions.includes(f.properties.regionKey) ? 'region selected' : 'region'))
      .on('click', (_, f) => onRegionClick(f))
      .on('pointermove', (event, f) => {
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
      for (const r of glyphRows) {
        const p = anchor(r);
        if (!p) continue;
        // A meteorológiai szélirány azt jelzi, honnan fúj; a nyíl a fújás irányába mutat.
        const g = gGlyph.append('g').attr('transform', `translate(${p[0]},${p[1]}) rotate(${r.values.windDirection + 180})`);
        g.append('path').attr('class', 'arrow-halo').attr('d', 'M0,-18 L0,18 M-6,10 L0,18 L6,10');
        g.append('path').attr('class', 'arrow').attr('d', 'M0,-18 L0,18 M-6,10 L0,18 L6,10');
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
    const locRows = level === 'location' ? byMember : new Map();
    svg
      .select('g.locations')
      .selectAll('circle')
      .data(locations.filter((l) => l.isActive), (l) => l.locationKey)
      .join('circle')
      .attr('class', 'location')
      .attr('cx', (l) => projection([l.longitude, l.latitude])[0])
      .attr('cy', (l) => projection([l.longitude, l.latitude])[1])
      .attr('r', level === 'location' ? 8 : 4.5)
      // Inline stílus, mert a .location CSS szabály felülírná a fill attribútumot.
      .style('fill', (l) => (level === 'location' && locRows.has(String(l.locationKey)) ? fillOf(locRows.get(String(l.locationKey))) : null))
      .on('click', (event, l) => {
        event.stopPropagation();
        onLocationClick(l);
      })
      .on('pointermove', (event, l) => {
        const row = locRows.get(String(l.locationKey));
        const lines = [`<strong>${l.name ?? 'Helyszín'}</strong>`, `<span class="muted">${l.regionName ?? ''}, ${l.countryName ?? ''}</span>`];
        if (row) for (const m of [fillMeasure, glyphMeasure].filter(Boolean)) lines.push(`${m.label}: <b>${formatValue(row.values[m.key], m)}</b>`);
        else lines.push('<span class="muted">Kattintás: szeletelés erre a helyszínre</span>');
        showTip(tip, event, wrapRef.current, lines.join('<br>'));
      })
      .on('pointerleave', () => tip.style('opacity', 0));

    drawLegend(svg.select('g.legend'), width, height, color, fillMeasure, glyphMeasure, noData);
  }, [geo, locations, rows, rowsAtPeriod, level, projection, fillMeasure, glyphMeasure, selectedRegions, width, height, onRegionClick, onLocationClick, wrapRef, theme]);

  return (
    <div className="map-wrap" ref={wrapRef}>
      <div className="map-period">{period ? formatPeriod(period, cube?.grain) : ''}</div>
      {loading && <div className="overlay-loading">Frissítés…</div>}
      <svg ref={svgRef} width={width} height={height + legendH} role="img" aria-label={`Térkép: ${measure.label}`}>
        <g className="regions" />
        <g className="glyphs" />
        <g className="locations" />
        <g className="legend" />
      </svg>
      <div ref={tipRef} className="tooltip" />
    </div>
  );
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

function drawLegend(g, width, height, color, fillMeasure, glyphMeasure, noData) {
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
      gl.append('text').attr('class', 'legend-label').attr('x', 30).attr('y', 4).text('Szélirány (fújás iránya)');
    } else {
      gl.append('circle').attr('class', 'bubble').attr('cx', 8).attr('cy', 0).attr('r', 8);
      gl.append('text').attr('class', 'legend-label').attr('x', 22).attr('y', 4).text(`${glyphMeasure.label} (buborék mérete)`);
    }
  }
}
