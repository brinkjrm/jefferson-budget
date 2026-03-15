import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const fmt = n => n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })
const num = v => v === '' || v == null ? 0 : parseFloat(String(v).replace(/[$,]/g, '')) || 0
const METHODS = ['Check', 'ACH', 'AMEX', 'Debit', 'Wire', 'Cash', 'Other']

function empty() {
  return { description: '', vendor: '', amount: '', date_paid: '', payment_method: 'Check', check_number: '', notes: '' }
}

export default function PrepaidTab() {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editFields, setEditFields] = useState({})
  const [adding, setAdding]     = useState(false)
  const [newFields, setNewFields] = useState(empty())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('prepaid_items').select('*')
      .order('date_paid', { ascending: false }).order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function addItem() {
    const { data } = await supabase.from('prepaid_items').insert({
      description: newFields.description, vendor: newFields.vendor,
      amount: num(newFields.amount), date_paid: newFields.date_paid || null,
      payment_method: newFields.payment_method, check_number: newFields.check_number, notes: newFields.notes,
    }).select().single()
    if (data) { setItems(prev => [data, ...prev]); setNewFields(empty()); setAdding(false) }
  }

  async function saveEdit(id) {
    const patch = { description: editFields.description, vendor: editFields.vendor,
      amount: num(editFields.amount), date_paid: editFields.date_paid || null,
      payment_method: editFields.payment_method, check_number: editFields.check_number, notes: editFields.notes }
    await supabase.from('prepaid_items').update(patch).eq('id', id)
    setItems(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    setEditingId(null)
  }

  async function deleteItem(id) {
    if (!confirm('Delete this prepaid item?')) return
    await supabase.from('prepaid_items').delete().eq('id', id)
    setItems(prev => prev.filter(r => r.id !== id))
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditFields({ description: item.description, vendor: item.vendor || '', amount: item.amount || '',
      date_paid: item.date_paid || '', payment_method: item.payment_method || 'Check',
      check_number: item.check_number || '', notes: item.notes || '' })
  }

  const total = items.reduce((s, i) => s + (i.amount || 0), 0)

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lbl font-bold text-xl">Prepaid Items</h2>
          <p className="text-lbl2 text-sm mt-0.5">
            Items already paid · Total: <span className="font-semibold" style={{ color: '#30d158' }}>{fmt(total)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn-secondary px-4 py-2 text-sm no-print">
            Print for Bank
          </button>
          <button onClick={() => setAdding(true)} className="btn-primary px-4 py-2 text-sm">
            + Add Item
          </button>
        </div>
      </div>

      <div className="apple-card overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-12 px-4 py-2.5 text-xs font-semibold uppercase tracking-widest"
          style={{ color: '#636366', background: '#2c2c2e', borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
          <div className="col-span-3">Description</div>
          <div className="col-span-2">Vendor</div>
          <div className="col-span-2 text-right">Amount</div>
          <div className="col-span-1">Date</div>
          <div className="col-span-1">Method</div>
          <div className="col-span-1">Check #</div>
          <div className="col-span-1">Notes</div>
          <div className="col-span-1 text-center">Del</div>
        </div>

        {adding && <FormRow fields={newFields} setFields={setNewFields}
          onSave={addItem} onCancel={() => { setAdding(false); setNewFields(empty()) }} isNew />}

        {items.length === 0 && !adding && (
          <div className="text-center py-16 text-lbl3 text-sm">
            No prepaid items yet — tap + Add Item
          </div>
        )}

        {items.map(item => {
          if (editingId === item.id) {
            return <FormRow key={item.id} fields={editFields} setFields={setEditFields}
              onSave={() => saveEdit(item.id)} onCancel={() => setEditingId(null)} />
          }
          return (
            <div key={item.id}
              onClick={() => startEdit(item)}
              className="grid grid-cols-12 px-4 py-3 cursor-pointer data-row text-sm"
              style={{ borderBottom: '1px solid rgba(84,84,88,0.2)' }}>
              <div className="col-span-3 font-medium text-lbl truncate">{item.description}</div>
              <div className="col-span-2 text-lbl2 truncate">{item.vendor || '—'}</div>
              <div className="col-span-2 text-right font-semibold" style={{ color: '#30d158' }}>{fmt(item.amount)}</div>
              <div className="col-span-1 text-lbl3 text-xs">
                {item.date_paid ? new Date(item.date_paid + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
              </div>
              <div className="col-span-1 text-lbl3 text-xs">{item.payment_method || '—'}</div>
              <div className="col-span-1 text-lbl3 text-xs font-mono">{item.check_number || '—'}</div>
              <div className="col-span-1 text-lbl3 text-xs truncate">{item.notes || ''}</div>
              <div className="col-span-1 flex justify-center" onClick={e => e.stopPropagation()}>
                <button onClick={() => deleteItem(item.id)} className="text-lbl3 hover:text-neg text-sm px-1">✕</button>
              </div>
            </div>
          )
        })}

        {/* Total footer */}
        <div className="grid grid-cols-12 px-4 py-3 font-bold text-sm"
          style={{ borderTop: '2px solid rgba(84,84,88,0.4)', background: '#2c2c2e' }}>
          <div className="col-span-3 text-lbl2 uppercase text-xs tracking-wide">Total Prepaid</div>
          <div className="col-span-2"></div>
          <div className="col-span-2 text-right" style={{ color: '#30d158' }}>{fmt(total)}</div>
          <div className="col-span-5"></div>
        </div>
      </div>
    </div>
  )
}

function FormRow({ fields, setFields, onSave, onCancel }) {
  const f = key => ({
    value: fields[key] ?? '',
    onChange: e => setFields(p => ({ ...p, [key]: e.target.value })),
    className: 'apple-input w-full',
  })
  return (
    <div className="grid grid-cols-12 px-4 py-3 gap-1.5 text-sm"
      style={{ background: 'rgba(10,132,255,0.07)', borderBottom: '1px solid rgba(10,132,255,0.3)' }}>
      <div className="col-span-3"><input {...f('description')} placeholder="Description" /></div>
      <div className="col-span-2"><input {...f('vendor')} placeholder="Vendor" /></div>
      <div className="col-span-2"><input {...f('amount')} placeholder="$0.00" /></div>
      <div className="col-span-1"><input {...f('date_paid')} type="date" /></div>
      <div className="col-span-1">
        <select {...f('payment_method')} className="apple-input w-full">
          {METHODS.map(m => <option key={m}>{m}</option>)}
        </select>
      </div>
      <div className="col-span-1"><input {...f('check_number')} placeholder="Check #" /></div>
      <div className="col-span-1"><input {...f('notes')} placeholder="Notes" /></div>
      <div className="col-span-1 flex items-center gap-1">
        <button onClick={onSave} className="btn-primary text-xs px-2.5 py-1.5">✓</button>
        <button onClick={onCancel} className="btn-secondary text-xs px-2 py-1.5">✕</button>
      </div>
    </div>
  )
}
