import React, { useState, useEffect } from 'react'
import { supabase, uploadInvoice } from '../lib/supabase.js'
import { generateDrawPDF } from '../utils/pdf.js'

const fmt = n => n == null || n === '' ? '$—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })
const num = v => v === '' || v == null ? null : parseFloat(String(v).replace(/[$,]/g, '')) || 0

export default function DrawsTab({ settings }) {
  const [draws, setDraws] = useState([])
  const [activeDrawId, setActiveDrawId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list' | 'form'

  useEffect(() => { loadDraws() }, [])

  async function loadDraws() {
    setLoading(true)
    const { data } = await supabase.from('draw_sheets').select('*').order('draw_number', { ascending: false })
    setDraws(data || [])
    setLoading(false)
  }

  async function createDraw() {
    const maxNum = draws.reduce((m, d) => Math.max(m, d.draw_number || 0), 0)
    const { data } = await supabase.from('draw_sheets').insert({
      draw_number: maxNum + 1,
      draw_date: new Date().toISOString().split('T')[0],
      borrower: settings.borrower,
      property_address: settings.property_address,
      builder: settings.builder,
      bank_name: settings.bank_name,
      loan_amount: num(settings.loan_amount),
      loan_number: settings.loan_number || '',
      status: 'draft',
    }).select().single()
    if (data) {
      setDraws(prev => [data, ...prev])
      setActiveDrawId(data.id)
      setView('form')
    }
  }

  async function deleteDraw(id) {
    if (!confirm('Delete this draw sheet?')) return
    await supabase.from('draw_sheets').delete().eq('id', id)
    setDraws(prev => prev.filter(d => d.id !== id))
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading draw sheets…</div>

  if (view === 'form' && activeDrawId) {
    return (
      <DrawForm
        drawId={activeDrawId}
        settings={settings}
        onBack={() => { setView('list'); loadDraws() }}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Draw Sheets</h2>
          <p className="text-sm text-gray-500">Create and manage loan disbursement requests</p>
        </div>
        <button
          onClick={createDraw}
          className="px-4 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 font-medium text-sm"
        >+ New Draw Sheet</button>
      </div>

      {draws.length === 0 && (
        <div className="text-center py-20 text-gray-400 bg-white rounded-lg shadow">
          <div className="text-4xl mb-3">📋</div>
          <div className="font-medium">No draw sheets yet</div>
          <div className="text-sm mt-1">Click "New Draw Sheet" to create your first disbursement request</div>
        </div>
      )}

      <div className="grid gap-3">
        {draws.map(draw => {
          const total = draw.previous_draws_total != null
            ? (Number(draw.previous_draws_total) + Number(draw.this_draw_amount || 0))
            : Number(draw.this_draw_amount || 0)
          const remaining = draw.loan_amount ? Number(draw.loan_amount) - total : null

          return (
            <div
              key={draw.id}
              className="bg-white rounded-lg shadow border border-gray-200 p-4 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => { setActiveDrawId(draw.id); setView('form') }}
            >
              <div className="flex items-center gap-4">
                <div className="bg-blue-900 text-white rounded-lg w-14 h-14 flex flex-col items-center justify-center flex-shrink-0">
                  <div className="text-xs font-medium">Draw</div>
                  <div className="text-2xl font-bold leading-tight">{draw.draw_number}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-800">{draw.property_address}</div>
                  <div className="text-sm text-gray-500">
                    {draw.draw_date ? new Date(draw.draw_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}
                    {' · '}{draw.bank_name}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6 text-right">
                <div>
                  <div className="text-xs text-gray-400">This Draw</div>
                  <div className="font-bold text-blue-700">{fmt(draw.this_draw_amount)}</div>
                </div>
                {remaining != null && (
                  <div>
                    <div className="text-xs text-gray-400">Remaining</div>
                    <div className={`font-bold ${remaining < 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(remaining)}</div>
                  </div>
                )}
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${draw.status === 'submitted' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {draw.status === 'submitted' ? '✓ Submitted' : 'Draft'}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); deleteDraw(draw.id) }}
                  className="text-gray-300 hover:text-red-400 text-lg px-1"
                >✕</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Draw Form ──────────────────────────────────────────────────────────────
function DrawForm({ drawId, settings, onBack }) {
  const [draw, setDraw] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pdfGenerating, setPdfGenerating] = useState(false)

  useEffect(() => { loadDraw() }, [drawId])

  async function loadDraw() {
    setLoading(true)
    const [{ data: d }, { data: its }] = await Promise.all([
      supabase.from('draw_sheets').select('*').eq('id', drawId).single(),
      supabase.from('draw_items').select('*').eq('draw_sheet_id', drawId).order('sort_order')
    ])
    setDraw(d)
    setItems(its || [])
    setLoading(false)
  }

  async function updateDraw(patch) {
    setDraw(p => ({ ...p, ...patch }))
    await supabase.from('draw_sheets').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', drawId)
  }

  async function updateDrawField(key, value) {
    await updateDraw({ [key]: key.includes('amount') || key === 'loan_amount' ? num(value) : value })
  }

  async function addItem() {
    const { data } = await supabase.from('draw_items').insert({
      draw_sheet_id: drawId,
      description: '',
      previous_amount: 0,
      this_draw_amount: 0,
      sort_order: items.length,
    }).select().single()
    if (data) setItems(prev => [...prev, data])
  }

  async function updateItem(id, patch) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
    await supabase.from('draw_items').update(patch).eq('id', id)
  }

  async function deleteItem(id) {
    await supabase.from('draw_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  async function handleInvoiceUpload(itemId, file, idx) {
    try {
      const { publicUrl, path } = await uploadInvoice(file, drawId, idx)
      await updateItem(itemId, { invoice_url: publicUrl, invoice_filename: file.name })
    } catch (e) {
      alert('Upload failed: ' + e.message)
    }
  }

  async function handleGeneratePDF() {
    setPdfGenerating(true)
    // Recalculate this_draw_amount total before PDF
    const thisDraw = items.reduce((s, i) => s + (Number(i.this_draw_amount) || 0), 0)
    const prevTotal = items.reduce((s, i) => s + (Number(i.previous_amount) || 0), 0)
    await updateDraw({ this_draw_amount: thisDraw, previous_draws_total: prevTotal })
    try {
      await generateDrawPDF({ ...draw, this_draw_amount: thisDraw, previous_draws_total: prevTotal }, items, settings)
    } catch (e) {
      alert('PDF generation error: ' + e.message)
    }
    setPdfGenerating(false)
  }

  async function markSubmitted() {
    await updateDraw({ status: 'submitted' })
    alert('Draw sheet marked as submitted.')
  }

  if (loading || !draw) return <div className="text-center py-20 text-gray-400">Loading…</div>

  const prevTotal = items.reduce((s, i) => s + (Number(i.previous_amount) || 0), 0)
  const thisTotal = items.reduce((s, i) => s + (Number(i.this_draw_amount) || 0), 0)
  const grandTotal = prevTotal + thisTotal
  const remaining = draw.loan_amount ? Number(draw.loan_amount) - grandTotal : null

  return (
    <div>
      {/* Back + actions */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
          ← All Draw Sheets
        </button>
        <div className="flex gap-2">
          {draw.status !== 'submitted' && (
            <button onClick={markSubmitted} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
              ✓ Mark Submitted
            </button>
          )}
          <button
            onClick={handleGeneratePDF}
            disabled={pdfGenerating}
            className="px-4 py-1.5 text-sm bg-blue-700 text-white rounded hover:bg-blue-800 font-medium disabled:opacity-50"
          >
            {pdfGenerating ? 'Generating…' : '📄 Download PDF'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        {/* Draw header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="bg-blue-900 text-white rounded-xl w-16 h-16 flex flex-col items-center justify-center">
            <div className="text-xs">Draw</div>
            <div className="text-3xl font-bold leading-tight">{draw.draw_number}</div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Request for Partial Disbursement of Loan Proceeds</h2>
            <p className="text-sm text-gray-500">{draw.status === 'submitted' ? '✅ Submitted to bank' : '📝 Draft'}</p>
          </div>
        </div>

        {/* Header fields grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Borrower', key: 'borrower' },
            { label: 'Property Address', key: 'property_address' },
            { label: 'Builder', key: 'builder' },
            { label: 'Bank Name', key: 'bank_name' },
            { label: 'Loan Amount', key: 'loan_amount', money: true },
            { label: 'Loan Number', key: 'loan_number' },
            { label: 'Draw Date', key: 'draw_date', type: 'date' },
          ].map(({ label, key, money, type }) => (
            <div key={key}>
              <label className="text-xs text-gray-500 font-medium uppercase tracking-wide block mb-1">{label}</label>
              <input
                type={type || 'text'}
                defaultValue={draw[key] || ''}
                onBlur={e => updateDrawField(key, e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-400 focus:bg-blue-50"
                placeholder={money ? '$0.00' : label}
              />
            </div>
          ))}
        </div>

        {/* Line items */}
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
          <div className="grid grid-cols-12 bg-blue-900 text-white px-3 py-2 text-xs font-semibold uppercase tracking-wide">
            <div className="col-span-4">Description / Line Item</div>
            <div className="col-span-2 text-right">Previous Draws</div>
            <div className="col-span-2 text-right">This Draw</div>
            <div className="col-span-2 text-right">Total to Date</div>
            <div className="col-span-1 text-center">Invoice</div>
            <div className="col-span-1 text-center">Del</div>
          </div>

          {items.map((item, idx) => (
            <DrawItemRow
              key={item.id}
              item={item}
              idx={idx}
              onUpdate={(patch) => updateItem(item.id, patch)}
              onDelete={() => deleteItem(item.id)}
              onInvoiceUpload={(file) => handleInvoiceUpload(item.id, file, idx)}
            />
          ))}

          {items.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">No line items yet. Click + Add Line Item below.</div>
          )}

          {/* Totals row */}
          <div className="grid grid-cols-12 px-3 py-2.5 bg-gray-100 border-t-2 border-gray-300 font-bold text-sm">
            <div className="col-span-4 text-gray-700 uppercase text-xs tracking-wide">Totals</div>
            <div className="col-span-2 text-right text-gray-700">{fmt(prevTotal)}</div>
            <div className="col-span-2 text-right text-blue-700">{fmt(thisTotal)}</div>
            <div className="col-span-2 text-right text-gray-800">{fmt(grandTotal)}</div>
            <div className="col-span-2"></div>
          </div>
        </div>

        <button onClick={addItem} className="text-sm text-blue-600 hover:text-blue-800 font-medium mb-6">+ Add Line Item</button>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Loan Amount', value: fmt(draw.loan_amount), color: 'gray' },
            { label: 'Previous Draws', value: fmt(prevTotal), color: 'gray' },
            { label: 'This Draw', value: fmt(thisTotal), color: 'blue' },
            { label: '$ Remaining', value: remaining != null ? fmt(remaining) : '—', color: remaining != null && remaining < 0 ? 'red' : 'green' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`border-2 border-${color}-200 rounded-lg p-3 bg-${color}-50`}>
              <div className="text-xs text-gray-500 font-medium">{label}</div>
              <div className={`text-xl font-bold text-${color}-700 mt-0.5`}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DrawItemRow({ item, idx, onUpdate, onDelete, onInvoiceUpload }) {
  const [desc, setDesc] = useState(item.description || '')
  const [prev, setPrev] = useState(item.previous_amount || '')
  const [thisDraw, setThisDraw] = useState(item.this_draw_amount || '')
  const fileRef = React.useRef()
  const total = (Number(prev) || 0) + (Number(thisDraw) || 0)

  function flush(key, value) {
    const patch = { [key]: key.includes('amount') ? (parseFloat(String(value).replace(/[$,]/g, '')) || 0) : value }
    onUpdate(patch)
  }

  return (
    <div className="grid grid-cols-12 px-3 py-2 border-b border-gray-100 text-sm hover:bg-gray-50">
      <div className="col-span-4">
        <input
          value={desc}
          onChange={e => setDesc(e.target.value)}
          onBlur={() => flush('description', desc)}
          placeholder="Line item description"
          className="w-full px-1 py-0.5 border border-transparent hover:border-gray-200 rounded focus:outline-none focus:border-blue-400 focus:bg-blue-50 text-sm"
        />
      </div>
      <div className="col-span-2">
        <input
          value={prev}
          onChange={e => setPrev(e.target.value)}
          onBlur={() => flush('previous_amount', prev)}
          placeholder="$0.00"
          className="w-full px-1 py-0.5 border border-transparent hover:border-gray-200 rounded focus:outline-none focus:border-blue-400 focus:bg-blue-50 text-sm text-right"
        />
      </div>
      <div className="col-span-2">
        <input
          value={thisDraw}
          onChange={e => setThisDraw(e.target.value)}
          onBlur={() => flush('this_draw_amount', thisDraw)}
          placeholder="$0.00"
          className="w-full px-1 py-0.5 border border-transparent hover:border-gray-200 rounded focus:outline-none focus:border-blue-400 focus:bg-blue-50 text-sm text-right"
        />
      </div>
      <div className="col-span-2 text-right pr-2 text-gray-700 font-medium self-center">
        {total > 0 ? '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
      </div>
      <div className="col-span-1 flex justify-center items-center">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={e => e.target.files[0] && onInvoiceUpload(e.target.files[0])} />
        <button
          title={item.invoice_filename || 'Attach invoice'}
          onClick={() => fileRef.current.click()}
          className={`text-lg px-1 ${item.invoice_url ? 'text-green-600' : 'text-gray-300 hover:text-blue-400'}`}
        >
          {item.invoice_url ? '📎✓' : '📎'}
        </button>
        {item.invoice_url && (
          <a href={item.invoice_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline ml-1 truncate max-w-16" title={item.invoice_filename}>
            view
          </a>
        )}
      </div>
      <div className="col-span-1 flex justify-center items-center">
        <button onClick={onDelete} className="text-gray-300 hover:text-red-400 px-1">✕</button>
      </div>
    </div>
  )
}
