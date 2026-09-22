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
