import test from 'node:test'
import assert from 'node:assert/strict'
import { messageTargetsAddress } from '../server/projectEmail.js'

test('project inbox accepts mail addressed to the custom-domain address', () => {
  assert.equal(messageTargetsAddress({
    to: { text: 'Jefferson Project <Josh@3120JeffersonSt.com>' },
    headers: new Map(),
  }, 'Josh@3120jeffersonst.com'), true)
})

test('project inbox rejects unrelated mail in the shared iCloud inbox', () => {
  assert.equal(messageTargetsAddress({
    to: { text: 'Personal Account <owner@icloud.com>' },
    headers: new Map(),
  }, 'Josh@3120jeffersonst.com'), false)
})

test('project inbox recognizes the original recipient delivery header', () => {
  assert.equal(messageTargetsAddress({
    headers: new Map([['delivered-to', 'Josh@3120JeffersonSt.com']]),
  }, 'Josh@3120jeffersonst.com'), true)
})
