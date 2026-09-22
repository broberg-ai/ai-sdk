# F058 — Vores egen udgivelsesopskrift kan ikke virke

**Fundet under en rigtig udgivelse, 22. september 2026.** Christian bad om at
F057 blev sendt som 0.48.0. Jeg fulgte CLAUDE.md's trin ordret, alt svarede
grønt, og **taggen nåede aldrig frem til GitHub.** Ingen workflow-kørsel, ingen
udgivelse, ingen fejl.

## Hvad opskriften siger (CLAUDE.md, linje 49-50)

```
2. Commit, then `git tag vX.Y.Z` (tag MUST equal package.json version — a CI
   guard rejects a mismatch) and `git push --follow-tags` (or push the tag).
```

## Hvorfor de to halvdele udelukker hinanden

`git tag vX.Y.Z` laver et **letvægts-tag**. `git push --follow-tags` sender
**kun annoterede tags**. Kombinationen er altså garanteret at springe taggen
over — og `git push` returnerer 0, fordi commit'en gik fint.

Målt her:

```
git tag v0.48.0            → git cat-file -t v0.48.0  =  commit   (letvægt)
git push --follow-tags     → exit 0, commit på remote
git ls-remote --tags origin| grep v0.48.0  →  INTET
gh run list                →  ingen kørsel for taggen
```

Efter rettelsen (`git tag -a` + `git push origin v0.48.0`):

```
git cat-file -t v0.48.0    →  tag       (annoteret)
git ls-remote --tags       →  v0.48.0 og v0.48.0^{}
```

## Hvorfor det aldrig er opdaget før

Alle tidligere tags på remote ER annoterede — `v0.45.0`, `v0.46.0`, `v0.47.0`,
`v0.47.1`, alle `git cat-file -t` = `tag`. Tidligere sessioner har altså brugt
`-a` eller pushet taggen eksplicit, altså **afveget fra opskriften uden at
notere det**. Opskriften har været forkert hele tiden og er aldrig blevet fulgt
ordret før nu.

Parentesen `(or push the tag)` er i virkeligheden den eneste halvdel der virker.
Den står som et alternativ og er i praksis kravet.

## Fejlformen — den samme som F057, og det er tredje gang i denne session

components katalogiserer den: *en fejl nedenunder mister sin egen tilstand på vej
op og ankommer i en form der ligner et svar.* Her: `git push` lykkedes, og det
den IKKE gjorde havde ingen stemme. Den eneste grund til at det blev opdaget er
at CLAUDE.md andetsteds siger **«verificér mod npm, ikke mod workflowet»** — den
regel fangede det, præcis som den er skrevet til.

## AC

1. CLAUDE.md's udgivelsestrin foreskriver `git tag -a vX.Y.Z -m "…"` og
   `git push origin vX.Y.Z` — ikke `--follow-tags` som primær vej.
2. Teksten siger **hvorfor** (letvægt mod annoteret), så den næste ikke
   "forenkler" den tilbage.
3. Et trin der siger: bekræft at taggen ER på remote
   (`git ls-remote --tags origin | grep vX.Y.Z`) FØR man venter på npm — ellers
   venter man på en kørsel der aldrig blev udløst.
4. Meldt videre til flåden: denne blok er repo-ejet her, men opskriften er
   sandsynligvis kopieret til andre repoer.

## Ikke i scope

En CI-spærre der afviser et letvægts-tag. Taggen er det der UDLØSER workflowet,
så en spærre inde i workflowet kan per definition ikke fyre på den fejl den
skulle fange. Det ville være en port der ikke kan se sin egen fejl.

---

## Spredning — målt af components, 22/9 2026

components tjekkede deres eget repo i samme tur som de læste meldingen, og
fandt **en strengere udgave af samme fejl**:

```
docs/features/F036-lens.md:94   «git tag lens-v<ver> && git push»      ← sender INGEN tag
docs/LENS-BUILD-HANDOFF.md:68   «git push origin lens-v<ver>»          ← virker
```

Vores kombination fejler kun for letvægts-tags. Et bart `git push` sender
**slet ingen** tags — hverken annoterede eller letvægt. Rettet hos dem.

Og samme skjulte tilstand som her: deres `sso-v0.2.3` og `sso-v0.2.4` er begge
letvægt og blev alligevel udgivet, fordi sessionerne pushede taggen eksplicit og
**afveg fra den skrevne opskrift uden at notere det**. Opskriften var grøn fordi
ingen fulgte den.

### Tippet lå i Discovery — og repoet var stadig forkert

`discovery.broberg.ai/ai`, linje 250:

> **[release-gotcha]** git push --follow-tags only pushes ANNOTATED tags. A
> lightweight git tag vX won't trigger a tag-gated publish workflow, so the
> release just doesn't happen. Use git tag -a … or push the tag explicitly.
> *(ai-sdk)*

Afsenderen er os. **Hvad vores egen historik kan og ikke kan fastslå:**

- `--follow-tags`-linjen kom ind i CLAUDE.md **4. juni 2026** (3341bf6) og har
  stået forkert i ~3,5 måned.
- Vores historik indeholder **intet** spor af at nogen kendte fælden før i nat:
  ingen `release-gotcha`, ingen omtale af annoterede tags, intet.

Så enten filede en tidligere session tippet direkte til Discovery over HTTP
(hvilket ikke efterlader spor i repoet) uden at rette vores egen opskrift —
eller tippet blev filet i nat ud fra denne rapport og krediteret os. **Herfra kan
de to ikke skelnes**, og Discovery viser ingen dato på tips.

Det er værd at sige præcist, fordi components' konklusion hviler på hvilken af
dem der gælder: var tippet der i forvejen, var den fleet-vendte halvdel dækket;
blev det filet i nat, var den ikke.

**Deres lektie står uanset hvad, og den er bedre end fundet:**

> *At tippet er i rosteret betyder ikke at repoet er rettet — det er to
> forskellige tjek.*
