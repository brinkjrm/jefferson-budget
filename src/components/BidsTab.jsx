import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 })

const STATUS_COLORS = {
  pending:  { bg: 'rgba(255,214,10,0.15)',  border: 'rgba(255,214,10,0.4)',  text: '#ffd60a',  label: 'Pending'  },
  accepted: { bg: 'rgba(48,209,88,0.15)',   border: 'rgba(48,209,88,0.4)',   text: '#30d158',  label: 'Accepted' },
  rejected: { bg: 'rgba(255,69,58,0.12)',   border: 'rgba(255,69,58,0.3)',   text: '#ff453a',  label: 'Rejected' },
}

const SOURCE_ICONS = { pdf_upload: '📄', email: '📧', manual: '✏️' }

// ── Simple fuzzy match: returns true if any word in needle appears in haystack ──
function fuzzyMatch(a = '', b = '') {
  const words = a.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const target = b.toLowerCase()
  return words.some(w => target.includes(w))
}

export default function BidsTab() {
  const [bids,         setBids]         = useState([])
  const [contractors,  setContractors]  = useState([])
  const [budgetItems,  setBudgetItems]  = useState([])
  const [schedTasks,   setSchedTasks]   = useState([])
  const [loading,      setLoading]      = useState(true)
  const [dragging,     setDragging]     = useState(false)
  const [extracting,   setExtracting]   = useState(false)
  const [polling,      setPolling]      = useState(false)
  const [toast,        setToast]        = useState(null)
  const [reviewBid,    setReviewBid]    = useState(null)   // {extracted, pdfFile, pdfBase64}
  const [acceptModal,  setAcceptModal]  = useState(null)   // {bid, budgetMatches, schedMatches}
  const [contractorDrawer, setContractorDrawer] = useState(null)
  const [expandedTrade, setExpandedTrade] = useState(new Set())
  const [expandedBid,   setExpandedBid]   = useState(null)
  const fileInputRef = useRef()

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [b, c, li, st] = await Promise.all([
      supabase.from('bids').select('*, contractors(*)').order('created_at', { ascending: false }),
      supabase.from('contractors').select('*').order('name'),
      supabase.from('line_items').select('*').order('sort_order'),
      supabase.from('schedule_tasks').select('*').order('sort_order'),
    ])
    setBids(b.data || [])
    setContractors(c.data || [])
    setBudgetItems(li.data || [])
    setSchedTasks(st.data || [])
    setLoading(false)
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // ── PDF handling ────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files) => {
    const file = files[0]
    if (!file || file.type !== 'application/pdf') {
      showToast('Please drop a PDF file', 'error'); return
    }
    setExtracting(true)
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch('/api/extract-bid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pdf: base64 }),
      })
      const { bid, error } = await res.json()
      if (error) throw new Error(error)
      setReviewBid({ extracted: bid || {}, pdfFile: file, pdfBase64: base64 })
    } catch (err) {
      showToast('Extraction failed: ' + err.message, 'error')
    } finally {
      setExtracting(false)
    }
  }, [])

  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  // ── iCloud email poll ───────────────────────────────────────────────────────
  async function pollEmail(lookbackDays = 90) {
    setPolling(true)
    try {
      const res = await fetch('/api/poll-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lookbackDays }),
      })
      const { count, error } = await res.json()
      if (error) throw new Error(error)
      if (count > 0) { await loadAll(); showToast(`Found ${count} new bid${count > 1 ? 's' : ''} in iCloud!`) }
      else showToast(`No new bid emails in the last ${lookbackDays} days`)
    } catch (err) {
      showToast('Email poll failed: ' + err.message, 'error')
    } finally {
      setPolling(false)
    }
  }

  // ── Save reviewed bid ───────────────────────────────────────────────────────
  async function saveReviewedBid(fields) {
    try {
      // Upload PDF to Supabase Storage
      let pdfUrl = null
      if (reviewBid.pdfFile) {
        const path = `bid-${Date.now()}.pdf`
        const { error: upErr } = await supabase.storage.from('bid-pdfs').upload(path, reviewBid.pdfFile, { upsert: true })
        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage.from('bid-pdfs').getPublicUrl(path)
          pdfUrl = publicUrl
        }
      }

      // Upsert contractor
      let contractorId = null
      if (fields.contractorName) {
        const contractorData = { name: fields.contractorName, company: fields.company || null, email: fields.email || null, phone: fields.phone || null, trade: fields.trade || null }
        let existing = null
        if (fields.email) {
          const { data } = await supabase.from('contractors').select('id').eq('email', fields.email).maybeSingle()
          existing = data
        }
        if (existing) {
          await supabase.from('contractors').update(contractorData).eq('id', existing.id)
          contractorId = existing.id
        } else {
          const { data } = await supabase.from('contractors').insert(contractorData).select('id').single()
          if (data) contractorId = data.id
        }
      }

      // Insert bid
      const { data: saved } = await supabase.from('bids').insert({
        contractor_id: contractorId,
        trade: fields.trade || null,
        description: fields.description || null,
        total_amount: fields.totalAmount ? parseFloat(String(fields.totalAmount).replace(/[$,]/g,'')) : null,
        line_items: fields.lineItems || [],
        pdf_url: pdfUrl,
        source: 'pdf_upload',
        status: 'pending',
        notes: fields.notes || null,
      }).select('*, contractors(*)').single()

      if (saved) {
        setBids(prev => [saved, ...prev])
        if (!contractors.find(c => c.id === contractorId)) {
          const { data: cList } = await supabase.from('contractors').select('*').order('name')
          if (cList) setContractors(cList)
        }
      }
      setReviewBid(null)
      showToast('Bid saved!')
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error')
    }
  }

  // ── Accept bid ──────────────────────────────────────────────────────────────
  function startAccept(bid) {
    const trade = bid.trade || bid.contractors?.trade || ''
    const budgetMatches = budgetItems.filter(li =>
      fuzzyMatch(trade, li.name) || fuzzyMatch(trade, li.section) || fuzzyMatch(li.name, trade)
    )
    const schedMatches = schedTasks.filter(st =>
      fuzzyMatch(trade, st.name) || fuzzyMatch(st.name, trade)
    )
    setAcceptModal({ bid, budgetMatches, schedMatches, selectedBudget: budgetMatches[0]?.id || null, selectedSched: schedMatches.map(t => t.id) })
  }

  async function confirmAccept(modal) {
    const { bid, selectedBudget, selectedSched } = modal
    const contractor = bid.contractors || contractors.find(c => c.id === bid.contractor_id)

    // 1. Accept this bid, reject others in the same trade
    await supabase.from('bids').update({ status: 'accepted', budget_line_item_id: selectedBudget || null, schedule_task_ids: selectedSched || [] }).eq('id', bid.id)
    if (bid.trade) {
      const sameTradeIds = bids.filter(b => b.trade === bid.trade && b.id !== bid.id).map(b => b.id)
      if (sameTradeIds.length) await supabase.from('bids').update({ status: 'rejected' }).in('id', sameTradeIds)
    }

    // 2. Update budget line item
    if (selectedBudget && bid.total_amount != null) {
      await supabase.from('line_items').update({
        actual_cost: bid.total_amount,
        vendor: contractor?.company || contractor?.name || null,
        status: 'locked',
      }).eq('id', selectedBudget)
    }

    // 3. Update schedule tasks
    if (selectedSched?.length && contractor) {
      // Store contractor name in schedule task notes for now
      for (const taskId of selectedSched) {
        const task = schedTasks.find(t => t.id === taskId)
        if (task) {
          const note = `Contractor: ${contractor.company || contractor.name}`
          await supabase.from('schedule_tasks').update({ notes: note }).eq('id', taskId)
        }
      }
    }

    await loadAll()
    setAcceptModal(null)
    showToast('Bid accepted! Budget and schedule updated.')
  }

  // ── Group bids by trade ─────────────────────────────────────────────────────
  const tradeGroups = {}
  bids.forEach(bid => {
    const t = bid.trade || 'Uncategorized'
    if (!tradeGroups[t]) tradeGroups[t] = []
    tradeGroups[t].push(bid)
  })

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading…</div>

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 200, padding: '10px 18px', borderRadius: 10, background: toast.type === 'error' ? '#ff453a' : '#30d158', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', transition: 'opacity 0.3s' }}>
          {toast.msg}
        </div>
      )}

      {/* Capture bar */}
      <div className="apple-card p-4 mb-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-white font-semibold text-sm">Import a Bid</span>
          <div className="ml-auto flex items-center gap-2">
            <select
              id="lookback"
              defaultValue="90"
              className="apple-input text-xs"
              style={{ width: 110 }}
              disabled={polling}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last year</option>
            </select>
            <button
              onClick={() => {
                const days = parseInt(document.getElementById('lookback').value)
                pollEmail(days)
              }}
              disabled={polling}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              {polling ? 'Checking…' : '📧 Check iCloud Email'}
            </button>
          </div>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? '#0a84ff' : 'rgba(84,84,88,0.5)'}`,
            borderRadius: 12,
            padding: '28px 16px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragging ? 'rgba(10,132,255,0.06)' : 'transparent',
            transition: 'all 0.15s',
          }}
        >
          {extracting ? (
            <div>
              <div style={{ fontSize: 28, marginBottom: 6 }}>⏳</div>
              <div style={{ fontSize: 13, color: '#0a84ff', fontWeight: 600 }}>Reading bid with AI…</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
              <div style={{ fontSize: 13, color: dragging ? '#0a84ff' : '#ebebf5', fontWeight: 500 }}>
                Drop a contractor bid PDF here
              </div>
              <div style={{ fontSize: 11, color: '#636366', marginTop: 4 }}>or click to browse</div>
            </div>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
      </div>

      {/* Bid comparison by trade */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-white font-semibold text-sm">Bid Comparison</span>
          <span className="text-lbl3 text-xs">{bids.length} bid{bids.length !== 1 ? 's' : ''} total</span>
        </div>
        {Object.keys(tradeGroups).length === 0 ? (
          <div className="apple-card p-8 text-center text-lbl3 text-sm" style={{ fontStyle: 'italic' }}>
            No bids yet — drop a PDF or check email to get started
          </div>
        ) : (
          Object.entries(tradeGroups).map(([trade, tradeBids]) => {
            const isOpen = expandedTrade.has(trade)
            const hasAccepted = tradeBids.some(b => b.status === 'accepted')
            return (
              <div key={trade} className="apple-card mb-3 overflow-hidden">
                <div
                  onClick={() => setExpandedTrade(s => { const n = new Set(s); n.has(trade) ? n.delete(trade) : n.add(trade); return n })}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', borderBottom: isOpen ? '1px solid rgba(84,84,88,0.3)' : 'none', background: '#2c2c2e' }}
                >
                  <span style={{ fontSize: 9, color: '#636366' }}>{isOpen ? '▼' : '▶'}</span>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#fff', flex: 1 }}>{trade}</span>
                  <span style={{ fontSize: 11, color: '#636366' }}>{tradeBids.length} bid{tradeBids.length !== 1 ? 's' : ''}</span>
                  {hasAccepted && <span style={{ fontSize: 10, fontWeight: 600, color: '#30d158', background: 'rgba(48,209,88,0.15)', borderRadius: 6, padding: '2px 7px' }}>Accepted</span>}
                </div>
                {isOpen && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, padding: 12 }}>
                    {tradeBids.map(bid => <BidCard key={bid.id} bid={bid} expanded={expandedBid === bid.id} onExpand={() => setExpandedBid(p => p === bid.id ? null : bid.id)} onAccept={() => startAccept(bid)} onContractor={() => setContractorDrawer(bid.contractors || contractors.find(c => c.id === bid.contractor_id))} />)}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Contractor directory */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-white font-semibold text-sm">Contractor Directory</span>
          <span className="text-lbl3 text-xs">{contractors.length} contacts</span>
        </div>
        {contractors.length === 0 ? (
          <div className="apple-card p-6 text-center text-lbl3 text-sm" style={{ fontStyle: 'italic' }}>No contractors yet</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {contractors.map(c => (
              <div key={c.id} onClick={() => setContractorDrawer(c)} className="apple-card p-4 cursor-pointer" style={{ transition: 'border-color 0.15s' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 2 }}>{c.name}</div>
                {c.company && <div style={{ fontSize: 12, color: '#0a84ff', marginBottom: 6 }}>{c.company}</div>}
                {c.trade && <span style={{ fontSize: 10, fontWeight: 600, color: '#636366', background: 'rgba(84,84,88,0.3)', borderRadius: 5, padding: '2px 7px', display: 'inline-block', marginBottom: 8 }}>{c.trade}</span>}
                <div style={{ fontSize: 11, color: '#8e8e93' }}>{c.email}</div>
                <div style={{ fontSize: 11, color: '#8e8e93' }}>{c.phone}</div>
                <div style={{ fontSize: 11, color: '#636366', marginTop: 6 }}>
                  {bids.filter(b => b.contractor_id === c.id).length} bid(s)
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review modal */}
      {reviewBid && (
        <ReviewModal
          extracted={reviewBid.extracted}
          onSave={saveReviewedBid}
          onCancel={() => setReviewBid(null)}
        />
      )}

      {/* Accept confirmation modal */}
      {acceptModal && (
        <AcceptModal
          modal={acceptModal}
          setModal={setAcceptModal}
          budgetItems={budgetItems}
          schedTasks={schedTasks}
          onConfirm={confirmAccept}
          onCancel={() => setAcceptModal(null)}
        />
      )}

      {/* Contractor drawer */}
      {contractorDrawer && (
        <ContractorDrawer
          contractor={contractorDrawer}
          bids={bids.filter(b => b.contractor_id === contractorDrawer.id)}
          onClose={() => setContractorDrawer(null)}
          onSave={async updated => {
            await supabase.from('contractors').update(updated).eq('id', contractorDrawer.id)
            const { data } = await supabase.from('contractors').select('*').order('name')
            if (data) setContractors(data)
            setContractorDrawer({ ...contractorDrawer, ...updated })
          }}
        />
      )}
    </div>
  )
}

// ── Bid card ──────────────────────────────────────────────────────────────────
function BidCard({ bid, expanded, onExpand, onAccept, onContractor }) {
  const st  = STATUS_COLORS[bid.status] || STATUS_COLORS.pending
  const contractor = bid.contractors
  const lineItems  = bid.line_items || []

  return (
    <div style={{ background: '#2c2c2e', borderRadius: 12, border: `1px solid ${bid.status === 'accepted' ? 'rgba(48,209,88,0.4)' : 'rgba(84,84,88,0.35)'}`, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 12 }}>{SOURCE_ICONS[bid.source] || '✏️'}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contractor ? (contractor.company || contractor.name) : 'Unknown contractor'}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: st.text, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 5, padding: '2px 7px', flexShrink: 0 }}>
            {st.label}
          </span>
        </div>
        {contractor?.name && contractor?.company && (
          <div style={{ fontSize: 11, color: '#8e8e93', marginBottom: 4 }}>{contractor.name}</div>
        )}
        <div style={{ fontSize: 22, fontWeight: 700, color: bid.status === 'accepted' ? '#30d158' : '#fff', marginBottom: 4 }}>
          {fmt(bid.total_amount)}
        </div>
        {bid.description && bid.description !== bid.trade && (
          <div style={{ fontSize: 11, color: '#636366', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bid.description}</div>
        )}
        <div style={{ fontSize: 10, color: '#48484a' }}>
          {bid.email_date ? new Date(bid.email_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : bid.created_at ? new Date(bid.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
        </div>
      </div>

      {expanded && lineItems.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(84,84,88,0.3)', padding: '8px 14px', maxHeight: 160, overflowY: 'auto' }}>
          {lineItems.map((li, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#ebebf5', padding: '3px 0', borderBottom: '1px solid rgba(84,84,88,0.15)' }}>
              <span style={{ flex: 1, paddingRight: 8, color: '#8e8e93' }}>{li.description}</span>
              <span style={{ fontWeight: 600, flexShrink: 0 }}>{fmt(li.amount)}</span>
            </div>
          ))}
          {bid.notes && <div style={{ fontSize: 11, color: '#636366', marginTop: 8, fontStyle: 'italic' }}>{bid.notes}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 1, borderTop: '1px solid rgba(84,84,88,0.3)' }}>
        {lineItems.length > 0 && (
          <button onClick={onExpand} style={{ flex: 1, padding: '8px 4px', fontSize: 11, color: '#8e8e93', background: 'transparent', textAlign: 'center' }}>
            {expanded ? 'Hide' : `${lineItems.length} items`}
          </button>
        )}
        {bid.pdf_url && (
          <a href={bid.pdf_url} target="_blank" rel="noreferrer" style={{ flex: 1, padding: '8px 4px', fontSize: 11, color: '#0a84ff', textAlign: 'center', display: 'block' }}>View PDF</a>
        )}
        {contractor && (
          <button onClick={onContractor} style={{ flex: 1, padding: '8px 4px', fontSize: 11, color: '#8e8e93', background: 'transparent', textAlign: 'center' }}>Contact</button>
        )}
        {bid.status === 'pending' && (
          <button onClick={onAccept} style={{ flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: 700, color: '#30d158', background: 'rgba(48,209,88,0.1)', textAlign: 'center' }}>
            Accept
          </button>
        )}
      </div>
    </div>
  )
}

// ── Review modal ──────────────────────────────────────────────────────────────
function ReviewModal({ extracted, onSave, onCancel }) {
  const [fields, setFields] = useState({
    contractorName: extracted.contractorName || '',
    company:        extracted.company        || '',
    email:          extracted.email          || '',
    phone:          extracted.phone          || '',
    trade:          extracted.trade          || '',
    totalAmount:    extracted.totalAmount    != null ? String(extracted.totalAmount) : '',
    lineItems:      extracted.lineItems      || [],
    description:    '',
    notes:          extracted.notes          || '',
  })
  const set = k => e => setFields(p => ({ ...p, [k]: e.target.value }))

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 700, background: '#1c1c1e', borderRadius: '16px 16px 0 0', padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.6)', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#636366' }}>Review Extracted Bid</span>
          <div style={{ flex: 1 }} />
          <button onClick={onCancel} className="btn-secondary text-xs px-2 py-1.5 mr-2">✕ Cancel</button>
          <button onClick={() => onSave(fields)} className="btn-primary text-xs px-3 py-1.5">Save Bid</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[['Contractor Name', 'contractorName'], ['Company', 'company'], ['Email', 'email'], ['Phone', 'phone']].map(([label, key]) => (
            <div key={key}>
              <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>{label}</label>
              <input value={fields[key]} onChange={set(key)} className="apple-input text-sm w-full" placeholder={label} />
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>Trade / Category</label>
            <input value={fields.trade} onChange={set('trade')} className="apple-input text-sm w-full" placeholder="e.g. Framing, Electrical…" />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>Total Amount</label>
            <input value={fields.totalAmount} onChange={set('totalAmount')} className="apple-input text-sm w-full" placeholder="$0" />
          </div>
        </div>

        {fields.lineItems.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#636366', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Line Items</div>
            <div style={{ background: '#2c2c2e', borderRadius: 10, overflow: 'hidden' }}>
              {fields.lineItems.map((li, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(84,84,88,0.2)', alignItems: 'center' }}>
                  <input value={li.description} onChange={e => { const l = [...fields.lineItems]; l[i] = { ...l[i], description: e.target.value }; setFields(p => ({ ...p, lineItems: l })) }} className="apple-input text-xs" style={{ flex: 1 }} placeholder="Description" />
                  <input value={li.amount != null ? String(li.amount) : ''} onChange={e => { const l = [...fields.lineItems]; l[i] = { ...l[i], amount: parseFloat(e.target.value) || 0 }; setFields(p => ({ ...p, lineItems: l })) }} className="apple-input text-xs" style={{ width: 90 }} placeholder="Amount" />
                  <button onClick={() => setFields(p => ({ ...p, lineItems: p.lineItems.filter((_, idx) => idx !== i) }))} style={{ color: '#ff453a', fontSize: 13 }}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea value={fields.notes} onChange={set('notes')} className="apple-input text-xs w-full" rows={3} placeholder="Payment terms, warranty, timeline…" style={{ resize: 'vertical' }} />
        </div>
      </div>
    </div>
  )
}

// ── Accept confirmation modal ─────────────────────────────────────────────────
function AcceptModal({ modal, setModal, budgetItems, schedTasks, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 600, background: '#1c1c1e', borderRadius: '16px 16px 0 0', padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#636366' }}>Accept Bid</span>
          <div style={{ flex: 1 }} />
          <button onClick={onCancel} className="btn-secondary text-xs px-2 py-1.5 mr-2">Cancel</button>
          <button onClick={() => onConfirm(modal)} className="btn-primary text-xs px-3 py-1.5">Confirm Accept</button>
        </div>

        <div style={{ marginBottom: 16, padding: '12px 14px', background: 'rgba(48,209,88,0.08)', borderRadius: 10, border: '1px solid rgba(48,209,88,0.25)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
            {modal.bid.contractors?.company || modal.bid.contractors?.name || 'Contractor'} — {fmt(modal.bid.total_amount)}
          </div>
          <div style={{ fontSize: 11, color: '#636366', marginTop: 2 }}>{modal.bid.trade}</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#636366', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Link to Budget Line Item</div>
          <select value={modal.selectedBudget || ''} onChange={e => setModal(p => ({ ...p, selectedBudget: e.target.value || null }))} className="apple-input text-sm w-full">
            <option value="">— Don't link —</option>
            {budgetItems.map(li => (
              <option key={li.id} value={li.id}>{li.name} (Est. {fmt(li.estimated_cost)})</option>
            ))}
          </select>
          {modal.selectedBudget && <div style={{ fontSize: 11, color: '#30d158', marginTop: 4 }}>✓ Will set actual cost to {fmt(modal.bid.total_amount)} and lock the row</div>}
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#636366', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Link to Schedule Tasks</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {schedTasks.filter(t => !t.parent_id ? true : true).slice(0, 30).map(t => {
              const checked = modal.selectedSched?.includes(t.id)
              return (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: checked ? '#0a84ff' : '#ebebf5', background: checked ? 'rgba(10,132,255,0.15)' : 'rgba(84,84,88,0.2)', borderRadius: 6, padding: '4px 8px' }}>
                  <input type="checkbox" checked={!!checked} onChange={e => setModal(p => ({ ...p, selectedSched: e.target.checked ? [...(p.selectedSched||[]), t.id] : (p.selectedSched||[]).filter(id => id !== t.id) }))} style={{ accentColor: '#0a84ff' }} />
                  {t.name}
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Contractor drawer ─────────────────────────────────────────────────────────
function ContractorDrawer({ contractor, bids, onClose, onSave }) {
  const [fields, setFields] = useState({ name: contractor.name || '', company: contractor.company || '', email: contractor.email || '', phone: contractor.phone || '', trade: contractor.trade || '', notes: contractor.notes || '' })
  const [editing, setEditing] = useState(false)
  const set = k => e => setFields(p => ({ ...p, [k]: e.target.value }))

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 600, background: '#1c1c1e', borderRadius: '16px 16px 0 0', padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.6)', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#636366' }}>Contractor</span>
          <div style={{ flex: 1 }} />
          {editing ? (
            <>
              <button onClick={() => { onSave(fields); setEditing(false) }} className="btn-primary text-xs px-3 py-1.5 mr-2">Save</button>
              <button onClick={() => setEditing(false)} className="btn-secondary text-xs px-2 py-1.5 mr-2">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-secondary text-xs px-2 py-1.5 mr-2">Edit</button>
          )}
          <button onClick={onClose} className="btn-secondary text-xs px-2 py-1.5">✕ Close</button>
        </div>

        {editing ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[['Name', 'name'], ['Company', 'company'], ['Email', 'email'], ['Phone', 'phone'], ['Trade', 'trade'], ['Notes', 'notes']].map(([label, key]) => (
              <div key={key}>
                <label style={{ fontSize: 11, color: '#636366', display: 'block', marginBottom: 4 }}>{label}</label>
                <input value={fields[key]} onChange={set(key)} className="apple-input text-sm w-full" placeholder={label} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{contractor.name}</div>
            {contractor.company && <div style={{ fontSize: 14, color: '#0a84ff', marginBottom: 8 }}>{contractor.company}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: '#8e8e93' }}>
              {contractor.email && <span>✉️ {contractor.email}</span>}
              {contractor.phone && <span>📞 {contractor.phone}</span>}
              {contractor.trade && <span>🔧 {contractor.trade}</span>}
            </div>
            {contractor.notes && <div style={{ fontSize: 12, color: '#636366', marginTop: 8, fontStyle: 'italic' }}>{contractor.notes}</div>}
          </div>
        )}

        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#636366', marginBottom: 10 }}>Bids ({bids.length})</div>
        {bids.length === 0 ? (
          <div style={{ fontSize: 12, color: '#636366', fontStyle: 'italic' }}>No bids on file</div>
        ) : (
          bids.map(bid => {
            const st = STATUS_COLORS[bid.status] || STATUS_COLORS.pending
            return (
              <div key={bid.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#2c2c2e', borderRadius: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{bid.trade || 'Uncategorized'}</div>
                  <div style={{ fontSize: 11, color: '#636366' }}>{bid.description || ''}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{fmt(bid.total_amount)}</div>
                <span style={{ fontSize: 10, fontWeight: 700, color: st.text, background: st.bg, borderRadius: 5, padding: '2px 7px' }}>{st.label}</span>
                {bid.pdf_url && <a href={bid.pdf_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0a84ff' }}>PDF</a>}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
