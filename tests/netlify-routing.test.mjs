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

test('AMG Learning is served from this site, not proxied to the old exam portal', () => {
  const routes = redirectBlocks()
  assert.equal(routes.some(route => route.to?.includes('amg-exam-portal')), false)
  for (const prefix of ['/course', '/login', '/api', '/practice-assets', '/guides']) {
    assert.equal(routes.some(route => route.from?.startsWith(prefix)), false, prefix)
  }
  const health = routes.find(route => route.from === '/practice/health')
  assert.deepEqual({ to: health?.to, status: health?.status, force: health?.force }, { to: '/practice/index.html', status: 200, force: true })
  assert.equal(routes.some(route => route.from === '/practice/*'), false)
  assert.match(resources, /href="\/practice\/health\/"/)
})

test('AMG Learning pages, practice bundle and study guides ship with the site', () => {
  for (const file of ['course/index.html', 'course/assessments/index.html', 'course/lesson-01/index.html', 'course/lesson-60/index.html', 'login/index.html', 'practice/index.html', 'guides/accident-health.docx', 'guides/life-producer.docx']) {
    assert.ok(fs.existsSync(new URL('../' + file, import.meta.url)), file)
  }
  const practice = fs.readFileSync(new URL('../practice/index.html', import.meta.url), 'utf8')
  const bundles = [...practice.matchAll(/(?:src|href)="(\/practice-assets\/[^"]+)"/g)].map(match => match[1])
  assert.ok(bundles.length >= 2)
  for (const bundle of bundles) assert.ok(fs.existsSync(new URL('..' + bundle, import.meta.url)), bundle)
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

test('the bundled Matchup export is not shadowed by a proxy', () => {
  const routes = redirectBlocks()
  const protectedPaths = ['/matchups', '/matchups/', '/matchups/*', '/_next/*', '/amg-logo.webp', '/icon.svg']
  assert.equal(routes.some(route => protectedPaths.includes(route.from)), false)
  assert.equal(routes.some(route => route.from === '/*'), false)
  const matchup = fs.readFileSync(new URL('../matchups/index.html', import.meta.url), 'utf8')
  assert.match(matchup, /Find the right trainer/)
  assert.match(matchup, /href="\/matchups\/broker\/"/)
  assert.match(matchup, /href="\/matchups\/cft\/"/)
  for (const page of ["agent/index.html", "broker/index.html", "cft/index.html"]) {
    assert.ok(fs.existsSync(new URL(`../matchups/${page}`, import.meta.url)))
  }
  assert.match(matchup, /src="\/matchups\/amg-logo\.webp"/)
  for (const asset of [...matchup.matchAll(/(?:src|href)="(\/matchups\/_next\/[^"?]+)(?:[^\"]*)"/g)].map(match => match[1])) {
    assert.ok(fs.existsSync(new URL(`..${asset}`, import.meta.url)), `Missing exported asset: ${asset}`)
  }
})
