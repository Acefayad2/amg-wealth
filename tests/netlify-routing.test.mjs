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

test('no learning page, asset or guide is reverse proxied around the portal gate', () => {
  const proxies = redirectBlocks().filter(route => route.status === 200)
  assert.deepEqual(proxies, [])
})

test('Life, Health, bundled question content and every guide alias redirect through the protected portal', () => {
  const routes = redirectBlocks()
  for (const path of ['/practice', '/practice/', '/practice/health', '/practice/health/', '/practice-assets/*', '/course/*', '/login/*', '/guides/accident-health.docx', '/guides/life-producer.docx', '/Accident & Health Study Guide.docx', '/Life Producer Study Guide.docx']) {
    assert.ok(routes.some(route => route.from === path && route.status === 302), path)
  }
  assert.ok(routes.some(route => route.from === '/course/*' && route.status === 302))
  assert.ok(routes.some(route => route.from === '/login/*' && route.status === 302))
  assert.ok(routes.some(route => route.from === '/practice/health/' && route.to.endsWith('/course/health/')))
  assert.match(resources, /href="\/practice\/health\/"/)
})
