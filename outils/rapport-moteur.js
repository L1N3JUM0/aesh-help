"use strict";

/* =====================================================================
   Lance le moteur de proposition (pial/moteur.js) sur les données
   d'exemple et affiche son rapport de fin, en Markdown.

   Usage (Node 22 ou plus récent, sans npm) :
     node outils/rapport-moteur.js

   Les fichiers de exemples/ sont importés comme dans l'interface ; les
   horaires des collèges sont ceux de l'étape 6 de SCENARIO-DEMO.md. Le
   moteur est lancé deux fois (contrôle du déterminisme), puis sur un jeu
   agrandi ×4 pour mesurer le temps de calcul. Les dernières sections
   comparent trois capacités — les exemples (pénurie), les exemples + le
   renfort (FICTIF_aesh_renfort.csv), les AESH doublées (capacité
   suffisante) — avec ou sans passes d'amélioration, puis avec un seul
   ordre de départage des AESH ou le meilleur de NB_ORDRES ; enfin le mode
   « budget de temps » de l'interface (BUDGET_MS), rejoué à l'identique.
   ===================================================================== */

var fs = require("fs");
var path = require("path");

var RACINE = path.join(__dirname, "..");
var M = require(path.join(RACINE, "pial/modele.js"));
var P = require(path.join(RACINE, "pial/moteur.js"));
var T = require(path.join(RACINE, "pial/tests.js"));
var env = {
  modele: M, zip: require(path.join(RACINE, "pial/zip.js")), importFichiers: require(path.join(RACINE, "pial/import-fichiers.js")),
  lireExemple: function (nom) { return Promise.resolve(new Uint8Array(fs.readFileSync(path.join(RACINE, "exemples", nom)))); }
};

function h(x) { return (Math.round(x * 100) / 100).toString().replace(".", ",") + " h"; }
function pct(a, b) { return b ? Math.round(100 * a / b) + " %" : "—"; }
function chrono(fn) { var t0 = process.hrtime.bigint(); var r = fn(); return { r: r, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; }
var NB_ORDRES = 12;
var BUDGET_MS = 2000;     // temps de recherche par défaut de « Proposer » (réglage budgetOrdres)
function ms(x) { return Math.round(x) + " ms"; }
// nombre d'AESH différentes par élève : {0: n, 1: n, …} et élèves à 4 ou plus
function aeshParEleve(d, affs) {
  var par = {}, dist = {}, plus = [];
  d.eleves.forEach(function (e) { par[e.id] = {}; });
  affs.forEach(function (a) { a.eleves.forEach(function (id) { if (par[id]) par[id][a.aeshId] = true; }); });
  d.eleves.forEach(function (e) {
    var n = Object.keys(par[e.id]).length;
    dist[n] = (dist[n] || 0) + 1;
    if (n >= 4) plus.push(e.nomCourt + " (" + n + ")");
  });
  return { dist: dist, plus: plus };
}
function copie(d, champs) { var o = {}; Object.keys(d).forEach(function (k) { o[k] = d[k]; }); Object.keys(champs).forEach(function (k) { o[k] = champs[k]; }); return o; }

Promise.all([T.chargerExemples(env), T.chargerExemples(env, { renfort: true })]).then(function (jeux) {
  var d = jeux[0];
  var e1 = chrono(function () { return P.proposer(d); });
  var e2 = chrono(function () { return P.proposer(d); });
  var deterministe = JSON.stringify(e1.r) === JSON.stringify(e2.r);
  var grand = T.agrandir(M, d, 4);
  var eg = chrono(function () { return P.proposer(grand); });
  var r = e1.r.rapport, l = [];
  var nomEtab = {};
  d.etablissements.forEach(function (e) { nomEtab[e.id] = e.nom; });

  l.push("## Rapport du moteur sur les données d'exemple");
  l.push("");
  l.push("Données : " + d.eleves.length + " élèves, " + d.aesh.length + " AESH, " + d.cours.length + " cours, " + d.etablissements.length
    + " établissements ; brouillon vide (aucune affectation épinglée).");
  l.push("");
  l.push("### Heures");
  l.push("");
  l.push("| | Demandées | Couvertes | Taux |");
  l.push("|---|---|---|---|");
  [["Individuel", r.heures.individuel], ["Mutualisé", r.heures.mutualise], ["Périscolaire (à part)", r.heures.periscolaire]].forEach(function (x) {
    l.push("| " + x[0] + " | " + h(x[1].demande) + " | " + h(x[1].couvert) + " | " + pct(x[1].couvert, x[1].demande) + " |");
  });
  var dem = r.heures.individuel.demande + r.heures.mutualise.demande, cou = r.heures.individuel.couvert + r.heures.mutualise.couvert;
  l.push("| **Total notifié** | " + h(dem) + " | " + h(cou) + " | " + pct(cou, dem) + " |");
  l.push("");
  var quot = 0, charge = 0;
  r.aesh.forEach(function (a) { quot += a.quotite; charge += (a.A + a.B) / 2; });
  l.push("Capacité : " + h(quot) + " de quotités ; charge moyenne affectée " + h(charge) + " (" + pct(charge, quot) + ").");
  l.push(r.nbProposees + " affectations proposées. Contraintes dures violées par le moteur : " + r.violations.length + ".");
  l.push("");
  l.push("### Élèves sous-couverts ou partiellement couverts (" + r.sousCouverts.length + ")");
  l.push("");
  l.push("| Élève | Classe | Établissement | État | Manque ind. | Manque mut. | Motif | Détail (AESH écartées) |");
  l.push("|---|---|---|---|---|---|---|---|");
  r.sousCouverts.forEach(function (s) {
    var det = Object.keys(s.detail).map(function (k) { return k + " " + s.detail[k]; }).join(", ");
    l.push("| " + s.nomCourt + " | " + s.classe + " | " + s.etablissement + " | " + s.etat + " | " + (s.manqueInd ? h(s.manqueInd) : "") + " | "
      + (s.manqueMut ? h(s.manqueMut) : "") + " | " + s.libelle + " | " + det + " |");
  });
  l.push("");
  l.push("### Temps périscolaires non couverts (" + r.periscolaireNonCouvert.length + ")");
  l.push("");
  if (r.periscolaireNonCouvert.length) {
    l.push("| Élève | Classe | Temps | Jour | Horaire | Semaines | Prioritaire | Motif |");
    l.push("|---|---|---|---|---|---|---|---|");
    r.periscolaireNonCouvert.forEach(function (p) {
      l.push("| " + p.nomCourt + " | " + p.classe + " | " + p.type + " | " + p.jour + " | " + p.debut + "–" + p.fin + " | " + p.semaines.join(", ")
        + " | " + (p.prioritaire ? "oui" : "") + " | " + p.libelle + " |");
    });
  } else l.push("Aucun.");
  l.push("");
  l.push("### AESH");
  l.push("");
  l.push("| AESH | Quotité | Charge A | Charge B | État | Trous A / B | Journées courtes A / B | Établissements possibles |");
  l.push("|---|---|---|---|---|---|---|---|");
  r.aesh.forEach(function (a) {
    var src = d.aesh.filter(function (x) { return x.id === a.aeshId; })[0];
    var etabs = src.etablissements.length ? src.etablissements.map(function (id) { return nomEtab[id] || id; }).join(", ") : "tous";
    l.push("| " + a.nom + " | " + h(a.quotite) + " | " + h(a.A) + " | " + h(a.B) + " | " + { sous: "sous-utilisée", complete: "complète", depassement: "dépassement" }[a.etat]
      + " | " + a.trousA + " / " + a.trousB + " | " + a.courtesA + " / " + a.courtesB
      + " | " + etabs + (src.indisponibilites.length ? " ; indisponible " + src.indisponibilites.join(", ") : "") + " |");
  });
  l.push("");
  l.push("AESH sous-utilisées : " + (r.aeshSousUtilisees.map(function (a) { return a.nom + " (reste " + h(a.restantA) + " en A, " + h(a.restantB) + " en B)"; }).join(" ; ") || "aucune") + ".");
  l.push("");
  l.push("### Temps de calcul (Node, " + process.version + ")");
  l.push("");
  l.push("| Jeu | Élèves | AESH | Cours | Temps |");
  l.push("|---|---|---|---|---|");
  l.push("| Exemples, 1re exécution | " + d.eleves.length + " | " + d.aesh.length + " | " + d.cours.length + " | " + ms(e1.ms) + " |");
  l.push("| Exemples, 2e exécution | " + d.eleves.length + " | " + d.aesh.length + " | " + d.cours.length + " | " + ms(e2.ms) + " |");
  l.push("| Agrandi ×4 | " + grand.eleves.length + " | " + grand.aesh.length + " | " + grand.cours.length + " | " + ms(eg.ms) + " |");
  l.push("");
  l.push("Déterminisme : " + (deterministe ? "les deux exécutions donnent un résultat identique." : "**DIFFÉRENCE entre les deux exécutions.**")
    + " Jeu agrandi : " + eg.r.rapport.violations.length + " violation(s).");
  l.push("");
  l.push("### Capacité et AESH différentes par élève");
  l.push("");
  l.push("| Jeu | Quotités | Couvert / notifié | Sous-couverts | Périscolaire | AESH par élève (0/1/2/3/4/5+) | Élèves à 4 AESH ou plus |");
  l.push("|---|---|---|---|---|---|---|");
  var doublees = copie(d, { aesh: d.aesh.concat(d.aesh.map(function (a) { var c = JSON.parse(JSON.stringify(a)); c.id = a.id + "-bis"; c.nom = a.nom + " bis"; return c; })) });
  [["Exemples (pénurie)", d], ["Exemples + renfort", jeux[1]], ["AESH doublées (capacité suffisante)", doublees]].forEach(function (x) {
    var res = P.proposer(x[1]), rr = res.rapport, q = 0, ap = aeshParEleve(x[1], res.affectations), cinq = 0;
    x[1].aesh.forEach(function (a) { q += a.quotite; });
    Object.keys(ap.dist).forEach(function (k) { if (+k >= 5) cinq += ap.dist[k]; });
    var de = rr.heures.individuel.demande + rr.heures.mutualise.demande, co = rr.heures.individuel.couvert + rr.heures.mutualise.couvert;
    l.push("| " + x[0] + " | " + h(q) + " | " + h(co) + " / " + h(de) + " (" + pct(co, de) + ") | " + rr.sousCouverts.length + " | "
      + h(rr.heures.periscolaire.couvert) + " / " + h(rr.heures.periscolaire.demande) + " | "
      + [0, 1, 2, 3, 4].map(function (k) { return ap.dist[k] || 0; }).concat([cinq]).join(" / ") + " | "
      + (ap.plus.length ? ap.plus.length + " : " + ap.plus.join(", ") : "0") + " |");
  });
  l.push("");
  l.push("### Passes d'amélioration");
  l.push("");
  l.push("Un seul ordre de départage (identifiants triés). Cellule : heures notifiées couvertes · trous de plus de " + (r.ecartMax / 60)
    + " h (A + B) · journées de moins de " + (r.journeeMin / 60) + " h (A + B) · élèves à 4 AESH ou plus.");
  l.push("");
  l.push("| Passes | Exemples (pénurie) | Exemples + renfort | AESH doublées |");
  l.push("|---|---|---|---|");
  var opt = JSON.parse(JSON.stringify(P.OPTIONS));
  function cellule(q, dec) {
    function f(x) { return dec ? x.toFixed(1).replace(".", ",") : String(x); }
    return h(q.couvert) + " · " + f(q.trous) + " trous · " + f(q.courtes) + " courtes · " + f(q.elevesPlusDe3);
  }
  [["aucune", false, false], ["nombre d'AESH par élève", true, false], ["nombre d'AESH par élève, puis trous (retenu)", true, true]].forEach(function (v) {
    P.OPTIONS.echanges = v[1]; P.OPTIONS.echangesTrous = v[2];
    l.push("| " + v[0] + " | " + [d, jeux[1], doublees].map(function (x) { return cellule(P.proposer(x).rapport.qualite, false); }).join(" | ") + " |");
  });
  Object.keys(opt).forEach(function (k) { P.OPTIONS[k] = opt[k]; });
  l.push("");
  l.push("### Plusieurs ordres de départage des AESH");
  l.push("");
  l.push("Le glouton départage les égalités de score par l'ordre des AESH. « Proposer » essaie " + NB_ORDRES
    + " ordres (identifiants triés, puis permutations à graine fixe) et garde le meilleur : heures couvertes, puis périscolaire prioritaire couvert, élèves à plus de 3 AESH, trous, journées courtes, périscolaire normal couvert.");
  l.push("Cellule : heures notifiées couvertes · trous · journées courtes · élèves à 4 AESH ou plus · périscolaire prioritaire non couvert / normal non couvert.");
  l.push("");
  l.push("| Jeu | Premier ordre | Moyenne des " + NB_ORDRES + " ordres | Meilleur (retenu) | Ordre retenu | Temps : 1 ordre / " + NB_ORDRES + " ordres |");
  l.push("|---|---|---|---|---|---|");
  function celluleOrdres(q, dec) {
    function f(x) { return dec ? x.toFixed(1).replace(".", ",") : String(x); }
    return cellule(q, dec) + " · " + h(q.periPrioNonCouvert) + " / " + h(q.periNormalNonCouvert);
  }
  [["Exemples (pénurie)", d], ["Exemples + renfort", jeux[1]], ["AESH doublées", doublees], ["Agrandi ×4", grand]].forEach(function (x) {
    var t0 = process.hrtime.bigint(), un = P.proposer(x[1]), t1 = process.hrtime.bigint(), m = P.proposerMeilleur(x[1], NB_ORDRES), t2 = process.hrtime.bigint();
    var moy = {};
    Object.keys(m.rapport.qualite).forEach(function (k) { moy[k] = 0; });
    m.rapport.ordres.essais.forEach(function (e) { Object.keys(moy).forEach(function (k) { moy[k] += e.qualite[k] / NB_ORDRES; }); });
    l.push("| " + x[0] + " | " + celluleOrdres(un.rapport.qualite, false) + " | " + celluleOrdres(moy, true) + " | " + celluleOrdres(m.rapport.qualite, false)
      + " | n° " + (m.rapport.ordres.retenu + 1) + " | " + ms(Number(t1 - t0) / 1e6) + " / " + ms(Number(t2 - t1) / 1e6)
      + (m.rapport.violations.length ? " · **" + m.rapport.violations.length + " violation(s)**" : "") + " |");
  });
  l.push("");
  l.push("### Budget de temps (« Proposer » dans l'interface)");
  l.push("");
  l.push("« Proposer » essaie autant d'ordres que le temps de recherche le permet (" + (BUDGET_MS / 1000) + " s ici, au moins " + P.MIN_ORDRES
    + "), mémorise le nombre essayé et le rejoue tel quel quand les données n'ont pas changé. Colonne « rejoué » : proposerMeilleur(d, nb) redonne exactement le même résultat.");
  l.push("");
  l.push("| Jeu | Ordres essayés | Temps | Meilleur (retenu) | Ordre retenu | Rejoué |");
  l.push("|---|---|---|---|---|---|");
  [["Exemples (pénurie)", d], ["Exemples + renfort", jeux[1]], ["AESH doublées", doublees], ["Agrandi ×4", grand]].forEach(function (x) {
    function horloge() { return Number(process.hrtime.bigint()) / 1e6; }
    var t0 = horloge(), b = P.proposerBudget(x[1], BUDGET_MS, horloge), t1 = horloge();
    var rejoue = JSON.stringify(P.proposerMeilleur(x[1], b.rapport.ordres.nb)) === JSON.stringify(b);
    l.push("| " + x[0] + " | " + b.rapport.ordres.nb + " | " + ms(t1 - t0) + " | " + celluleOrdres(b.rapport.qualite, false)
      + " | n° " + (b.rapport.ordres.retenu + 1) + " | " + (rejoue ? "identique" : "**différent**") + " |");
  });
  console.log(l.join("\n"));
}).catch(function (err) { console.error(err); process.exitCode = 1; });
