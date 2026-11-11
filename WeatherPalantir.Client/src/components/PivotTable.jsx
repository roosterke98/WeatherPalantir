import { useState } from 'react';
import { formatValue } from '../utils/format.js';

/**
 * Aggregált táblázat: az elérhető paraméterek egy listában szerepelnek, a másik listába áthelyezve
 * (húzással, dupla kattintással vagy a nyíl gombokkal) új oszlopként / sorként jelennek meg.
 * A pivot gomb felcseréli a sorokat és az oszlopokat.
 */
export default function PivotTable({ measures, selected, onSelectedChange, pivot, onPivot, data, loading, error, level, onMemberClick }) {
  const byKey = Object.fromEntries(measures.map((m) => [m.key, m]));
  const selectedMeasures = selected.map((k) => byKey[k]).filter(Boolean);
  const [members, total] = data ?? [null, null];
  const rows = members?.rows ?? [];
  const totalRow = total?.rows?.[0];

  const exportCsv = () => {
    const header = ['Tag', ...selectedMeasures.map((m) => `${m.label} (${m.unit})`)];
    const lines = [...rows, ...(totalRow && level !== 'all' ? [{ ...totalRow, memberName: 'Összesen' }] : [])].map((r) => [
      r.memberName,
      ...selectedMeasures.map((m) => r.values[m.key] ?? ''),
    ]);
    const csv = [header, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'weatherpalantir-tabla.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pivot">
      <DualList measures={measures} selected={selected} onChange={onSelectedChange} />

      <div className="pivot-table">
        <div className="table-tools">
          <button className="btn" onClick={onPivot} title="Sorok és oszlopok felcserélése">
            ⇄ Pivot ({pivot ? 'paraméterek soronként' : 'paraméterek oszloponként'})
          </button>
          <button className="btn ghost" onClick={exportCsv} disabled={!rows.length || !selectedMeasures.length}>
            CSV export
          </button>
          {loading && <span className="muted small">Frissítés…</span>}
        </div>
        {error && <div className="alert error">{error.message}</div>}
        {!selectedMeasures.length ? (
          <div className="empty">Húzzon át legalább egy paramétert a „Kiválasztott” listába.</div>
        ) : !rows.length && !loading ? (
          <div className="empty">Nincs adat a kijelölt szeletben.</div>
        ) : (
          <div className="table-scroll">
            {pivot ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Paraméter</th>
                    {rows.map((r) => (
                      <th key={r.memberKey} className="num">
                        <MemberButton row={r} level={level} onClick={onMemberClick} />
                      </th>
                    ))}
                    {level !== 'all' && totalRow && <th className="num">Összesen</th>}
                  </tr>
                </thead>
                <tbody>
                  {selectedMeasures.map((m) => (
                    <tr key={m.key}>
                      <th scope="row">{m.label}</th>
                      {rows.map((r) => (
                        <td key={r.memberKey} className="num">{formatValue(r.values[m.key], m)}</td>
                      ))}
                      {level !== 'all' && totalRow && <td className="num total">{formatValue(totalRow.values[m.key], m)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    {selectedMeasures.map((m) => (
                      <th key={m.key} className="num">
                        {m.label}
                        <span className="th-unit">{m.unit}</span>
                      </th>
                    ))}
                    <th className="num">Helyszín / óra</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.memberKey}>
                      <th scope="row"><MemberButton row={r} level={level} onClick={onMemberClick} /></th>
                      {selectedMeasures.map((m) => (
                        <td key={m.key} className="num">{formatValue(r.values[m.key], m)}</td>
                      ))}
                      <td className="num muted">{r.locationCount} / {r.hourCount}</td>
                    </tr>
                  ))}
                </tbody>
                {level !== 'all' && totalRow && (
                  <tfoot>
                    <tr>
                      <th scope="row">Összesen</th>
                      {selectedMeasures.map((m) => (
                        <td key={m.key} className="num">{formatValue(totalRow.values[m.key], m)}</td>
                      ))}
                      <td className="num muted">{totalRow.locationCount} / {totalRow.hourCount}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberButton({ row, level, onClick }) {
  if (level === 'all' || level === 'location') return row.memberName;
  return (
    <button className="btn link" onClick={() => onClick({ key: row.memberKey, name: row.memberName })} title="Lefúrás">
      {row.memberName}
    </button>
  );
}

function DualList({ measures, selected, onChange }) {
  const [focusAvail, setFocusAvail] = useState(null);
  const [focusSel, setFocusSel] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const available = measures.filter((m) => !selected.includes(m.key));
  const chosen = selected.map((k) => measures.find((m) => m.key === k)).filter(Boolean);

  const add = (key) => key && !selected.includes(key) && onChange([...selected, key]);
  const remove = (key) => key && onChange(selected.filter((k) => k !== key));

  const onDrop = (target) => (e) => {
    e.preventDefault();
    setDragOver(null);
    const key = e.dataTransfer.getData('text/plain');
    if (target === 'selected') add(key);
    else remove(key);
  };

  const item = (m, list) => (
    <li
      key={m.key}
      draggable
      tabIndex={0}
      className={(list === 'a' ? focusAvail : focusSel) === m.key ? 'focused' : ''}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', m.key)}
      onClick={() => (list === 'a' ? setFocusAvail(m.key) : setFocusSel(m.key))}
      onDoubleClick={() => (list === 'a' ? add(m.key) : remove(m.key))}
      onKeyDown={(e) => e.key === 'Enter' && (list === 'a' ? add(m.key) : remove(m.key))}
    >
      <span>{m.label}</span>
      <span className="muted small">{m.unit}</span>
    </li>
  );

  return (
    <div className="dual-list">
      <div
        className={dragOver === 'available' ? 'list-box drag-over' : 'list-box'}
        onDragOver={(e) => { e.preventDefault(); setDragOver('available'); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={onDrop('available')}
      >
        <h4>Elérhető paraméterek</h4>
        <ul>{available.map((m) => item(m, 'a'))}</ul>
      </div>
      <div className="dual-buttons">
        <button className="btn icon" onClick={() => add(focusAvail)} disabled={!focusAvail || selected.includes(focusAvail)} aria-label="Hozzáadás">›</button>
        <button className="btn icon" onClick={() => onChange(measures.map((m) => m.key))} aria-label="Összes hozzáadása">»</button>
        <button className="btn icon" onClick={() => remove(focusSel)} disabled={!focusSel || !selected.includes(focusSel)} aria-label="Eltávolítás">‹</button>
        <button className="btn icon" onClick={() => onChange([])} aria-label="Összes eltávolítása">«</button>
      </div>
      <div
        className={dragOver === 'selected' ? 'list-box drag-over' : 'list-box'}
        onDragOver={(e) => { e.preventDefault(); setDragOver('selected'); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={onDrop('selected')}
      >
        <h4>Kiválasztott (oszlopok)</h4>
        <ul>{chosen.map((m) => item(m, 's'))}</ul>
      </div>
    </div>
  );
}
