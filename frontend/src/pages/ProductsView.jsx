import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { fmtMoney } from '../lib/format.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5 }}>
    <span>{children}</span>
    {onDismiss && <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><I n="x" s={14} c="#f87171" /></button>}
  </div>
);

const ColHead = ({ children, align = 'left' }) => (
  <th style={{ padding: '10px 16px', textAlign: align, fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>{children}</th>
);

const emptyDraft = { name: '', sku: '', category: '', description: '', unitPrice: '', taxRate: '', unit: '', isService: false };

const ProductModal = ({ product, onClose, onSaved }) => {
  const [draft, setDraft] = useState(product ? {
    name: product.name ?? '', sku: product.sku ?? '', category: product.category ?? '',
    description: product.description ?? '', unitPrice: String(product.unitPrice ?? ''),
    taxRate: String(product.taxRate ?? ''), unit: product.unit ?? '', isService: product.isService ?? false,
  } : emptyDraft);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const body = {
        name: draft.name, sku: draft.sku || null, category: draft.category || null,
        description: draft.description || null, unit: draft.unit || null,
        unitPrice: Number(draft.unitPrice || 0),
        taxRate: Number(draft.taxRate || 0),
        isService: draft.isService,
      };
      const res = await wFetch(product ? `/products/${product.id}` : '/products', {
        method: product ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not save this product');
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={product ? product.name : 'New product'} onClose={onClose} width={520}
      footer={<>
        <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={save} disabled={saving || !draft.name.trim() || draft.unitPrice === ''}>
          {saving ? 'Saving…' : 'Save'}
        </Btn>
      </>}>
      {err && <div style={{ marginBottom: 12 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><FLabel required>Name</FLabel><FInput value={draft.name} onChange={set('name')} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><FLabel required>Unit price (INR)</FLabel><FInput type="number" value={draft.unitPrice} onChange={set('unitPrice')} /></div>
          <div><FLabel>Tax rate (%)</FLabel><FInput type="number" value={draft.taxRate} onChange={set('taxRate')} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><FLabel>SKU</FLabel><FInput value={draft.sku} onChange={set('sku')} /></div>
          <div><FLabel>Category</FLabel><FInput value={draft.category} onChange={set('category')} /></div>
        </div>
        <div><FLabel>Unit</FLabel><FInput value={draft.unit} onChange={set('unit')} placeholder="e.g. licence, hour, box" /></div>
        <div><FLabel>Description</FLabel><FTextarea value={draft.description} onChange={set('description')} rows={3} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.isService} onChange={set('isService')} />
          This is a service rather than a physical product
        </label>
      </div>
    </Modal>
  );
};

export const ProductsView = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (category) qs.set('category', category);
    if (showInactive) qs.set('includeInactive', 'true');
    wFetch(`/products?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load products'))))
      .then(d => { setProducts(d.data ?? []); setCategories(d.categories ?? []); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [search, category, showInactive]);

  useEffect(() => { load(); }, [load]);

  const remove = async (product) => {
    setErr(null);
    setNotice(null);
    try {
      const res = await wFetch(`/products/${product.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not remove this product');
      }
      const result = await res.json();
      if (result.deactivated) {
        setNotice(`“${product.name}” is used on ${result.usedBy.deals} deal(s) and ${result.usedBy.quotes} quote(s), so it was deactivated rather than deleted.`);
      }
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Products &amp; services</span>
          <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>{products.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)' }}>
            <I n="search" s={14} c="var(--t3)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search catalogue" aria-label="Search products"
              style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 12.5, width: 150 }} />
          </div>
          <div style={{ width: 150 }}>
            <FSelect value={category} onChange={e => setCategory(e.target.value)} placeholder="All categories"
              options={categories.map(c => ({ value: c, label: c }))} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--t3)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <Btn size="sm" onClick={() => setEditing(null)}>New product</Btn>
        </div>
      </div>

      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}
        {notice && (
          <div style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: 'var(--t2)' }}>
            <I n="alertc" s={14} c="#f59e0b" /><span>{notice}</span>
          </div>
        )}

        <div style={{ ...card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--bd)' }}>
              <ColHead>Name</ColHead><ColHead>SKU</ColHead><ColHead>Category</ColHead>
              <ColHead align="right">Price</ColHead><ColHead align="right">Tax</ColHead>
              <ColHead>Type</ColHead><ColHead align="right">Actions</ColHead>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ padding: 20, fontSize: 12.5, color: 'var(--t3)' }}>Loading…</td></tr>}
              {!loading && products.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <I n="briefcase" s={24} c="var(--t3)" />
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--t2)', fontWeight: 600 }}>No products yet</div>
                  <div style={{ marginTop: 3, fontSize: 12, color: 'var(--t3)' }}>Add one to start attaching it to deals and quotes.</div>
                </td></tr>
              )}
              {products.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--bd)', opacity: p.isActive ? 1 : 0.55 }}>
                  <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--t1)' }}>
                    {p.name}
                    {!p.isActive && <span style={{ marginLeft: 8 }}><StatusBadge label="Inactive" tone="gray" /></span>}
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--t3)' }}>{p.sku || '—'}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--t3)' }}>{p.category || '—'}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--t1)', textAlign: 'right', fontWeight: 600 }}>
                    {fmtMoney(p.unitPrice)}{p.unit ? <span style={{ color: 'var(--t3)', fontWeight: 400 }}> /{p.unit}</span> : null}
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--t3)', textAlign: 'right' }}>{Number(p.taxRate)}%</td>
                  <td style={{ padding: '11px 16px' }}>
                    <StatusBadge label={p.isService ? 'Service' : 'Product'} tone={p.isService ? 'violet' : 'blue'} />
                  </td>
                  <td style={{ padding: '11px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5 }}>
                      <I n="pencil" s={14} c="var(--t2)" />
                    </button>
                    <button onClick={() => remove(p)} aria-label={`Remove ${p.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5 }}>
                      <I n="trash" s={14} c="#f87171" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing !== undefined && (
        <ProductModal product={editing} onClose={() => setEditing(undefined)} onSaved={load} />
      )}
    </div>
  );
};

export default ProductsView;
