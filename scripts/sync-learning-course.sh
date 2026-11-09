#!/bin/sh
# Copy a built amg-practice-exam (dist/) into this site. See docs/learning-course.md.
# Usage: scripts/sync-learning-course.sh /path/to/amg-practice-exam
set -eu
portal="${1:?path to the amg-practice-exam checkout}"
dist="$portal/dist"
site="$(cd "$(dirname "$0")/.." && pwd)"
for need in "$dist/index.html" "$dist/course/index.html" "$dist/login/index.html" "$dist/practice-assets"; do
  [ -e "$need" ] || { echo "Missing $need. Run npm run build in $portal first." >&2; exit 1; }
done
# rm + cp, not rsync: macOS is case-insensitive and some names differ only by case.
rm -rf "$site/course" "$site/login" "$site/practice" "$site/practice-assets"
cp -R "$dist/course" "$site/course"
cp -R "$dist/login" "$site/login"
mkdir "$site/practice" && cp "$dist/index.html" "$site/practice/index.html"
cp -R "$dist/practice-assets" "$site/practice-assets"
cp "$dist/Accident & Health Study Guide.docx" "$site/guides/accident-health.docx"
cp "$dist/Life Producer Study Guide.docx" "$site/guides/life-producer.docx"
echo "Synced. Now run: npm test"
