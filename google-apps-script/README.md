# AMG Personality Google Sheet Endpoint

This script receives submissions from `assessment.html` and appends them to the `AMG Personality Responses` tab in:

https://docs.google.com/spreadsheets/d/1Fj9mFhTfJkLXOvxIcdQIHOaZ6yDQHwcxV9KI4mpzQ6o/edit

## Deploy

1. Open the Google Sheet.
2. Go to Extensions > Apps Script.
3. Paste `Code.gs` into the editor.
4. Deploy as a Web App.
5. Set "Execute as" to yourself.
6. Set access to "Anyone".
7. Copy the Web App URL.
8. Paste that URL into `assessment.html` as `GOOGLE_SCRIPT_URL`.

The script creates the `AMG Personality Responses` tab and headers automatically on the first submission.
