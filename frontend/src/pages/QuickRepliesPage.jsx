import { useState } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const DashHeader = ({ title, subtitle }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: '16px', flexShrink: 0, background: 'var(--surf)' }}>
    <div style={{ flex: 1 }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
    </div>
  </div>
);

const INITIAL_REPLIES = [
  { id: 1, shortcut: '/greeting', title: 'Welcome Greeting', body: 'Hello! 👋 Welcome to our store. How can I help you today?', category: 'General' },
  { id: 2, shortcut: '/hours', title: 'Business Hours', body: 'Our business hours are Mon–Fri, 9 AM to 6 PM IST. We\'ll get back to you during working hours!', category: 'General' },
  { id: 3, shortcut: '/thanks', title: 'Thank You', body: 'Thank you for reaching out! Is there anything else I can help with?', category: 'General' },
  { id: 4, shortcut: '/order', title: 'Order Status', body: 'I\'d be happy to check your order status. Could you please share your order ID?', category: 'Support' },
  { id: 5, shortcut: '/return', title: 'Return Policy', body: 'We offer easy returns within 7 days of delivery. Would you like to initiate a return?', category: 'Support' },
  { id: 6, shortcut: '/payment', title: 'Payment Issue', body: 'I understand you\'re facing a payment issue. Let me help you resolve this. Can you describe the problem?', category: 'Support' },
  { id: 7, shortcut: '/offer', title: 'Current Offers', body: '🎉 We have exciting offers running! Get up to 30% off on all products. Use code SAVE30 at checkout.', category: 'Sales' },
  { id: 8, shortcut: '/catalog', title: 'Send Catalog', body: 'Here\'s our latest product catalog! Feel free to browse and let me know if anything catches your eye. 📋', category: 'Sales' },
];

export default function QuickRepliesPage() {
  const [replies, setReplies] = useState(INITIAL_REPLIES);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [showNew, setShowNew] = useState(false);
  const [newShortcut, setNewShortcut] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState('General');

  const categories = ['All', 'General', 'Support', 'Sales'];
  const filtered = replies.filter(r => {
    if (filter !== 'All' && r.category !== filter) return false;
    if (search && !`${r.title} ${r.shortcut} ${r.body}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleAdd = () => {
    if (!newShortcut.trim() || !newBody.trim()) return;
    setReplies(prev => [...prev, {
      id: Date.now(),
      shortcut: newShortcut.startsWith('/') ? newShortcut : `/${newShortcut}`,
      title: newTitle || newShortcut,
      body: newBody,
      category: newCategory,
    }]);
    setShowNew(false);
    setNewShortcut(''); setNewTitle(''); setNewBody('');
  };

  const handleDelete = (id) => {
    setReplies(prev => prev.filter(r => r.id !== id));
  };

  const inputStyle = {
    width: '100%', padding: '10px 13px', borderRadius: 8,
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
    color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Quick Replies" subtitle="Manage your saved message templates" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 9, background: 'var(--surf)', border: '1px solid var(--bd)' }}>
            {categories.map(c => {
              const on = filter === c;
              return (
                <div key={c} onClick={() => setFilter(c)}
                  style={{
                    padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
                    fontWeight: on ? 700 : 500,
                    color: on ? '#060913' : 'var(--t2)',
                    background: on ? 'var(--green)' : 'transparent',
                    transition: 'all .12s', whiteSpace: 'nowrap',
                  }}>{c}</div>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, background: 'var(--surf)', border: '1px solid var(--bd)', flex: 1, minWidth: 180, maxWidth: 300 }}>
            <I n="search" s={13} c="var(--t2)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search replies…"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif" }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--t3)', marginLeft: 'auto' }}>{filtered.length} replies</span>
          <Btn onClick={() => setShowNew(true)} style={{ boxShadow: 'var(--glow)' }}>
            <I n="plus" s={14} c="#060A10" /> New Reply
          </Btn>
        </div>

        {/* New Reply Form */}
        {showNew && (
          <div style={{ ...card, padding: 20, marginBottom: 20, animation: 'fadeUp .3s ease both' }}>
            <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)', marginBottom: 14 }}>Create Quick Reply</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <input value={newShortcut} onChange={e => setNewShortcut(e.target.value)} placeholder="/shortcut" style={inputStyle} />
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Title" style={inputStyle} />
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                  style={{ ...inputStyle, appearance: 'auto', colorScheme: 'dark' }}>
                  <option value="General">General</option>
                  <option value="Support">Support</option>
                  <option value="Sales">Sales</option>
                </select>
              </div>
              <textarea value={newBody} onChange={e => setNewBody(e.target.value)} placeholder="Reply message…" rows={3}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn variant="ghost" onClick={() => setShowNew(false)}>Cancel</Btn>
                <Btn onClick={handleAdd} disabled={!newShortcut.trim() || !newBody.trim()}>Add Reply</Btn>
              </div>
            </div>
          </div>
        )}

        {/* Replies grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {filtered.map(r => {
            const catColors = { General: '#1EBF5E', Support: '#0EA5E9', Sales: '#F59E0B' };
            const col = catColors[r.category] || '#A78BFA';
            return (
              <div key={r.id} style={{
                ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
                transition: 'transform .15s, border-color .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'var(--bdm)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--t1)', marginBottom: 4 }}>{r.title}</p>
                    <code style={{ fontSize: 11, color: col, background: `${col}12`, padding: '2px 8px', borderRadius: 5, border: `1px solid ${col}25` }}>{r.shortcut}</code>
                  </div>
                  <span style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 5,
                    background: `${col}12`, border: `1px solid ${col}25`, color: col,
                    fontWeight: 700, letterSpacing: '.04em',
                  }}>{r.category}</span>
                </div>
                <p style={{
                  fontSize: 12, color: 'var(--t2)', lineHeight: 1.5,
                  background: 'rgba(255,255,255,0.02)', padding: '10px 12px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.04)', flex: 1,
                }}>{r.body}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant="ghost" size="sm" style={{ flex: 1, justifyContent: 'center' }}>
                    <I n="copy" s={12} c="var(--t2)" /> Copy
                  </Btn>
                  <Btn variant="ghost" size="sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleDelete(r.id)}>
                    <I n="trash" s={12} c="#f87171" /> Delete
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
