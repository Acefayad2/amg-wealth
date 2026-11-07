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
    force: /\bforce\s*=\s*true/.test(block),
  }))
}

test('payment entry points remain forced LaunchPoint redirects', () => {
  const routes = redirectBlocks()
  for (const from of ['/pay', '/checkout', '/secure-payment']) {
    const route = routes.find(candidate => candidate.from === from)
    assert.deepEqual(
      { to: route?.to, status: route?.status, force: route?.force },
      { to: 'https://mylaunch.dev/invoice/amg', status: 302, force: true },
    )
  }
  assert.equal((config.match(/^\[functions\]$/gm) || []).length, 1)
  assert.match(config, /node_bundler\s*=\s*"esbuild"/)
})

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


test('AMG Matchups cards use the primary-domain portal', () => {
  const toolkit = resources.match(/<section class="resource-section" id="toolkit"[\s\S]*?<\/section>/)?.[0]
  assert.ok(toolkit)
  const card = toolkit.match(/<a class="compact-card" href="\/matchups\/"[\s\S]*?<\/a>/)?.[0]
  assert.ok(card)
  assert.match(resources, /<a class="quick-card matchups" href="\/matchups\/"/)
  assert.match(card, /<h3>AMG Matchups<\/h3>/)
  assert.match(card, /target="_blank"/)
  assert.match(card, /rel="noopener noreferrer"/)
  assert.equal((resources.match(/<h3>AMG Matchups<\/h3>/g) || []).length, 1)
})


test('Agent Portal entry points keep their direct redirects', () => {
  const routes = redirectBlocks()
  for (const from of ['/agent-portal', '/agent-portal.html']) {
    assert.deepEqual(routes.filter(route => route.from === from), [{
      from,
      to: 'https://agents.anointedmoneygroup.com/',
      status: 302,
      force: true,
    }])
  }
})

test('Matchup routes and root-relative assets proxy to the current portal', () => {
  const routes = redirectBlocks()
  const expected = [
    ['/matchups', '/'],
    ['/matchups/', '/'],
    ['/matchups/*', '/:splat'],
    ['/_next/*', '/_next/:splat'],
    ['/amg-logo.webp', '/amg-logo.webp'],
    ['/icon.svg', '/icon.svg'],
  ]
  for (const [from, suffix] of expected) {
    assert.deepEqual(routes.filter(route => route.from === from), [{
      from,
      to: `https://amg-matchup-portal.netlify.app${suffix}`,
      status: 200,
      force: true,
    }])
  }
  assert.equal(routes.some(route => route.from === '/*'), false)
})
