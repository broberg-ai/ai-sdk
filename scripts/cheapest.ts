// F080.3 — "billigste model fra udbyder X", answered from cheapestModels(), never memory.
//   bun run scripts/cheapest.ts <vendor> [kind]       e.g.  mistral   |  mistral embedding
// Prints the cheapest overall AND the cheapest on our own direct route, because "from
// provider X" can mean either, and the two differ (22 Oct 2026: Mistral's cheapest is
// mistral-nemo via OpenRouter; directly it is ministral-3b-2512).
import { cheapestModels, type PriceKind } from "../src/catalogue/pricing-api.ts";

const [vendor, kind = "chat"] = process.argv.slice(2);
if (!vendor) {
  console.error("usage: bun run scripts/cheapest.ts <vendor> [kind]");
  process.exit(2);
}
const fmt = (n: number) => `$${n}`;
for (const [label, route] of [["Billigst i alt", undefined], ["Billigst direkte (vores egen adapter)", "direct"]] as const) {
  const r = cheapestModels({ vendor, kind: kind as PriceKind, route, limit: 3 });
  console.log(`\n## ${label} — ${vendor}, ${kind}`);
  if (r.results.length === 0) console.log("(ingen)");
  r.results.forEach((x, i) => {
    console.log(
      `${i + 1}. ${x.callAs.model}  ${fmt(x.inputPer1M)} ind / ${fmt(x.outputPer1M)} ud pr. 1M (blandet ${fmt(x.blendedPer1M)})` +
        `\n   kald: override:{ provider:"${x.callAs.provider}", model:"${x.callAs.model}" } · rute ${x.route} · region ${x.region}` +
        `\n   kilde: ${x.source === "curated" ? "vores pristabel" : "OpenRouter-kataloget"}, tjekket ${x.checkedAt ?? "ukendt"} · upstream ${x.upstream}` +
        (x.caveats.length ? `\n   forbehold: ${x.caveats.join("; ")}` : ""),
    );
  });
  if (r.matched > r.results.length) console.log(`(${r.matched} i alt matchede)`);
  for (const c of r.caveats) console.log(`⚠ ${c}`);
}
