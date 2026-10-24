const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const axios = require('axios')

const isbnLookup = require('../isbn-lookup')

const ISBN = '9780441013593'

// Route axios.get calls by URL fragment. Handlers return response `data` or
// throw to simulate a provider failure. No live network is used.
function mockAxios (t, handlers) {
  const calls = []
  t.mock.method(axios, 'get', async (url, config = {}) => {
    calls.push({ url, config })
    for (const [fragment, handler] of handlers) {
      if (url.includes(fragment)) {
        return { data: handler(url, config) }
      }
    }
    throw new Error(`Unexpected axios.get call: ${url}`)
  })
  return calls
}

const isbndb = (title) => () => ({ book: { title, authors: ['Frank Herbert'] } })
const google = (volumeInfo) => () => ({ items: [{ volumeInfo }] })
const openLibrary = (fields) => () => ({ [`ISBN:${ISBN}`]: fields })

beforeEach((t) => {
  // Expected provider failures are part of several tests; keep the output clean.
  t.mock.method(console, 'error', () => {})
  t.mock.method(console, 'log', () => {})
})

test('combines all providers and sorts results by descending title length', async (t) => {
  const calls = mockAxios(t, [
    ['api2.isbndb.com', isbndb('Dune Messiah')],
    ['googleapis.com', google({ title: 'Dune', subtitle: 'Deluxe Edition', authors: ['Frank Herbert'] })],
    ['openlibrary.org', openLibrary({ title: 'Dune', authors: [{ name: 'Frank Herbert' }] })]
  ])

  const results = await isbnLookup.fetchBookTitle(ISBN, 'secret-key')

  assert.deepEqual(results.map(r => r.source), ['Google Books', 'ISBNdb', 'Open Library'])
  assert.deepEqual(results.map(r => r.title), ['Dune: Deluxe Edition', 'Dune Messiah', 'Dune'])
  assert.ok(results.every(r => r.isbn === ISBN))

  const isbndbCall = calls.find(call => call.url.includes('api2.isbndb.com'))
  assert.equal(isbndbCall.url, `https://api2.isbndb.com/book/${ISBN}`)
  assert.deepEqual(isbndbCall.config, { headers: { Authorization: 'secret-key' } })
})

test('skips ISBNdb when no API key is supplied', async (t) => {
  const calls = mockAxios(t, [
    ['googleapis.com', google({ title: 'Dune', authors: ['Frank Herbert'] })],
    ['openlibrary.org', openLibrary({ title: 'Dune', authors: [{ name: 'Frank Herbert' }] })]
  ])

  const results = await isbnLookup.fetchBookTitle(ISBN)

  assert.deepEqual(results.map(r => r.source), ['Google Books', 'Open Library'])
  assert.equal(calls.some(call => call.url.includes('isbndb')), false)
})

test('omits an empty Google Books subtitle', async (t) => {
  mockAxios(t, [
    ['googleapis.com', google({ title: 'Dune', subtitle: '', authors: ['Frank Herbert'] })]
  ])

  const results = await isbnLookup.fetchBookTitle(ISBN)

  assert.equal(results.length, 1)
  assert.equal(results[0].title, 'Dune')
  assert.deepEqual(results[0].authors, ['Frank Herbert'])
})

test('maps Open Library author objects to names', async (t) => {
  mockAxios(t, [
    ['openlibrary.org', openLibrary({
      title: 'Dune',
      subtitle: 'Chronicles',
      authors: [{ name: 'Frank Herbert' }, { name: 'Brian Herbert' }]
    })]
  ])

  const results = await isbnLookup.fetchBookTitle(ISBN)

  assert.equal(results.length, 1)
  assert.equal(results[0].title, 'Dune: Chronicles')
  assert.deepEqual(results[0].authors, ['Frank Herbert', 'Brian Herbert'])
  assert.equal(results[0].source, 'Open Library')
})

test('continues when the ISBNdb provider fails', async (t) => {
  mockAxios(t, [
    ['api2.isbndb.com', () => { throw new Error('isbndb unavailable') }],
    ['googleapis.com', google({ title: 'Dune', authors: ['Frank Herbert'] })],
    ['openlibrary.org', openLibrary({ title: 'Dune', authors: [{ name: 'Frank Herbert' }] })]
  ])

  const results = await isbnLookup.fetchBookTitle(ISBN, 'secret-key')

  assert.deepEqual(results.map(r => r.source), ['Google Books', 'Open Library'])
})

test('returns an empty list when every provider fails', async (t) => {
  mockAxios(t, [
    ['api2.isbndb.com', () => { throw new Error('isbndb unavailable') }],
    ['googleapis.com', () => { throw new Error('google unavailable') }],
    ['openlibrary.org', () => { throw new Error('openlibrary unavailable') }]
  ])

  const results = await isbnLookup.fetchBookTitle(ISBN, 'secret-key')

  assert.deepEqual(results, [])
})

test('treats a Google Books empty result set as a provider failure', async (t) => {
  mockAxios(t, [
    ['googleapis.com', () => ({ items: [] })],
    ['openlibrary.org', openLibrary({ title: 'Dune', authors: [{ name: 'Frank Herbert' }] })]
  ])

  const results = await isbnLookup.fetchBookTitle(ISBN)

  assert.deepEqual(results.map(r => r.source), ['Open Library'])
})
