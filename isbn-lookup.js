const axios = require('axios')
const isDev = process.env.NODE_ENV == 'development'

async function fetchBookTitleFromISBNdb(isbn, apiKey) {
  const isbnDbUrl = `https://api2.isbndb.com/book/${isbn}`
  const isbnDbResponseData = (await axios.get(isbnDbUrl, { headers: { Authorization: apiKey } })).data
  if (isDev) console.debug(JSON.stringify(isbnDbResponseData, null, '\t'))
  return isbnDbResponseData.book.title
}

async function fetchBookTitleFromGoogleBooks(isbn) {
  const googleBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`
  const googleBooksResponseData = (await axios.get(googleBooksUrl)).data
  if (isDev) console.debug(JSON.stringify(googleBooksResponseData, null, '\t'))
  return googleBooksResponseData.items[0].volumeInfo.title
}

async function fetchBookTitleFromOpenLibrary(isbn) {
  const openLibraryUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  const openLibraryResponseData = (await axios.get(openLibraryUrl)).data
  if (isDev) console.debug(JSON.stringify(openLibraryResponseData, null, '\t'))
  return openLibraryResponseData[`ISBN:${isbn}`].title
}

// Define a function to fetch the book title for a given ISBN code
module.exports.fetchBookTitle = async (isbn, isbnDbKey) => {
  let titles = []
  if (isbnDbKey) {
    try {
      titles.push({ title: await fetchBookTitleFromISBNdb(isbn, isbnDbKey), source: 'ISBNdb', isbn })
    } catch (error) {
      if (isDev) console.error(`Failed to fetch book title from ISBNdb for ISBN ${isbn}: ${error}`)
    }
  }
  try {
    titles.push({ title: await fetchBookTitleFromGoogleBooks(isbn), source: 'Google Books', isbn })
  } catch (error) {
    if (isDev) console.error(`Failed to fetch book title from Google Books for ISBN ${isbn}: ${error}`)
  }
  try {
    titles.push({ title: await fetchBookTitleFromOpenLibrary(isbn), source: 'Open Library', isbn })
  } catch (error) {
    if (isDev) console.error(`Failed to fetch book title from Open Library for ISBN ${isbn}: ${error}`)
  }
  titles = titles.sort((a, b) => {
    return b.title.length - a.title.length
  })
  return titles
}