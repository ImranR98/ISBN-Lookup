// Test-only preload that replaces the live lookup provider with a deterministic
// stub before cli.js requires it. Selected via NODE_OPTIONS=--require=...
const fs = require('node:fs')
const path = require('node:path')

const isbnLookup = require(path.resolve(__dirname, '..', '..', 'isbn-lookup.js'))

isbnLookup.fetchBookTitle = async (isbn, apiKey) => {
  if (process.env.MOCK_CAPTURE_FILE) {
    const record = { isbn: String(isbn), apiKey: apiKey || null }
    fs.appendFileSync(process.env.MOCK_CAPTURE_FILE, `${JSON.stringify(record)}\n`)
  }

  let titles = {}
  try {
    titles = JSON.parse(process.env.MOCK_ISBN_TITLES || '{}')
  } catch {
    titles = {}
  }

  const title = titles[String(isbn)]
  if (title === undefined) {
    return []
  }
  return [{ isbn: String(isbn), title, authors: [], source: 'mock' }]
}
