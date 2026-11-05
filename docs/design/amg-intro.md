# AMG website introduction

Gold-letter reveal generated with Higgsfield Seedance 2.5 for the November 4, 2026 request. The A, M, and G arrive separately with metallic impacts and gold sparks, then settle on a dark emerald background. The homepage uses a 2.68-second video asset played at 1.6× speed (about 1.68 seconds of playback), followed by a 0.7-second upward veil reveal. The exact brand name appears as live text below the letters at video time 1.53 seconds (about 0.96 seconds into playback).

- Higgsfield job: `15736812-458b-494c-91aa-61ad5919d9f2`
- Generated source: 1920 × 1080, 24 fps, 5.04 seconds, HEVC with audio.
- Website asset: `assets/amg-intro.mp4`, H.264/AAC with fast-start metadata, 820,796 bytes.
- Short homepage asset: `assets/amg-intro-short.mp4`, H.264/AAC, 1920 × 1080, fast-start, 439,016 bytes. The first 4.0 source seconds run at 1.5× speed, with an audio fade over the final 0.317 seconds. The full-length Resources page video is unchanged.
- Generation quote: 80 credits for one 1080p result. One job submitted and completed.
- Original result: https://d8j0ntlcm91z4.cloudfront.net/user_3F3Wyc8aPIE73qdpViOJx8BolpH/hf_20261104_150849_15736812-458b-494c-91aa-61ad5919d9f2.mp4

The introduction runs on every eligible homepage load and refresh with muted playback and no visible controls. The Sound on/off and Skip intro buttons were removed at the user's request. It does not read or write a session-level seen flag. Escape closes it, including during the veil exit. Reduced-motion settings, data-saving mode, hidden tabs, and deep links bypass the introduction. No video is requested when bypassing the introduction.

The entire overlay is capped below 2.5 seconds from opening, including loading and the veil exit. Normal playback and the veil complete in about 2.39 seconds plus startup. A timer starts the veil no later than 1.7 seconds and removes the overlay 710 ms later; an independent 2.45-second deadline remains active through the exit. Missing playback is dismissed after 1.5 seconds. Escape, errors, reduced motion, backgrounding, or the hard deadline close immediately.

Refresh `/` or `/#top` to review the introduction again; the existing `/?intro=play` preview link also works without being required. Accessibility and deep-link bypasses still apply. The modal uses the full 16:9 composition at every viewport size to keep all three letters visible. After it closes, focus and page scrolling return to the site.

Validation: reviewed generated frames and desktop/mobile playback; automatic completion and page scroll restoration checked in the browser. Focused lifecycle tests cover playback failures, stalled loading, the total time cap including delayed exit events, Escape (including during the veil), repeat visits with legacy session data, reduced motion, muted playback without controls, and cleanup.
