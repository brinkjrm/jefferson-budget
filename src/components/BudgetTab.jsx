import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

const fmt = n => n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const num = v => v === '' || v == null ? null : parseFloat(String(v).replace(/[$,]/g, '')) || 0

export default function BudgetTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
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
    const newStatus = item.status === 'locked' ? 'pending' : 'locked'
    await updateItem(item.id, { status: newStatus })
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
    setEditFields({ name: item.name, code: item.code || '', estimated_cost: item.estimated_cost || '', actual_cost: item.actual_cost || '', vendor: item.vendor || '', date_paid: item.date_paid || '', notes: item.notes || '' })
  }

  async function saveEdit(id) {
    const patch = {
      name: editFields.name,
      code: editFields.code,
      estimated_cost: num(editFields.estimated_cost),
      actual_cost: editFields.actual_cost !== '' ? num(editFields.actual_cost) : null,
      vendor: editFields.vendor,
      date_paid: editFields.date_paid || null,
      notes: editFields.notes,
    }
    await updateItem(id, patch)
    setEditingId(null)
  }

  const softItems = items.filter(i => i.section === 'soft')
  const hardItems = items.filter(i => i.section === 'hard')

  const totalEst = items.reduce((s, i) => s + (i.estimated_cost || 0), 0)
  const totalAct = items.reduce((s, i) => s + (i.actual_cost || 0), 0)
  const lockedEst = items.filter(i => i.status === 'locked').reduce((s, i) => s + (i.actual_cost || i.estimated_cost || 0), 0)
  const pendingEst = items.filter(i => i.status !== 'locked').reduce((s, i) => s + (i.estimated_cost || 0), 0)
  const overages = items.filter(i => i.actual_cost != null && i.actual_cost > (i.estimated_cost || 0))
  const pctLocked = totalEst > 0 ? Math.round((lockedEst / totalEst) * 100) : 0

  if (loading) return <div className="text-center py-20 text-gray-400">Loading budget…</div>

  return (
    <div>
      {/* Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Budget', value: fmt(totalEst), color: 'blue' },
          { label: 'Locked In', value: fmt(lockedEst), sub: `${pctLocked}% committed`, color: 'green' },
          { label: 'Pending Bids', value: fmt(pendingEst), color: 'yellow' },
          { label: 'Overages', value: overages.length, sub: overages.length ? `${overages.map(o=>o.name).slice(0,2).join(', ')}…` : 'None 🎉', color: overages.length ? 'red' : 'gray' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className={`bg-white rounded-lg shadow p-4 border-l-4 border-${color}-500`}>
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</div>
            <div className={`text-2xl font-bold text-${color}-700 mt-1`}>{value}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-100 border border-green-300 inline-block"></span>Locked bid</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-white border border-gray-200 inline-block"></span>Pending</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300 inline-block"></span>Over budget</span>
        <span className="ml-auto text-gray-400 italic">Click any row to edit · Click lock icon to mark bid as confirmed</span>
      </div>

      {/* Soft Costs */}
      <Section
        title="B.  ALLOWABLE SOFT COSTS"
        items={softItems}
        editingId={editingId}
        editFields={editFields}
        setEditFields={setEditFields}
        onEdit={startEdit}
        onSave={saveEdit}
        onCancel={() => setEditingId(null)}
        onToggleLock={toggleLock}
        onDelete={deleteItem}
        onAdd={() => addItem('soft')}
      />

      <div className="mb-4" />

      {/* Hard Costs */}
      <Section
        title="C.  HARD COSTS"
        items={hardItems}
        editingId={editingId}
        editFields={editFields}
        setEditFields={setEditFields}
        onEdit={startEdit}
        onSave={saveEdit}
        onCancel={() => setEditingId(null)}
        onToggleLock={toggleLock}
        onDelete={deleteItem}
        onAdd={() => addItem('hard')}
      />
    </div>
  )
}

function Section({ title, items, editingId, editFields, setEditFields, onEdit, onSave, onCancel, onToggleLock, onDelete, onAdd }) {
  const sectionEst = items.reduce((s, i) => s + (i.estimated_cost || 0), 0)
  const sectionAct = items.reduce((s, i) => s + (i.actual_cost || 0), 0)

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Section header */}
      <div className="bg-blue-900 text-white px-4 py-2.5 flex items-center justify-between">
        <span className="font-bold text-sm tracking-wide">{title}</span>
        <span className="text-blue-200 text-sm">
          Est: <strong className="text-white">{fmt(sectionEst)}</strong>
          {sectionAct > 0 && <> · Actual: <strong className="text-white">{fmt(sectionAct)}</strong></>}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-12 bg-gray-50 border-b border-gray-200 px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <div className="col-span-1">Code</div>
        <div className="col-span-3">Description</div>
        <div className="col-span-2 text-right">Estimated</div>
        <div className="col-span-2 text-right">Bid / Actual</div>
        <div className="col-span-2">Vendor</div>
        <div className="col-span-1">Date Paid</div>
        <div className="col-span-1 text-center">Actions</div>
      </div>

      {/* Rows */}
      {items.map(item => {
        const isEditing = editingId === item.id
        const isLocked = item.status === 'locked'
        const isOver = item.actual_cost != null && item.actual_cost > (item.estimated_cost || 0)
        const rowClass = isOver ? 'row-overage' : isLocked ? 'row-locked' : 'row-pending'

        if (isEditing) {
          return (
            <EditRow
              key={item.id}
              fields={editFields}
              setFields={setEditFields}
              onSave={() => onSave(item.id)}
              onCancel={onCancel}
            />
          )
        }

        return (
          <div
            key={item.id}
            className={`grid grid-cols-12 px-2 py-2 border-b border-gray-100 text-sm hover:opacity-90 cursor-pointer ${rowClass}`}
            onClick={() => onEdit(item)}
          >
            <div className="col-span-1 text-gray-400 text-xs font-mono">{item.code || ''}</div>
            <div className="col-span-3 font-medium text-gray-800 truncate">{item.name}</div>
            <div className="col-span-2 text-right text-gray-700">{fmt(item.estimated_cost)}</div>
            <div className={`col-span-2 text-right font-semibold ${isOver ? 'text-red-600' : isLocked ? 'text-green-700' : 'text-gray-400'}`}>
              {item.actual_cost != null ? fmt(item.actual_cost) : '—'}
              {isOver && <span className="ml-1 text-xs">▲</span>}
            </div>
            <div className="col-span-2 text-gray-500 text-xs truncate">{item.vendor || ''}</div>
            <div className="col-span-1 text-gray-400 text-xs">{item.date_paid ? new Date(item.date_paid).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</div>
            <div className="col-span-1 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
              <button
                title={isLocked ? 'Unlock bid' : 'Mark as locked bid'}
                onClick={() => onToggleLock(item)}
                className={`text-xs px-1.5 py-0.5 rounded ${isLocked ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500 hover:bg-green-100'}`}
              >
                {isLocked ? '🔒' : '🔓'}
              </button>
              <button
                title="Delete"
                onClick={() => onDelete(item.id)}
                className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-red-400 hover:bg-red-50"
              >✕</button>
            </div>
          </div>
        )
      })}

      {/* Add row */}
      <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
        <button
          onClick={onAdd}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >+ Add line item</button>
      </div>
    </div>
  )
}

function EditRow({ fields, setFields, onSave, onCancel }) {
  const f = (key) => ({
    value: fields[key] ?? '',
    onChange: e => setFields(p => ({ ...p, [key]: e.target.value })),
    className: 'w-full px-1 py-0.5 border border-blue-300 rounded text-sm bg-blue-50 focus:outline-none focus:border-blue-500',
  })

  return (
    <div className="grid grid-cols-12 px-2 py-2 border-b border-blue-200 bg-blue-50 gap-1 text-sm">
      <div className="col-span-1"><input {...f('code')} placeholder="Code" /></div>
      <div className="col-span-3"><input {...f('name')} placeholder="Description" /></div>
      <div className="col-span-2"><input {...f('estimated_cost')} placeholder="Estimated $" /></div>
      <div className="col-span-2"><input {...f('actual_cost')} placeholder="Bid / Actual $" /></div>
      <div className="col-span-2"><input {...f('vendor')} placeholder="Vendor" /></div>
      <div className="col-span-1"><input {...f('date_paid')} type="date" /></div>
      <div className="col-span-1 flex gap-1 items-center">
        <button onClick={onSave} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">Save</button>
        <button onClick={onCancel} className="text-xs bg-gray-200 text-gray-600 px-1.5 py-1 rounded hover:bg-gray-300">✕</button>
      </div>
    </div>
  )
}
