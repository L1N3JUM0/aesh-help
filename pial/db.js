"use strict";

/* =====================================================================
   PialDB — mini-module d'accès à IndexedDB, sans dépendance externe.
   Base "pial-suivi", deux object stores :
     - rapports : keyPath "id" (id du rapport côté AESH, sert de clé de
       dédoublonnage). Index : eleveId, classe, aesh, modalite, relation,
       debut, creeJour.
     - imports  : clé auto-incrémentée, un enregistrement par fichier de
       transmission importé (bilan + traçabilité).
   API façon promesses, exposée sur l'objet global PialDB.
   ===================================================================== */
var PialDB = (function () {

  var NOM_BASE = "pial-suivi";
  var VERSION = 1;
  var promesseBase = null;

  function ouvrir() {
    if (promesseBase) return promesseBase;
    promesseBase = new Promise(function (resolve, reject) {
      var req = indexedDB.open(NOM_BASE, VERSION);
      req.onupgradeneeded = function (evt) {
        var db = evt.target.result;
        if (!db.objectStoreNames.contains("rapports")) {
          var magasin = db.createObjectStore("rapports", { keyPath: "id" });
          magasin.createIndex("eleveId", "eleveId", { unique: false });
          magasin.createIndex("classe", "classe", { unique: false });
          magasin.createIndex("aesh", "aesh", { unique: false });
          magasin.createIndex("modalite", "modalite", { unique: false });
          magasin.createIndex("relation", "relation", { unique: false });
          magasin.createIndex("debut", "debut", { unique: false });
          magasin.createIndex("creeJour", "creeJour", { unique: false });
        }
        if (!db.objectStoreNames.contains("imports")) {
          db.createObjectStore("imports", { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
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
  function normaliserRapport(r, enveloppe, nomFichier) {
    if (!r || typeof r !== "object") return null;
    if (!r.id || !r.eleveId) return null;
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
      aesh: enveloppe.aesh || "", etablissement: enveloppe.etablissement || "",
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

  // importe une enveloppe de transmission ({format, aesh, etablissement, rapports, ...}).
  // rejette si le format n'est pas reconnu. Résout avec {ajoutes, connus, ignores}.
  function importerFichier(enveloppe, nomFichier) {
    if (!enveloppe || enveloppe.format !== "suivi-aesh/1") {
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
        t.objectStore("imports").add({
          nomFichier: nomFichier || "", aesh: enveloppe.aesh || "",
          etablissement: enveloppe.etablissement || "", genereLe: enveloppe.genere_le || "",
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

  /* ---------- sauvegarde / restauration ---------- */

  function exporterTout() {
    return Promise.all([tousLesRapports(), tousLesImports()]).then(function (r) {
      return { rapports: r[0], imports: r[1] };
    });
  }

  // remplace intégralement le contenu de la base (pas de fusion).
  function remplacerTout(donnees) {
    return ouvrir().then(function (db) {
      var t = db.transaction(["rapports", "imports"], "readwrite");
      t.objectStore("rapports").clear();
      t.objectStore("imports").clear();
      (donnees.rapports || []).forEach(function (r) { t.objectStore("rapports").put(r); });
      (donnees.imports || []).forEach(function (imp) { t.objectStore("imports").put(imp); });
      return promesseTransaction(t);
    });
  }

  return {
    importerFichier: importerFichier,
    tousLesRapports: tousLesRapports,
    tousLesImports: tousLesImports,
    rapportsDeEleve: rapportsDeEleve,
    purgerAvecPredicat: purgerAvecPredicat,
    exporterTout: exporterTout,
    remplacerTout: remplacerTout
  };
})();
