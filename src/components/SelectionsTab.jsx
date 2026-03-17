import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 })

const STATUS = {
  TBD:         { bg: 'rgba(99,99,102,0.25)',    border: 'rgba(99,99,102,0.5)',   text: '#8e8e93',  label: 'TBD'         },
  CONSIDERING: { bg: 'rgba(255,214,10,0.15)',   border: 'rgba(255,214,10,0.4)',  text: '#ffd60a',  label: 'Considering' },
  SELECTED:    { bg: 'rgba(48,209,88,0.15)',    border: 'rgba(48,209,88,0.4)',   text: '#30d158',  label: 'Selected'    },
}

const CATEGORIES = ['Plumbing', 'Lighting', 'Hardware', 'Bath Access', 'Appliances', 'Exterior']

const CAT_ICONS = {
  Plumbing:     '🚿',
  Lighting:     '💡',
  Hardware:     '🔩',
  'Bath Access':'🪥',
  Appliances:   '🏠',
  Exterior:     '🌿',
}

export default function SelectionsTab() {
  const [items,       setItems]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [statusFilter,setStatusFilter]= useState('ALL')
  const [search,      setSearch]      = useState('')
  const [editItem,    setEditItem]    = useState(null)
  const [expandedCat, setExpandedCat] = useState(new Set(CATEGORIES))
  const [toast,       setToast]       = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('selections').select('*').order('sort_order')
    setItems(data || [])
    setLoading(false)
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function saveEdit(fields) {
    const patch = {
      product_link: fields.product_link || null,
      brand_model:  fields.brand_model  || null,
      unit_price:   fields.unit_price   ? parseFloat(String(fields.unit_price).replace(/[$,]/g,'')) : null,
      status:       fields.status,
      notes:        fields.notes        || null,
      updated_at:   new Date().toISOString(),
    }
    await supabase.from('selections').update(patch).eq('id', editItem.id)
    setItems(prev => prev.map(i => i.id === editItem.id ? { ...i, ...patch } : i))
    setEditItem(null)
    showToast('Saved!')
  }

  // Derived stats
  const selected    = items.filter(i => i.status === 'SELECTED')
  const considering = items.filter(i => i.status === 'CONSIDERING')
  const tbd         = items.filter(i => i.status === 'TBD')
  const totalSelected = selected.reduce((s, i) => s + ((i.unit_price || 0) * (i.qty || 1)), 0)

  // Filtered items
  const searchLower = search.trim().toLowerCase()
  const filtered = items.filter(i => {
    if (statusFilter !== 'ALL' && i.status !== statusFilter) return false
    if (searchLower && !i.item_description?.toLowerCase().includes(searchLower)
      && !i.room?.toLowerCase().includes(searchLower)
      && !i.brand_model?.toLowerCase().includes(searchLower)
      && !i.section?.toLowerCase().includes(searchLower)) return false
    return true
  })

  // Group by category
  const byCategory = {}
  CATEGORIES.forEach(c => { byCategory[c] = filtered.filter(i => i.category === c) })

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading…</div>

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 200, padding: '10px 18px', borderRadius: 10, background: toast.type === 'error' ? '#ff453a' : '#30d158', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Items',   value: items.length,       sub: 'across all categories', accent: '#0a84ff' },
          { label: 'Selected',      value: selected.length,    sub: fmt(totalSelected) + ' committed', accent: '#30d158' },
          { label: 'Considering',   value: considering.length, sub: 'still deciding',  accent: '#ffd60a' },
          { label: 'TBD',           value: tbd.length,         sub: 'need attention',  accent: '#ff453a' },
        ].map(({ label, value, sub, accent }) => (
          <div key={label} className="apple-card p-4" style={{ borderLeft: `3px solid ${accent}` }}>
            <div className="text-lbl2 text-xs font-medium uppercase tracking-wider mb-1">{label}</div>
            <div className="font-bold text-2xl leading-tight" style={{ color: accent }}>{value}</div>
            <div className="text-lbl3 text-xs mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="apple-input text-sm"
          style={{ width: 220 }}
          placeholder="Search items, rooms…"
        />
        <div className="flex gap-1">
          {['ALL', 'TBD', 'CONSIDERING', 'SELECTED'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: statusFilter === s ? (s === 'ALL' ? '#0a84ff' : STATUS[s]?.bg || '#0a84ff') : 'rgba(84,84,88,0.2)',
                color: statusFilter === s ? (s === 'ALL' ? '#fff' : STATUS[s]?.text || '#fff') : '#8e8e93',
                border: `1px solid ${statusFilter === s ? (s === 'ALL' ? '#0a84ff' : STATUS[s]?.border || '#0a84ff') : 'transparent'}`,
              }}
            >
              {s === 'ALL' ? 'All' : STATUS[s]?.label}
            </button>
          ))}
        </div>
        <span className="text-lbl3 text-xs ml-auto">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Category groups */}
      {CATEGORIES.map(cat => {
        const catItems = byCategory[cat]
        if (catItems.length === 0 && statusFilter !== 'ALL') return null
        const allCatItems = items.filter(i => i.category === cat)
        const isOpen = expandedCat.has(cat)
        const selectedCount = allCatItems.filter(i => i.status === 'SELECTED').length
        const catTotal = allCatItems.filter(i => i.status === 'SELECTED').reduce((s, i) => s + ((i.unit_price || 0) * (i.qty || 1)), 0)

        // Group by section within category
        const sections = [...new Set(catItems.map(i => i.section || 'General'))]

        return (
          <div key={cat} className="apple-card mb-3 overflow-hidden">
            {/* Category header */}
            <div
              onClick={() => setExpandedCat(s => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n })}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: '#2c2c2e', borderBottom: isOpen ? '1px solid rgba(84,84,88,0.3)' : 'none' }}
            >
              <span style={{ fontSize: 9, color: '#636366' }}>{isOpen ? '▼' : '▶'}</span>
              <span style={{ fontSize: 16 }}>{CAT_ICONS[cat]}</span>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#fff', flex: 1 }}>{cat}</span>
              <span style={{ fontSize: 11, color: '#636366' }}>{allCatItems.length} items</span>
              {selectedCount > 0 && (
                <span style={{ fontSize: 11, color: '#30d158', fontWeight: 600 }}>{selectedCount} selected · {fmt(catTotal)}</span>
              )}
            </div>

            {isOpen && (
              <div>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 0.5fr 2fr 1fr 1fr', gap: 8, padding: '6px 16px', borderBottom: '1px solid rgba(84,84,88,0.2)', color: '#636366', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <div>Room</div>
                  <div>Item</div>
                  <div style={{ textAlign: 'center' }}>Qty</div>
                  <div>Brand / Model</div>
                  <div style={{ textAlign: 'right' }}>Unit Price</div>
                  <div style={{ textAlign: 'right' }}>Status</div>
                </div>

                {sections.map(section => {
                  const sectionItems = catItems.filter(i => (i.section || 'General') === section)
                  return (
                    <div key={section}>
                      <div style={{ padding: '5px 16px', fontSize: 10, fontWeight: 700, color: '#48484a', textTransform: 'uppercase', letterSpacing: '0.07em', background: 'rgba(84,84,88,0.08)', borderBottom: '1px solid rgba(84,84,88,0.15)' }}>
                        {section}
                      </div>
                      {sectionItems.map(item => {
                        const st = STATUS[item.status] || STATUS.TBD
                        const hasLink = !!item.product_link
                        return (
                          <div
                            key={item.id}
                            onClick={() => setEditItem({ ...item })}
                            style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 0.5fr 2fr 1fr 1fr', gap: 8, padding: '9px 16px', borderBottom: '1px solid rgba(84,84,88,0.12)', cursor: 'pointer', alignItems: 'center', background: item.status === 'SELECTED' ? 'rgba(48,209,88,0.04)' : 'transparent' }}
                            onMouseEnter={e => e.currentTarget.style.background = item.status === 'SELECTED' ? 'rgba(48,209,88,0.08)' : 'rgba(84,84,88,0.1)'}
                            onMouseLeave={e => e.currentTarget.style.background = item.status === 'SELECTED' ? 'rgba(48,209,88,0.04)' : 'transparent'}
                          >
                            <div style={{ fontSize: 12, color: '#8e8e93', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.room}</div>
                            <div style={{ fontSize: 13, color: '#ebebf5', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {hasLink ? (
                                <a href={item.product_link} target="_blank" rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  style={{ color: '#0a84ff', textDecoration: 'none' }}
                                  title={item.item_description}
                                >{item.item_description}</a>
                              ) : item.item_description}
                            </div>
                            <div style={{ fontSize: 12, color: '#636366', textAlign: 'center' }}>{item.qty}</div>
                            <div style={{ fontSize: 11, color: '#636366', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.brand_model || ''}>
                              {item.brand_model ? item.brand_model.slice(0, 60) + (item.brand_model.length > 60 ? '…' : '') : '—'}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: item.unit_price ? '#fff' : '#48484a', textAlign: 'right' }}>{fmt(item.unit_price)}</div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: st.text, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                                {st.label}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                {catItems.length === 0 && (
                  <div style={{ padding: '16px', fontSize: 12, color: '#636366', fontStyle: 'italic', textAlign: 'center' }}>
                    No items match current filter
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Edit modal */}
      {editItem && (
        <EditModal
          item={editItem}
          onChange={patch => setEditItem(p => ({ ...p, ...patch }))}
          onSave={() => saveEdit(editItem)}
          onCancel={() => setEditItem(null)}
        />
      )}
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditModal({ item, onChange, onSave, onCancel }) {
  const st = STATUS[item.status] || STATUS.TBD

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 640, background: '#1c1c1e', borderRadius: '16px 16px 0 0', padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.6)', maxHeight: '80vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#636366', marginBottom: 2 }}>
              {item.category} · {item.room}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{item.item_description}</div>
            {item.notes && <div style={{ fontSize: 12, color: '#636366', marginTop: 4, fontStyle: 'italic' }}>{item.notes}</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={onCancel} className="btn-secondary text-xs px-2 py-1.5">Cancel</button>
            <button onClick={onSave} className="btn-primary text-xs px-3 py-1.5">Save</button>
          </div>
        </div>

        {/* Status selector */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#636366', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Status</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['TBD', 'CONSIDERING', 'SELECTED'].map(s => {
              const sst = STATUS[s]
              const active = item.status === s
              return (
                <button
                  key={s}
                  onClick={() => onChange({ status: s })}
                  style={{
                    flex: 1, padding: '9px 4px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                    background: active ? sst.bg : 'rgba(44,44,46,1)',
                    color: active ? sst.text : '#48484a',
                    border: `1px solid ${active ? sst.border : 'rgba(84,84,88,0.3)'}`,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {sst.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Product link */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>Product Link</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={item.product_link || ''}
              onChange={e => onChange({ product_link: e.target.value })}
              className="apple-input text-sm"
              style={{ flex: 1 }}
              placeholder="Paste product URL…"
            />
            {item.product_link && (
              <a href={item.product_link} target="_blank" rel="noreferrer"
                style={{ padding: '6px 12px', background: 'rgba(10,132,255,0.15)', color: '#0a84ff', borderRadius: 8, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
                View ↗
              </a>
            )}
          </div>
        </div>

        {/* Brand / Model */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>Brand / Model</label>
          <input
            value={item.brand_model || ''}
            onChange={e => onChange({ brand_model: e.target.value })}
            className="apple-input text-sm w-full"
            placeholder="e.g. Kohler Artifacts K-72759"
          />
        </div>

        {/* Price + Qty */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>Unit Price</label>
            <input
              value={item.unit_price != null ? String(item.unit_price) : ''}
              onChange={e => onChange({ unit_price: e.target.value })}
              className="apple-input text-sm w-full"
              placeholder="$0"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>Qty</label>
            <input
              value={item.qty || 1}
              onChange={e => onChange({ qty: parseInt(e.target.value) || 1 })}
              type="number"
              min="1"
              className="apple-input text-sm w-full"
            />
          </div>
        </div>

        {item.unit_price && (
          <div style={{ fontSize: 12, color: '#30d158', marginBottom: 12 }}>
            Total: {('$' + ((parseFloat(String(item.unit_price).replace(/[$,]/g,'')) || 0) * (item.qty || 1)).toLocaleString('en-US', { minimumFractionDigits: 0 }))}
          </div>
        )}

        {/* Notes */}
        <div>
          <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea
            value={item.notes || ''}
            onChange={e => onChange({ notes: e.target.value })}
            className="apple-input text-xs w-full"
            rows={3}
            style={{ resize: 'vertical' }}
            placeholder="Notes, preferences, requirements…"
          />
        </div>
      </div>
    </div>
  )
}
