require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const xlsx = require('xlsx');

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

// Set up the ISBNdb and Open Library API credentials
const apiKey = process.env.ISBNDB_API_KEY;
const openLibraryApiUrl = 'https://openlibrary.org/api/books?bibkeys=ISBN:';
const openLibraryFormat = '&format=json&jscmd=data';

// Define a function to fetch the book title for a given ISBN code
async function fetchBookTitle(isbn) {
  const isbnDbUrl = `https://api2.isbndb.com/book/${isbn}`;
  const isbnDbHeaders = { Authorization: apiKey };
  try {
    const isbnDbResponse = await axios.get(isbnDbUrl, { headers: isbnDbHeaders });
    const book = isbnDbResponse.data.book;
    return book.title;
  } catch (error) {
    console.error(`Failed to fetch book title from ISBNdb API for ISBN ${isbn}.`);
    console.error(`Falling back to Open Library API...`);
    const openLibraryUrl = `${openLibraryApiUrl}${isbn}${openLibraryFormat}`;
    const openLibraryResponse = await axios.get(openLibraryUrl);
    const openLibraryBook = openLibraryResponse.data[`ISBN:${isbn}`];
    return openLibraryBook ? openLibraryBook.title : null;
  }
}

// Define a function to fetch the book titles for all ISBN codes in the list
async function fetchBookTitles(isbnList) {
  const bookTitles = {};
  for (const isbn of isbnList) {
    bookTitles[isbn] = await fetchBookTitle(isbn);
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
