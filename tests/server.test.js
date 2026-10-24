const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

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

beforeEach((t) => {
  // Request logging would otherwise dominate the test output.
  t.mock.method(console, 'log', () => {})
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
