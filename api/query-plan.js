// Vercel serverless function — /api/query-plan
// Fetches a plan PDF from storage and answers a question about it using Claude.
//
// Required env var: ANTHROPIC_API_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { pdfUrl, question } = req.body
  if (!pdfUrl || !question) return res.status(400).json({ error: 'pdfUrl and question required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'

  // Fetch the PDF and convert to base64
  let pdfBase64
  try {
    const pdfRes = await fetch(pdfUrl)
    if (!pdfRes.ok) return res.status(400).json({ error: 'Failed to fetch PDF from storage' })
    const buffer = await pdfRes.arrayBuffer()
    pdfBase64 = Buffer.from(buffer).toString('base64')
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching PDF: ' + err.message })
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
        max_tokens: 1024,
        system: `You are a construction document assistant for a residential new-build project at 3120 Jefferson St, Boulder CO.
Answer questions about architectural and structural plans concisely and accurately.
Reference specific dimensions, materials, callouts, or notes you can see in the document.
If the answer isn't visible in the plan, say so clearly.`,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            { type: 'text', text: question },
          ],
        }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: err })
    }

    const data = await response.json()
    const answer = data.content?.[0]?.text || 'No response from AI.'
    res.json({ answer })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
