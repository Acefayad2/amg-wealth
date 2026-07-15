const SPREADSHEET_ID = '1Fj9mFhTfJkLXOvxIcdQIHOaZ6yDQHwcxV9KI4mpzQ6o'
const SHEET_NAME = 'STAR Responses'

const HEADERS = [
  'Submitted At',
  'Full Name',
  'Email',
  'Phone',
  'Primary STAR Type',
  'Secondary STAR Type',
  'Structure Score',
  'Technical Score',
  'Action Score',
  'Relationship Score',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Q5',
  'Q6',
  'Q7',
  'Q8',
  'Q9',
  'Q10',
  'Q11',
  'Q12',
  'Q13',
  'Q14',
  'Q15',
  'Q16',
  'Q17',
  'Q18',
  'Q19',
  'Q20',
  'Source',
  'User Agent',
]

function doGet() {
  return json_({ ok: true, message: 'AMG STAR endpoint is ready.' })
}

function doPost(event) {
  const lock = LockService.getScriptLock()
  lock.waitLock(10000)

  try {
    const params = event.parameter || {}
    const sheet = getResponseSheet_()

    sheet.appendRow([
      params.submittedAt || new Date().toISOString(),
      params.fullName || '',
      params.email || '',
      params.phone || '',
      params.primaryType || '',
      params.secondaryType || '',
      params.structureScore || '',
      params.technicalScore || '',
      params.actionScore || '',
      params.relationshipScore || '',
      params.q1 || '',
      params.q2 || '',
      params.q3 || '',
      params.q4 || '',
      params.q5 || '',
      params.q6 || '',
      params.q7 || '',
      params.q8 || '',
      params.q9 || '',
      params.q10 || '',
      params.q11 || '',
      params.q12 || '',
      params.q13 || '',
      params.q14 || '',
      params.q15 || '',
      params.q16 || '',
      params.q17 || '',
      params.q18 || '',
      params.q19 || '',
      params.q20 || '',
      params.source || 'AMG Netlify STAR assessment',
      params.userAgent || '',
    ])

    return json_({ ok: true })
  } catch (error) {
    return json_({ ok: false, error: error.message })
  } finally {
    lock.releaseLock()
  }
}

function getResponseSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME)

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS)
    sheet.setFrozenRows(1)
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setFontColor('#F4E7C3')
      .setBackground('#0B2E24')
  }

  return sheet
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}
