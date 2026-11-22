"use strict";

/* =====================================================================
   Installe le hook git « pre-push » de ce dépôt : avant chaque push, les
   tests (node outils/tests-node.js) sont lancés sur le commit poussé ; un
   échec bloque le push.

   Les hooks de .git/hooks ne sont pas versionnés : à lancer une fois par
   copie du dépôt (cloner à nouveau = relancer).

     node outils/installer-hooks.js              installe (ou met à jour)
     node outils/installer-hooks.js --verifier   dit si le hook est installé
     node outils/installer-hooks.js --retirer    supprime le hook installé ici

   Le hook installé est un petit script fixe qui appelle outils/pre-push.js :
   la logique reste versionnée et se met à jour avec le dépôt, sans
   réinstallation. Un autre hook pre-push déjà présent n'est jamais écrasé
   sans --forcer.
   ===================================================================== */

var fs = require("fs");
var path = require("path");
var cp = require("child_process");

var MARQUE = "# installé par outils/installer-hooks.js";
var CONTENU = [
  "#!/bin/sh",
  MARQUE + " (ne pas modifier : la logique est dans outils/pre-push.js)",
  "racine=$(git rev-parse --show-toplevel) || exit 1",
  "if ! command -v node >/dev/null 2>&1; then",
  "  echo \"pre-push : node est introuvable, les tests ne peuvent pas être lancés — push bloqué (git push --no-verify pour passer outre).\" >&2",
  "  exit 1",
  "fi",
  "exec node \"$racine/outils/pre-push.js\"",
  ""
].join("\n");

function cheminHook() {
  var r = cp.spawnSync("git", ["rev-parse", "--git-path", "hooks/pre-push"], { encoding: "utf8", cwd: path.join(__dirname, "..") });
  if (r.status !== 0) throw new Error("ce dossier n'est pas un dépôt git : " + (r.stderr || "").trim());
  return path.resolve(path.join(__dirname, ".."), r.stdout.trim());
}

function principal(args) {
  var chemin = cheminHook(), existe = fs.existsSync(chemin), actuel = existe ? fs.readFileSync(chemin, "utf8") : "";
  var nous = actuel.indexOf(MARQUE) >= 0;
  if (args.indexOf("--verifier") >= 0) {
    console.log(nous ? "Le hook pre-push est installé : " + chemin : (existe ? "Un AUTRE hook pre-push est présent (non installé par ce script) : " + chemin : "Aucun hook pre-push installé."));
    return nous ? 0 : 1;
  }
  if (args.indexOf("--retirer") >= 0) {
    if (nous) { fs.unlinkSync(chemin); console.log("Hook pre-push retiré."); } else console.log("Rien à retirer (aucun hook installé par ce script).");
    return 0;
  }
  if (existe && !nous && args.indexOf("--forcer") < 0) {
    console.error("Un hook pre-push existe déjà et n'a pas été installé par ce script : " + chemin + "\nIl n'est pas écrasé. Relancez avec --forcer pour le remplacer.");
    return 1;
  }
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, CONTENU, { mode: 493 });   // 0755
  try { fs.chmodSync(chemin, 493); } catch (e) { /* Windows : sans objet */ }
  console.log((nous ? "Hook pre-push mis à jour : " : "Hook pre-push installé : ") + chemin
    + "\nAvant chaque push, les tests sont lancés sur le commit poussé ; un échec bloque le push (git push --no-verify pour passer outre).");
  return 0;
}

module.exports = { principal: principal, CONTENU: CONTENU, MARQUE: MARQUE };

if (require.main === module) process.exitCode = principal(process.argv.slice(2));
