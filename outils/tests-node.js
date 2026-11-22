"use strict";

/* =====================================================================
   Lance en ligne de commande les tests de pial/tests.js — exactement les
   mêmes assertions que pial/tests.html dans le navigateur.

   Usage (Node 22 ou plus récent, sans npm) :
     node outils/tests-node.js

   Code de sortie 0 si tout passe, 1 sinon.
   ===================================================================== */

var fs = require("fs");
var path = require("path");

var RACINE = path.join(__dirname, "..");
function charger(relatif) {
  var chemin = path.join(RACINE, relatif);
  return fs.existsSync(chemin) ? require(chemin) : null;
}

var PialTests = charger("pial/tests.js");
var env = {
  modele: charger("pial/modele.js"),
  zip: charger("pial/zip.js"),
  importFichiers: charger("pial/import-fichiers.js"),
  moteur: charger("pial/moteur.js"),
  chiffrement: charger("pial/chiffrement.js"),
  rapprochement: charger("rapprochement.js"),
  dossier: charger("pial/dossier.js"),
  statsAff: charger("pial/stats-affectations.js"),
  lireExemple: function (nom) {
    var chemin = path.join(RACINE, "exemples", nom);
    return Promise.resolve(fs.existsSync(chemin) ? new Uint8Array(fs.readFileSync(chemin)) : null);
  }
};

PialTests.executer(env).then(function (bilan) {
  var groupe = "";
  bilan.lignes.forEach(function (l) {
    if (l.groupe !== groupe) { groupe = l.groupe; console.log("\n[" + groupe + "]"); }
    var marque = l.etat === "ok" ? "  ok    " : (l.etat === "ignore" ? "  --    " : "  ÉCHEC ");
    console.log(marque + l.nom + (l.message ? "\n          " + l.message : ""));
  });
  // fonction supprimée mais encore appelée, identifiant HTML disparu (garde-fou statique)
  var apl = require("./verifier-appels.js").executer();
  console.log("\n[appels et identifiants]");
  apl.lignes.forEach(function (l) { console.log((l.etat === "ok" ? "  ok    " : "  ÉCHEC ") + l.nom + (l.message ? "\n          " + l.message : "")); });
  // test de fumée : chaque onglet de l'espace PIAL et chaque vue de l'application AESH s'ouvrent sans exception
  return require("./test-fumee.js").executer().then(function (fum) {
    console.log("\n[test de fumée : les deux applications exécutées]");
    fum.lignes.forEach(function (l) { console.log((l.etat === "ok" ? "  ok    " : "  ÉCHEC ") + l.nom + (l.message ? "\n          " + l.message : "")); });
    var echecs = bilan.echecs.length + apl.echecs + fum.echecs;
    console.log("\n" + (bilan.reussis + apl.reussis + fum.reussis) + " réussi(s), " + echecs + " échec(s), " + bilan.ignores + " ignoré(s).");
    process.exitCode = echecs ? 1 : 0;
  });
}).then(null, function (err) {
  console.error(err);
  process.exitCode = 1;
});
