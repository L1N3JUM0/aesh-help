# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Aucune dépendance externe : ni CDN, ni police, ni script tiers, ni requête réseau à l'exécution. L'app doit fonctionner entièrement hors ligne et ne jamais contacter un serveur autre que celui qui sert ses propres fichiers statiques.**

## What this is

"Suivi AESH" — a French-language single-page web app for AESH (school teaching assistants in France) to record student profiles and write periodic accompaniment reports (rapports d'accompagnement), then export/print/email them. Entirely client-side, no backend, no build step.

## Repository structure

The application logic — HTML, CSS, and JavaScript — lives in one file: `index.html`. There is no `package.json`, no bundler, no framework, and no test suite. Around it sit the PWA assets needed for installability and offline use:

- `manifest.webmanifest` — app name/icons/theme for "Add to Home Screen".
- `service-worker.js` — caches the app shell for offline use (see "PWA / mode hors ligne" below).
- `icons/icon.svg` — the source icon (hand-written SVG); `icons/icon-192.png` and `icons/icon-512.png` are PNGs rendered from that same design for manifest/favicon/apple-touch-icon use.

To work on this project, edit `index.html` (and, for icon changes, `icons/icon.svg` plus regenerated PNGs) directly.

## Running / testing

There is no build or install step. To try changes, open `index.html` directly in a browser (or serve the directory with any static file server, e.g. `python -m http.server`) — verify changes manually, there is no automated test runner. Note that the service worker only registers over `http(s)://`; when opened via `file://` it is skipped and the app must still work exactly the same (see below). When testing the service worker/offline behavior, serve over `http(s)://` and remember the browser cache: after editing cached files, bump `CACHE_VERSION` in `service-worker.js` and hard-reload (or unregister the old worker) to see changes.

## PWA / mode hors ligne

- `manifest.webmanifest` and `service-worker.js` are registered/referenced with **relative paths** (no leading `/`) because the site is published as a GitHub Pages *project* page at `https://l1n3jum0.github.io/aesh-help/`, not at a domain root. Root-absolute paths (`/manifest.webmanifest`, etc.) would 404 there. Keep every new asset reference relative.
- Service worker registration in `index.html` is guarded with `location.protocol!=="file:"`: opening `index.html` by double-clicking it (no server) must keep working exactly as before, without a service worker or install prompt.
- `service-worker.js` precaches a fixed file list (`FICHIERS`) and serves cache-first, with a same-origin runtime fill-in and an offline navigation fallback to the cached `index.html`. **Bump `CACHE_VERSION` at the top of `service-worker.js` on every deploy that changes any cached file** — the `activate` handler deletes old-versioned caches automatically, this is the only mechanism that pushes updates to already-installed users.
- If you add a new static asset that the app shell depends on (a new icon size, a new file), add it to `FICHIERS` in `service-worker.js` too, or it won't be available offline.

## Architecture

The script is a single IIFE at the bottom of `index.html`, organized into clearly commented sections (search for `/* =============== ... =============== */`):

- **stockage (storage)** — all app state lives in one object `db`, persisted as a single JSON blob to `localStorage` under the key `suivi-aesh-v1` (falls back to an in-memory object if `localStorage` is unavailable, e.g. private browsing). `db` holds `reglages` (settings), `eleves` (students), `rapports` (reports), and user-added custom option lists `matieresPerso`/`accompPerso`. Every mutation is followed by a call to `sauver()`.
- **navigation** — a simple view switcher: five top-level `<section>` views (`vue-eleves`, `vue-fiche`, `vue-rapport`, `vue-apercu`, `vue-reglages`) are shown/hidden by toggling a `.masque` class via `vue(nom)`. There is no router/history management; "back" buttons call fixed handlers.
- **pastilles (pill selectors)** — `pastilles(hote, valeurs, options)` is the one reusable UI primitive in this app: it renders a set of toggle buttons into a container element and returns a `{get, set, ajouter}` controller. Supports single- or multi-select (`options.multi`) and an `onChange` callback. Used throughout for modality, period, relation quality, subjects, and accompaniment-type pickers. When adding a new choice field, reuse this helper rather than writing bespoke button logic.
- **data flow**: Élève (student) profiles are created/edited in `vue-fiche` and store defaults (subjects, modality) that pre-fill each new Rapport (report) in `vue-rapport`. Submitting a report (`r-apercu`) builds a report object, pushes it to `db.rapports` (capped at the 200 most recent), saves, and renders it read-only in `vue-apercu`.
- **export paths** — from the report preview, a report can be: emailed via a `mailto:` link to the configured PIAL coordinator address, printed via `window.print()` (see the `@media print` CSS block, which hides chrome and reveals a `.signature` block), downloaded as plain text (`texteBrut()` builds the `.txt` content), or copied to the clipboard.
- **backup/restore** — Réglages → « Sauvegarder mes données » exports the whole `db` wrapped in a versioned envelope `{format:"suivi-aesh-backup/1", exporte_le, compteurs, donnees}` (`sauvegarder()`); this is distinct from the PIAL transmission format `suivi-aesh/N`, which is partial (no surname, no notes). « Restaurer une sauvegarde » validates `format` (`analyserSauvegarde()`, also accepts legacy headerless exports), then lets the user pick Remplacer (overwrite) or Fusionner (`fusionner()`: dedup by `id`, an existing élève/rapport is replaced only if the backup copy has a strictly newer `modifie`/`cree`; nothing is deleted), behind a `confirmationForte` showing exact counts. Raw data from storage or files goes through `normaliser()`. `reglages.derniereSauvegarde` drives the 30-day reminder on Mes élèves. « Reconstruire depuis une transmission » rebuilds élève fiches (flagged `reconstruite`) from a `transmission_*.json`. At startup `navigator.storage.persist()` is requested (never blocking; refusal shows a banner in Réglages).

## Conventions to preserve

- **Data never leaves the device.** All app data lives in `localStorage` (with an in-memory fallback) on the user's own device; nothing is sent to a server. This is the core privacy promise of the app for AESH handling data on children with disabilities — do not add analytics, remote sync, telemetry, or any `fetch`/`XMLHttpRequest`/`navigator.sendBeacon` call that transmits app data over the network. Browser-initiated loading/caching of the app's own static files (by the service worker) is fine; the rule is about data, not about the initial page/asset load.
- **No framework, no external dependency.** No build step, no npm packages, no CDN-hosted libraries (JS or CSS) — everything ships as plain files in this repo.
- **All interface text is in French**, in the existing direct tone (addressed to a single AESH professional). Keep new UI copy consistent with this.
- **Must keep working when `index.html` is opened alone** (double-clicked, `file://`, no server, no service worker) — this is the fallback for anyone who can't or doesn't want to install the PWA. Any new feature must degrade gracefully rather than break under `file://` (see the existing `stockageOk` localStorage fallback and the service worker's `file:` guard for the pattern to follow).
- Vanilla ES5-style JS (`var`, `function`, no arrow functions/`let`/`const`, no modules) — match this style rather than introducing modern syntax.
- User-facing text inserted into `innerHTML` should be escaped where it originates from free text fields (see the `.replace(/</g,"&lt;")` pattern used for the comment field) to avoid breaking the markup.

## Module Affectations (espace PIAL)

La spécification fait foi : `docs/SPEC-affectations-PIAL.md`. Lire la section concernée avant toute modification de `/pial/`. Les règles de calcul vivent dans `pial/modele.js` (fonctions pures) et doivent rester couvertes par `pial/tests.html`. Les noms des données d'exemple (`exemples/`) sont fictifs. Ne jamais y mettre de données réelles.

- Fichiers : `pial/modele.js` (règles pures), `pial/moteur.js` (proposition gloutonne et déterministe, score et raisons, rapport de fin ; pur, `POIDS` regroupe les poids du score), `pial/zip.js` (ZIP lecture/écriture), `pial/import-fichiers.js` (CSV/XLSX, correspondance, aperçu — pur, sans DOM), `pial/affectations.js` (état du module + interface : import, réglages d'établissement, onglet Affectations), `pial/db.js` (IndexedDB `pial-suivi`, schéma v3, migration additive). Ces fichiers exposent un global (`PialModele`, `PialMoteur`, `PialZip`, `PialImport`…) et, pour les modules purs, `module.exports` afin d'être chargés par Node.
- Brouillon (affectations `version` = 0), versions validées (copies `version` = numéro, magasin `versions`), pile d'annulation de 20 actions en mémoire (`operationsInverses` dans `modele.js`). Réglage « Gérer les temps périscolaires » décoché par défaut : il conditionne l'import des colonnes Récréation / Pause méridienne et tout le périscolaire.
- Tests : les assertions sont dans `pial/tests.js`, partagé par `pial/tests.html` (navigateur ; en `file://` les tests sur les fichiers d'exemple sont ignorés) et `node outils/tests-node.js` (Node ≥ 22, sans npm, code de sortie 1 en cas d'échec). Lancer `node outils/tests-node.js` avant chaque commit touchant `/pial/`.
- Données d'exemple : régénérées par `node outils/generer-exemples.js [AAAA-MM-JJ]` (déterministe ; les dates dépendent de la date de référence). `exemples/FICTIF_*` est marqué `-text` dans `.gitattributes` pour conserver les octets exacts (Windows-1252, CRLF, XLSX). Déroulé de démonstration : `exemples/SCENARIO-DEMO.md`. `node outils/rapport-moteur.js` affiche le rapport du moteur sur les exemples (couverture, motifs, temps de calcul, comparaison avec le renfort `FICTIF_aesh_renfort.csv`).
- L'espace PIAL est installable à part : `pial/manifest.webmanifest` (portée `pial/`, icônes `icons/icon-pial-*.png` = même dessin sur fond vert, source `icons/icon-pial.svg`), lien inséré seulement hors `file:`.
- `pial/index.html` enregistre lui aussi `../service-worker.js` (même garde `file:`) ; tous les fichiers de `/pial/` nécessaires à l'app sont dans `FICHIERS`, et le service worker ne met jamais en cache `exemples/` ni `outils/`.
