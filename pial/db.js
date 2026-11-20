"use strict";

/* =====================================================================
   PialDB — mini-module d'accès à IndexedDB, sans dépendance externe.
   Base "pial-suivi" :
     - rapports : keyPath "id" (id du rapport côté AESH, sert de clé de
       dédoublonnage). Index : eleveId, classe, aesh, modalite, relation,
       debut, creeJour, etablissement (v2 du schéma).
     - imports  : clé auto-incrémentée, un enregistrement par fichier de
       transmission importé (bilan + traçabilité).
     - v3 (module Affectations, docs/SPEC-affectations-PIAL.md §9.2) :
       etablissements, eleves, aesh, cours, affectations, versions,
       correspondances, parametres. Migration additive : rapports et
       imports ne sont jamais touchés.
     - v4 (spec §3, §9.2) : identifiant interne stable des élèves et des
       AESH (PialModele.migrerV4, dans la transaction de mise à niveau) ;
       index uniques eleves.anneeCle ([annee, cle]) et aesh.cle, index
       eleves.parcours. Rapports et imports ne sont pas touchés.
   API façon promesses, exposée sur l'objet global PialDB.
   ===================================================================== */
var PialDB = (function () {

  var NOM_BASE = "pial-suivi";
  var VERSION = 4;
  var promesseBase = null;

  // magasins du module Affectations : {nom: [keyPath, [index...]]}
  var MAGASINS_V3 = {
    etablissements: ["id", []],
    eleves: ["id", ["cle", "annee", "etablissement", "classe"]],
    aesh: ["id", ["annee"]],
    cours: ["id", ["eleveId", "eleveCle", "etablissement"]],
    affectations: ["id", ["version", "aeshId", "creneauCle"]],
    versions: ["numero", ["annee"]],
    correspondances: ["type", []],
    parametres: ["cle", []]
  };
  var NOMS_V3 = Object.keys(MAGASINS_V3);
  // magasins dont les identifiants changent en v4
  var MIGRES_V4 = ["eleves", "aesh", "cours", "affectations", "versions"];

  /* v3 -> v4, dans la transaction de mise à niveau : tout est relu, traduit
     par PialModele.migrerV4, puis réécrit. Une erreur abandonne la
     transaction : la base reste en v3, intacte. */
  function migrerVersV4(t) {
    var lu = {}, reste = MIGRES_V4.length;
    MIGRES_V4.forEach(function (nom) {
      var r = t.objectStore(nom).getAll();
      r.onsuccess = function () {
        lu[nom] = r.result;
        if (--reste) return;
        if (typeof PialModele === "undefined") { t.abort(); return; }
        var m = PialModele.migrerV4(lu);
        MIGRES_V4.forEach(function (n) {
          var s = t.objectStore(n);
          s.clear();
          m[n].forEach(function (o) { s.put(o); });
        });
        t.objectStore("parametres").put({ cle: "migrationV4", valeur: { date: new Date().toISOString(),
          eleves: m.eleves.length, aesh: m.aesh.length, cours: m.cours.length, affectations: m.affectations.length, versions: m.versions.length } });
      };
    });
  }
  function indexV4(t) {
    var el = t.objectStore("eleves"), ae = t.objectStore("aesh");
    if (!el.indexNames.contains("anneeCle")) el.createIndex("anneeCle", ["annee", "cle"], { unique: true });
    if (!el.indexNames.contains("parcours")) el.createIndex("parcours", "parcours", { unique: false });
    if (!ae.indexNames.contains("cle")) ae.createIndex("cle", "cle", { unique: true });
  }

  function ouvrir() {
    if (promesseBase) return promesseBase;
    promesseBase = new Promise(function (resolve, reject) {
      var req = indexedDB.open(NOM_BASE, VERSION);
      // un autre onglet garde la base ouverte dans l'ancienne version : la
      // mise à niveau attend sa fermeture
      req.onblocked = function () {
        if (typeof PialDB.surBlocage === "function") PialDB.surBlocage();
      };
      req.onupgradeneeded = function (evt) {
        var db = evt.target.result;
        var magasin;
        if (!db.objectStoreNames.contains("rapports")) {
          magasin = db.createObjectStore("rapports", { keyPath: "id" });
          magasin.createIndex("eleveId", "eleveId", { unique: false });
          magasin.createIndex("classe", "classe", { unique: false });
          magasin.createIndex("aesh", "aesh", { unique: false });
          magasin.createIndex("modalite", "modalite", { unique: false });
          magasin.createIndex("relation", "relation", { unique: false });
          magasin.createIndex("debut", "debut", { unique: false });
          magasin.createIndex("creeJour", "creeJour", { unique: false });
          magasin.createIndex("etablissement", "etablissement", { unique: false });
        } else {
          // migration v1 -> v2 : ajoute l'index etablissement sans toucher
          // aux données existantes (le champ etablissement existe déjà sur
          // chaque rapport stocké, seul l'index manquait).
          magasin = evt.target.transaction.objectStore("rapports");
          if (!magasin.indexNames.contains("etablissement")) {
            magasin.createIndex("etablissement", "etablissement", { unique: false });
          }
        }
        if (!db.objectStoreNames.contains("imports")) {
          db.createObjectStore("imports", { keyPath: "id", autoIncrement: true });
        }
        // migration v2 -> v3 : ajoute les magasins absents, rien d'autre
        NOMS_V3.forEach(function (nom) {
          if (db.objectStoreNames.contains(nom)) return;
          var m = db.createObjectStore(nom, { keyPath: MAGASINS_V3[nom][0] });
          MAGASINS_V3[nom][1].forEach(function (idx) { m.createIndex(idx, idx, { unique: false }); });
        });
        // v3 -> v4 : identifiants internes (une base plus ancienne n'a pas
        // encore d'élève ni d'AESH : seuls les index sont ajoutés)
        var t = evt.target.transaction;
        if (evt.oldVersion === 3) migrerVersV4(t);
        indexV4(t);
      };
      req.onsuccess = function () {
        var db = req.result;
        // un onglet plus récent demande une mise à niveau : on libère la base
        db.onversionchange = function () {
          db.close();
          promesseBase = null;
          if (typeof PialDB.surVersionPerimee === "function") PialDB.surVersionPerimee();
        };
        resolve(db);
      };
      req.onerror = function () { reject(req.error); };
    });
    return promesseBase;
  }

  function promesseRequete(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function promesseTransaction(t) {
    return new Promise(function (resolve, reject) {
      // n'écoute pas "error" : un add() en doublon (dédoublonnage import) fait
      // remonter un événement d'erreur sur la transaction même quand son
      // preventDefault() a déjà empêché l'abandon — seul "abort" signale un
      // échec réel.
      t.oncomplete = function () { resolve(); };
      t.onabort = function () { reject(t.error); };
    });
  }

  /* ---------- import ---------- */

  // vérifie la forme minimale d'un rapport transmis, renvoie l'enregistrement
  // normalisé à stocker, ou null si la structure est invalide.
  // En v1, l'établissement est un champ unique porté par l'enveloppe ; en
  // v2, chaque rapport porte le sien (issu de la fiche élève côté AESH). On
  // normalise les deux vers le même champ "etablissement" du rapport stocké
  // pour que le reste du code n'ait pas à distinguer les deux formats.
  function normaliserRapport(r, enveloppe, nomFichier) {
    if (!r || typeof r !== "object") return null;
    if (!r.id || !r.eleveId) return null;
    var etablissement = enveloppe.format === "suivi-aesh/2" ? (r.etablissement || "") : (enveloppe.etablissement || "");
    return {
      id: r.id, eleveId: r.eleveId, eleveNom: r.eleveNom || "",
      classe: r.classe || "", heures: r.heures || "",
      periode: r.periode || "", debut: r.debut || "", fin: r.fin || "",
      periodeTexte: r.periodeTexte || "",
      modalite: r.modalite || "", copartage: r.copartage || 0,
      relation: r.relation || "",
      invest: r.invest || { tendance: "", items: {} },
      accomp: Array.isArray(r.accomp) ? r.accomp : [],
      matieres: Array.isArray(r.matieres) ? r.matieres : [],
      commentaire: r.commentaire || "",
      creeJour: r.creeJour || "",
      aesh: enveloppe.aesh || "", etablissement: etablissement,
      importeLe: new Date().toISOString(), sourceFichier: nomFichier || ""
    };
  }

  // tente d'ajouter un rapport dans la transaction en cours ; résout avec
  // "ajoute" | "connu" (id déjà présent) | "ignore" (erreur imprévue).
  function tenterAjout(t, rapport) {
    return new Promise(function (resolve) {
      var req;
      try { req = t.objectStore("rapports").add(rapport); }
      catch (e) { resolve("ignore"); return; }
      req.onsuccess = function () { resolve("ajoute"); };
      req.onerror = function (evt) {
        evt.preventDefault(); // empêche l'abandon de la transaction
        resolve(req.error && req.error.name === "ConstraintError" ? "connu" : "ignore");
      };
    });
  }

  // importe une enveloppe de transmission ({format, aesh, etablissement(s), rapports, ...}).
  // accepte suivi-aesh/1 (établissement unique porté par l'enveloppe) et
  // suivi-aesh/2 (établissement par rapport, enveloppe.etablissements pour
  // information). Rejette si le format n'est pas reconnu. Résout avec
  // {ajoutes, connus, ignores}.
  function importerFichier(enveloppe, nomFichier) {
    if (!enveloppe || (enveloppe.format !== "suivi-aesh/1" && enveloppe.format !== "suivi-aesh/2")) {
      return Promise.reject(new Error("format-inconnu"));
    }
    return ouvrir().then(function (db) {
      var t = db.transaction(["rapports", "imports"], "readwrite");
      var compte = { ajoutes: 0, connus: 0, ignores: 0 };
      var liste = Array.isArray(enveloppe.rapports) ? enveloppe.rapports : [];
      var promesses = liste.map(function (brut) {
        var rapport = normaliserRapport(brut, enveloppe, nomFichier);
        if (!rapport) { compte.ignores++; return Promise.resolve(); }
        return tenterAjout(t, rapport).then(function (resultat) {
          if (resultat === "ajoute") compte.ajoutes++;
          else if (resultat === "connu") compte.connus++;
          else compte.ignores++;
        });
      });
      return Promise.all(promesses).then(function () {
        var etablissementImport = enveloppe.etablissement
          || (Array.isArray(enveloppe.etablissements) ? enveloppe.etablissements.join(", ") : "");
        t.objectStore("imports").add({
          nomFichier: nomFichier || "", aesh: enveloppe.aesh || "",
          etablissement: etablissementImport, genereLe: enveloppe.genere_le || "",
          periode: enveloppe.periode || null,
          nbAjoutes: compte.ajoutes, nbConnus: compte.connus, nbIgnores: compte.ignores,
          importeLe: new Date().toISOString()
        });
        return promesseTransaction(t).then(function () { return compte; });
      });
    });
  }

  /* ---------- lecture ---------- */

  function tousLesRapports() {
    return ouvrir().then(function (db) {
      return promesseRequete(db.transaction("rapports", "readonly").objectStore("rapports").getAll());
    });
  }

  function tousLesImports() {
    return ouvrir().then(function (db) {
      return promesseRequete(db.transaction("imports", "readonly").objectStore("imports").getAll());
    });
  }

  // fiche élève agrégée : tous les rapports d'un élève, triés par date,
  // récupérés via l'index eleveId et un curseur (pas un scan de tout le magasin).
  function rapportsDeEleve(eleveId) {
    return ouvrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var resultats = [];
        var index = db.transaction("rapports", "readonly").objectStore("rapports").index("eleveId");
        var req = index.openCursor(IDBKeyRange.only(eleveId));
        req.onsuccess = function (evt) {
          var curseur = evt.target.result;
          if (curseur) { resultats.push(curseur.value); curseur.continue(); }
          else {
            resultats.sort(function (a, b) { return (a.creeJour || "").localeCompare(b.creeJour || ""); });
            resolve(resultats);
          }
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /* ---------- suppression ---------- */

  // purge par curseur : supprime tout rapport pour lequel predicat(rapport)
  // renvoie true. Renvoie le nombre de rapports supprimés.
  function purgerAvecPredicat(predicat) {
    return ouvrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var supprimes = 0;
        var magasin = db.transaction("rapports", "readwrite").objectStore("rapports");
        var req = magasin.openCursor();
        req.onsuccess = function (evt) {
          var curseur = evt.target.result;
          if (!curseur) { resolve(supprimes); return; }
          if (predicat(curseur.value)) { curseur.delete(); supprimes++; }
          curseur.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // purge tous les rapports d'un élève (curseur sur l'index eleveId) —
  // utilisé quand un élève quitte le PIAL. Renvoie le nombre supprimé.
  function purgerParEleve(eleveId) {
    return ouvrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var supprimes = 0;
        var index = db.transaction("rapports", "readwrite").objectStore("rapports").index("eleveId");
        var req = index.openCursor(IDBKeyRange.only(eleveId));
        req.onsuccess = function (evt) {
          var curseur = evt.target.result;
          if (!curseur) { resolve(supprimes); return; }
          curseur.delete();
          supprimes++;
          curseur.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /* ---------- module Affectations : accès génériques ---------- */

  function tous(magasin) {
    return ouvrir().then(function (db) {
      return promesseRequete(db.transaction(magasin, "readonly").objectStore(magasin).getAll());
    });
  }
  function obtenir(magasin, cle) {
    return ouvrir().then(function (db) {
      return promesseRequete(db.transaction(magasin, "readonly").objectStore(magasin).get(cle));
    });
  }

  /* applique plusieurs opérations en UNE transaction (tout ou rien) :
     [{magasin, vider: bool, supprimer: [clés], enregistrer: [objets]}],
     exécutées dans cet ordre pour chaque opération. */
  function appliquer(operations) {
    var noms = [];
    operations.forEach(function (op) { if (noms.indexOf(op.magasin) < 0) noms.push(op.magasin); });
    if (!noms.length) return Promise.resolve();
    return ouvrir().then(function (db) {
      var t = db.transaction(noms, "readwrite");
      operations.forEach(function (op) {
        var m = t.objectStore(op.magasin);
        if (op.vider) m.clear();
        (op.supprimer || []).forEach(function (cle) { m.delete(cle); });
        (op.enregistrer || []).forEach(function (o) { m.put(o); });
      });
      return promesseTransaction(t);
    });
  }

  /* ---------- sauvegarde / restauration ---------- */

  // {rapports, imports, <magasins v3>...}
  function exporterTout() {
    return Promise.all([tousLesRapports(), tousLesImports()].concat(NOMS_V3.map(tous))).then(function (r) {
      var out = { rapports: r[0], imports: r[1] };
      NOMS_V3.forEach(function (nom, i) { out[nom] = r[i + 2]; });
      return out;
    });
  }

  /* ---------- avant la mise à niveau v3 -> v4 ---------- */

  // ouvre la base dans sa version actuelle, sans la mettre à niveau
  function ouvrirSansMiseANiveau() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(NOM_BASE);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  /* la base doit-elle être migrée (v3 avec des élèves, des AESH ou des
     affectations) ? Résout avec {aMigrer, version, compteurs} ; ne
     modifie rien (une base absente est créée vide, sans magasin). */
  function etatMiseANiveau() {
    return ouvrirSansMiseANiveau().then(function (db) {
      return new Promise(function (resolve) {
        var v = db.version, noms = ["eleves", "aesh", "affectations", "versions"];
        if (v !== 3 || noms.some(function (n) { return !db.objectStoreNames.contains(n); })) { db.close(); resolve({ aMigrer: false, version: v }); return; }
        var t = db.transaction(noms, "readonly"), c = {};
        noms.forEach(function (n) { var r = t.objectStore(n).count(); r.onsuccess = function () { c[n] = r.result; }; });
        t.oncomplete = function () { db.close(); resolve({ aMigrer: c.eleves + c.aesh + c.affectations > 0, version: v, compteurs: c }); };
        t.onabort = function () { db.close(); resolve({ aMigrer: false, version: v }); };
      });
    }, function () { return { aMigrer: false }; });
  }
  // tout le contenu de la base dans sa version actuelle (sauvegarde avant migration)
  function exporterAvantMiseANiveau() {
    return ouvrirSansMiseANiveau().then(function (db) {
      var noms = ["rapports", "imports"].concat(NOMS_V3).filter(function (n) { return db.objectStoreNames.contains(n); });
      return new Promise(function (resolve, reject) {
        var t = db.transaction(noms, "readonly"), out = {};
        noms.forEach(function (n) { var r = t.objectStore(n).getAll(); r.onsuccess = function () { out[n] = r.result; }; });
        t.oncomplete = function () { db.close(); resolve(out); };
        t.onabort = function () { db.close(); reject(t.error); };
      });
    });
  }

  // remplace intégralement le contenu de la base (pas de fusion). Un
  // magasin absent de "donnees" (sauvegarde pial-suivi/1, antérieure au
  // module Affectations) est laissé tel quel plutôt que vidé.
  function remplacerTout(donnees) {
    return ouvrir().then(function (db) {
      var noms = ["rapports", "imports"].concat(NOMS_V3.filter(function (n) { return Array.isArray(donnees[n]); }));
      var t = db.transaction(noms, "readwrite");
      noms.forEach(function (nom) {
        var m = t.objectStore(nom);
        m.clear();
        (donnees[nom] || []).forEach(function (o) { m.put(o); });
      });
      return promesseTransaction(t);
    });
  }

  return {
    MAGASINS_AFFECTATIONS: NOMS_V3,
    tous: tous,
    obtenir: obtenir,
    appliquer: appliquer,
    importerFichier: importerFichier,
    tousLesRapports: tousLesRapports,
    tousLesImports: tousLesImports,
    rapportsDeEleve: rapportsDeEleve,
    purgerAvecPredicat: purgerAvecPredicat,
    purgerParEleve: purgerParEleve,
    exporterTout: exporterTout,
    etatMiseANiveau: etatMiseANiveau,
    exporterAvantMiseANiveau: exporterAvantMiseANiveau,
    remplacerTout: remplacerTout
  };
})();
