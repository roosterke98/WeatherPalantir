// A backend REST API hívásai. Minden adat az ASP.NET Core rétegen keresztül érkezik az adattárházból.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function toQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) q.set(k, v.join(','));
    } else {
      q.set(k, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function request(path, { params, signal, method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}${params ? toQuery(params) : ''}`, {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const problem = await res.json();
      message = problem.detail || problem.title || message;
    } catch {
      /* nem ProblemDetails válasz */
    }
    throw new ApiError(message, res.status);
  }
  return res.status === 204 ? null : res.json();
}

/** Az OLAP állapotból a kocka-lekérdezés paraméterei. */
export function cubeParams(s, overrides = {}) {
  return {
    from: s.from,
    to: s.to,
    grain: s.grain,
    level: s.level,
    kind: s.kind,
    countries: s.countries,
    regions: s.regions,
    locations: s.locations,
    conditions: s.conditions,
    ...overrides,
  };
}

export const api = {
  measures: (signal) => request('/measures', { signal }),
  locations: (signal) => request('/locations', { signal }),
  regions: (signal) => request('/regions', { signal }),
  regionsGeoJson: (signal) => request('/regions/geojson', { signal }),
  range: (signal) => request('/weather/range', { signal }),
  cube: (params, signal) => request('/weather/cube', { params, signal }),
  conditions: (params, signal) => request('/weather/conditions', { params, signal }),
  windRose: (params, signal) => request('/weather/windrose', { params, signal }),
  errorLog: (params, signal) => request('/errorlog', { params, signal }),
  errorPackages: (signal) => request('/errorlog/packages', { signal }),
  geocode: (name, signal) => request('/geocoding/search', { params: { name, count: 10, language: 'hu' }, signal }),
  newLocations: (signal) => request('/newlocations', { signal }),
  addNewLocation: (body) => request('/newlocations', { method: 'POST', body }),
};
