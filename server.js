const express = require('express')
const path = require('path')
require('dotenv').config()

const isbnLookup = require('./isbn-lookup')

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }))
app.get('/:isbn/title', async (req, res) => {
  try {
    const result = await isbnLookup.fetchBookTitle(req.params.isbn, process.env.ISBNDB_API_KEY)
    if (!result) {
      res.status(204).send()
    } else {
      result.isbn = req.params.isbn
      res.send(result)
    }
  } catch (error) {
    console.error(error)
    res.status(400).send(error)
  }
})

app.all('*', (req, res) => {
  res.redirect(404, '/')
})
const port = process.env.PORT || 8080
app.listen(port, () => {
  console.log(`Server started on port ${port}`)
})