const express = require('express')
const path = require('path')
require('dotenv').config()
const fs = require('fs')

const isbnLookup = require('./isbn-lookup')

function applyAnalyticsScript (scriptElement, indexPath = path.join(__dirname, 'public', 'index.html')) {
  if (!scriptElement || !/<script [^(<>)]+><\/script>/.test(scriptElement)) {
    return false
  }
  const html = fs.readFileSync(indexPath).toString()
  const updated = html.replace('<!-- ANALYTICS_SCRIPT_PLACEHOLDER -->', scriptElement)
  if (updated === html) {
    return false
  }
  fs.writeFileSync(indexPath, updated)
  return true
}

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }))
app.get('/:isbn/title', async (req, res) => {
  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip
  const logString = `${(new Date()).toISOString()}: Request for ISBN '${req.params.isbn}' from IP '${ip}'`
  try { 
    const result = await isbnLookup.fetchBookTitle(req.params.isbn, req.query.ISBNDB_API_KEY || process.env.ISBNDB_API_KEY)
    console.log(`${logString}: ${result.length} results.`)
    res.status(result.length > 0 ? 200 : 204).send(result)
  } catch (error) {
    console.error(`${logString}: ERROR.`)
    console.error(error)
    res.status(400).send(error)
  }
})

app.use((req, res) => {
  res.redirect(404, '/')
})
if (require.main === module) {
  applyAnalyticsScript(process.env['ANALYTICS_SCRIPT_ELEMENT'])
  const port = process.env.PORT || 8080
  app.listen(port, () => {
    console.log(`Server started on port ${port}`)
  })
}

module.exports = app
module.exports.applyAnalyticsScript = applyAnalyticsScript
