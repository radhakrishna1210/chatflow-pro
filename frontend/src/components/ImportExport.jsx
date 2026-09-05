import { useState, useRef } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { Modal } from './Modal.jsx';
import { wDownload, wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

// Import and export for a CRM list. Import currently supports leads only; the
// export side is generic, so `entity` drives the download for any list the
// server can export.
export const ImportExport = ({ entity, canImport = false, canExport = true, onImported }) => {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);

  const reset = () => { setPreview(null); setFile(null); setResult(null); setErr(null); };

  const exportCsv = async () => {
    setErr(null);
    try {
      await wDownload(`/crm-data/export/${entity}`, `${entity}.csv`);
    } catch (e) {
      setErr(e?.message || 'Could not export. Exporting requires an admin account.');
    }
  };

  const choose = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', f);
      const res = await wFetch('/crm-data/import/leads/preview', { method: 'POST', body: form });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not read that file');
      }
      setPreview(await res.json());
    } catch (e2) {
      setErr(e2.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await wFetch('/crm-data/import/leads', { method: 'POST', body: form });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Import failed');
      }
      setResult(await res.json());
      setPreview(null);
      onImported?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        {canImport && (
          <Btn size="sm" variant="outline" onClick={() => { reset(); setOpen(true); }}>
            <I n="download" s={12} c="currentColor" /> Import
          </Btn>
        )}
        {canExport && (
          <Btn size="sm" variant="ghost" onClick={exportCsv} title="Download as CSV">
            Export
          </Btn>
        )}
      </div>

      {open && (
        <Modal title="Import leads from CSV" onClose={() => { setOpen(false); reset(); }} width={620}
          footer={<>
            <Btn variant="ghost" size="sm" onClick={() => { setOpen(false); reset(); }}>Close</Btn>
            {preview && preview.valid > 0 && (
              <Btn size="sm" onClick={runImport} disabled={busy}>
                {busy ? 'Importing…' : `Import ${preview.valid} lead${preview.valid === 1 ? '' : 's'}`}
              </Btn>
            )}
          </>}>

          {err && (
            <div style={{ marginBottom: 12, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5 }}>
              {err}
            </div>
          )}

          {!preview && !result && (
            <div>
              <p style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 0, lineHeight: 1.55 }}>
                Upload a CSV with at least a phone column. Columns named like
                {' '}<code style={{ color: 'var(--t1)' }}>name</code>, <code style={{ color: 'var(--t1)' }}>email</code>,
                {' '}<code style={{ color: 'var(--t1)' }}>status</code> and <code style={{ color: 'var(--t1)' }}>source</code>
                {' '}are detected automatically. Nothing is written until you confirm.
              </p>
              <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={choose} style={{ display: 'none' }} />
              <Btn size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                {busy ? 'Reading…' : 'Choose a CSV file'}
              </Btn>
            </div>
          )}

          {preview && (
            <div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {[
                  ['Rows', preview.totalRows, 'var(--t1)'],
                  ['Will import', preview.valid, 'var(--green)'],
                  ['Will skip', preview.invalid, preview.invalid ? '#f87171' : 'var(--t3)'],
                ].map(([label, value, tone]) => (
                  <div key={label} style={{ ...card, padding: '9px 14px', minWidth: 92 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700 }}>{label}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: tone, fontFamily: "'Syne',sans-serif" }}>{value}</div>
                  </div>
                ))}
              </div>

              {preview.unmapped?.length > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 10 }}>
                  Ignored columns: {preview.unmapped.join(', ')}
                </div>
              )}

              <div style={{ ...card, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--bd)' }}>
                    {['Line', 'Name', 'Phone', 'Status', 'Issues'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {preview.preview.map(r => (
                      <tr key={r.line} style={{ borderBottom: '1px solid var(--bd)' }}>
                        <td style={{ padding: '7px 12px', fontSize: 11.5, color: 'var(--t3)' }}>{r.line}</td>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: 'var(--t1)' }}>{r.name || '—'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: 'var(--t2)' }}>{r.phoneNumber}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11.5, color: 'var(--t3)' }}>{r.status}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: r.issues.length ? '#f87171' : 'var(--t3)' }}>
                          {r.issues.length ? r.issues.join('; ') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.totalRows > preview.preview.length && (
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 8 }}>
                  Showing the first {preview.preview.length} of {preview.totalRows} rows.
                </div>
              )}
            </div>
          )}

          {result && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12, color: 'var(--green)', fontSize: 13, fontWeight: 600 }}>
                <I n="checkc" s={16} c="var(--green)" />
                Imported {result.imported} lead{result.imported === 1 ? '' : 's'}.
              </div>
              <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.7 }}>
                <div>{result.contactsCreated} new contact{result.contactsCreated === 1 ? '' : 's'} created.</div>
                {result.alreadyLeads > 0 && <div>{result.alreadyLeads} contact(s) were already leads and were left unchanged.</div>}
                {result.skipped > 0 && <div style={{ color: '#f87171' }}>{result.skipped} row(s) skipped.</div>}
              </div>
              {result.errors?.length > 0 && (
                <div style={{ ...card, marginTop: 12, padding: '10px 13px', maxHeight: 160, overflowY: 'auto' }}>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 3 }}>
                      Line {e.line}: {e.reason}{e.value ? ` (“${e.value}”)` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
};

export default ImportExport;
