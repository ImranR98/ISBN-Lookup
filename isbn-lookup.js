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
  let title = null
  if (isbnDbKey) {
    try {
      title = { title: await fetchBookTitleFromISBNdb(isbn, isbnDbKey), source: 'ISBNdb' }
    } catch (error) {
      console.error(`Failed to fetch book title from ISBNdb for ISBN ${isbn}: ${error}`)
    }
  }
  if (!title) {
    try {
      title = { title: await fetchBookTitleFromOpenLibrary(isbn), source: 'Open Library' }
    } catch (error) {
      console.error(`Failed to fetch book title from Open Library for ISBN ${isbn}: ${error}`)
    }
  }
  if (!title) {
    try {
      title = { title: await fetchBookTitleFromGoogleBooks(isbn), source: 'Google Books' }
    } catch (error) {
      console.error(`Failed to fetch book title from Google Books for ISBN ${isbn}: ${error}`)
    }
  }
  return title
}