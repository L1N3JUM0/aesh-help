"use strict";

/* =====================================================================
   Test de fumée : EXÉCUTE les deux applications dans un faux navigateur
   (outils/faux-navigateur.js : DOM construit depuis le vrai HTML, IndexedDB
   en mémoire) avec des données d'exemple fictives, ouvre chaque onglet ou
   chaque vue, clique les boutons, et échoue sur toute exception.

   Il attrape ce que les tests de règles ne voient pas : une fonction
   supprimée mais encore appelée (ReferenceError au premier clic), un
   identifiant disparu du HTML (TypeError sur null), un module dont une
   fonction exposée a disparu, un onglet qui ne s'affiche plus.

   Contrôles :
     1. espace PIAL (pial/index.html) : démarrage, puis chaque onglet de la
        barre de navigation, puis tous les boutons visibles de l'onglet ;
     2. application AESH (index.html) : démarrage, puis tous les boutons
        visibles, à plusieurs reprises, jusqu'à avoir ouvert chaque vue
        accessible ;
     3. modules : pour chaque appel `Module.fonction(` écrit dans le code,
        la fonction existe bien sur le module chargé.

   Lancé par outils/tests-node.js ; exécutable seul :
     node outils/test-fumee.js
   ===================================================================== */

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var FB = require("./faux-navigateur.js");
var VA = require("./verifier-appels.js");

var RACINE = path.join(__dirname, "..");

function attendre(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function laisserFinir() {
  return new Promise(function (resolve) {
    var i = 0;
    (function tour() { if (++i > 400) return resolve(); setImmediate(tour); })();
  }).then(function () { return attendre(30); }).then(function () {
    return new Promise(function (resolve) { var i = 0; (function tour() { if (++i > 400) return resolve(); setImmediate(tour); })(); });
  });
}

/* exceptions non rattrapées pendant une exécution (promesses rejetées) */
function surveillerRejets(erreurs) {
  var f = function (raison) { erreurs.push("promesse rejetée : " + (raison && raison.stack ? String(raison.stack).split("\n").slice(0, 3).join(" | ") : String(raison))); };
  process.on("unhandledRejection", f);
  return function () { process.removeListener("unhandledRejection", f); };
}

function executerScripts(nav, scripts) {
  vm.createContext(nav.ctx);
  scripts.forEach(function (s) {
    try { vm.runInContext(s.source, nav.ctx, { filename: s.nom }); }
    catch (e) { nav.erreurs.push("exception au chargement de " + s.nom + " : " + (e && e.stack ? String(e.stack).split("\n").slice(0, 3).join(" | ") : String(e))); }
  });
}

/* un élément est visible si ni lui ni un ancêtre n'est masqué (classe « masque » ou attribut hidden) */
function visible(el) {
  for (var n = el._n; n && n.tag !== "#racine"; n = n.parent) {
    if (n.classes && n.classes.indexOf("masque") >= 0) return false;
    if ("hidden" in n.attrs) return false;
  }
  return true;
}

/* clique chaque bouton visible une fois ; renvoie le nombre de clics.
   Les clics lourds (calcul du moteur) sont écartés : ils ne dépendent pas de l'interface. */
var ECARTES = /propos|relanc|ordres/i;
function balayer(nav, dans, dejaClique, apres) {
  var n = 0;
  nav.cliquables(dans).slice().forEach(function (el) {
    if (dejaClique && dejaClique.indexOf(el) >= 0) return;
    if (!visible(el) || ECARTES.test(el.id || "")) return;
    if (dejaClique) dejaClique.push(el);
    n++;
    nav.declencher(el, "click");
    if (apres) apres();
  });
  return n;
}

function aideErreurs(nav, depuis) { return nav.erreurs.slice(depuis); }

/* ---------- graine de données fictives pour l'espace PIAL ---------- */

function graineIdb(idb) {
  var charger = function (rel) { return require(path.join(RACINE, rel)); };
  var T = charger("pial/tests.js"), M = charger("pial/modele.js"), P = charger("pial/moteur.js");
  var env = {
    modele: M, zip: charger("pial/zip.js"), importFichiers: charger("pial/import-fichiers.js"),
    lireExemple: function (nom) { var f = path.join(RACINE, "exemples", nom); return Promise.resolve(fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null); }
  };
  var ctx0 = { indexedDB: idb.indexedDB, IDBKeyRange: idb.IDBKeyRange, Promise: Promise, JSON: JSON, Date: Date, Object: Object, Array: Array, Math: Math, Number: Number, String: String, Error: Error, PialModele: M, console: console };
  vm.createContext(ctx0);
  vm.runInContext(fs.readFileSync(path.join(RACINE, "pial/db.js"), "utf8"), ctx0, { filename: "pial/db.js" });
  var DB = vm.runInContext("PialDB", ctx0);
  return T.chargerExemples(env).then(function (d) {
    var res = P.proposer(d);
    var brut = { eleves: d.eleves, aesh: d.aesh, cours: d.cours, affectations: res.affectations, versions: [] };
    var m = M.migrerV4(brut);
    // un élément de chaque magasin ; la 1re version validée alimente l'évolution des statistiques
    var ops = [
      { magasin: "etablissements", enregistrer: d.etablissements },
      { magasin: "eleves", enregistrer: m.eleves }, { magasin: "aesh", enregistrer: m.aesh },
      { magasin: "cours", enregistrer: m.cours }, { magasin: "affectations", enregistrer: m.affectations },
      { magasin: "parametres", enregistrer: [{ cle: "reglages", valeur: { gererPeriscolaire: true } }] }
    ];
    return DB.appliquer(ops).then(function () {
      var fichiers = fs.readdirSync(path.join(RACINE, "exemples")).filter(function (f) { return /^FICTIF_transmission_.*\.json$/.test(f); }).sort();
      return fichiers.reduce(function (p, f) {
        return p.then(function () { return DB.importerFichier(JSON.parse(fs.readFileSync(path.join(RACINE, "exemples", f), "utf8")), f); });
      }, Promise.resolve());
    }).then(function () { return { eleves: m.eleves.length, affectations: m.affectations.length }; });
  });
}

/* ---------- espace PIAL ---------- */

function testerPial(rendre) {
  var erreurs = [], idb = FB.creerIndexedDB(), arreter = surveillerRejets(erreurs);
  var page = VA.scriptsDePage("pial/index.html");
  return graineIdb(idb).then(function (graine) {
    var nav = FB.creerNavigateur({ html: page.html, erreurs: erreurs, indexedDB: idb });
    // le sélecteur de navigation doit exister dans le HTML réel
    var boutons = nav.document.querySelectorAll("#nav button");
    rendre("la barre de navigation compte 8 onglets", function () { if (boutons.length !== 8) throw new Error(boutons.length + " onglet(s) trouvé(s)"); });
    rendre("jeu fictif : élèves et affectations présents en base", function () { if (!(graine.eleves > 5 && graine.affectations > 5)) throw new Error(JSON.stringify(graine)); });
    executerScripts(nav, page.fichiers);
    return laisserFinir().then(function () {
      rendre("espace PIAL : démarrage sans exception", function () { if (erreurs.length) throw new Error(erreurs.slice(0, 4).join("\n          ")); });
      var depuis = erreurs.length;
      return boutons.reduce(function (p, b) {
        return p.then(function () {
          var vueId = b.dataset.vue, avant = erreurs.length;
          nav.declencher(b, "click");
          return laisserFinir().then(function () {
            rendre("espace PIAL : onglet « " + vueId + " » s'ouvre sans exception", function () {
              if (erreurs.length > avant) throw new Error(erreurs.slice(avant, avant + 4).join("\n          "));
              var section = nav.document.getElementById(vueId);
              if (!section) throw new Error("section #" + vueId + " absente du HTML");
              if (!visible(section)) throw new Error("la section #" + vueId + " reste masquée après le clic");
            });
            // boutons de l'onglet (bascules internes, filtres, exports…)
            var avant2 = erreurs.length, deja = [], n = balayer(nav, nav.document.getElementById(vueId), deja);
            return laisserFinir().then(function () {
              // les boutons fabriqués par le clic précédent
              n += balayer(nav, nav.document.getElementById(vueId), deja);
              return laisserFinir().then(function () {
                rendre("espace PIAL : onglet « " + vueId + " » : " + n + " bouton(s) cliqué(s) sans exception", function () {
                  if (erreurs.length > avant2) throw new Error(erreurs.slice(avant2, avant2 + 4).join("\n          "));
                });
              });
            });
          });
        });
      }, Promise.resolve()).then(function () {
        verifierModules(nav, page.fichiers, rendre, "espace PIAL");
      });
    }).then(arreter, function (e) { arreter(); throw e; });
  });
}

/* ---------- application AESH ---------- */

/* jeu fictif de l'application AESH : la sauvegarde d'exemple si elle est présente, sinon un petit jeu intégré */
function donneesAesh() {
  var f = path.join(RACINE, "exemples", "FICTIF_sauvegarde_aesh_desordonnee.json");
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")).donnees;
  return { reglages: { aesh: "Marc Leroy", coordo: "coordo@exemple.invalid", anonyme: true, etablissements: ["École Fictive Gamma"] },
    eleves: [{ id: "n1aa1111", prenom: "Mia", nom: "Vert", classe: "CP", heures: "6 h", notes: "", etablissement: "École Fictive Gamma", modalite: "Individuel", copartage: 1, matieres: ["Français"], modifie: "2026-10-05T09:00:00.000Z" }],
    rapports: [{ id: "rap-0020", eleveId: "n1aa1111", eleveNom: "Mia V.", classe: "CP", heures: "6 h", cree: "2026-10-05T17:00:00.000Z", creeJour: "2026-10-05", periode: "Semaine", debut: "2026-10-05", fin: "2026-10-11", periodeTexte: "Semaine du 05/10/2026 au 11/10/2026", relation: "Fluide", modalite: "Individuel", copartage: 0, invest: { tendance: "Stable", items: {} }, accomp: ["Reformulation des consignes"], matieres: ["Français"], commentaire: "Bien.", aesh: "Marc Leroy", etablissement: "École Fictive Gamma" }],
    matieresPerso: [], accompPerso: [], investPerso: [] };
}

/* Pages successives (état neuf à chaque tour) : un bouton ouvre une vue et masque les autres ; en repartant d'une
   page neuve, chaque tour peut cliquer des boutons que le tour précédent n'a plus vus. Un bouton est repéré par son
   identifiant, ou à défaut par sa balise, sa classe et ses données (une carte d'élève vaut une carte). Fin : plus aucun nouveau bouton. */
function testerAesh(rendre) {
  var erreurs = [], arreter = surveillerRejets(erreurs);
  var page = VA.scriptsDePage("index.html");
  var donnees = donneesAesh();
  var sections = [];
  FB.analyserHtml(page.html).enfants.forEach(function f(n) { if (n.tag === "section" && /^vue-/.test(n.attrs.id || "")) sections.push(n.attrs.id); else n.enfants.forEach(f); });
  var vues = {}, faits = {}, clics = 0, dernier = null;

  function tour() {
    var nav = FB.creerNavigateur({ html: page.html, erreurs: erreurs, localStorage: { "suivi-aesh-v1": JSON.stringify(donnees) } });
    dernier = nav;
    executerScripts(nav, page.fichiers);
    function noterVues() { sections.forEach(function (id) { var el = nav.document.getElementById(id); if (el && visible(el)) vues[id] = true; }); }
    return laisserFinir().then(function () {
      noterVues();
      var nouveaux = 0;
      nav.cliquables().slice().forEach(function (el) {
        if (!visible(el) || ECARTES.test(el.id || "")) return;
        var cle = el.id || (el.tagName + "." + el.className + "|" + JSON.stringify(el.dataset));
        if (faits[cle]) return;
        faits[cle] = true; nouveaux++;
        clics++;
        nav.declencher(el, "click");
        noterVues();
      });
      return laisserFinir().then(function () { noterVues(); return nouveaux; });
    });
  }
  function tours(restant) {
    return tour().then(function (nouveaux) { return nouveaux && restant > 1 ? tours(restant - 1) : null; });
  }
  return tour().then(function (n0) {
    rendre("application AESH : démarrage sans exception", function () { if (erreurs.length) throw new Error(erreurs.slice(0, 4).join("\n          ")); });
    return n0 ? tours(12) : null;
  }).then(function () {
    rendre("application AESH : " + clics + " bouton(s) cliqué(s) sur " + Object.keys(vues).length + " vue(s), sans exception", function () { if (erreurs.length) throw new Error(erreurs.slice(0, 4).join("\n          ")); });
    rendre("application AESH : chaque vue accessible s'ouvre (" + Object.keys(vues).sort().join(", ") + ")", function () {
      ["vue-eleves", "vue-reglages", "vue-fiche", "vue-rapport", "vue-transmission"].forEach(function (v) { if (!vues[v]) throw new Error("la vue « " + v + " » n'a jamais été affichée"); });
    });
    verifierModules(dernier, page.fichiers, rendre, "application AESH");
  }).then(arreter, function (e) { arreter(); throw e; });
}

/* ---------- modules : chaque Module.fonction( écrit dans le code existe ---------- */

function verifierModules(nav, fichiers, rendre, quoi) {
  var manque = [], vus = {}, affectes = {};
  // rappels branchés de l'extérieur (PialDB.surBlocage = function…) : définis par la page elle-même
  fichiers.forEach(function (f) {
    var code = VA.nettoyer(f.source).code, re = /\b(Pial[A-Z]\w*|Rapprochement|Graphiques)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g, m;
    while ((m = re.exec(code))) affectes[m[1] + "." + m[2]] = true;
  });
  fichiers.forEach(function (f) {
    var code = VA.nettoyer(f.source).code, re = /\b(Pial[A-Z]\w*|Rapprochement|Graphiques)\.([A-Za-z_$][\w$]*)\s*\(/g, m;
    while ((m = re.exec(code))) {
      var mod = m[1], fn = m[2], cle = mod + "." + fn;
      if (vus[cle] || affectes[cle]) continue; vus[cle] = true;
      var objet = nav.ctx[mod];
      if (objet === undefined) { if (mod === "Rapprochement" || mod === "PialStatsUI") continue; manque.push(f.nom + " : module « " + mod + " » non chargé (appel de " + cle + ")"); continue; }
      if (typeof objet[fn] !== "function") manque.push(f.nom + " : « " + cle + "(…) » est appelée mais le module ne l'expose pas");
    }
  });
  rendre(quoi + " : chaque fonction de module appelée existe (" + Object.keys(vus).length + " appels distincts)", function () { if (manque.length) throw new Error(manque.join("\n          ")); });
}

/* ---------- exécution ---------- */

function executer() {
  var lignes = [], echecs = 0;
  function rendre(nom, fn) {
    try { fn(); lignes.push({ etat: "ok", nom: nom }); }
    catch (e) { echecs++; lignes.push({ etat: "echec", nom: nom, message: e.message }); }
  }
  return testerPial(rendre).then(function () { return testerAesh(rendre); }).then(function () {
    return { reussis: lignes.length - echecs, echecs: echecs, lignes: lignes };
  }, function (e) {
    rendre("test de fumée : exécution complète", function () { throw e; });
    return { reussis: lignes.length - echecs, echecs: echecs, lignes: lignes };
  });
}

module.exports = { executer: executer };

if (require.main === module) {
  executer().then(function (b) {
    b.lignes.forEach(function (l) { console.log((l.etat === "ok" ? "  ok    " : "  ÉCHEC ") + l.nom + (l.message ? "\n          " + l.message : "")); });
    console.log("\n" + b.reussis + " réussi(s), " + b.echecs + " échec(s).");
    process.exitCode = b.echecs ? 1 : 0;
  });
}
