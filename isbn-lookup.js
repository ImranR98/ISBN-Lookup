const axios = require('axios')
const isDev = process.env.NODE_ENV == 'development'

async function fetchBookDataFromISBNdb(isbn, apiKey) {
  const isbnDbUrl = `https://api2.isbndb.com/book/${isbn}`
  const isbnDbResponseData = (await axios.get(isbnDbUrl, { headers: { Authorization: apiKey } })).data
  if (isDev) console.debug(JSON.stringify(isbnDbResponseData, null, '\t'))
  return { title: isbnDbResponseData.book.title, authors: isbnDbResponseData.book.authors }
}

async function fetchBookDataFromGoogleBooks(isbn) {
  const googleBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`
  const googleBooksResponseData = (await axios.get(googleBooksUrl)).data
  if (isDev) console.debug(JSON.stringify(googleBooksResponseData, null, '\t'))
  const title = googleBooksResponseData.items[0].volumeInfo.title
  const subtitle = googleBooksResponseData.items[0].volumeInfo.subtitle
  const finalTitle = `${title}${subtitle && subtitle.length > 0 ? `: ${subtitle}` : ''}`
  const authors = googleBooksResponseData.items[0].volumeInfo.authors
  return { title: finalTitle, authors }
}

async function fetchBookDataFromOpenLibrary(isbn) {
  const openLibraryUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  const openLibraryResponseData = (await axios.get(openLibraryUrl)).data
  if (isDev) console.debug(JSON.stringify(openLibraryResponseData, null, '\t'))
  const title = openLibraryResponseData[`ISBN:${isbn}`].title
  const subtitle = openLibraryResponseData[`ISBN:${isbn}`].subtitle
  const finalTitle = `${title}${subtitle && subtitle.length > 0 ? `: ${subtitle}` : ''}`
  const authors = openLibraryResponseData[`ISBN:${isbn}`].authors.map(a => a.name)
  return { title: finalTitle, authors }
}

// Define a function to fetch the book title for a given ISBN code
module.exports.fetchBookTitle = async (isbn, isbnDbKey) => {
  let titles = []
  if (isbnDbKey) {
    try {
      const bookData = await fetchBookDataFromISBNdb(isbn, isbnDbKey)
      titles.push({ ...bookData, source: 'ISBNdb', isbn })
    } catch (error) {
      if (isDev) console.error(`Failed to fetch book title from ISBNdb for ISBN ${isbn}: ${error}`)
    }
  }
  try {
    const bookData = await fetchBookDataFromGoogleBooks(isbn)
    titles.push({ ...bookData, source: 'Google Books', isbn })
  } catch (error) {
    if (isDev) console.error(`Failed to fetch book title from Google Books for ISBN ${isbn}: ${error}`)
  }
  try {
    const bookData = await fetchBookDataFromOpenLibrary(isbn)
    titles.push({ ...bookData, source: 'Open Library', isbn })
  } catch (error) {
    if (isDev) console.error(`Failed to fetch book title from Open Library for ISBN ${isbn}: ${error}`)
  }
  titles = titles.sort((a, b) => {
    return b.title.length - a.title.length
  })
  return titles
}