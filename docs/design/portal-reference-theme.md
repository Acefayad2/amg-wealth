# AMG portal reference template

The user's reference is the ten-panel mobile flow: warm cream background, raised cream cards, inset fields, round icon wells, dark-green actions with gold arrows, gold selection outlines, and a high-contrast serif heading. Changing only the palette does not restore this template.

The shared material and typography source is `assets/amg-portal-theme.css`. Fonts are self-hosted: Bodoni Moda headings and Manrope body text. The same file styles course entry, both course catalogs, all lessons, both mock exams, practice drills, the personal checklist, and the admin Licensing workspace. Admin rules are scoped to the visible Licensing section.

Matchup source is now in `integrations/matchup-ui/`; `app/reference-theme.css` mirrors the shared theme. Its build exports to `out/`, which is copied to `/matchups/`. The restored entry card offers Agent and CFT/MD routes. Booking validation, matching, CFT authorization and availability are unchanged.

Course source remains `Acefayad2/amg-practice-exam`. Its `scripts/apply-portal-theme.mjs` runs in the production build, attaches the shared stylesheet after page-specific CSS, and adds scoped body classes. Mock-exam progress and context now sit inside the question card. Saved answers, question banks, videos, scoring and access checks are unchanged.

Visual checks use synthetic data only. Reference screenshots were checked at 390 px and desktop widths. New appointment-request features are deferred per the user's latest instruction.
