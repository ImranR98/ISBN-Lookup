require('dotenv').config();
const fs = require('fs');
const ExcelJS = require('exceljs');

const isbnLookup = require('./isbn-lookup')

// Normalize the value ExcelJS returns for a cell into a trimmed ISBN string.
// Handles plain strings/numbers, rich text, hyperlinks, formulas, and blanks.
function normalizeCellValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText
        .map(part => (part && typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim();
    }
    if (typeof value.text === 'string') {
      return value.text.trim();
    }
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return normalizeCellValue(value.result);
    }
  }
  return '';
}

function readTextIsbns(inputFile) {
  return fs.readFileSync(inputFile, 'utf-8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

async function readXlsxIsbns(inputFile) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputFile);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }
  const isbns = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const isbn = normalizeCellValue(row.getCell(1).value);
    if (isbn) {
      isbns.push(isbn);
    }
  });
  return isbns;
}

async function readIsbnList(inputFile) {
  if (inputFile.endsWith('.txt')) {
    return readTextIsbns(inputFile);
  }
  if (inputFile.endsWith('.xlsx')) {
    return readXlsxIsbns(inputFile);
  }
  throw new Error('Invalid input file format. Only text and Excel files are supported');
}

async function fetchBookTitles(isbnList, apiKey) {
  const bookTitles = {};
  for (const isbn of isbnList) {
    const res = await isbnLookup.fetchBookTitle(isbn, apiKey || process.env.ISBNDB_API_KEY);
    bookTitles[isbn] = res && res[0] ? res[0].title : null;
    if (bookTitles[isbn]) {
      console.log(isbn, '|', bookTitles[isbn]);
    }
  }
  return bookTitles;
}

async function writeTitleWorkbook(inputFile, bookTitles) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Title');
  worksheet.columns = [
    { header: 'isbn', key: 'isbn' },
    { header: 'title', key: 'title' }
  ];
  for (const [isbn, title] of Object.entries(bookTitles)) {
    worksheet.addRow({ isbn, title: title ?? null });
  }

  const outputFilename = `${inputFile.replace(/\.[^/.]+$/, '')}-book-titles.xlsx`;
  await workbook.xlsx.writeFile(outputFilename);
  return outputFilename;
}

async function main() {
  const inputFile = process.argv[2];
  const apiKey = process.argv[3];

  if (!inputFile || !fs.existsSync(inputFile)) {
    throw new Error('Please specify a valid input file');
  }

  const isbnList = await readIsbnList(inputFile);
  const bookTitles = await fetchBookTitles(isbnList, apiKey);
  const outputFilename = await writeTitleWorkbook(inputFile, bookTitles);
  console.log(`Titles saved to ${outputFilename}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  readIsbnList,
  fetchBookTitles,
  writeTitleWorkbook,
  normalizeCellValue
};
