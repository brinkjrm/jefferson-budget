import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

// ── Markdown-lite renderer (bold, bullets, line breaks) ───────────────────
function renderMessage(text) {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    // Bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{part.slice(2, -2)}</strong>
      }
      return part
    })
    // Bullet point
    if (line.trimStart().startsWith('- ') || line.trimStart().startsWith('• ')) {
      return (
        <div key={i} className="flex gap-2 my-0.5">
          <span style={{ color: '#0a84ff', flexShrink: 0 }}>·</span>
          <span>{parts.slice(1)}</span>
        </div>
      )
    }
    return <div key={i} className={line === '' ? 'h-2' : 'my-0.5'}>{parts}</div>
  })
}

// ── Suggested prompts ─────────────────────────────────────────────────────
const SUGGESTIONS = [
  'What are my biggest pending bids?',
  'Flag any items that look over budget',
  'Summarize the budget for my bank',
  'What % of my budget is locked in?',
  'Draft a cover note for my next draw',
]

export default function ChatPanel() {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [ctx, setCtx]           = useState(null)
  const [ctxLoading, setCtxLoading] = useState(false)
  const bottomRef               = useRef(null)
  const inputRef                = useRef(null)

  // Load budget context when panel opens for the first time
  useEffect(() => {
    if (open && !ctx && !ctxLoading) loadContext()
  }, [open])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  async function loadContext() {
    setCtxLoading(true)
    const [{ data: lineItems }, { data: prepaidItems }, { data: drawSheets }, { data: settingsRows }] =
      await Promise.all([
        supabase.from('line_items').select('*').order('sort_order'),
        supabase.from('prepaid_items').select('*').order('created_at', { ascending: false }),
        supabase.from('draw_sheets').select('*').order('draw_number', { ascending: false }),
        supabase.from('settings').select('*'),
      ])
    const settings = {}
    settingsRows?.forEach(r => { settings[r.key] = r.value })
    setCtx({ lineItems: lineItems || [], prepaidItems: prepaidItems || [], drawSheets: drawSheets || [], settings })
    setCtxLoading(false)
  }

  async function send(text) {
    const userText = (text || input).trim()
    if (!userText || loading) return
    setInput('')

    const newMessages = [...messages, { role: 'user', content: userText }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          budgetContext: ctx,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMessages(prev => [...prev, { role: 'assistant', content: data.content }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Error: ${err.message}. Make sure ANTHROPIC_API_KEY is set in your Vercel environment variables.`
      }])
    }
    setLoading(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {/* ── Floating button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 no-print"
        style={{ background: open ? '#3a3a3c' : '#0a84ff' }}
        title="Ask Claude about your budget"
      >
        <span className="text-2xl">{open ? '✕' : '✦'}</span>
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex flex-col no-print"
          style={{
            width: 400,
            height: 560,
            background: '#1c1c1e',
            border: '1px solid rgba(84,84,88,0.5)',
            borderRadius: 20,
            boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(84,84,88,0.4)', background: '#2c2c2e' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: '#0a84ff' }}>
              <span className="text-white text-sm font-bold">✦</span>
            </div>
            <div>
              <div className="text-white font-semibold text-sm">Budget Assistant</div>
              <div className="text-xs" style={{ color: ctxLoading ? '#ff9f0a' : '#30d158' }}>
                {ctxLoading ? 'Loading budget data…' : ctx ? `${ctx.lineItems?.length || 0} line items loaded` : 'Not connected'}
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="ml-auto text-xs px-2 py-1 rounded-lg"
                style={{ background: '#3a3a3c', color: '#8e8e93' }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && !ctxLoading && (
              <div>
                <p className="text-sm mb-3" style={{ color: '#8e8e93' }}>
                  Ask me anything about the 3120 Jefferson budget — costs, bids, draws, or what to watch out for.
                </p>
                <div className="space-y-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="w-full text-left text-sm px-3 py-2 rounded-xl transition-colors"
                      style={{ background: '#2c2c2e', color: '#0a84ff', border: '1px solid rgba(10,132,255,0.25)' }}
                      onMouseOver={e => e.currentTarget.style.background = '#3a3a3c'}
                      onMouseOut={e => e.currentTarget.style.background = '#2c2c2e'}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-xs text-sm leading-relaxed px-3.5 py-2.5"
                  style={{
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    background: msg.role === 'user' ? '#0a84ff' : '#2c2c2e',
                    color: msg.role === 'user' ? '#ffffff' : '#ffffff',
                    maxWidth: '85%',
                  }}
                >
                  {msg.role === 'assistant' ? renderMessage(msg.content) : msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-2xl rounded-bl-sm"
                  style={{ background: '#2c2c2e' }}>
                  <div className="flex gap-1 items-center">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full"
                        style={{ background: '#8e8e93', animation: `bounce 1.2s ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0 px-3 py-3"
            style={{ borderTop: '1px solid rgba(84,84,88,0.4)', background: '#2c2c2e' }}>
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your budget…"
                rows={1}
                className="flex-1 resize-none text-sm px-3 py-2.5 rounded-xl"
                style={{
                  background: '#3a3a3c',
                  border: '1px solid rgba(84,84,88,0.5)',
                  color: '#ffffff',
                  maxHeight: 100,
                  outline: 'none',
                  lineHeight: 1.5,
                }}
                onInput={e => {
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
                }}
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity"
                style={{ background: input.trim() && !loading ? '#0a84ff' : '#3a3a3c' }}
              >
                <span className="text-white text-sm">↑</span>
              </button>
            </div>
            <p className="text-center mt-2 text-xs" style={{ color: '#3a3a3c' }}>
              Powered by Claude · reads live budget data
            </p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </>
  )
}
