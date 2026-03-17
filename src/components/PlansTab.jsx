import React, { useState, useEffect, useRef } from 'react'
import { supabase, uploadPlan } from '../lib/supabase.js'

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PlansTab() {
  const [plans,       setPlans]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState(null)
  const [uploading,   setUploading]   = useState(false)
  const [dragging,    setDragging]    = useState(false)
  const [question,    setQuestion]    = useState('')
  const [answer,      setAnswer]      = useState(null)
  const [asking,      setAsking]      = useState(false)
  const [toast,       setToast]       = useState(null)
  const [renamingId,  setRenamingId]  = useState(null)
  const [renameVal,   setRenameVal]   = useState('')
  const fileRef = useRef()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('plans').select('*').order('created_at', { ascending: false })
    setPlans(data || [])
    setLoading(false)
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleFiles(files) {
    const pdf = Array.from(files).find(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    if (!pdf) { showToast('Please drop a PDF file', 'error'); return }
    setUploading(true)
    try {
      const { publicUrl } = await uploadPlan(pdf)
      const name = pdf.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ')
      const { data, error } = await supabase.from('plans').insert({
        name,
        file_url: publicUrl,
        file_size: pdf.size,
      }).select().single()
      if (error) throw error
      setPlans(prev => [data, ...prev])
      setSelected(data)
      setAnswer(null)
      showToast('Plan uploaded!')
    } catch (err) {
      showToast('Upload failed: ' + err.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  async function deletePlan(plan) {
    if (!confirm(`Delete "${plan.name}"?`)) return
    await supabase.from('plans').delete().eq('id', plan.id)
    setPlans(prev => prev.filter(p => p.id !== plan.id))
    if (selected?.id === plan.id) { setSelected(null); setAnswer(null) }
    showToast('Deleted')
  }

  async function saveName(plan) {
    const name = renameVal.trim()
    if (!name) return setRenamingId(null)
    await supabase.from('plans').update({ name }).eq('id', plan.id)
    setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, name } : p))
    if (selected?.id === plan.id) setSelected(p => ({ ...p, name }))
    setRenamingId(null)
  }

  async function askQuestion() {
    if (!selected || !question.trim()) return
    setAsking(true)
    setAnswer(null)
    try {
      const res = await fetch('/api/query-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pdfUrl: selected.file_url, question: question.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setAnswer(data.answer)
    } catch (err) {
      setAnswer('Error: ' + err.message)
    } finally {
      setAsking(false)
    }
  }

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading…</div>

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 200, padding: '10px 18px', borderRadius: 10, background: toast.type === 'error' ? '#ff453a' : '#30d158', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* ── Left panel: list ── */}
        <div style={{ width: 280, flexShrink: 0 }}>

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
            style={{
              border: `2px dashed ${dragging ? '#0a84ff' : 'rgba(84,84,88,0.5)'}`,
              borderRadius: 12,
              padding: '18px 12px',
              textAlign: 'center',
              cursor: 'pointer',
              marginBottom: 12,
              background: dragging ? 'rgba(10,132,255,0.06)' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            {uploading ? (
              <div style={{ color: '#0a84ff', fontSize: 13 }}>Uploading…</div>
            ) : (
              <>
                <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
                <div style={{ fontSize: 12, color: '#636366', fontWeight: 600 }}>Drop PDF or click to upload</div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = '' }} />

          {/* Plan list */}
          <div className="apple-card overflow-hidden">
            {plans.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: '#636366', fontStyle: 'italic', textAlign: 'center' }}>
                No plans uploaded yet
              </div>
            ) : plans.map(plan => (
              <div
                key={plan.id}
                onClick={() => { setSelected(plan); setAnswer(null); setQuestion('') }}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(84,84,88,0.2)',
                  background: selected?.id === plan.id ? 'rgba(10,132,255,0.12)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onMouseEnter={e => { if (selected?.id !== plan.id) e.currentTarget.style.background = 'rgba(84,84,88,0.1)' }}
                onMouseLeave={e => { if (selected?.id !== plan.id) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>📐</span>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {renamingId === plan.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={() => saveName(plan)}
                      onKeyDown={e => { if (e.key === 'Enter') saveName(plan); if (e.key === 'Escape') setRenamingId(null) }}
                      onClick={e => e.stopPropagation()}
                      className="apple-input text-xs w-full"
                    />
                  ) : (
                    <div
                      style={{ fontSize: 13, color: '#ebebf5', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onDoubleClick={e => { e.stopPropagation(); setRenamingId(plan.id); setRenameVal(plan.name) }}
                      title="Double-click to rename"
                    >
                      {plan.name}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: '#48484a', marginTop: 1 }}>
                    {fmtDate(plan.created_at)}{plan.file_size ? ` · ${fmtSize(plan.file_size)}` : ''}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deletePlan(plan) }}
                  style={{ fontSize: 12, color: '#636366', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', flexShrink: 0 }}
                  title="Delete plan"
                >🗑</button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right panel: viewer + Q&A ── */}
        <div style={{ flex: 1 }}>
          {!selected ? (
            <div className="apple-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, color: '#48484a' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📐</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Select a plan to view it</div>
              <div style={{ fontSize: 12, color: '#636366', marginTop: 4 }}>Upload PDFs on the left, then click to open</div>
            </div>
          ) : (
            <>
              {/* Plan name header */}
              <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>📐</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{selected.name}</span>
                <a href={selected.file_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: '#0a84ff', fontWeight: 600, marginLeft: 'auto' }}>
                  Open in new tab ↗
                </a>
              </div>

              {/* PDF iframe */}
              <div className="apple-card overflow-hidden" style={{ marginBottom: 12 }}>
                <iframe
                  src={selected.file_url}
                  title={selected.name}
                  style={{ width: '100%', height: '65vh', border: 'none', display: 'block' }}
                />
              </div>

              {/* Q&A */}
              <div className="apple-card p-4">
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#636366', marginBottom: 10 }}>
                  Ask about this plan
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) askQuestion() }}
                    className="apple-input text-sm"
                    style={{ flex: 1 }}
                    placeholder="e.g. What are the exterior wall dimensions?"
                  />
                  <button
                    onClick={askQuestion}
                    disabled={asking || !question.trim()}
                    className="btn-primary text-xs px-4"
                    style={{ opacity: asking || !question.trim() ? 0.5 : 1 }}
                  >
                    {asking ? '…' : 'Ask'}
                  </button>
                </div>
                {asking && (
                  <div style={{ fontSize: 12, color: '#636366', fontStyle: 'italic' }}>Reading plan…</div>
                )}
                {answer && !asking && (
                  <div style={{ background: 'rgba(10,132,255,0.07)', border: '1px solid rgba(10,132,255,0.2)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#ebebf5', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {answer}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
