# Portfolio logo compatibility correction

- Based on main a7f0939, preserving the restored November 6 site, the corrected weekly-banner logo, and BOM only Thursday and Saturday.
- Replaced the services monogram's CSS raster luminance mask with a native SVG luminance mask. Safari versions that treat the original opaque raster as an alpha mask showed a filled gold square instead of the mark.
- Reused the exact original logo, centered crop, responsive dimensions and gold gradient. No logo artwork was regenerated.
- No changes to the Matchup portal, login, data, routing or schedule.
- Regression tests cover the SVG mask, original asset/crop, unique IDs and removal of the CSS-mask dependency. Preview visual verification and production confirmation are required before completion.

## Verification scope

The user supplied the iPhone Safari failure screenshot. Cloud Chromium is available for preview and live visual checks; actual iPhone Safari execution is not available and must not be claimed.
