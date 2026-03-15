import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 })
const num = v => v === '' || v == null ? null : parseFloat(String(v).replace(/[$,]/g, '')) || 0

export default function BudgetTab() {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editFields, setEditFields] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('line_items').select('*').order('sort_order').order('created_at')
    setItems(data || [])
    setLoading(false)
  }

  async function updateItem(id, patch) {
    patch.updated_at = new Date().toISOString()
    await supabase.from('line_items').update(patch).eq('id', id)
    setItems(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  async function toggleLock(item) {
    await updateItem(item.id, { status: item.status === 'locked' ? 'pending' : 'locked' })
  }

  async function deleteItem(id) {
    if (!confirm('Delete this line item?')) return
    await supabase.from('line_items').delete().eq('id', id)
    setItems(prev => prev.filter(r => r.id !== id))
  }

  async function addItem(section) {
    const maxOrder = items.filter(i => i.section === section).reduce((m, i) => Math.max(m, i.sort_order || 0), 0)
    const { data } = await supabase.from('line_items').insert({
      section, name: 'New Line Item', estimated_cost: 0, status: 'pending', sort_order: maxOrder + 1
    }).select().single()
    if (data) { setItems(prev => [...prev, data]); startEdit(data) }
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditFields({
      name: item.name, code: item.code || '',
      estimated_cost: item.estimated_cost ?? '',
      actual_cost: item.actual_cost ?? '',
      vendor: item.vendor || '', notes: item.notes || '',
      payments: item.payments || [],
    })
  }

  async function saveEdit(id) {
    await updateItem(id, {
      name: editFields.name, code: editFields.code,
      estimated_cost: num(editFields.estimated_cost),
      actual_cost: editFields.actual_cost !== '' ? num(editFields.actual_cost) : null,
      vendor: editFields.vendor,
      notes: editFields.notes,
      payments: editFields.payments,
    })
    setEditingId(null)
  }

  const softItems = items.filter(i => i.section === 'soft')
  const hardItems = items.filter(i => i.section === 'hard')
  const totalEst  = items.reduce((s, i) => s + (i.estimated_cost || 0), 0)
  const locked    = items.filter(i => i.status === 'locked')
  const lockedAmt = locked.reduce((s, i) => s + (i.actual_cost ?? i.estimated_cost ?? 0), 0)
  const pending   = items.filter(i => i.status !== 'locked').reduce((s, i) => s + (i.estimated_cost || 0), 0)
  const overages  = items.filter(i => i.actual_cost != null && i.actual_cost > (i.estimated_cost || 0))
  const pct       = totalEst > 0 ? Math.round((lockedAmt / totalEst) * 100) : 0

  if (loading) return <Spinner />

  return (
    <div>
      {/* ── Dashboard cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Budget',  value: fmt(totalEst),    sub: 'estimated',         accent: '#0a84ff' },
          { label: 'Locked In',     value: fmt(lockedAmt),   sub: `${pct}% committed`, accent: '#30d158' },
          { label: 'Pending Bids',  value: fmt(pending),     sub: `${items.filter(i=>i.status!=='locked').length} items`, accent: '#ffd60a' },
          { label: 'Over Budget',   value: overages.length,  sub: overages.length ? overages.slice(0,1).map(o=>o.name).join('') + (overages.length > 1 ? ` +${overages.length-1}` : '') : 'All clear', accent: overages.length ? '#ff453a' : '#30d158' },
        ].map(({ label, value, sub, accent }) => (
          <div key={label} className="apple-card p-4" style={{ borderLeft: `3px solid ${accent}` }}>
            <div className="text-lbl2 text-xs font-medium uppercase tracking-wider mb-1">{label}</div>
            <div className="text-lbl font-bold text-2xl leading-tight" style={{ color: accent }}>{value}</div>
            <div className="text-lbl3 text-xs mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-4 mb-3 text-xs text-lbl3">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'rgba(48,209,88,0.25)', border: '1px solid rgba(48,209,88,0.4)' }}/>
          Locked bid
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'rgba(255,69,58,0.2)', border: '1px solid rgba(255,69,58,0.4)' }}/>
          Over budget
        </span>
        <span className="ml-auto italic" style={{ color: '#3a3a3c' }}>Tap any row to edit</span>
      </div>

      <Section title="B · SOFT COSTS" items={softItems} editingId={editingId} editFields={editFields}
        setEditFields={setEditFields} onEdit={startEdit} onSave={saveEdit} onCancel={() => setEditingId(null)}
        onToggleLock={toggleLock} onDelete={deleteItem} onAdd={() => addItem('soft')} />

      <div className="mb-4" />

      <Section title="C · HARD COSTS" items={hardItems} editingId={editingId} editFields={editFields}
        setEditFields={setEditFields} onEdit={startEdit} onSave={saveEdit} onCancel={() => setEditingId(null)}
        onToggleLock={toggleLock} onDelete={deleteItem} onAdd={() => addItem('hard')} />
    </div>
  )
}

function Section({ title, items, editingId, editFields, setEditFields, onEdit, onSave, onCancel, onToggleLock, onDelete, onAdd }) {
  const sEst = items.reduce((s, i) => s + (i.estimated_cost || 0), 0)
  const sAct = items.reduce((s, i) => s + (i.actual_cost || 0), 0)

  return (
    <div className="apple-card overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(84,84,88,0.4)', background: '#2c2c2e' }}>
        <span className="font-semibold text-lbl tracking-wide text-sm">{title}</span>
        <span className="text-lbl2 text-xs">
          Est <span className="text-lbl font-semibold">{fmt(sEst)}</span>
          {sAct > 0 && <> · Actual <span className="text-pos font-semibold">{fmt(sAct)}</span></>}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold uppercase tracking-widest"
        style={{ color: '#636366', borderBottom: '1px solid rgba(84,84,88,0.3)' }}>
        <div className="col-span-1">Code</div>
        <div className="col-span-2">Description</div>
        <div className="col-span-2 text-right">Estimated</div>
        <div className="col-span-2 text-right">Bid / Actual</div>
        <div className="col-span-1">Vendor</div>
        <div className="col-span-2">Notes</div>
        <div className="col-span-1">Payments</div>
        <div className="col-span-1 text-center">Lock</div>
      </div>

      {/* Rows */}
      {items.map(item => {
        if (editingId === item.id) {
          return <EditRow key={item.id} fields={editFields} setFields={setEditFields}
            onSave={() => onSave(item.id)} onCancel={onCancel} onDelete={() => onDelete(item.id)} />
        }
        const isLocked = item.status === 'locked'
        const isOver   = item.actual_cost != null && item.actual_cost > (item.estimated_cost || 0)
        const pmts     = item.payments || []
        const pmtTotal = pmts.reduce((s, p) => s + (num(p.amount) || 0), 0)
        const pmtLabel = pmts.length === 0 ? '' :
          pmts.length === 1
            ? (pmts[0].date ? new Date(pmts[0].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : fmt(pmtTotal))
            : `${pmts.length} pmts`
        return (
          <div
            key={item.id}
            onClick={() => onEdit(item)}
            className={`grid grid-cols-12 px-4 py-2.5 cursor-pointer transition-colors text-sm ${isOver ? 'row-overage' : isLocked ? 'row-locked' : 'row-pending'}`}
            style={{ borderBottom: '1px solid rgba(84,84,88,0.2)' }}
          >
            <div className="col-span-1 font-mono text-xs" style={{ color: '#636366' }}>{item.code || ''}</div>
            <div className="col-span-2 font-medium text-lbl truncate">{item.name}</div>
            <div className="col-span-2 text-right text-lbl2">{fmt(item.estimated_cost)}</div>
            <div className={`col-span-2 text-right font-semibold ${isOver ? 'text-neg' : isLocked ? 'text-pos' : 'text-lbl3'}`}>
              {item.actual_cost != null ? fmt(item.actual_cost) : '—'}
              {isOver && <span className="ml-1 text-xs">▲</span>}
            </div>
            <div className="col-span-1 text-xs text-lbl2 truncate">{item.vendor || ''}</div>
            <div className="col-span-2 text-xs text-lbl2 truncate" title={item.notes || ''}>{item.notes || ''}</div>
            <div className="col-span-1 text-xs text-lbl3">
              {pmtLabel && (
                <span title={pmts.length > 1 ? fmt(pmtTotal) : undefined}>{pmtLabel}</span>
              )}
            </div>
            <div className="col-span-1 flex justify-center" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => onToggleLock(item)}
                className="text-base px-1 transition-transform hover:scale-110"
                title={isLocked ? 'Unlock' : 'Lock as confirmed bid'}
              >
                {isLocked ? '🔒' : '🔓'}
              </button>
            </div>
          </div>
        )
      })}

      {/* Add row */}
      <div className="px-4 py-2.5" style={{ borderTop: '1px solid rgba(84,84,88,0.2)' }}>
        <button onClick={onAdd} className="text-xs font-semibold" style={{ color: '#0a84ff' }}>
          + Add line item
        </button>
      </div>
    </div>
  )
}

function EditRow({ fields, setFields, onSave, onCancel, onDelete }) {
  const f = key => ({
    value: fields[key] ?? '',
    onChange: e => setFields(p => ({ ...p, [key]: e.target.value })),
    className: 'apple-input w-full',
  })

  const payments = fields.payments || []

  function addPayment() {
    setFields(p => ({ ...p, payments: [...(p.payments || []), { date: '', amount: '' }] }))
  }

  function updatePayment(i, key, val) {
    setFields(p => {
      const pmts = [...(p.payments || [])]
      pmts[i] = { ...pmts[i], [key]: val }
      return { ...p, payments: pmts }
    })
  }

  function removePayment(i) {
    setFields(p => ({ ...p, payments: (p.payments || []).filter((_, idx) => idx !== i) }))
  }

  return (
    <div className="px-4 py-3 text-sm"
      style={{ background: 'rgba(10,132,255,0.07)', borderBottom: '1px solid rgba(10,132,255,0.3)' }}>

      {/* Main fields */}
      <div className="grid grid-cols-12 gap-1.5 mb-2">
        <div className="col-span-1"><input {...f('code')} placeholder="Code" /></div>
        <div className="col-span-2"><input {...f('name')} placeholder="Description" /></div>
        <div className="col-span-2"><input {...f('estimated_cost')} placeholder="Est. $" /></div>
        <div className="col-span-2"><input {...f('actual_cost')} placeholder="Bid / Actual $" /></div>
        <div className="col-span-1"><input {...f('vendor')} placeholder="Vendor" /></div>
        <div className="col-span-2 relative">
          <input {...f('notes')} placeholder="Notes" />
          {fields.notes && (
            <button
              onClick={() => setFields(p => ({ ...p, notes: '' }))}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-lbl3 hover:text-neg text-xs leading-none"
              title="Clear note"
            >✕</button>
          )}
        </div>
        <div className="col-span-2 flex items-center gap-1">
          <button onClick={onSave} className="btn-primary text-xs px-2.5 py-1.5">Save</button>
          <button onClick={onCancel} className="btn-secondary text-xs px-2 py-1.5">✕</button>
          <button onClick={onDelete} className="text-xs px-1 py-1.5 hover:opacity-70" style={{ color: '#ff453a' }} title="Delete line item">🗑</button>
        </div>
      </div>

      {/* Payments sub-section */}
      <div className="pt-2" style={{ borderTop: '1px solid rgba(10,132,255,0.2)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#636366' }}>Payments</span>
          <button onClick={addPayment} className="text-xs font-semibold" style={{ color: '#0a84ff' }}>+ Add</button>
        </div>
        {payments.length === 0 ? (
          <div className="text-xs text-lbl3 italic">No payments recorded</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded px-2 py-1.5" style={{ background: 'rgba(84,84,88,0.25)' }}>
                <input
                  type="date"
                  value={p.date || ''}
                  onChange={e => updatePayment(i, 'date', e.target.value)}
                  className="apple-input text-xs"
                  style={{ width: '130px' }}
                />
                <input
                  type="text"
                  value={p.amount || ''}
                  placeholder="Amount $"
                  onChange={e => updatePayment(i, 'amount', e.target.value)}
                  className="apple-input text-xs"
                  style={{ width: '90px' }}
                />
                <button
                  onClick={() => removePayment(i)}
                  className="text-lbl3 hover:text-neg text-xs leading-none"
                  title="Remove payment"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return <div className="text-center py-24 text-lbl3 text-sm">Loading…</div>
}
