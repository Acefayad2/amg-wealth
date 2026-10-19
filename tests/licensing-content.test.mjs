import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const licensing = fs.readFileSync(new URL('../licensing.html', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('licensing presents the approved three-step sequence in order', () => {
  const book = licensing.indexOf('Book your exam')
  const study = licensing.indexOf('Study for your exam')
  const pass = licensing.indexOf('Pass your exam')
  assert.ok(book > 0 && book < study && study < pass)
  assert.match(licensing, /tel:\+12222532959/)
  assert.match(licensing, /Natasha Talley/)
  assert.match(licensing, /assets\/natasha-talley\.png/)
  assert.match(licensing, />Life Producer</)
  assert.match(licensing, />Health &amp; Sickness</)
  assert.match(licensing, /href="\/course\/"/)
  assert.match(licensing, /href="\/course\/health\/"/)
  assert.doesNotMatch(licensing, /calendly|calendar|iframe/i)
})

test('contrast changes are scoped to dark and explicit light surfaces', () => {
  assert.match(home, /class="leadership-light" id="philosophy"/)
  assert.match(home, /class="reveal leadership-copy"/)
  assert.match(home, /leadership-light \.leadership-copy\{color:#294b41/)
  assert.match(home, /hero p\.lede\{[^}]*rgba\(255,255,255,\.9\)/)
  assert.match(home, /a:focus-visible,button:focus-visible/)
  assert.doesNotMatch(home, /\bp\s*\{[^}]*color:\s*(?:#fff|white)/)
})
