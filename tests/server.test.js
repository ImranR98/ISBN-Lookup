const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const isbnLookup = require('../isbn-lookup')
const app = require('../server')

const ISBN = '9780345409461'

async function startServer (t) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

async function freePort () {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

function writeTempIndex (t, html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isbn-lookup-index-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'index.html')
  fs.writeFileSync(file, html)
  return file
}

beforeEach((t) => {
  // Expected lookup errors would otherwise dominate the test output.
  t.mock.method(console, 'error', () => {})
})

test('serves the web UI', async (t) => {
  const base = await startServer(t)

  const response = await fetch(`${base}/`)

  assert.equal(response.status, 200)
  assert.match(await response.text(), /<title>ISBN Lookup<\/title>/)
})

test('serves the UI through the html extension fallback', async (t) => {
  const base = await startServer(t)

  const response = await fetch(`${base}/index`)

  assert.equal(response.status, 200)
  assert.match(await response.text(), /<title>ISBN Lookup<\/title>/)
})

test('returns lookup results for an ISBN', async (t) => {
  const base = await startServer(t)
  let receivedIsbn
  let receivedKey
  t.mock.method(isbnLookup, 'fetchBookTitle', async (isbn, key) => {
    receivedIsbn = isbn
    receivedKey = key
    return [{ isbn, title: 'The Way of Kings', authors: ['Brandon Sanderson'], source: 'Google Books' }]
  })

  const response = await fetch(`${base}/${ISBN}/title?ISBNDB_API_KEY=query-key`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, [{ isbn: ISBN, title: 'The Way of Kings', authors: ['Brandon Sanderson'], source: 'Google Books' }])
  assert.equal(receivedIsbn, ISBN)
  assert.equal(receivedKey, 'query-key')
})

test('falls back to the ISBNDB_API_KEY environment variable', async (t) => {
  const base = await startServer(t)
  process.env.ISBNDB_API_KEY = 'env-key'
  t.after(() => { delete process.env.ISBNDB_API_KEY })
  let receivedKey
  t.mock.method(isbnLookup, 'fetchBookTitle', async (isbn, key) => {
    receivedKey = key
    return []
  })

  const response = await fetch(`${base}/${ISBN}/title`)

  assert.equal(response.status, 204)
  assert.equal(receivedKey, 'env-key')
})

test('returns 204 when no titles are found', async (t) => {
  const base = await startServer(t)
  t.mock.method(isbnLookup, 'fetchBookTitle', async () => [])

  const response = await fetch(`${base}/${ISBN}/title`)

  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
})

test('returns 400 when the lookup throws', async (t) => {
  const base = await startServer(t)
  t.mock.method(isbnLookup, 'fetchBookTitle', async () => {
    throw new Error('upstream failure')
  })

  const response = await fetch(`${base}/${ISBN}/title`)

  assert.equal(response.status, 400)
})

test('redirects unknown paths to the web UI', async (t) => {
  const base = await startServer(t)

  const response = await fetch(`${base}/not-a-real-page`, { redirect: 'manual' })

  assert.equal(response.status, 404)
  assert.equal(response.headers.get('location'), '/')
})

test('prefers the query API key over the environment', async (t) => {
  const base = await startServer(t)
  process.env.ISBNDB_API_KEY = 'env-key'
  t.after(() => { delete process.env.ISBNDB_API_KEY })
  let receivedKey
  t.mock.method(isbnLookup, 'fetchBookTitle', async (isbn, key) => {
    receivedKey = key
    return []
  })

  const response = await fetch(`${base}/${ISBN}/title?ISBNDB_API_KEY=query-key`)

  assert.equal(response.status, 204)
  assert.equal(receivedKey, 'query-key')
})

test('logs the client IP from proxy headers', async (t) => {
  const base = await startServer(t)
  const lines = []
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')))
  t.mock.method(isbnLookup, 'fetchBookTitle', async () => [])

  await fetch(`${base}/${ISBN}/title`, { headers: { 'x-real-ip': '203.0.113.7' } })
  await fetch(`${base}/${ISBN}/title`, { headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' } })

  assert.ok(lines.some(line => line.includes("from IP '203.0.113.7'")))
  assert.ok(lines.some(line => line.includes("from IP '198.51.100.9, 10.0.0.1'")))
})

test('injects a valid analytics script into the placeholder', (t) => {
  const file = writeTempIndex(t, '<head><!-- ANALYTICS_SCRIPT_PLACEHOLDER --></head>')
  const script = '<script defer data-domain="example.com" src="https://analytics.example.com/js/script.js"></script>'

  assert.equal(app.applyAnalyticsScript(script, file), true)

  const html = fs.readFileSync(file, 'utf8')
  assert.ok(html.includes(script))
  assert.equal(html.includes('ANALYTICS_SCRIPT_PLACEHOLDER'), false)
})

test('ignores an analytics value that is not a script element', (t) => {
  const original = '<head><!-- ANALYTICS_SCRIPT_PLACEHOLDER --></head>'
  const file = writeTempIndex(t, original)

  assert.equal(app.applyAnalyticsScript('<script>alert(1)</script>', file), false)
  assert.equal(fs.readFileSync(file, 'utf8'), original)
})

test('does not rewrite the index when the placeholder is absent', (t) => {
  const original = '<head><title>ISBN Lookup</title></head>'
  const file = writeTempIndex(t, original)

  assert.equal(app.applyAnalyticsScript('<script defer src="https://example.com/a.js"></script>', file), false)
  assert.equal(fs.readFileSync(file, 'utf8'), original)
})

test('starts the HTTP server when executed directly', async (t) => {
  const port = await freePort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  t.after(() => new Promise(resolve => {
    if (child.exitCode !== null) return resolve()
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
    child.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })
    child.kill('SIGTERM')
  }))

  const deadline = Date.now() + 10000
  let body = ''
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) {
        body = await response.text()
        break
      }
    } catch {
      // The listener may not be ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  assert.match(body, /<title>ISBN Lookup<\/title>/, `server output: ${output}`)
})
