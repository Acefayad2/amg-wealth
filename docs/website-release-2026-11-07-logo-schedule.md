# Weekly banner logo and schedule correction

Based on the restored production site at `f9c00f6`.

- Keep the weekly banner's AMG mark circular. A more specific logo rule now overrides the slideshow's generic wide-image aspect ratio and automatic height.
- Remove Tuesday and Wednesday BOM entries from the live weekly banner and its downloadable flyer. Preserve Thursday at 7 PM and Saturday at 10 AM and 2 PM, and all non-BOM events.
- Preserve the restored homepage, bundled Matchup portal, routing, admin code, and database state.

## Checks

- 174 automated tests passed, including logo CSS and schedule regressions.
- TypeScript check, production bundle build, and diff whitespace check passed.
- Generated admin bundles are unchanged.
- Responsive preview and production verification are required before release completion. No physical iPhone/Safari test is claimed.
