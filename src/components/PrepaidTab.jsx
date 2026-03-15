import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const fmt = n => n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = v => v === '' || v == null ? 0 : parseFloat(String(v).replace(/[$,]/g, '')) || 0

const METHODS = ['Check', 'ACH', 'AMEX', 'Debit', 'Wire', 'Cash', 'Other']

export default function PrepaidTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editFields, setEditFields] = useState({})
  const [adding, setAdding] = useState(false)
  const [newFields, setNewFields] = useState(emptyFields())

  function emptyFields() {
    return { description: '', vendor: '', amount: '', date_paid: '', payment_method: 'Check', check_number: '', notes: '' }
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('prepaid_items').select('*').order('date_paid', { ascending: false }).order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function addItem() {
    const { data } = await supabase.from('prepaid_items').insert({
      description: newFields.description,
      vendor: newFields.vendor,
      amount: num(newFields.amount),
      date_paid: newFields.date_paid || null,
      payment_method: newFields.payment_method,
      check_number: newFields.check_number,
      notes: newFields.notes,
    }).select().single()
    if (data) {
      setItems(prev => [data, ...prev])
      setNewFields(emptyFields())
      setAdding(false)
    }
  }

  async function saveEdit(id) {
    const patch = {
      description: editFields.description,
      vendor: editFields.vendor,
      amount: num(editFields.amount),
      date_paid: editFields.date_paid || null,
      payment_method: editFields.payment_method,
      check_number: editFields.check_number,
      notes: editFields.notes,
    }
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
    setEditFields({ description: item.description, vendor: item.vendor || '', amount: item.amount || '', date_paid: item.date_paid || '', payment_method: item.payment_method || 'Check', check_number: item.check_number || '', notes: item.notes || '' })
  }

  const total = items.reduce((s, i) => s + (i.amount || 0), 0)

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Prepaid Items</h2>
          <p className="text-sm text-gray-500">Items already paid — for bank documentation. Total: <strong className="text-blue-700">{fmt(total)}</strong></p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded hover:bg-gray-200 no-print"
          >🖨 Print for Bank</button>
          <button
            onClick={() => setAdding(true)}
            className="px-4 py-1.5 text-sm bg-blue-700 text-white rounded hover:bg-blue-800 font-medium"
          >+ Add Item</button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {/* Headers */}
        <div className="grid grid-cols-12 bg-blue-900 text-white px-3 py-2 text-xs font-semibold uppercase tracking-wide">
          <div className="col-span-3">Description</div>
          <div className="col-span-2">Vendor / Payee</div>
          <div className="col-span-2 text-right">Amount</div>
          <div className="col-span-1">Date Paid</div>
          <div className="col-span-1">Method</div>
          <div className="col-span-1">Check #</div>
          <div className="col-span-1">Notes</div>
          <div className="col-span-1 text-center">Actions</div>
        </div>

        {/* Add row */}
        {adding && (
          <FormRow
            fields={newFields}
            setFields={setNewFields}
            onSave={addItem}
            onCancel={() => { setAdding(false); setNewFields(emptyFields()) }}
            isNew
          />
        )}

        {items.length === 0 && !adding && (
          <div className="text-center py-12 text-gray-400">No prepaid items yet. Click + Add Item to get started.</div>
        )}

        {items.map(item => {
          if (editingId === item.id) {
            return (
              <FormRow
                key={item.id}
                fields={editFields}
                setFields={setEditFields}
                onSave={() => saveEdit(item.id)}
                onCancel={() => setEditingId(null)}
              />
            )
          }
          return (
            <div
              key={item.id}
              className="grid grid-cols-12 px-3 py-2.5 border-b border-gray-100 text-sm hover:bg-gray-50 cursor-pointer"
              onClick={() => startEdit(item)}
            >
              <div className="col-span-3 font-medium text-gray-800 truncate">{item.description}</div>
              <div className="col-span-2 text-gray-600 truncate">{item.vendor || '—'}</div>
              <div className="col-span-2 text-right font-semibold text-green-700">{fmt(item.amount)}</div>
              <div className="col-span-1 text-gray-500 text-xs">{item.date_paid ? new Date(item.date_paid + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</div>
              <div className="col-span-1 text-gray-500 text-xs">{item.payment_method || '—'}</div>
              <div className="col-span-1 text-gray-400 text-xs font-mono">{item.check_number || '—'}</div>
              <div className="col-span-1 text-gray-400 text-xs truncate">{item.notes || ''}</div>
              <div className="col-span-1 flex justify-center" onClick={e => e.stopPropagation()}>
                <button onClick={() => deleteItem(item.id)} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
              </div>
            </div>
          )
        })}

        {/* Total footer */}
        <div className="grid grid-cols-12 px-3 py-2.5 bg-gray-50 border-t-2 border-gray-300 font-bold text-sm">
          <div className="col-span-3 text-gray-700">TOTAL PREPAID</div>
          <div className="col-span-2"></div>
          <div className="col-span-2 text-right text-green-700">{fmt(total)}</div>
          <div className="col-span-5"></div>
        </div>
      </div>
    </div>
  )
}

function FormRow({ fields, setFields, onSave, onCancel, isNew }) {
  const f = key => ({
    value: fields[key] ?? '',
    onChange: e => setFields(p => ({ ...p, [key]: e.target.value })),
    className: 'w-full px-1 py-0.5 border border-blue-300 rounded text-sm bg-blue-50 focus:outline-none',
  })
  return (
    <div className="grid grid-cols-12 px-3 py-2 border-b border-blue-200 bg-blue-50 gap-1 text-sm">
      <div className="col-span-3"><input {...f('description')} placeholder="Description" /></div>
      <div className="col-span-2"><input {...f('vendor')} placeholder="Vendor" /></div>
      <div className="col-span-2"><input {...f('amount')} placeholder="$0.00" /></div>
      <div className="col-span-1"><input {...f('date_paid')} type="date" /></div>
      <div className="col-span-1">
        <select {...f('payment_method')} className="w-full px-1 py-0.5 border border-blue-300 rounded text-sm bg-blue-50">
          {METHODS.map(m => <option key={m}>{m}</option>)}
        </select>
      </div>
      <div className="col-span-1"><input {...f('check_number')} placeholder="Check #" /></div>
      <div className="col-span-1"><input {...f('notes')} placeholder="Notes" /></div>
      <div className="col-span-1 flex gap-1 items-center">
        <button onClick={onSave} className="text-xs bg-blue-600 text-white px-2 py-1 rounded">✓</button>
        <button onClick={onCancel} className="text-xs bg-gray-200 px-1.5 py-1 rounded">✕</button>
      </div>
    </div>
  )
}
