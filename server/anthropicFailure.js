function providerMessage(payload) {
  try {
    const parsed = JSON.parse(payload)
    return parsed?.error?.message || parsed?.message || ''
  } catch {
    return String(payload || '')
  }
}

export function anthropicFailure(status, payload) {
  const message = providerMessage(payload)

  if (/credit balance is too low|purchase credits|plans\s*&\s*billing/i.test(message)) {
    return {
      status: 402,
      body: {
        code: 'AI_CREDITS_REQUIRED',
        error: 'Plan Q&A is temporarily unavailable because the Anthropic API account has no remaining credits. Add credits in Anthropic Console → Plans & Billing, then try again.',
      },
    }
  }

  if (status === 401 || status === 403) {
    return {
      status: 503,
      body: {
        code: 'AI_CONFIGURATION_ERROR',
        error: 'Plan Q&A cannot connect to the AI service. Check the Anthropic API key in the app settings.',
      },
    }
  }

  if (status === 429) {
    return {
      status: 429,
      body: {
        code: 'AI_RATE_LIMITED',
        error: 'The plan assistant is temporarily busy. Please wait a moment and try again.',
      },
    }
  }

  return {
    status: 502,
    body: {
      code: 'AI_PROVIDER_ERROR',
      error: 'The plan assistant could not answer right now. Please try again shortly.',
    },
  }
}
