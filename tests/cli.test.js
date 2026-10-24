const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ExcelJS = require('exceljs')

const cliPath = path.resolve(__dirname, '..', 'cli.js')
const cli = require('../cli')
const preload = path.join(__dirname, 'helpers', 'mock-isbn-lookup.js')

function tempDir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isbn-cli-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function runCli (dir, args, env = {}) {
  const capture = path.join(dir, 'calls.jsonl')
  const result = spawnSync(process.execPath, [cliPath, ...args], {
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

function cellText (cell) {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && typeof value.text === 'string') return value.text
  return String(value)
}

async function readOutput (dir, inputName) {
  const output = path.join(dir, `${inputName}-book-titles.xlsx`)
  assert.ok(fs.existsSync(output), `missing output workbook ${output}`)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(output)
  const worksheet = workbook.getWorksheet('Title')
  assert.ok(worksheet, 'missing Title worksheet')
  assert.equal(worksheet.getCell('A1').value, 'isbn')
  assert.equal(worksheet.getCell('B1').value, 'title')

  const rows = []
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const isbn = cellText(row.getCell(1))
    const title = cellText(row.getCell(2))
    rows.push(title ? { isbn, title } : { isbn })
  })
  return rows
}

async function writeXlsx (input, rows) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('ISBNs')
  for (const row of rows) {
    worksheet.addRow(row)
  }
  await workbook.xlsx.writeFile(input)
  return workbook
}

test('normalizes ExcelJS cell values', () => {
  assert.equal(cli.normalizeCellValue(' 9780345409461 '), '9780345409461')
  assert.equal(cli.normalizeCellValue(9780345409461), '9780345409461')
  assert.equal(cli.normalizeCellValue(null), '')
  assert.equal(cli.normalizeCellValue(undefined), '')
  assert.equal(cli.normalizeCellValue(''), '')
  assert.equal(cli.normalizeCellValue(Number.NaN), '')
  assert.equal(
    cli.normalizeCellValue({ richText: [{ text: '978' }, { text: '0345409461' }] }),
    '9780345409461'
  )
  assert.equal(
    cli.normalizeCellValue({ text: ' 9781416594789 ', hyperlink: 'https://example.com' }),
    '9781416594789'
  )
  assert.equal(
    cli.normalizeCellValue({ formula: 'A1', result: 9780316452502 }),
    '9780316452502'
  )
  assert.equal(cli.normalizeCellValue({ error: '#N/A' }), '')
  assert.equal(cli.normalizeCellValue(true), '')
})

test('looks up a text file and writes an xlsx', async (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.txt')
  fs.writeFileSync(input, '9780345409461\r\n\r\n  9781416594789  \r\n')

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
  assert.deepEqual(await readOutput(dir, 'input'), [
    { isbn: '9780345409461', title: 'Dune' },
    { isbn: '9781416594789', title: 'Mistborn' }
  ])
})

test('passes the command-line API key to the lookup module', async (t) => {
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

test('falls back to the ISBNDB_API_KEY environment variable', async (t) => {
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

test('reads ISBNs from the first column of an xlsx file', async (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.xlsx')
  await writeXlsx(input, [['9780345409461'], [9781416594789]])

  const { result, calls } = runCli(dir, [input], {
    MOCK_ISBN_TITLES: JSON.stringify({
      9780345409461: 'Dune',
      9781416594789: 'Mistborn'
    })
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls.map(call => call.isbn), ['9780345409461', '9781416594789'])
  assert.deepEqual(await readOutput(dir, 'input'), [
    { isbn: '9780345409461', title: 'Dune' },
    { isbn: '9781416594789', title: 'Mistborn' }
  ])
})

test('skips blank rows and handles string and numeric ISBN cells', async (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.xlsx')
  await writeXlsx(input, [
    [],
    [null],
    [null, 'not an ISBN'],
    [''],
    [' 9780345409461 '],
    [9781416594789],
    ['9780316452502']
  ])

  const { result, calls } = runCli(dir, [input], {
    MOCK_ISBN_TITLES: JSON.stringify({
      9780345409461: 'Dune',
      9781416594789: 'Mistborn',
      9780316452502: 'The Way of Kings'
    })
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls.map(call => call.isbn), [
    '9780345409461',
    '9781416594789',
    '9780316452502'
  ])
  assert.deepEqual(await readOutput(dir, 'input'), [
    { isbn: '9780345409461', title: 'Dune' },
    { isbn: '9781416594789', title: 'Mistborn' },
    { isbn: '9780316452502', title: 'The Way of Kings' }
  ])
})

test('writes a row with no title when the lookup returns nothing', async (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.txt')
  fs.writeFileSync(input, '9780000000000\n')

  const { result } = runCli(dir, [input])

  assert.equal(result.status, 0, result.stderr)
  const rows = await readOutput(dir, 'input')
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

test('rejects an invalid xlsx file', (t) => {
  const dir = tempDir(t)
  const input = path.join(dir, 'input.xlsx')
  fs.writeFileSync(input, 'not an xlsx workbook')

  const { result } = runCli(dir, [input])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /\S/)
})
