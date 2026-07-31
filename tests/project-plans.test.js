import test from 'node:test'
import assert from 'node:assert/strict'
import { hasProjectPlanAccess, privatePlanPath, safePlanPath } from '../server/projectPlans.js'

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
