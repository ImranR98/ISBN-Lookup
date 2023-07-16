require('dotenv').config();
const fs = require('fs');
const xlsx = require('xlsx');

const isbnLookup = require('./isbn-lookup')

// Get the input file name from command-line arguments
const inputFile = process.argv[2];

// Throw an error if the input file is not specified or is not a valid file
if (!inputFile || !fs.existsSync(inputFile)) {
  throw new Error('Please specify a valid input file');
}

// Read the list of ISBN codes from the input file
let isbnList;
if (inputFile.endsWith('.txt')) {
  isbnList = fs.readFileSync(inputFile, 'utf-8').trim().split('\n');
} else if (inputFile.endsWith('.xlsx')) {
  const workbook = xlsx.readFile(inputFile);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  isbnList = xlsx.utils.sheet_to_json(worksheet, { header: 1, blankrows: false })
    .filter(row => row.length > 0) // Remove empty rows
    .map(row => row[0]); // Extract the first column (ISBN codes)
} else {
  throw new Error('Invalid input file format. Only text and Excel files are supported');
}

// Define a function to fetch the book titles for all ISBN codes in the list
async function fetchBookTitles(isbnList) {
  const bookTitles = {};
  for (const isbn of isbnList) {
    const res = (await isbnLookup.fetchBookTitle(isbn, process.env.ISBNDB_API_KEY))
    bookTitles[isbn] = res && res[0] ? res[0].title : null;
  }
  return bookTitles;
}

// Fetch the book titles for all ISBN codes in the list
fetchBookTitles(isbnList)
  .then((bookTitles) => {
    // Create a workbook and add a worksheet
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(
      Object.entries(bookTitles).map(([isbn, title]) => ({ isbn, title }))
    );

    // Add the worksheet to the workbook
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Book Titles');

    // Write the workbook to a file
    const outputFilename = `${inputFile.replace(/\.[^/.]+$/, '')}-book-titles.xlsx`;
    xlsx.writeFile(workbook, outputFilename);
    console.log(`Book titles saved to ${outputFilename}`);
  })
  .catch((error) => {
    console.error(error);
  });