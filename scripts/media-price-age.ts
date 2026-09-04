// F050 — how old are the prices no job can refresh?
//
// Run monthly by .github/workflows/research-models.yml, whose output lands in the PR
// body and the job summary. It reports; it never fails the run — see the workflow
// comment for why a gate would be worse than none here.
import { MEDIA_PRICING, MEDIA_PRICING_CHECKED_AT, mediaUnitCounts } from "../src/cost/media-pricing.js";
import { PRICING_STALE_AFTER_DAYS } from "../src/catalogue/pricing-api.js";

// Clamped for the same reason computeFreshness clamps: a date-only stamp is UTC
// midnight, so a check made today in Copenhagen floors to -1 for the first hours.
const ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(MEDIA_PRICING_CHECKED_AT)) / 86_400_000));
const stale = ageDays > PRICING_STALE_AFTER_DAYS;
const counts = mediaUnitCounts();

console.log(`\n## Hand-maintained prices (this job cannot refresh them)\n`);
console.log(
  `${stale ? "⚠️ **STALE**" : "✅ Fresh"} — last checked by a human on ` +
    `**${MEDIA_PRICING_CHECKED_AT}** (${ageDays} days ago, threshold ${PRICING_STALE_AFTER_DAYS}d).\n`,
);
console.log(`| unit | rows |`);
console.log(`|---|---|`);
for (const [unit, n] of Object.entries(counts)) console.log(`| \`${unit}\` | ${n} |`);
console.log(`\n${Object.keys(MEDIA_PRICING).length} rows total.\n`);
if (stale) {
  console.log(
    `**To refresh:** re-read each row's \`source\` URL in \`src/cost/media-pricing.ts\`, ` +
      `correct any number that moved, and bump \`MEDIA_PRICING_CHECKED_AT\`. ` +
      `Bumping the date without re-reading the pages is the one failure mode this report has ` +
      `— the date is then a claim nobody made.\n`,
  );
}
