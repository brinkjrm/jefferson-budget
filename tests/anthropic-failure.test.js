import test from 'node:test'
import assert from 'node:assert/strict'
import { anthropicFailure } from '../server/anthropicFailure.js'

test('Anthropic credit errors become a useful plan Q&A message', () => {
  const result = anthropicFailure(400, JSON.stringify({
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    },
  }))

  assert.equal(result.status, 402)
  assert.equal(result.body.code, 'AI_CREDITS_REQUIRED')
  assert.match(result.body.error, /no remaining credits/i)
  assert.doesNotMatch(result.body.error, /\{"type"/)
})

test('Anthropic authentication and rate limits do not expose raw provider responses', () => {
  assert.equal(anthropicFailure(401, 'invalid x-api-key').body.code, 'AI_CONFIGURATION_ERROR')
  assert.equal(anthropicFailure(429, '{"error":{"message":"rate limit"}}').body.code, 'AI_RATE_LIMITED')
  assert.equal(anthropicFailure(500, '<html>failure</html>').body.code, 'AI_PROVIDER_ERROR')
})
