# AMG production website release — November 4, 2026

Published at the user's explicit request to publish all current changes.

- Production: https://anointedmoneygroup.com
- Netlify site: `eeb65021-6055-4242-8b9e-578cdcecc8d8`
- Published deploy: `6aeb527810eb0a5ca9716597`
- Release commit: `40167af` on `codex/amg-resource-library`
- Previous production deploy: `6aeb46000d4b3a510f67a068`

## Included changes

- Short Higgsfield AMG introduction: 2.68-second video and 0.55-second upward veil reveal, replayed on eligible homepage loads and refreshes. Skip, Escape, reduced-motion and deep-link behavior retained.
- AMG meeting invitation directly below the metrics, with Wednesday 7 PM and Saturday 10 AM / 2 PM Eastern cards linking to the existing guest calendar.
- Homepage slideshow contains the weekly schedule, Tokyo 2028 trip flyer, and Las Vegas November 2026 ladies' trip flyer.
- Resources page has the original five-second AMG video beside the guest invitation section.
- Twelve PHP video cards and the Lights Out 2026 playlist are available on Resources. Existing getting-started videos remain; the generational wealth video is listed once.
- National Life Group removed from both carousel groups; twelve carrier logos remain in each matching group.

## Verification

- 157 automated tests passed, with no failures or skips.
- TypeScript check and production build passed. The staged admin bundles match the tracked release bundles exactly; backend and admin application code are unchanged by this release.
- Netlify reports this deploy as current and ready for the production domain.
- Live browser verified the intro on initial load and refresh, guest-section placement, all three slides, twelve carriers without NLG, and the Resources guest/video collection links.
- Production homepage, Resources, short MP4, and both trip WebPs returned HTTP 200 with the expected asset content types and sizes.
- Anonymous inquiries listing returned HTTP 401, matching the pre-release baseline. No production inquiries or messages were created during this release verification.

## Follow-up: 2.5-second maximum intro, no Skip button

Published deploy `6aeb57b1982fa5cee9d78ba8` from commit `263c17b` at the user's request. This supersedes the intro timing and Skip-button behavior above; the other website changes remain in place.

The homepage intro replays on eligible refreshes, uses 1.4× video playback and a 350 ms veil, and has no visible Skip intro button. The overlay starts its exit by 2.0 seconds, closes 360 ms later, and retains an independent 2.45-second hard deadline through the exit. Loading is included in the time budget. Escape and accessibility bypasses remain.

All 11 focused intro lifecycle tests passed, including slow/stalled media, delayed exit events, browser playback-rate resets, refreshes, and cleanup. Desktop/mobile browser checks passed. Production was confirmed current/ready, the served intro script matched the release bytes, and live refresh showed no Skip button, 1.4× playback, a 0.35-second veil, and automatic scroll restoration.

## Follow-up: remove Sound on button

Published deploy `6aeb6c428d3a9b0bbbc53473` from commit `230ddc8` at the user's request. Removed the homepage intro's sound button, control wrapper, toggle handler, and unused control styles. Playback remains muted; the existing 2.5-second maximum and refresh behavior are unchanged.

All 11 focused intro tests passed. A live production refresh confirmed the intro opened with zero buttons, muted playback, and 1.4× playback speed. The Resources page's separate video retains its native controls.
