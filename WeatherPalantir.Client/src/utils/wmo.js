// A WMO időjárási kódok (dm.DimWeatherCondition) magyar megnevezései.
export const WMO_HU = {
  0: 'Derült ég',
  1: 'Túlnyomóan derült',
  2: 'Részben felhős',
  3: 'Borult',
  45: 'Köd',
  48: 'Zúzmarás köd',
  51: 'Gyenge szitálás',
  53: 'Mérsékelt szitálás',
  55: 'Erős szitálás',
  56: 'Gyenge ónos szitálás',
  57: 'Erős ónos szitálás',
  61: 'Gyenge eső',
  63: 'Mérsékelt eső',
  65: 'Erős eső',
  66: 'Gyenge ónos eső',
  67: 'Erős ónos eső',
  71: 'Gyenge havazás',
  73: 'Mérsékelt havazás',
  75: 'Erős havazás',
  77: 'Hószemcsék',
  80: 'Gyenge zápor',
  81: 'Mérsékelt zápor',
  82: 'Heves zápor',
  85: 'Gyenge hózápor',
  86: 'Erős hózápor',
  95: 'Zivatar',
  96: 'Zivatar gyenge jégesővel',
  97: 'Erős zivatar',
  99: 'Zivatar erős jégesővel',
};

export const SEVERITY_HU = { Low: 'Alacsony', Mild: 'Enyhe', Moderate: 'Mérsékelt', Severe: 'Súlyos', Extreme: 'Extrém' };

export const conditionLabel = (key, fallback) => (key == null ? 'Ismeretlen' : WMO_HU[key] ?? fallback ?? `WMO ${key}`);
