const express = require('express')

const app = express()
const PORT = 3100

app.listen(PORT, () => {
  console.log(`API auf http://localhost:${PORT}`)
})

module.exports = app
