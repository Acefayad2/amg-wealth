import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const config = fs.readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8')
const resources = fs.readFileSync(new URL('../resources.html', import.meta.url), 'utf8')

function redirectBlocks() {
  return config.split('[[redirects]]').slice(1).map(block => ({
    from: block.match(/\bfrom\s*=\s*"([^"]+)"/)?.[1],
    to: block.match(/\bto\s*=\s*"([^"]+)"/)?.[1],
    status: Number(block.match(/\bstatus\s*=\s*(\d+)/)?.[1]),
  }))
}

test('only explicit public practice pages are reverse proxied', () => {
  const proxies = redirectBlocks().filter(route => route.status === 200)
  assert.deepEqual(
    proxies.filter(route => route.from === '/practice' || route.from?.startsWith('/practice/')).map(route => route.from),
    ['/practice', '/practice/', '/practice/health', '/practice/health/'],
  )
  assert.equal(proxies.some(route => route.from === '/practice/*'), false)
  assert.equal(proxies.some(route => route.from?.includes('course')), false)
  assert.equal(proxies.some(route => route.from?.includes('login')), false)
  assert.equal(proxies.some(route => route.from?.includes('api')), false)
})

test('protected Life uses redirects while public assets and guides are explicit', () => {
  const routes = redirectBlocks()
  assert.ok(routes.some(route => route.from === '/course/*' && route.status === 302))
  assert.ok(routes.some(route => route.from === '/login/*' && route.status === 302))
  assert.ok(routes.some(route => route.from === '/practice-assets/*' && route.status === 200))
  assert.ok(routes.some(route => route.from === '/guides/accident-health.docx' && route.status === 200))
  assert.ok(routes.some(route => route.from === '/guides/life-producer.docx' && route.status === 200))
  assert.match(resources, /href="\/practice\/health\/"/)
})
