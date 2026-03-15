import React, { useState, useEffect } from 'react'
import { supabase, uploadInvoice } from '../lib/supabase.js'
import { generateDrawPDF } from '../utils/pdf.js'

const fmt = n => n == null || n === '' ? '$—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })
const num = v => v === '' || v == null ? null : parseFloat(String(v).replace(/[$,]/g, '')) || 0

export default function DrawsTab({ settings }) {
  const [draws, setDraws]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [activeDrawId, setActiveDrawId] = useState(null)
  const [view, setView]           = useState('list')

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
      borrower: 'Josh Meyer',
      property_address: settings.property_address,
      builder: settings.builder,
      bank_name: settings.bank_name,
      loan_amount: num(settings.loan_amount),
      loan_number: settings.loan_number || '',
      status: 'draft',
    }).select().single()
    if (data) { setDraws(prev => [data, ...prev]); setActiveDrawId(data.id); setView('form') }
  }

  async function deleteDraw(id) {
    if (!confirm('Delete this draw sheet?')) return
    await supabase.from('draw_sheets').delete().eq('id', id)
    setDraws(prev => prev.filter(d => d.id !== id))
  }

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading…</div>

  if (view === 'form' && activeDrawId) {
    return <DrawForm drawId={activeDrawId} settings={settings}
      onBack={() => { setView('list'); loadDraws() }} />
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lbl font-bold text-xl">Draw Sheets</h2>
          <p className="text-lbl2 text-sm mt-0.5">Loan disbursement requests</p>
        </div>
        <button onClick={createDraw} className="btn-primary px-5 py-2 text-sm">+ New Draw Sheet</button>
      </div>

      {draws.length === 0 && (
        <div className="apple-card text-center py-20">
          <div className="text-5xl mb-4">📋</div>
          <div className="text-lbl font-semibold text-lg">No draw sheets yet</div>
          <div className="text-lbl2 text-sm mt-2">Create your first disbursement request</div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {draws.map(draw => {
          const thisAmt   = Number(draw.this_draw_amount || 0)
          const prevAmt   = Number(draw.previous_draws_total || 0)
          const remaining = draw.loan_amount ? Number(draw.loan_amount) - (prevAmt + thisAmt) : null
          return (
            <div key={draw.id}
              className="apple-card p-4 flex items-center justify-between cursor-pointer transition-all hover:opacity-90"
              onClick={() => { setActiveDrawId(draw.id); setView('form') }}>
              <div className="flex items-center gap-4">
                <div className="rounded-apple2 w-14 h-14 flex flex-col items-center justify-center flex-shrink-0"
                  style={{ background: '#0a84ff' }}>
                  <div className="text-white text-xs font-medium">Draw</div>
                  <div className="text-white text-2xl font-bold leading-tight">{draw.draw_number}</div>
                </div>
                <div>
                  <div className="text-lbl font-semibold">{draw.property_address}</div>
                  <div className="text-lbl2 text-sm mt-0.5">
                    {draw.draw_date ? new Date(draw.draw_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}
                    {' · '}{draw.bank_name}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6 text-right">
                <div>
                  <div className="text-lbl3 text-xs mb-0.5">This Draw</div>
                  <div className="text-acc font-bold">{fmt(draw.this_draw_amount)}</div>
                </div>
                {remaining != null && (
                  <div>
                    <div className="text-lbl3 text-xs mb-0.5">Remaining</div>
                    <div className="font-bold" style={{ color: remaining < 0 ? '#ff453a' : '#30d158' }}>{fmt(remaining)}</div>
                  </div>
                )}
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                  draw.status === 'submitted'
                    ? 'text-pos' : 'text-warn'
                }`} style={{ background: draw.status === 'submitted' ? 'rgba(48,209,88,0.15)' : 'rgba(255,159,10,0.15)' }}>
                  {draw.status === 'submitted' ? '✓ Submitted' : 'Draft'}
                </span>
                <button onClick={e => { e.stopPropagation(); deleteDraw(draw.id) }}
                  className="text-lbl3 hover:text-neg text-lg px-1 ml-1">✕</button>
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
  const [draw, setDraw]         = useState(null)
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [pdfLoading, setPdfLoading] = useState(false)

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
    const v = (key.includes('amount') || key === 'loan_amount') ? num(value) : value
    await updateDraw({ [key]: v })
  }

  async function addItem() {
    const { data } = await supabase.from('draw_items').insert({
      draw_sheet_id: drawId, description: '', previous_amount: 0, this_draw_amount: 0, sort_order: items.length,
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
      const { publicUrl } = await uploadInvoice(file, drawId, idx)
      await updateItem(itemId, { invoice_url: publicUrl, invoice_filename: file.name })
    } catch (e) { alert('Upload failed: ' + e.message) }
  }

  async function handlePDF() {
    setPdfLoading(true)
    const thisTotal = items.reduce((s, i) => s + (Number(i.this_draw_amount) || 0), 0)
    const prevTotal = items.reduce((s, i) => s + (Number(i.previous_amount) || 0), 0)
    await updateDraw({ this_draw_amount: thisTotal, previous_draws_total: prevTotal })
    try {
      await generateDrawPDF({ ...draw, this_draw_amount: thisTotal, previous_draws_total: prevTotal }, items, { ...settings, borrower: 'Josh Meyer' })
    } catch (e) { alert('PDF error: ' + e.message) }
    setPdfLoading(false)
  }

  if (loading || !draw) return <div className="text-center py-24 text-lbl3 text-sm">Loading…</div>

  const prevTotal = items.reduce((s, i) => s + (Number(i.previous_amount) || 0), 0)
  const thisTotal = items.reduce((s, i) => s + (Number(i.this_draw_amount) || 0), 0)
  const grandTotal = prevTotal + thisTotal
  const remaining  = draw.loan_amount ? Number(draw.loan_amount) - grandTotal : null

  return (
    <div>
      {/* Back + actions */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={onBack} className="text-acc text-sm font-medium hover:opacity-70">← Draw Sheets</button>
        <div className="flex gap-2">
          {draw.status !== 'submitted' && (
            <button onClick={() => updateDraw({ status: 'submitted' })}
              className="btn-secondary px-4 py-2 text-sm" style={{ color: '#30d158' }}>
              ✓ Mark Submitted
            </button>
          )}
          <button onClick={handlePDF} disabled={pdfLoading}
            className="btn-primary px-5 py-2 text-sm disabled:opacity-40">
            {pdfLoading ? 'Generating…' : '↓ Download PDF'}
          </button>
        </div>
      </div>

      <div className="apple-card p-6 mb-4">
        {/* Draw title */}
        <div className="flex items-center gap-4 mb-6">
          <div className="rounded-apple2 w-16 h-16 flex flex-col items-center justify-center flex-shrink-0"
            style={{ background: '#0a84ff' }}>
            <div className="text-white text-xs">Draw</div>
            <div className="text-white text-3xl font-bold leading-tight">{draw.draw_number}</div>
          </div>
          <div>
            <h2 className="text-lbl font-bold text-lg leading-snug">Request for Partial Disbursement<br/>of Loan Proceeds</h2>
            <span className={`text-xs font-semibold mt-1 inline-block px-2 py-0.5 rounded-full ${
              draw.status === 'submitted' ? 'text-pos' : 'text-warn'
            }`} style={{ background: draw.status === 'submitted' ? 'rgba(48,209,88,0.15)' : 'rgba(255,159,10,0.15)' }}>
              {draw.status === 'submitted' ? '✓ Submitted' : 'Draft'}
            </span>
          </div>
        </div>

        {/* Header fields */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Borrower',          key: 'borrower' },
            { label: 'Property Address',  key: 'property_address' },
            { label: 'Builder / GC',      key: 'builder' },
            { label: 'Bank Name',         key: 'bank_name' },
            { label: 'Loan Amount',       key: 'loan_amount' },
            { label: 'Loan Number',       key: 'loan_number' },
            { label: 'Draw Date',         key: 'draw_date', type: 'date' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="text-lbl3 text-xs font-semibold uppercase tracking-widest block mb-1">{label}</label>
              <input
                type={type || 'text'}
                defaultValue={key === 'borrower' ? 'Josh Meyer' : (draw[key] || '')}
                onBlur={e => updateDrawField(key, e.target.value)}
                className="apple-input w-full"
                placeholder={label}
              />
            </div>
          ))}
        </div>

        {/* Line items table */}
        <div className="rounded-apple overflow-hidden mb-4" style={{ border: '1px solid rgba(84,84,88,0.35)' }}>
          <div className="grid grid-cols-12 px-4 py-2.5 text-xs font-semibold uppercase tracking-widest"
            style={{ color: '#636366', background: '#2c2c2e', borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
            <div className="col-span-4">Description</div>
            <div className="col-span-2 text-right">Previous Draws</div>
            <div className="col-span-2 text-right">This Draw</div>
            <div className="col-span-2 text-right">Total to Date</div>
            <div className="col-span-1 text-center">Invoice</div>
            <div className="col-span-1 text-center">Del</div>
          </div>

          {items.map((item, idx) => (
            <DrawItemRow key={item.id} item={item} idx={idx}
              onUpdate={p => updateItem(item.id, p)}
              onDelete={() => deleteItem(item.id)}
              onInvoiceUpload={f => handleInvoiceUpload(item.id, f, idx)} />
          ))}

          {items.length === 0 && (
            <div className="text-center py-10 text-lbl3 text-sm">No line items yet</div>
          )}

          {/* Totals */}
          <div className="grid grid-cols-12 px-4 py-3 font-bold text-sm"
            style={{ borderTop: '2px solid rgba(84,84,88,0.4)', background: '#2c2c2e' }}>
            <div className="col-span-4 text-lbl2 text-xs uppercase tracking-wide">Totals</div>
            <div className="col-span-2 text-right text-lbl2">{fmt(prevTotal)}</div>
            <div className="col-span-2 text-right text-acc">{fmt(thisTotal)}</div>
            <div className="col-span-2 text-right text-lbl">{fmt(grandTotal)}</div>
            <div className="col-span-2"></div>
          </div>
        </div>

        <button onClick={addItem} className="text-acc text-sm font-semibold mb-6">+ Add Line Item</button>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Loan Amount',    value: fmt(draw.loan_amount), color: '#8e8e93' },
            { label: 'Previous Draws', value: fmt(prevTotal),        color: '#8e8e93' },
            { label: 'This Draw',      value: fmt(thisTotal),        color: '#0a84ff' },
            { label: '$ Remaining',    value: remaining != null ? fmt(remaining) : '—',
              color: remaining != null && remaining < 0 ? '#ff453a' : '#30d158' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-apple p-3"
              style={{ background: '#2c2c2e', border: `1px solid rgba(84,84,88,0.35)` }}>
              <div className="text-lbl3 text-xs mb-1">{label}</div>
              <div className="font-bold text-xl" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DrawItemRow({ item, idx, onUpdate, onDelete, onInvoiceUpload }) {
  const [desc, setDesc]         = useState(item.description || '')
  const [prev, setPrev]         = useState(item.previous_amount || '')
  const [thisDraw, setThisDraw] = useState(item.this_draw_amount || '')
  const fileRef = React.useRef()
  const total = (Number(prev) || 0) + (Number(thisDraw) || 0)

  function flush(key, value) {
    onUpdate({ [key]: key.includes('amount') ? (parseFloat(String(value).replace(/[$,]/g,'')) || 0) : value })
  }

  const inputCls = "w-full px-2 py-1 rounded-lg text-sm text-lbl focus:outline-none focus:border-acc transition-colors"
  const inputStyle = { background: 'transparent', border: '1px solid transparent' }
  const inputHoverStyle = { border: '1px solid rgba(84,84,88,0.4)' }

  return (
    <div className="grid grid-cols-12 px-4 py-2 data-row text-sm"
      style={{ borderBottom: '1px solid rgba(84,84,88,0.2)' }}>
      <div className="col-span-4">
        <input value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => flush('description', desc)}
          placeholder="Line item description"
          className={inputCls} style={{ ...inputStyle, background: 'transparent' }}
          onFocus={e => e.target.style.borderColor = '#0a84ff'}
          onBlurCapture={e => e.target.style.borderColor = 'transparent'} />
      </div>
      <div className="col-span-2">
        <input value={prev} onChange={e => setPrev(e.target.value)} onBlur={() => flush('previous_amount', prev)}
          placeholder="$0.00" className={inputCls + ' text-right'} style={inputStyle}
          onFocus={e => e.target.style.borderColor = '#0a84ff'}
          onBlurCapture={e => e.target.style.borderColor = 'transparent'} />
      </div>
      <div className="col-span-2">
        <input value={thisDraw} onChange={e => setThisDraw(e.target.value)} onBlur={() => flush('this_draw_amount', thisDraw)}
          placeholder="$0.00" className={inputCls + ' text-right'} style={inputStyle}
          onFocus={e => e.target.style.borderColor = '#0a84ff'}
          onBlurCapture={e => e.target.style.borderColor = 'transparent'} />
      </div>
      <div className="col-span-2 text-right pr-3 text-lbl2 font-medium self-center text-sm">
        {total > 0 ? fmt(total) : '—'}
      </div>
      <div className="col-span-1 flex justify-center items-center gap-1">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={e => e.target.files[0] && onInvoiceUpload(e.target.files[0])} />
        <button onClick={() => fileRef.current.click()}
          title={item.invoice_filename || 'Attach invoice'}
          className="text-lg transition-transform hover:scale-110"
          style={{ color: item.invoice_url ? '#30d158' : '#3a3a3c' }}>
          📎
        </button>
        {item.invoice_url && (
          <a href={item.invoice_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-acc hover:underline">view</a>
        )}
      </div>
      <div className="col-span-1 flex justify-center items-center">
        <button onClick={onDelete} className="text-lbl3 hover:text-neg text-sm px-1">✕</button>
      </div>
    </div>
  )
}
