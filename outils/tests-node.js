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
  console.log("\n" + bilan.reussis + " réussi(s), " + bilan.echecs.length + " échec(s), " + bilan.ignores + " ignoré(s).");
  process.exitCode = bilan.echecs.length ? 1 : 0;
}, function (err) {
  console.error(err);
  process.exitCode = 1;
});
