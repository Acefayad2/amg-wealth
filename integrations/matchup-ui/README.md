# AMG Matchup UI source

This source builds the static `/matchups/` export in the website repository. The backend is the existing Supabase `amg-matchup` function; theme changes do not change appointment behavior.

The visual reference is the user’s original cream card layout, raised controls, recessed fields, serif headings and green/gold actions. Shared tokens are in `/assets/amg-portal-theme.css`; copy that file to `app/reference-theme.css` before building.

Run `npm ci`, `npm run build`, `npm run typecheck`, then `npm test` here. Copy the contents of `out/` into the repository’s `/matchups/` directory. Do not publish sample records or fake availability counts.
