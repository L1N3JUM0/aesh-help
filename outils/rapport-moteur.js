"use strict";

/* =====================================================================
   Lance le moteur de proposition (pial/moteur.js) sur les données
   d'exemple et affiche son rapport de fin, en Markdown.

   Usage (Node 22 ou plus récent, sans npm) :
     node outils/rapport-moteur.js

   Les fichiers de exemples/ sont importés comme dans l'interface ; les
   horaires des collèges sont ceux de l'étape 6 de SCENARIO-DEMO.md. Le
   moteur est lancé deux fois (contrôle du déterminisme), puis sur un jeu
   agrandi ×4 pour mesurer le temps de calcul. Une dernière section compare
   trois capacités : les exemples (pénurie), les exemples + le renfort
   (FICTIF_aesh_renfort.csv), et les AESH doublées (capacité suffisante).
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
var NB_PERMUTATIONS = 12;
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
  l.push("### Variantes : levier « AESH connue libre » et passe d'échanges");
  l.push("");
  l.push("Élèves à 4 AESH ou plus / heures notifiées couvertes. Réglage retenu : " + JSON.stringify(P.OPTIONS) + ".");
  l.push("");
  l.push("| Variante | Exemples (pénurie) | Exemples + renfort | AESH doublées |");
  l.push("|---|---|---|---|");
  var retenu = JSON.parse(JSON.stringify(P.OPTIONS));
  [["aucun", false, false], ["levier seul", true, false], ["échanges seuls", false, true], ["les deux", true, true]].forEach(function (v) {
    P.OPTIONS.aeshConnue = v[1]; P.OPTIONS.echanges = v[2];
    l.push("| " + v[0] + " | " + [d, jeux[1], doublees].map(function (x) {
      var res = P.proposer(x), rr = res.rapport, ap = aeshParEleve(x, res.affectations);
      return ap.plus.length + " / " + h(rr.heures.individuel.couvert + rr.heures.mutualise.couvert) + (rr.nbEchanges ? " (" + rr.nbEchanges + " mouvements)" : "");
    }).join(" | ") + " |");
  });
  P.OPTIONS.aeshConnue = retenu.aeshConnue; P.OPTIONS.echanges = retenu.echanges;
  l.push("");
  l.push("### Trous et journées courtes : avant / après");
  l.push("");
  l.push("Par jeu : heures notifiées couvertes · trous de plus de " + (r.ecartMax / 60) + " h (A + B, toutes AESH) · journées de moins de "
    + (r.journeeMin / 60) + " h de présence (A + B) · élèves à 4 AESH ou plus. « Avant » = phase 2 (critère « créneau isolé » −10, sans passe sur les trous).");
  l.push("Le glouton est sensible à l'ordre de départage des AESH (identifiants) : la seconde table donne la moyenne sur " + NB_PERMUTATIONS
    + " permutations des identifiants des AESH, plus représentative qu'un seul jeu.");
  var poidsCourte = P.POIDS.journeeCourte, opt = JSON.parse(JSON.stringify(P.OPTIONS));
  var variantes = [
    ["avant (phase 2)", { trous: false, colleConnue: false, echangesTrous: false }, 0],
    ["passe sur les trous seule", { trous: false, colleConnue: false, echangesTrous: true }, poidsCourte],
    ["score : trou −30", { trous: true, colleConnue: false, echangesTrous: false }, 0],
    ["score : trou −30, journée courte −10", { trous: true, colleConnue: false, echangesTrous: false }, poidsCourte],
    ["score trou + journée courte, passe sur les trous", { trous: true, colleConnue: false, echangesTrous: true }, poidsCourte],
    ["idem + créneau collé à une AESH connue", { trous: true, colleConnue: true, echangesTrous: true }, poidsCourte]
  ];
  function regler(v) { Object.keys(v[1]).forEach(function (k) { P.OPTIONS[k] = v[1][k]; }); P.POIDS.journeeCourte = v[2]; }
  function mesure(x) {
    var res = P.proposer(x), rr = res.rapport;
    return { couvert: rr.heures.individuel.couvert + rr.heures.mutualise.couvert, trous: rr.trous.A + rr.trous.B,
      courtes: rr.courtes.A + rr.courtes.B, plus: aeshParEleve(x, res.affectations).plus.length, violations: rr.violations.length };
  }
  function cellule(m, dec) {
    function f(x) { return dec ? x.toFixed(1).replace(".", ",") : String(x); }
    return h(m.couvert) + " · " + f(m.trous) + " trous · " + f(m.courtes) + " courtes · " + f(m.plus) + (m.violations ? " · **" + m.violations + " violation(s)**" : "");
  }
  // permutation k des identifiants des AESH (noms inchangés)
  function permuter(x, k) {
    var o = copie(x, {});
    o.aesh = x.aesh.map(function (a, i) { var c = JSON.parse(JSON.stringify(a)); c.id = String.fromCharCode(97 + ((i * 7 + k * 5) % 26)) + ((i * 13 + k * 11) % 97) + "|" + a.id; return c; });
    return o;
  }
  [["Exemples tels quels", false], ["Moyenne sur " + NB_PERMUTATIONS + " permutations", true]].forEach(function (t) {
    l.push("");
    l.push("**" + t[0] + "**");
    l.push("");
    l.push("| Variante | Exemples (pénurie) | Exemples + renfort | AESH doublées |");
    l.push("|---|---|---|---|");
    variantes.forEach(function (v) {
      regler(v);
      l.push("| " + v[0] + (JSON.stringify(v[1]) === JSON.stringify({ trous: opt.trous, colleConnue: opt.colleConnue, echangesTrous: opt.echangesTrous }) ? " (retenu)" : "") + " | "
        + [d, jeux[1], doublees].map(function (x) {
          if (!t[1]) return cellule(mesure(x), false);
          var s = { couvert: 0, trous: 0, courtes: 0, plus: 0, violations: 0 };
          for (var k = 0; k < NB_PERMUTATIONS; k++) { var m = mesure(permuter(x, k)); Object.keys(s).forEach(function (c) { s[c] += m[c]; }); }
          Object.keys(s).forEach(function (c) { if (c !== "violations") s[c] /= NB_PERMUTATIONS; });
          return cellule(s, true);
        }).join(" | ") + " |");
    });
  });
  P.POIDS.journeeCourte = poidsCourte; Object.keys(opt).forEach(function (k) { P.OPTIONS[k] = opt[k]; });
  console.log(l.join("\n"));
}).catch(function (err) { console.error(err); process.exitCode = 1; });
