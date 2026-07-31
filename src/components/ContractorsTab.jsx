import React, { useMemo, useState } from 'react'
import { useProject, useProjectCollection } from '../context/ProjectContext.jsx'
import { PROJECT_ACCESS_STORAGE_KEY } from './OwnerAccessGate.jsx'

const EMPTY_CONTACT = { name: '', company: '', trade: '', phone: '', email: '', notes: '' }
const TRADES = [
  'General Contractor', 'Demolition', 'Excavation', 'Concrete', 'Framing', 'Roofing',
  'Windows & Doors', 'Siding', 'Gutters', 'Electrical', 'Plumbing', 'HVAC',
  'Insulation', 'Drywall', 'Flooring', 'Painting', 'Tile', 'Cabinets', 'Landscaping', 'Other',
]

export default function ContractorsTab() {
  const { createEntity, updateEntity, refresh } = useProject()
  const [contractors, , contractorsLoading] = useProjectCollection('contractors')
  const [bids, , bidsLoading] = useProjectCollection('bids')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState(null)
  const loading = contractorsLoading || bidsLoading

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return [...contractors]
      .sort((a, b) => String(a.trade || 'zzzz').localeCompare(String(b.trade || 'zzzz')) || String(a.name || '').localeCompare(String(b.name || '')))
      .filter(contact => !term || [contact.name, contact.company, contact.trade, contact.phone, contact.email].join(' ').toLowerCase().includes(term))
  }, [contractors, search])

  const bidSummary = useMemo(() => {
    const grouped = new Map()
    bids.forEach(bid => {
      const current = grouped.get(bid.contractor_id) || { count: 0, total: 0, pending: 0 }
      current.count += 1
      current.total += Number(bid.total_amount || 0)
      if (bid.status === 'pending') current.pending += 1
      grouped.set(bid.contractor_id, current)
    })
    return grouped
  }, [bids])

  async function syncInbox() {
    setSyncing(true)
    setNotice(null)
    try {
      const response = await fetch('/api/sync-project-inbox', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-project-access-code': sessionStorage.getItem(PROJECT_ACCESS_STORAGE_KEY) || '',
        },
        body: JSON.stringify({ lookbackDays: 30 }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The inbox could not be checked')
      await refresh(['contractors', 'bids'])
      setNotice({
        type: 'success',
        text: `Inbox checked: ${result.imported} new email${result.imported === 1 ? '' : 's'}, ${result.contractorsSaved || 0} contractor${result.contractorsSaved === 1 ? '' : 's'}, and ${result.bidsSaved || 0} bid${result.bidsSaved === 1 ? '' : 's'} saved.`,
      })
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setSyncing(false)
    }
  }

  async function saveContact(fields) {
    const values = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value || '').trim() || null]))
    if (!values.name && !values.company) throw new Error('Enter a contractor name or company')
    if (selected?.id) {
      await updateEntity('contractors', selected.id, values, {
        type: 'contractor.updated',
        entityType: 'contractor',
        entityId: selected.id,
        summary: `Updated contractor ${values.company || values.name}`,
      })
    } else {
      await createEntity('contractors', { ...values, name: values.name || values.company }, {
        type: 'contractor.created',
        entityType: 'contractor',
        summary: `Added contractor ${values.company || values.name}`,
      })
    }
    setSelected(null)
    setNotice({ type: 'success', text: 'Contractor saved' })
  }

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading contractors…</div>

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-white font-bold text-xl">Contractors</h2>
          <p className="text-lbl2 text-sm mt-1">Private owner directory populated from bids, project email, and your edits.</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={syncInbox} disabled={syncing} className="btn-secondary text-xs px-3 py-2">
            {syncing ? 'Checking inbox…' : 'Check project inbox'}
          </button>
          <button type="button" onClick={() => setSelected(EMPTY_CONTACT)} className="text-acc text-sm font-semibold">+ Add contractor</button>
        </div>
      </div>

      {notice && (
        <div className="mb-4 px-4 py-3 text-sm rounded-lg" style={{
          color: notice.type === 'error' ? '#ff6961' : '#30d158',
          background: notice.type === 'error' ? 'rgba(255,69,58,0.1)' : 'rgba(48,209,88,0.1)',
        }}>{notice.text}</div>
      )}

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <label className="block" style={{ flex: '1 1 280px' }}>
          <span className="text-lbl3 uppercase tracking-wider font-semibold block mb-1.5" style={{ fontSize: 10 }}>Search directory</span>
          <input value={search} onChange={event => setSearch(event.target.value)} className="apple-input w-full text-sm" placeholder="Name, company, trade, phone, or email" />
        </label>
        <div className="text-lbl3 text-xs pb-2">{filtered.length} of {contractors.length} contacts</div>
      </div>

      <div className="apple-card overflow-hidden">
        <div className="hidden md:grid px-4 py-2 text-lbl3 uppercase tracking-wider font-semibold" style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1.25fr 90px', gap: 16, fontSize: 10, background: '#252527' }}>
          <span>Name</span><span>Trade</span><span>Phone</span><span>Email</span><span>Bids</span>
        </div>
        {filtered.length ? filtered.map(contact => {
          const summary = bidSummary.get(contact.id) || { count: 0, pending: 0 }
          return (
            <div key={contact.id} className="data-row px-4 py-3 cursor-pointer" onClick={() => setSelected(contact)} style={{ borderTop: '1px solid rgba(84,84,88,0.24)' }}>
              <div className="grid md:items-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="text-white text-sm font-semibold truncate">{contact.name || contact.company}</div>
                  {contact.company && contact.company !== contact.name && <div className="text-acc text-xs truncate mt-0.5">{contact.company}</div>}
                </div>
                <div className="text-lbl2 text-sm">{contact.trade || 'Trade not set'}</div>
                <div>
                  {contact.phone ? <a href={`tel:${contact.phone}`} onClick={event => event.stopPropagation()} className="text-lbl2 text-sm hover:text-white">{contact.phone}</a> : <span className="text-lbl3 text-sm">No phone</span>}
                </div>
                <div style={{ minWidth: 0 }}>
                  {contact.email ? <a href={`mailto:${contact.email}`} onClick={event => event.stopPropagation()} className="text-acc text-sm truncate block">{contact.email}</a> : <span className="text-lbl3 text-sm">No email</span>}
                </div>
                <div className="text-lbl3 text-xs">
                  {summary.count} bid{summary.count === 1 ? '' : 's'}{summary.pending ? ` · ${summary.pending} pending` : ''}
                </div>
              </div>
            </div>
          )
        }) : <div className="text-center text-lbl3 text-sm py-12">{search ? 'No matching contractors' : 'No contractors yet'}</div>}
      </div>

      {selected && (
        <ContractorEditor
          contractor={selected}
          bidSummary={bidSummary.get(selected.id)}
          onSave={saveContact}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function ContractorEditor({ contractor, bidSummary, onSave, onClose }) {
  const [fields, setFields] = useState({ ...EMPTY_CONTACT, ...contractor })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = key => event => setFields(previous => ({ ...previous, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(fields)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Contractor details" className="fixed inset-0 z-[100] flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.72)' }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form onSubmit={submit} className="w-full max-w-2xl p-5" style={{ background: '#1c1c1e', borderRadius: '16px 16px 0 0', maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="flex items-start gap-4 mb-5">
          <div>
            <div className="text-lbl3 uppercase tracking-wider font-semibold" style={{ fontSize: 10 }}>{contractor.id ? 'Edit contractor' : 'New contractor'}</div>
            <h3 className="text-white font-semibold text-lg mt-1">{fields.company || fields.name || 'Contractor details'}</h3>
            {bidSummary && <p className="text-lbl3 text-xs mt-1">{bidSummary.count} bid{bidSummary.count === 1 ? '' : 's'} on file</p>}
          </div>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="text-lbl2 text-xl px-2" aria-label="Close contractor editor">×</button>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Contact name"><input value={fields.name || ''} onChange={set('name')} className="apple-input w-full text-sm" /></Field>
          <Field label="Company"><input value={fields.company || ''} onChange={set('company')} className="apple-input w-full text-sm" /></Field>
          <Field label="Trade"><input value={fields.trade || ''} onChange={set('trade')} list="contractor-trades" className="apple-input w-full text-sm" /><datalist id="contractor-trades">{TRADES.map(trade => <option key={trade} value={trade} />)}</datalist></Field>
          <Field label="Phone"><input type="tel" value={fields.phone || ''} onChange={set('phone')} className="apple-input w-full text-sm" autoComplete="tel" /></Field>
          <Field label="Email"><input type="email" value={fields.email || ''} onChange={set('email')} className="apple-input w-full text-sm" autoComplete="email" /></Field>
          <Field label="Notes"><input value={fields.notes || ''} onChange={set('notes')} className="apple-input w-full text-sm" /></Field>
        </div>
        {error && <p className="text-xs mt-4" style={{ color: '#ff6961' }}>{error}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="text-lbl2 text-sm px-3 py-2">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-2">{saving ? 'Saving…' : 'Save contractor'}</button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="block"><span className="text-lbl3 text-xs block mb-1.5">{label}</span>{children}</label>
}
