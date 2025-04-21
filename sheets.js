// sheets.js
const { google } = require('googleapis');
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
module.exports = google.sheets({version: 'v4', auth});
