const express = require('express')
const path = require('path')
require('dotenv').config()
const fs = require('fs')

const isbnLookup = require('./isbn-lookup')

if (process.env['ANALYTICS_SCRIPT_ELEMENT'] && /<script [^(<>)]+><\/script>/.test(process.env['ANALYTICS_SCRIPT_ELEMENT'])) {
  const indexHTML = __dirname + '/public/index.html'
  fs.writeFileSync(indexHTML,
    fs.readFileSync(indexHTML).toString().replace(
      '<!-- ANALYTICS_SCRIPT_PLACEHOLDER -->',
      process.env['ANALYTICS_SCRIPT_ELEMENT']
    )
  )
}

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }))
app.get('/:isbn/title', async (req, res) => {
  try {
    const result = await isbnLookup.fetchBookTitle(req.params.isbn, process.env.ISBNDB_API_KEY)
    const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip
    console.log(`Request for ISBN '${req.params.isbn}' from IP '${ip}': ${result.length} results.`)
    res.status(result.length > 0 ? 200 : 204).send(result)
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