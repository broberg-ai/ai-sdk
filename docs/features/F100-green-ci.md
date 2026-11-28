# F100 — Grøn CI: secret-gate + security/workflows

> Kilde: røde checks målt på commit 7019b12 (28/11 2026). Ejerens ja: Decision Board 28/11 («Ja»). Regel: D-12d58c (tests og CI altid grønne).

## Fund (målt, ikke antaget)

1. **secret-gate** — gitleaks `generic-api-key` i `src/providers/mistral-cache.test.ts:45`, commit `d03ab87` (27/8 2026). Strengen er `conversation-42` (en test-nøgle til prompt-cache, ingen hemmelighed). Fingerprint: `d03ab878006c14cbbe20e6022c2a713b8b1a1d7b:src/providers/mistral-cache.test.ts:generic-api-key:45`. Fundet ligger i historikken, så en filrettelse fjerner det ikke.
2. **security / workflows** (zizmor) — `.github/workflows/publish.yml`: 3× `unpinned-uses` (checkout@v4, setup-bun@v2, setup-node@v4) og 2× `cache-poisoning` på publish-jobbet.

## Scope

- Falsk positiv: fingerprint i `.gitleaksignore` med dateret kommentar (flådens egen vej, jf. secret-gate.yml). Ingen deaktivering af porten.
- publish.yml: pin de tre actions til commit-SHA med versionskommentar; slå cache fra i publish-jobbet (`no-cache` på setup-bun). Ingen ændring af hvad der publiceres.
- Bevis: næste push giver grøn secret-gate og grøn security; en release (patch) gennemføres med OIDC-publish uændret.

## Reuse

Intet nyt. `.gitleaksignore` er flådens dokumenterede mekanisme (secret-gate.yml). Actions pinnes efter fleet-konvention (secret-gate.yml pinner allerede reusable workflow til SHA).
