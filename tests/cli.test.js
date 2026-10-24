const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const xlsx = require('xlsx')

const cli = path.resolve(__dirname, '..', 'cli.js')
const preload = path.join(__dirname, 'helpers', 'mock-isbn-lookup.js')

function tempDir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isbn-cli-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function runCli (dir, args, env = {}) {
  const capture = path.join(dir, 'calls.jsonl')
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    env: {
      ...process.env,
      ISBNDB_API_KEY: '',
      NODE_OPTIONS: `--require=${preload}`,
      MOCK_CAPTURE_FILE: capture,
      ...env
    },
    encoding: 'utf8',
    timeout: 30000
  })
  const calls = fs.existsSync(capture)
    ? fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : []
  return { result, calls }
}

function readOutput (dir, inputName) {
  const output = path.join(dir, `${inputName}-book-titles.xlsx`)
  assert.ok(fs.existsSync(output), `missing output workbook ${output}`)
  const workbook = xlsx.readFile(output)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return xlsx.utils.sheet_to_json(sheet)
}

test('looks up a text file and writes an xlsx', (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.txt')
  fs.writeFileSync(input, '9780345409461\n9781416594789\n')

  const { result, calls } = runCli(dir, [input], {
    MOCK_ISBN_TITLES: JSON.stringify({
      9780345409461: 'Dune',
      9781416594789: 'Mistborn'
    })
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /9780345409461 \| Dune/)
  assert.match(result.stdout, /9781416594789 \| Mistborn/)
  assert.match(result.stdout, /Titles saved to .*input-book-titles\.xlsx/)
  assert.deepEqual(calls.map(call => call.isbn), ['9780345409461', '9781416594789'])
  assert.deepEqual(calls.map(call => call.apiKey), [null, null])
  assert.deepEqual(readOutput(dir, 'input'), [
    { isbn: '9780345409461', title: 'Dune' },
    { isbn: '9781416594789', title: 'Mistborn' }
  ])
})

test('passes the command-line API key to the lookup module', (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.txt')
  fs.writeFileSync(input, '9780345409461\n')

  const { result, calls } = runCli(dir, [input, 'secret-key'], {
    MOCK_ISBN_TITLES: JSON.stringify({ 9780345409461: 'Dune' })
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].apiKey, 'secret-key')
})

test('falls back to the ISBNDB_API_KEY environment variable', (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.txt')
  fs.writeFileSync(input, '9780345409461\n')

  const { result, calls } = runCli(dir, [input], {
    ISBNDB_API_KEY: 'env-key',
    MOCK_ISBN_TITLES: JSON.stringify({ 9780345409461: 'Dune' })
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls[0].apiKey, 'env-key')
})

test('reads ISBNs from the first column of an xlsx file', (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.xlsx')
  const workbook = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.aoa_to_sheet([['9780345409461'], [9781416594789]]),
    'ISBNs'
  )
  xlsx.writeFile(workbook, input)

  const { result, calls } = runCli(dir, [input], {
    MOCK_ISBN_TITLES: JSON.stringify({
      9780345409461: 'Dune',
      9781416594789: 'Mistborn'
    })
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls.map(call => call.isbn), ['9780345409461', '9781416594789'])
  assert.deepEqual(readOutput(dir, 'input'), [
    { isbn: '9780345409461', title: 'Dune' },
    { isbn: '9781416594789', title: 'Mistborn' }
  ])
})

test('writes a row with no title when the lookup returns nothing', (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.txt')
  fs.writeFileSync(input, '9780000000000\n')

  const { result } = runCli(dir, [input])

  assert.equal(result.status, 0, result.stderr)
  const rows = readOutput(dir, 'input')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].isbn, '9780000000000')
  assert.equal(rows[0].title, undefined)
})

test('rejects a missing input file', (t) => {
  const dir = tempDir(t)
  const { result } = runCli(dir, [])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Please specify a valid input file/)
})

test('rejects an unsupported input file format', (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.csv')
  fs.writeFileSync(input, '9780345409461\n')

  const { result } = runCli(dir, [input])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Only text and Excel files are supported/)
})
