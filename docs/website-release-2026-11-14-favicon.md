# Clear circular AMG favicon

Replace the detailed raster favicon with a compact vector rendition of the existing AMG monogram and gold ring. The black disk is circular and all four corners are transparent. Solid gold improves contrast at small tab sizes.

- Add `favicon.svg`; render 512px PNG fallbacks and a six-size ICO (16/32/48/64/128/256px).
- Refresh existing AMG favicon links across the website, admin, licensing/course pages and bundled Matchup export with a dated asset URL. Preserve the separate payment-page branding.
- Keep the Matchup source icon and metadata consistent with its bundled output.
- No application behavior, records, permissions, routing or integrations change.

Validation: 280 existing tests, TypeScript, production admin build and whitespace checks pass. All 148 modified HTML pages differ only in icon metadata. XML parsing, transparent corners, opaque disk centers and ICO sizes verified. Browser review checks SVG at 16/24/32/48/128px against light and dark surfaces, plus PNG fallback. Existing assets and uncommitted local work in other checkouts remain untouched.
