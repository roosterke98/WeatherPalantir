import * as d3 from 'd3';

// Magyar dátum- és számformázás a D3 tengelyekhez és feliratokhoz.
d3.timeFormatDefaultLocale({
  dateTime: '%Y. %B %-e., %A %X',
  date: '%Y.%m.%d.',
  time: '%H:%M:%S',
  periods: ['de.', 'du.'],
  days: ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'],
  shortDays: ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'],
  months: ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'],
  shortMonths: ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'],
});

d3.formatDefaultLocale({
  decimal: ',',
  thousands: ' ',
  grouping: [3],
  currency: ['', ' Ft'],
});
