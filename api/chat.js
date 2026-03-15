// Vercel serverless function — /api/chat
// Receives budget context from the frontend + conversation history,
// calls Claude, returns the response.
//
// Required env var: ANTHROPIC_API_KEY
// Optional env var: ANTHROPIC_MODEL (defaults to claude-sonnet-4-5-20250929)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages, budgetContext } = req.body
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel environment variables' })
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'
  const systemPrompt = buildSystemPrompt(budgetContext)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: err })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    res.json({ content: text })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── System prompt ─────────────────────────────────────────────────────────

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function buildSystemPrompt(ctx) {
  if (!ctx) {
    return `You are a construction budget assistant for Josh Meyer's home renovation at 3120 Jefferson St, Boulder CO 80304. Budget data is not yet loaded — ask the user to reload and try again.`
  }

  const { lineItems = [], prepaidItems = [], drawSheets = [], settings = {} } = ctx

  const totalEst   = lineItems.reduce((s, i) => s + (i.estimated_cost || 0), 0)
  const lockedAmt  = lineItems.filter(i => i.status === 'locked')
                              .reduce((s, i) => s + (i.actual_cost ?? i.estimated_cost ?? 0), 0)
  const pendingAmt = lineItems.filter(i => i.status !== 'locked')
                              .reduce((s, i) => s + (i.estimated_cost || 0), 0)
  const overages   = lineItems.filter(i => i.actual_cost != null && i.actual_cost > (i.estimated_cost || 0))
  const prepaidTot = prepaidItems.reduce((s, i) => s + (i.amount || 0), 0)
  const pct        = totalEst > 0 ? Math.round((lockedAmt / totalEst) * 100) : 0

  const softItems = lineItems.filter(i => i.section === 'soft')
  const hardItems = lineItems.filter(i => i.section === 'hard')

  function itemRow(i) {
    const actual = i.actual_cost != null ? `, Bid/Actual: ${fmt(i.actual_cost)}` : ''
    const over   = i.actual_cost != null && i.actual_cost > (i.estimated_cost || 0) ? ' ⚠️ OVER' : ''
    const vendor = i.vendor ? ` — ${i.vendor}` : ''
    const date   = i.date_paid ? ` (paid ${i.date_paid})` : ''
    return `  [${(i.code || '').padEnd(6)}] ${i.name}: Est ${fmt(i.estimated_cost)}${actual} [${i.status?.toUpperCase()}]${vendor}${date}${over}`
  }

  const drawList = drawSheets.slice(0, 5).map(d =>
    `  Draw #${d.draw_number} — ${d.draw_date} — ${fmt(d.this_draw_amount)} — ${d.status}`
  ).join('\n') || '  None on file'

  return `You are a sharp, practical construction budget assistant for Josh Meyer. Josh is the owner of a single-family home renovation at 3120 Jefferson St, Boulder CO 80304. You have live access to the full project budget right now.

PROJECT OVERVIEW:
  Owner: Josh Meyer
  Property: 3120 Jefferson St, Boulder CO 80304
  Builder/GC: ${settings.builder || 'Marc David Homes'}
  Bank: ${settings.bank_name || 'FirstBank'}
  Loan Amount: ${settings.loan_amount ? fmt(settings.loan_amount) : 'Not set'}

BUDGET SUMMARY:
  Total Estimated: ${fmt(totalEst)}
  Locked Bids: ${fmt(lockedAmt)} (${pct}% of budget committed)
  Pending Bids: ${fmt(pendingAmt)}
  Over-budget items: ${overages.length}${overages.length ? ` (${overages.map(o => o.name).join(', ')})` : ''}
  Prepaid to date: ${fmt(prepaidTot)}

SOFT COSTS (${softItems.length} items):
${softItems.map(itemRow).join('\n') || '  None'}

HARD COSTS (${hardItems.length} items):
${hardItems.map(itemRow).join('\n') || '  None'}

PREPAID ITEMS (${prepaidItems.length} items, total ${fmt(prepaidTot)}):
${prepaidItems.slice(0, 10).map(i => `  ${i.description} — ${fmt(i.amount)} — ${i.vendor || ''} — ${i.date_paid || ''} — ${i.payment_method || ''}`).join('\n') || '  None'}

DRAW SHEET HISTORY (${drawSheets.length} total):
${drawList}

GUIDELINES:
- Be direct and concise. Josh is a busy owner, not a developer.
- Flag anything that looks off (overages, gaps, unusually high/low bids for Boulder).
- When asked to draft text (bank letters, draw summaries, emails to subs), produce clean, ready-to-use copy.
- Format dollar amounts as currency. Use bullet points sparingly.
- If Josh asks about typical Boulder construction costs, use your knowledge to give honest ballparks.
- Never make up budget numbers — always reference the data above.`
}
