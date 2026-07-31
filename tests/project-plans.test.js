import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasProjectPlanAccess,
  hasProjectPlanShareAccess,
  privatePlanPath,
  projectPlanShareToken,
  safePlanPath,
} from '../server/projectPlans.js'

test('private plan paths never expose a public URL', () => {
  assert.equal(privatePlanPath('private:permit-package/architectural.pdf'), 'permit-package/architectural.pdf')
  assert.match(safePlanPath('Architectural Plans 02/16/26.pdf', 'uploads'), /^uploads\/\d+-Architectural-Plans-02-16-26\.pdf$/)
})

test('plan access code uses an exact server-side match', () => {
  const previous = process.env.PROJECT_ACCESS_CODE
  process.env.PROJECT_ACCESS_CODE = 'correct-horse-battery-staple'
  try {
    assert.equal(hasProjectPlanAccess({ headers: { 'x-project-access-code': 'correct-horse-battery-staple' } }), true)
    assert.equal(hasProjectPlanAccess({ headers: { 'x-project-access-code': 'incorrect' } }), false)
  } finally {
    if (previous == null) delete process.env.PROJECT_ACCESS_CODE
    else process.env.PROJECT_ACCESS_CODE = previous
  }
})

test('view-only share token is derived from the private access code', () => {
  const previous = process.env.PROJECT_ACCESS_CODE
  process.env.PROJECT_ACCESS_CODE = 'correct-horse-battery-staple'
  try {
    const token = projectPlanShareToken()
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(hasProjectPlanShareAccess(token), true)
    assert.equal(hasProjectPlanShareAccess(`${token.slice(0, -1)}x`), false)
  } finally {
    if (previous == null) delete process.env.PROJECT_ACCESS_CODE
    else process.env.PROJECT_ACCESS_CODE = previous
  }
})
