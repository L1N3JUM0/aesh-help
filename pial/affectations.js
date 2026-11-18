"use strict";

/* =====================================================================
   PialAffectations — module « Affectations » de l'espace PIAL
   (docs/SPEC-affectations-PIAL.md).

   Ce fichier tient l'état en mémoire du module (chargé depuis IndexedDB
   via PialDB) et l'interface : import des fichiers élèves / AESH /
   emplois du temps, paramètres des établissements, onglet Affectations.
   Toutes les règles de calcul sont dans modele.js (fonctions pures).
   ===================================================================== */
var PialAffectations = (function () {

  var M = PialModele;

  /* =============== état en mémoire =============== */
  var etat = {
    etablissements: [], eleves: [], aesh: [], cours: [],
    affectations: [],          // brouillon (version 0) uniquement
    versions: [], correspondances: {}, reglages: {}
  };

  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function anneeCourante() { return M.anneeScolaire(aujourdhui()); }

  function recharger() {
    return Promise.all(PialDB.MAGASINS_AFFECTATIONS.map(PialDB.tous)).then(function (r) {
      var parNom = {};
      PialDB.MAGASINS_AFFECTATIONS.forEach(function (nom, i) { parNom[nom] = r[i] || []; });
      var annee = anneeCourante();
      etat.etablissements = parNom.etablissements;
      etat.eleves = parNom.eleves.filter(function (e) { return e.annee === annee; });
      etat.aesh = parNom.aesh;
      etat.cours = parNom.cours.filter(function (c) { return c.annee === annee; });
      etat.affectations = parNom.affectations.filter(function (a) { return a.version === 0 && a.annee === annee; });
      etat.versions = parNom.versions;
      etat.correspondances = {};
      parNom.correspondances.forEach(function (c) { etat.correspondances[c.type] = c.colonnes; });
      var reg = parNom.parametres.filter(function (p) { return p.cle === "reglages"; })[0];
      etat.reglages = (reg && reg.valeur) || {};
    });
  }

  function compteurs() {
    return { eleves: etat.eleves.length, aesh: etat.aesh.length, cours: etat.cours.length, affectations: etat.affectations.length };
  }

  function contexte() {
    return M.contexte({
      etablissements: etat.etablissements, eleves: etat.eleves, aesh: etat.aesh,
      cours: etat.cours, affectations: etat.affectations, reglages: etat.reglages
    });
  }

  return {
    etat: etat, recharger: recharger, compteurs: compteurs, contexte: contexte,
    anneeCourante: anneeCourante, aujourdhui: aujourdhui
  };
})();
