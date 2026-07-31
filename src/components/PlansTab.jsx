import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { PROJECT_ACCESS_STORAGE_KEY } from './OwnerAccessGate.jsx'

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
  const [plans,      setPlans]       = useState([])
  const [shareUrl,   setShareUrl]    = useState('')
  const [loading,    setLoading]     = useState(true)
  const [accessCode, setAccessCode]  = useState(() => sessionStorage.getItem(PROJECT_ACCESS_STORAGE_KEY) || sessionStorage.getItem('jefferson-plan-access') || '')
  const [codeInput,  setCodeInput]   = useState(() => sessionStorage.getItem(PROJECT_ACCESS_STORAGE_KEY) || sessionStorage.getItem('jefferson-plan-access') || '')
  const [unlocked,   setUnlocked]    = useState(false)
  const [unlockError, setUnlockError] = useState('')
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

  useEffect(() => {
    if (accessCode) unlock(accessCode)
    else setLoading(false)
  }, [])

  async function planRequest(path = '', options = {}, code = accessCode) {
    const response = await fetch(`/api/project-plans${path}`, {
      ...options,
      headers: {
        'x-project-access-code': code,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Plan request failed')
    return data
  }

  async function unlock(code = codeInput) {
    const clean = code.trim()
    if (!clean) return
    setLoading(true)
    setUnlockError('')
    try {
      const data = await planRequest('', {}, clean)
      sessionStorage.setItem(PROJECT_ACCESS_STORAGE_KEY, clean)
      sessionStorage.setItem('jefferson-plan-access', clean)
      setAccessCode(clean)
      setCodeInput(clean)
      setPlans(data.plans || [])
      setShareUrl(data.share_url || '')
      setUnlocked(true)
    } catch (error) {
      sessionStorage.removeItem(PROJECT_ACCESS_STORAGE_KEY)
      sessionStorage.removeItem('jefferson-plan-access')
      setUnlockError(error.message)
      setUnlocked(false)
    } finally {
      setLoading(false)
    }
  }

  async function selectPlan(plan) {
    setSelected({ ...plan, file_url: '' })
    setAnswer(null)
    setQuestion('')
    try {
      const data = await planRequest(`?id=${encodeURIComponent(plan.id)}`)
      setSelected(current => current?.id === plan.id ? { ...current, file_url: data.url } : current)
    } catch (error) {
      showToast(`Plan could not be opened: ${error.message}`, 'error')
    }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function copyShareLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      showToast('View-only share link copied')
    } catch {
      showToast('Could not copy the link. Please try again.', 'error')
    }
  }

  async function handleFiles(files) {
    const pdf = Array.from(files).find(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    if (!pdf) { showToast('Please drop a PDF file', 'error'); return }
    setUploading(true)
    try {
      const prepared = await planRequest('', {
        method: 'POST',
        body: JSON.stringify({ action: 'prepareUpload', filename: pdf.name, size: pdf.size }),
      })
      const uploaded = await supabase.storage.from('plan-pdfs').uploadToSignedUrl(
        prepared.path,
        prepared.token,
        pdf,
        { contentType: 'application/pdf' },
      )
      if (uploaded.error) throw uploaded.error
      const name = pdf.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ')
      const result = await planRequest('', {
        method: 'POST',
        body: JSON.stringify({
          action: 'finalizeUpload',
          path: prepared.path,
          name,
          size: pdf.size,
        }),
      })
      const data = result.plan
      setPlans(previous => [data, ...previous.filter(plan => plan.id !== data.id)])
      const signed = await planRequest(`?id=${encodeURIComponent(data.id)}`)
      data.file_url = signed.url
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
    await planRequest('', { method: 'DELETE', body: JSON.stringify({ id: plan.id }) })
    setPlans(previous => previous.filter(item => item.id !== plan.id))
    if (selected?.id === plan.id) { setSelected(null); setAnswer(null) }
    showToast('Deleted')
  }

  async function saveName(plan) {
    const name = renameVal.trim()
    if (!name) return setRenamingId(null)
    await planRequest('', { method: 'PATCH', body: JSON.stringify({ id: plan.id, name }) })
    setPlans(previous => previous.map(item => item.id === plan.id ? { ...item, name } : item))
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
        headers: {
          'content-type': 'application/json',
          'x-project-access-code': accessCode,
        },
        body: JSON.stringify({ pdfUrl: selected.file_url, question: question.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setAnswer(data.answer)
    } catch (err) {
      setAnswer(err.message)
    } finally {
      setAsking(false)
    }
  }

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Opening secure plan library…</div>

  if (!unlocked) return (
    <div className="max-w-md mx-auto py-14">
      <div className="apple-card p-7">
        <div className="text-3xl mb-4">🔒</div>
        <h2 className="text-white font-bold text-xl">Private plan library</h2>
        <p className="text-lbl2 text-sm mt-2 mb-5">Enter the project access code to view architectural, structural, and permit documents.</p>
        <form onSubmit={event => { event.preventDefault(); unlock() }}>
          <input type="password" value={codeInput} onChange={event => setCodeInput(event.target.value)}
            className="apple-input w-full" placeholder="Project access code" autoComplete="current-password" autoFocus />
          {unlockError && <p className="text-xs mt-2" style={{ color: '#ff453a' }}>{unlockError}</p>}
          <button type="submit" className="btn-primary w-full py-2.5 mt-4 text-sm">Unlock plans</button>
        </form>
      </div>
    </div>
  )

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 200, padding: '10px 18px', borderRadius: 10, background: toast.type === 'error' ? '#ff453a' : '#30d158', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-white font-bold text-xl">Project plans</h2>
          <p className="text-lbl2 text-sm mt-1">Anyone with the shared link can view the schedule, selections, and plans, but cannot make changes or see owner-only areas.</p>
        </div>
        <button
          type="button"
          className="btn-primary px-4 py-2.5 text-sm whitespace-nowrap"
          onClick={copyShareLink}
          disabled={!shareUrl}
        >
          Copy subcontractor link
        </button>
      </div>

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
                onClick={() => selectPlan(plan)}
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
                {selected.file_url && <a href={selected.file_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: '#0a84ff', fontWeight: 600, marginLeft: 'auto' }}>
                  Open in new tab ↗
                </a>}
              </div>

              {/* PDF iframe */}
              <div className="apple-card overflow-hidden" style={{ marginBottom: 12 }}>
                {selected.file_url ? <iframe
                  src={selected.file_url}
                  title={selected.name}
                  style={{ width: '100%', height: '65vh', border: 'none', display: 'block' }}
                /> : <div className="text-center py-24 text-lbl3 text-sm">Creating secure preview…</div>}
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
                    disabled={asking || !question.trim() || !selected.file_url}
                    className="btn-primary text-xs px-4"
                    style={{ opacity: asking || !question.trim() || !selected.file_url ? 0.5 : 1 }}
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
