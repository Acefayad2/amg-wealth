# AMG Google Sheet Response Endpoint

This script receives submissions from the AMG website and appends them to Google Sheet tabs:

- `Consultation Responses` for the home-page consultation form
- `AMG Personality Responses` for the direct-link personality test

https://docs.google.com/spreadsheets/d/18g_rHgbxuMAGru-cKXGd2lmwG8vhRq9bAcEzdFT2U8M/edit

## Deploy

1. Open the Google Sheet.
2. Go to Extensions > Apps Script.
3. Paste `Code.gs` into the editor.
4. Deploy as a Web App.
5. Set "Execute as" to yourself.
6. Set access to "Anyone".
7. Copy the Web App URL.
8. Paste that URL into `index.html` and `assessment.html` as `GOOGLE_SCRIPT_URL`.

The script creates both response tabs and headers automatically on the first submission.
