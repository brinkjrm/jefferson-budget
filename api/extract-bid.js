// Vercel serverless function — /api/extract-bid
// Accepts a PDF (base64) or plain email text and extracts structured bid data using Claude.
//
// Required env var: ANTHROPIC_API_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { pdf, emailBody, emailFrom, emailSubject } = req.body
  if (!pdf && !emailBody) return res.status(400).json({ error: 'pdf or emailBody required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'

  const systemPrompt = `You are a construction bid extraction assistant. Extract structured data from contractor bids/quotes/proposals.
Always respond with valid JSON only — no markdown, no explanation, just the JSON object.

Return this exact shape:
{
  "contractorName": "Full name of the person",
  "company": "Company or business name",
  "email": "email address if present",
  "phone": "phone number if present",
  "trade": "One of: General Contractor, Framing, Roofing, Electrical, Plumbing, HVAC, Insulation, Drywall, Flooring, Painting, Tile, Cabinets, Concrete, Excavation, Landscaping, Demolition, Windows & Doors, Siding, Gutters, Other",
  "totalAmount": 12345.00,
  "lineItems": [
    { "description": "Labor and materials for X", "amount": 5000 }
  ],
  "notes": "Any relevant notes, warranty info, timeline, payment terms, etc."
}

If a field cannot be determined, use null. For totalAmount, use the final grand total as a number (no $ sign). Extract all line items you can find.`

  let userContent
  if (pdf) {
    userContent = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdf },
      },
      { type: 'text', text: 'Extract the bid information from this PDF.' },
    ]
  } else {
    const context = emailSubject ? `Subject: ${emailSubject}\nFrom: ${emailFrom || 'unknown'}\n\n` : ''
    userContent = `${context}${emailBody}\n\nExtract the bid information from this email.`
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: err })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || '{}'

    // Parse and validate JSON from Claude
    let extracted
    try {
      extracted = JSON.parse(text)
    } catch {
      // Try to extract JSON from response if it contains extra text
      const match = text.match(/\{[\s\S]*\}/)
      extracted = match ? JSON.parse(match[0]) : {}
    }

    res.json({ bid: extracted })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
