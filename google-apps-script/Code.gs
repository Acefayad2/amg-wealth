const SPREADSHEET_ID = '18g_rHgbxuMAGru-cKXGd2lmwG8vhRq9bAcEzdFT2U8M'
const PERSONALITY_SHEET_NAME = 'AMG Personality Responses'
const CONSULTATION_SHEET_NAME = 'Consultation Responses'

const PERSONALITY_HEADERS = [
  'Submitted At',
  'Full Name',
  'Email',
  'Phone',
  'Primary Personality Type',
  'Secondary Personality Type',
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

const CONSULTATION_HEADERS = [
  'Submitted At',
  'Full Name',
  'Email',
  'Phone',
  'Interest',
  'Goals',
  'Source',
  'User Agent',
]

function doGet() {
  return json_({ ok: true, message: 'AMG response endpoint is ready.' })
}

function doPost(event) {
  const lock = LockService.getScriptLock()
  lock.waitLock(10000)

  try {
    const params = event.parameter || {}

    if (params.formType === 'consultation') {
      appendConsultation_(params)
    } else {
      appendPersonality_(params)
    }

    return json_({ ok: true })
  } catch (error) {
    return json_({ ok: false, error: error.message })
  } finally {
    lock.releaseLock()
  }
}

function appendConsultation_(params) {
  const sheet = getSheet_(CONSULTATION_SHEET_NAME, CONSULTATION_HEADERS)

  sheet.appendRow([
    params.submittedAt || new Date().toISOString(),
    params.fullName || params['full-name'] || '',
    params.email || '',
    params.phone || '',
    params.interest || '',
    params.goals || '',
    params.source || 'AMG website consultation form',
    params.userAgent || '',
  ])
}

function appendPersonality_(params) {
  const sheet = getSheet_(PERSONALITY_SHEET_NAME, PERSONALITY_HEADERS)

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
    params.source || 'AMG Netlify Personality assessment',
    params.userAgent || '',
  ])
}

function getSheet_(sheetName, headers) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName)

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers)
    sheet.setFrozenRows(1)
    sheet.getRange(1, 1, 1, headers.length)
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
