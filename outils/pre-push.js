"use strict";

/* =====================================================================
   Logique du hook git « pre-push » (installé par outils/installer-hooks.js).

   Pour chaque commit qui va être poussé, extrait CE commit dans un dossier
   temporaire (git worktree) et y lance `node outils/tests-node.js`. On teste
   donc exactement ce qui sera publié, même quand on pousse un commit qui
   n'est pas le dernier (git push origin <hash>:main) et que le dossier de
   travail contient autre chose.

   Un échec bloque le push (code de sortie 1). Pour passer outre en connaissance
   de cause : git push --no-verify.

   Git fournit sur l'entrée standard une ligne par référence poussée :
     <réf locale> <hash local> <réf distante> <hash distant>
   ===================================================================== */

var fs = require("fs");
var os = require("os");
var path = require("path");
var cp = require("child_process");

var NUL = /^0+$/;

function git(args, options) {
  return cp.spawnSync("git", args, Object.assign({ encoding: "utf8" }, options || {}));
}
function envSansGit() {
  var e = {};
  Object.keys(process.env).forEach(function (k) { if (!/^GIT_/.test(k)) e[k] = process.env[k]; });
  return e;
}

/* teste un commit ; renvoie {ok, ignore, sortie} */
function tester(racine, hash) {
  var dossier = fs.mkdtempSync(path.join(os.tmpdir(), "pre-push-"));
  var ajout = git(["worktree", "add", "--detach", "--force", dossier, hash], { cwd: racine });
  if (ajout.status !== 0) {
    fs.rmSync(dossier, { recursive: true, force: true });
    return { ok: false, sortie: "impossible d'extraire le commit " + hash.slice(0, 7) + " :\n" + (ajout.stderr || ajout.stdout) };
  }
  try {
    if (!fs.existsSync(path.join(dossier, "outils", "tests-node.js"))) return { ok: true, ignore: true };
    var r = cp.spawnSync(process.execPath, [path.join("outils", "tests-node.js")], { cwd: dossier, encoding: "utf8", env: envSansGit(), maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, sortie: String(r.stdout || "") + String(r.stderr || "") };
  } finally {
    git(["worktree", "remove", "--force", dossier], { cwd: racine });
    fs.rmSync(dossier, { recursive: true, force: true });
    git(["worktree", "prune"], { cwd: racine });
  }
}

/* extrait l'essentiel d'une sortie de tests : les échecs (avec leur message) et la ligne de total */
function resume(sortie) {
  var lignes = sortie.split("\n"), out = [];
  for (var i = 0; i < lignes.length; i++) {
    if (/ÉCHEC/.test(lignes[i])) {
      out.push(lignes[i]);
      while (i + 1 < lignes.length && /^\s{6,}\S/.test(lignes[i + 1])) out.push(lignes[++i]);
    } else if (/réussi\(s\)/.test(lignes[i]) || /^Error|^\w*Error:/.test(lignes[i])) out.push(lignes[i]);
  }
  return out.join("\n");
}

function principal() {
  var racine = git(["rev-parse", "--show-toplevel"]).stdout.trim();
  if (!racine) { console.error("pre-push : dépôt git introuvable."); return 1; }
  var entree = "";
  try { entree = fs.readFileSync(0, "utf8"); } catch (e) { /* aucune entrée : rien à pousser */ }
  var hashs = [];
  entree.split("\n").forEach(function (l) {
    var p = l.trim().split(/\s+/);
    if (p.length >= 2 && !NUL.test(p[1]) && hashs.indexOf(p[1]) < 0) hashs.push(p[1]);   // un hash tout à zéro = suppression de branche
  });
  var echec = false;
  hashs.forEach(function (h) {
    console.error("pre-push : tests du commit " + h.slice(0, 7) + " (celui qui sera publié)…");
    var r = tester(racine, h);
    if (r.ignore) { console.error("pre-push : ce commit n'a pas de outils/tests-node.js, aucun test lancé."); return; }
    if (r.ok) { console.error("pre-push : " + (resume(r.sortie).split("\n").pop() || "tests réussis") + " — push autorisé."); return; }
    echec = true;
    console.error("\npre-push : ÉCHEC des tests sur le commit " + h.slice(0, 7) + " — push BLOQUÉ.\n" + (resume(r.sortie) || r.sortie.slice(-2000)));
  });
  if (echec) console.error("\nCorrigez puis recommencez. Pour passer outre en connaissance de cause : git push --no-verify");
  return echec ? 1 : 0;
}

module.exports = { principal: principal, resume: resume };

if (require.main === module) process.exitCode = principal();
