"use strict";

/* =====================================================================
   Génère le jeu de données FICTIF du module Affectations (spec §10).

   Usage (Node, sans npm) :
     node outils/generer-exemples.js [date-de-reference AAAA-MM-JJ]

   Outil de développement uniquement : il n'est pas chargé par
   l'application. Tout est déterministe (aucun Math.random) : mêmes
   arguments, mêmes fichiers. Les dates de notification sont calculées
   depuis la date de référence (par défaut, aujourd'hui) — relancer le
   script avant une démonstration pour que le cas 13 (fin de notification
   dans moins de 30 jours) reste vrai.

   Tous les noms sont manifestement fictifs et tous les fichiers de
   données sont préfixés FICTIF_. Les e-mails utilisent le domaine réservé
   exemple.invalid.
   ===================================================================== */

var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

var DOSSIER = path.join(__dirname, "..", "exemples");

/* =============== dates =============== */
function isoJour(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
function plusJours(iso, n) {
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoJour(d);
}
var REF = process.argv[2] || isoJour(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(REF)) { console.error("Date de référence invalide : " + REF); process.exit(1); }
var AN = parseInt(REF.slice(5, 7), 10) >= 8 ? parseInt(REF.slice(0, 4), 10) : parseInt(REF.slice(0, 4), 10) - 1;
var DEBUT_ANNEE = AN + "-09-01";
var FIN_ANNEE = (AN + 1) + "-07-04";

/* =============== générateur pseudo-aléatoire à graine fixe =============== */
function mulberry32(graine) {
  return function () {
    graine |= 0; graine = graine + 0x6D2B79F5 | 0;
    var t = Math.imul(graine ^ graine >>> 15, 1 | graine);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var alea = mulberry32(20262027);
function melanger(liste) {
  var l = liste.slice();
  for (var i = l.length - 1; i > 0; i--) {
    var j = Math.floor(alea() * (i + 1));
    var t = l[i]; l[i] = l[j]; l[j] = t;
  }
  return l;
}

/* =============== établissements et horaires =============== */
var TILLEULS = "Collège Fictif des Tilleuls";
var PORT = "Collège Fictif du Port";
var LILAS = "École Fictive des Lilas";

var CRENEAUX_COLLEGE = [["08:00", "08:55"], ["08:55", "09:50"], ["10:05", "11:00"], ["11:00", "11:55"],
  ["13:30", "14:25"], ["14:25", "15:20"], ["15:35", "16:30"]];
var CRENEAUX_ECOLE = [["08:30", "09:30"], ["09:30", "10:15"], ["10:30", "11:30"],
  ["13:30", "14:30"], ["14:30", "15:15"], ["15:30", "16:30"]];

// liste des cases horaires d'une classe : [{jour, debut, fin}]
function casesCollege() {
  var out = [];
  ["lundi", "mardi", "mercredi", "jeudi", "vendredi"].forEach(function (j) {
    CRENEAUX_COLLEGE.forEach(function (c, i) {
      if (j === "mercredi" && i > 3) return;     // mercredi après-midi libre
      if (j === "vendredi" && i === 6) return;   // fin plus tôt le vendredi
      out.push({ jour: j, debut: c[0], fin: c[1] });
    });
  });
  return out; // 30 cases
}
function casesEcole() {
  var out = [];
  ["lundi", "mardi", "jeudi", "vendredi"].forEach(function (j) { // pas de classe le mercredi (cas 6)
    CRENEAUX_ECOLE.forEach(function (c) { out.push({ jour: j, debut: c[0], fin: c[1] }); });
  });
  return out; // 24 cases
}

/* Une "case" de l'emploi du temps d'une classe contient une ou plusieurs
   entrées {matiere, semaine, groupe}. Plusieurs entrées = groupes
   différents (LV2, demi-groupes) ou alternance A/B. Chaque élève ne suit
   que les entrées de ses groupes. */
function repeter(m, n) { var a = []; for (var i = 0; i < n; i++) a.push(m); return a; }

function edtCollege(niveau) {
  var cases = casesCollege();
  var speciales = []; // entrées multiples, posées en premier sur des cases fixes
  var simples;
  if (niveau === 6) {
    simples = [].concat(repeter("Français", 5), repeter("Mathématiques", 4), repeter("Anglais", 4),
      repeter("Histoire-Géographie", 3), repeter("EPS", 4), ["SVT", "Technologie", "Physique-Chimie",
        "Arts plastiques", "Éducation musicale", "EMC"]);
  } else {
    simples = [].concat(repeter("Français", 4), repeter("Mathématiques", 4), repeter("Anglais", 3),
      repeter("Histoire-Géographie", 3), repeter("EPS", 3), ["SVT", "Physique-Chimie", "Arts plastiques",
        "Éducation musicale", "EMC"]);
    // LV2 : deux groupes sur le même créneau (cas 1), deux fois par semaine
    speciales.push([{ matiere: "LV2", semaine: "", groupe: "LV2 espagnol" }, { matiere: "LV2", semaine: "", groupe: "LV2 allemand" }]);
    speciales.push([{ matiere: "LV2", semaine: "", groupe: "LV2 espagnol" }, { matiere: "LV2", semaine: "", groupe: "LV2 allemand" }]);
    // alternance A/B : sciences en A, technologie en B (même créneau)
    speciales.push([{ matiere: "Physique-Chimie", semaine: "A", groupe: "" }, { matiere: "Technologie", semaine: "B", groupe: "" }]);
    if (niveau <= 4) {
      // demi-groupes : G1 en semaine A, G2 en semaine B seulement (cas 5)
      speciales.push([{ matiere: "Technologie", semaine: "A", groupe: "G1" }, { matiere: "Technologie", semaine: "B", groupe: "G2" }]);
    }
  }
  var contenu = speciales.concat(simples.map(function (m) { return [{ matiere: m, semaine: "", groupe: "" }]; }));
  var ordre = melanger(cases);
  var edt = [];
  for (var i = 0; i < contenu.length && i < ordre.length; i++) edt.push({ c: ordre[i], entrees: contenu[i] });
  return edt;
}
function edtEcole(classe) {
  var cases = casesEcole();
  var decouverte = (classe === "CM1" || classe === "CM2")
    ? ["Sciences", "Sciences", "Histoire-Géographie"]
    : ["Questionner le monde", "Questionner le monde", "Questionner le monde"];
  var simples = [].concat(repeter("Français", 8), repeter("Mathématiques", 6), decouverte,
    ["Anglais", "EPS", "EPS", "EPS", "Arts plastiques", "Éducation musicale", "EMC"]);
  var ordre = melanger(cases);
  return simples.map(function (m, i) { return { c: ordre[i], entrees: [{ matiere: m, semaine: "", groupe: "" }] }; });
}

var CLASSES = {};
CLASSES[TILLEULS] = { "6A": 6, "6B": 6, "5A": 5, "5B": 5, "4A": 4, "4C": 4, "3A": 3 };
CLASSES[PORT] = { "6A": 6, "5A": 5, "4A": 4, "3B": 3 };
CLASSES[LILAS] = { "CP": 0, "CE1": 0, "CE2": 0, "CM1": 0, "CM2": 0 };
var EDT_CLASSES = {};
Object.keys(CLASSES).forEach(function (etab) {
  EDT_CLASSES[etab] = {};
  Object.keys(CLASSES[etab]).forEach(function (cl) {
    EDT_CLASSES[etab][cl] = etab === LILAS ? edtEcole(cl) : edtCollege(CLASSES[etab][cl]);
  });
});

/* =============== élèves (45) =============== */
/* ind/mut : heures notifiées. lv2/demi : groupes suivis. prio/exclu :
   matières pré-remplies (cas 9). fin : fin de notification particulière. */
var ELEVES = [
  // --- Collège Fictif des Tilleuls (22) ---
  { e: TILLEULS, c: "6A", p: "Emma", n: "Exemple", ind: 8, besoins: ["Reformulation des consignes", "Aide à l'organisation"] },
  { e: TILLEULS, c: "6A", p: "Noah", n: "Fictif", mut: 6, besoins: ["Recentrage sur la tâche"] },
  { e: TILLEULS, c: "6A", p: "Jade", n: "Factice", mut: 6, besoins: ["Lecture à voix haute"] },
  { e: TILLEULS, c: "6A", p: "Tom", n: "Figurant", ind: 6 },
  // cas 8 : récréation et pause méridienne accompagnées, pause méridienne prioritaire
  { e: TILLEULS, c: "6B", p: "Louis", n: "Imaginaire", ind: 12, recre: true, merid: "prioritaire", besoins: ["Aide aux déplacements", "Gestes du quotidien"] },
  { e: TILLEULS, c: "6B", p: "Alice", n: "Prototype", ind: 6, besoins: ["Secrétaire, scripteur"] },
  // cas 2 : trois élèves mutualisés dans la même classe (même cours, même groupe)
  { e: TILLEULS, c: "5A", p: "Hugo", n: "Maquette", mut: 6, lv2: "LV2 espagnol", besoins: ["Recentrage sur la tâche"] },
  { e: TILLEULS, c: "5A", p: "Léna", n: "Modèle", mut: 6, lv2: "LV2 espagnol", besoins: ["Reformulation des consignes"] },
  { e: TILLEULS, c: "5A", p: "Adam", n: "Essai", mut: 4.5, lv2: "LV2 espagnol" },
  { e: TILLEULS, c: "5A", p: "Chloé", n: "Brouillon", ind: 9, lv2: "LV2 allemand", besoins: ["Secrétaire, scripteur", "Prise de notes"] },
  { e: TILLEULS, c: "5B", p: "Gabriel", n: "Gabarit", ind: 6, mut: 3, lv2: "LV2 allemand" },
  { e: TILLEULS, c: "5B", p: "Manon", n: "Copie", mut: 4, lv2: "LV2 espagnol" },
  // cas 1 : deux mutualisés de la même classe, groupes de LV2 différents
  { e: TILLEULS, c: "4A", p: "Rose", n: "Échantillon", mut: 6, lv2: "LV2 espagnol", demi: "G1" },
  { e: TILLEULS, c: "4A", p: "Arthur", n: "Simulacre", mut: 6, lv2: "LV2 allemand", demi: "G1" },
  { e: TILLEULS, c: "4A", p: "Mila", n: "Démo", ind: 8, lv2: "LV2 espagnol", demi: "G2", besoins: ["Gestion des émotions"] },
  // cas 5 : demi-groupe G2, technologie en semaine B seulement
  { e: TILLEULS, c: "4C", p: "Raphaël", n: "Témoin", ind: 10, lv2: "LV2 allemand", demi: "G2", besoins: ["Aide à la manipulation"] },
  { e: TILLEULS, c: "4C", p: "Lina", n: "Spécimen", ind: 6, lv2: "LV2 espagnol", demi: "G1" },
  // cas 13 : notification qui se termine dans moins de 30 jours
  { e: TILLEULS, c: "3A", p: "Jules", n: "Ébauche", ind: 12, lv2: "LV2 espagnol", fin: plusJours(REF, 20), besoins: ["Aménagement des évaluations"] },
  { e: TILLEULS, c: "3A", p: "Zoé", n: "Esquisse", mut: 5, lv2: "LV2 espagnol" },
  // cas 9 : cours prioritaires et exclus pré-remplis
  { e: TILLEULS, c: "3A", p: "Nathan", n: "Copie", ind: 6, lv2: "LV2 allemand", prio: ["Français", "Mathématiques"], exclu: ["EPS"] },
  // notification déjà échue (alerte « dépassée »)
  { e: TILLEULS, c: "3A", p: "Inès", n: "Doublure", ind: 7, lv2: "LV2 allemand", fin: plusJours(REF, -5) },
  { e: TILLEULS, c: "3A", p: "Yasmine", n: "Factice", ind: 8, lv2: "LV2 espagnol", exclu: ["Éducation musicale"] },
  // --- Collège Fictif du Port (13) ---
  { e: PORT, c: "6A", p: "Léo", n: "Exemple", ind: 9, besoins: ["Mise en confiance, encouragement"] },
  { e: PORT, c: "6A", p: "Ambre", n: "Fictif", mut: 5 },
  { e: PORT, c: "6A", p: "Timéo", n: "Modèle", mut: 5 },
  { e: PORT, c: "5A", p: "Lucie", n: "Essai", ind: 6, recre: true, lv2: "LV2 espagnol" },
  { e: PORT, c: "5A", p: "Ethan", n: "Brouillon", ind: 8, lv2: "LV2 allemand", prio: ["Français"] },
  { e: PORT, c: "4A", p: "Clara", n: "Gabarit", ind: 12, lv2: "LV2 espagnol", demi: "G1", besoins: ["Secrétaire, scripteur", "Aide aux déplacements"] },
  // même groupe de LV2 : mutualisables ensemble
  { e: PORT, c: "4A", p: "Maël", n: "Démo", mut: 6, lv2: "LV2 espagnol", demi: "G2" },
  { e: PORT, c: "4A", p: "Lou", n: "Témoin", mut: 6, lv2: "LV2 espagnol", demi: "G2" },
  { e: PORT, c: "3B", p: "Sami", n: "Spécimen", ind: 10, lv2: "LV2 allemand" },
  { e: PORT, c: "3B", p: "Anna", n: "Ébauche", ind: 6, merid: true, lv2: "LV2 espagnol" },
  { e: PORT, c: "3B", p: "Victor", n: "Esquisse", mut: 4, lv2: "LV2 espagnol" },
  { e: PORT, c: "3B", p: "Elsa", n: "Copie", mut: 4, lv2: "LV2 espagnol" },
  { e: PORT, c: "3B", p: "Liam", n: "Doublure", ind: 9, lv2: "LV2 allemand", besoins: ["Médiation avec l'enseignant"] },
  // --- École Fictive des Lilas (10) — sans alternance, sans classe le mercredi (cas 6) ---
  { e: LILAS, c: "CP", p: "Paul", n: "Figurant", ind: 12, recre: true, besoins: ["Aide aux déplacements"] },
  { e: LILAS, c: "CP", p: "Mia", n: "Exemple", ind: 8 },
  { e: LILAS, c: "CE1", p: "Lucas", n: "Imaginaire", ind: 10, besoins: ["Lecture à voix haute"] },
  { e: LILAS, c: "CE2", p: "Nina", n: "Prototype", mut: 6 },
  { e: LILAS, c: "CE2", p: "Malo", n: "Maquette", mut: 6 },
  { e: LILAS, c: "CM1", p: "Iris", n: "Simulacre", ind: 9, merid: true, besoins: ["Gestes du quotidien"] },
  { e: LILAS, c: "CM1", p: "Axel", n: "Échantillon", ind: 6 },
  { e: LILAS, c: "CM2", p: "Lola", n: "Témoin", ind: 12, besoins: ["Secrétaire, scripteur"] },
  { e: LILAS, c: "CM2", p: "Enzo", n: "Spécimen", mut: 6 },
  { e: LILAS, c: "CM2", p: "Romy", n: "Spécimen", mut: 6 }
];

// cas 10 : deux « Lucas M. » en 5B, fichier séparé pour que le jeu principal s'importe sans erreur
var ELEVES_COLLISION = [
  { e: TILLEULS, c: "5B", p: "Lucas", n: "Maquette", ind: 6 },
  { e: TILLEULS, c: "5B", p: "Lucas", n: "Modèle", mut: 4 },
  { e: TILLEULS, c: "5B", p: "Sacha", n: "Esquisse", ind: 5 }
];

function nomCourt(el) { return el.p + " " + el.n.charAt(0).toUpperCase() + "."; }
function sansAccent(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function cleEleve(el) { return sansAccent((nomCourt(el) + "|" + el.c + "|" + el.e).toLowerCase()); }

// garde-fou : aucune collision dans le jeu principal
(function () {
  var vus = {};
  ELEVES.forEach(function (el) {
    var k = cleEleve(el);
    if (vus[k]) { console.error("Collision imprévue dans le jeu principal : " + k); process.exit(1); }
    vus[k] = true;
  });
})();

/* =============== AESH (14) =============== */
var AESH = [
  // cas 3 : sur deux établissements ; cas 14 : nom mal orthographié dans certains rapports
  { n: "Durand", p: "Sophie", q: 24, etabs: [TILLEULS, PORT], form: ["TSA"] },
  { n: "Exemplaire", p: "Léa", q: 24, etabs: [TILLEULS] },
  // cas 4 : indisponible le mercredi
  { n: "Fictif", p: "Hugo", q: 24, etabs: [TILLEULS], indispo: "mer" },
  // cas 4 : indisponible le vendredi après-midi
  { n: "Démonstration", p: "Nadia", q: 20, etabs: [TILLEULS, PORT], indispo: "ven-pm", form: ["LSF"] },
  { n: "Factice", p: "Inès", q: 20, etabs: [PORT] },
  { n: "Imaginaire", p: "Paul", q: 18, etabs: [PORT], indispo: "lun-am" },
  { n: "Prototype", p: "Chloé", q: 18, etabs: [LILAS] },
  { n: "Maquette", p: "Yanis", q: 24, etabs: [LILAS] },
  { n: "Brouillon", p: "Manon", q: 20, etabs: [LILAS, TILLEULS] },
  { n: "Essai", p: "Omar", q: 20, etabs: [] }, // vide = tous les établissements
  { n: "Simulée", p: "Julie", q: 12, etabs: [TILLEULS] },
  { n: "Modèle", p: "Théo", q: 20, etabs: [PORT] },
  { n: "Échantillon", p: "Sarah", q: 12, etabs: [LILAS] },
  { n: "Gabarit", p: "Bruno", q: 18, etabs: [TILLEULS], form: ["TSA", "Braille"] }
];
// renfort (scénario, étape « relance ») : importé après une première
// proposition, il fait remonter la couverture
var AESH_RENFORT = [
  { n: "Renfort", p: "Camille", q: 24, etabs: [TILLEULS] },
  { n: "Appoint", p: "Alix", q: 12, etabs: [LILAS] }
];
function emailAesh(a) { return sansAccent(a.p + "." + a.n).toLowerCase().replace(/[^a-z.]/g, "") + "@exemple.invalid"; }

/* =============== écriture CSV =============== */
function celluleCSV(v, sep) {
  v = String(v == null ? "" : v);
  if (v.indexOf(sep) > -1 || v.indexOf('"') > -1 || /[\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function csv(lignes, sep) {
  return lignes.map(function (l) { return l.map(function (v) { return celluleCSV(v, sep); }).join(sep); }).join("\r\n") + "\r\n";
}
function heuresFr(h) { return h ? String(h).replace(".", ",") : ""; }
function ouiNon(b) { return b === "prioritaire" ? "prioritaire" : (b ? "oui" : "non"); }

var ENTETE_ELEVES = ["Etablissement", "Classe", "Prenom", "Nom", "Heures_individuelles", "Heures_mutualisees",
  "Recreation", "Pause_meridienne", "Besoins", "Debut_notification", "Fin_notification"];
function ligneEleve(el) {
  return [el.e, el.c, el.p, el.n, heuresFr(el.ind), heuresFr(el.mut), ouiNon(el.recre), ouiNon(el.merid),
    (el.besoins || []).join(" | "), DEBUT_ANNEE, el.fin || FIN_ANNEE];
}
var ENTETE_AESH = ["Nom", "Prenom", "Quotite_hebdo", "Email", "Etablissements", "Indisponibilites", "Formations"];
function ligneAesh(a) {
  return [a.n, a.p, a.q, emailAesh(a), a.etabs.join(" | "), a.indispo || "", (a.form || []).join(" | ")];
}

function lignesEdt() {
  var lignes = [["Etablissement", "Classe", "Eleve", "Jour", "Debut", "Fin", "Matiere", "Semaine", "Groupe", "Priorite"]];
  ELEVES.forEach(function (el) {
    var cours = [];
    EDT_CLASSES[el.e][el.c].forEach(function (cas) {
      cas.entrees.forEach(function (en) {
        if (en.groupe && en.groupe !== el.lv2 && en.groupe !== el.demi) return;
        cours.push({ c: cas.c, en: en });
      });
    });
    var ORDRE_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];
    cours.sort(function (a, b) {
      return (ORDRE_JOURS.indexOf(a.c.jour) - ORDRE_JOURS.indexOf(b.c.jour)) || a.c.debut.localeCompare(b.c.debut);
    });
    cours.forEach(function (x) {
      var prio = "";
      if (el.prio && el.prio.indexOf(x.en.matiere) > -1) prio = "prioritaire";
      if (el.exclu && el.exclu.indexOf(x.en.matiere) > -1) prio = "exclu";
      lignes.push([el.e, el.c, nomCourt(el), x.c.jour, x.c.debut, x.c.fin, x.en.matiere, x.en.semaine, x.en.groupe, prio]);
    });
  });
  return lignes;
}

/* =============== encodage Windows-1252 =============== */
function enWindows1252(texte) {
  var tampon = Buffer.alloc(texte.length);
  for (var i = 0; i < texte.length; i++) {
    var code = texte.charCodeAt(i);
    // on se limite volontairement au sous-ensemble commun Latin-1 / Windows-1252
    if (code > 0xFF || (code >= 0x80 && code <= 0x9F)) throw new Error("Caractère hors Windows-1252 : " + texte[i]);
    tampon[i] = code;
  }
  return tampon;
}

/* =============== ZIP (pour le XLSX) =============== */
var TABLE_CRC = (function () {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(octets) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// archive ZIP avec compression deflate (comme Excel), pour tester la
// décompression DecompressionStream("deflate-raw") côté application.
function zip(entrees) {
  var parties = [], central = [], decalage = 0;
  entrees.forEach(function (en) {
    var nom = Buffer.from(en.nom, "utf8");
    var brut = Buffer.from(en.contenu, "utf8");
    var comp = zlib.deflateRawSync(brut);
    var crc = crc32(brut);
    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x5B21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(brut.length, 22);
    local.writeUInt16LE(nom.length, 26); local.writeUInt16LE(0, 28);
    var cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x5B21, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(brut.length, 24);
    cd.writeUInt16LE(nom.length, 28); cd.writeUInt32LE(decalage, 42);
    parties.push(local, nom, comp);
    central.push(cd, nom);
    decalage += local.length + nom.length + comp.length;
  });
  var tailleCentral = central.reduce(function (s, b) { return s + b.length; }, 0);
  var fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entrees.length, 8); fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(tailleCentral, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat(parties.concat(central, [fin]));
}

/* =============== XLSX minimal =============== */
function xmlEch(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function colonne(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
// numéro de série Excel d'une date ISO (origine 1899-12-30)
function serieExcel(iso) { return Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000); }

// lignes : tableau de tableaux de valeurs {t:"s"|"n"|"d", v}
function xlsx(nomFeuille, lignes) {
  var partagees = [], index = {};
  function idPartage(s) { if (!(s in index)) { index[s] = partagees.length; partagees.push(s); } return index[s]; }
  var xmlLignes = lignes.map(function (l, r) {
    var cellules = l.map(function (cel, c) {
      var ref = colonne(c) + (r + 1);
      if (cel.v === "" || cel.v == null) return "";
      if (cel.t === "n") return '<c r="' + ref + '"><v>' + cel.v + '</v></c>';
      if (cel.t === "d") return '<c r="' + ref + '" s="1"><v>' + serieExcel(cel.v) + '</v></c>';
      return '<c r="' + ref + '" t="s"><v>' + idPartage(String(cel.v)) + '</v></c>';
    }).join("");
    return '<row r="' + (r + 1) + '">' + cellules + '</row>';
  }).join("");
  var feuille = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + xmlLignes + '</sheetData></worksheet>';
  var sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + partagees.length + '" uniqueCount="' + partagees.length + '">'
    + partagees.map(function (s) { return '<si><t xml:space="preserve">' + xmlEch(s) + '</t></si>'; }).join("") + '</sst>';
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>'
    + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
    + '</styleSheet>';
  return zip([
    { nom: "[Content_Types].xml", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>' },
    { nom: "_rels/.rels", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>' },
    { nom: "xl/workbook.xml", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="' + xmlEch(nomFeuille) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { nom: "xl/_rels/workbook.xml.rels", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>' },
    { nom: "xl/worksheets/sheet1.xml", contenu: feuille },
    { nom: "xl/sharedStrings.xml", contenu: sst },
    { nom: "xl/styles.xml", contenu: styles }
  ]);
}

/* =============== rapports AESH (suivi-aesh/2) =============== */
var ACCOMP = ["Reformulation des consignes", "Secrétaire, scripteur", "Aide à la mise en place du matériel",
  "Recentrage sur la tâche", "Aide à l'organisation", "Prise de notes", "Lecture à voix haute",
  "Aide à la manipulation", "Mise en confiance, encouragement", "Gestion des émotions",
  "Médiation avec l'enseignant", "Relations avec les autres élèves", "Aménagement des évaluations",
  "Aide aux déplacements", "Gestes du quotidien", "Mise en mots, verbalisation"];
var MATIERES_RAPPORT = ["Français", "Mathématiques", "Histoire-Géographie", "Anglais", "SVT", "EPS", "Questionner le monde", "Sciences"];
var RELATIONS = ["Fluide", "Fluide", "En construction", "Difficile"];
var TENDANCES = ["En progrès", "Stable", "En progrès", "En recul"];

function eleveParNom(court, classe, etab) {
  return ELEVES.filter(function (el) { return nomCourt(el) === court && el.c === classe && el.e === etab; })[0];
}
var compteurRapport = 0;
function rapport(el, periode) {
  compteurRapport++;
  var acc = (el.besoins && el.besoins.length) ? el.besoins.slice() : [];
  while (acc.length < 3) {
    var a = ACCOMP[Math.floor(alea() * ACCOMP.length)];
    if (acc.indexOf(a) < 0) acc.push(a);
  }
  var mat = melanger(MATIERES_RAPPORT.filter(function (m) {
    return el.e === LILAS ? ["Histoire-Géographie", "SVT"].indexOf(m) < 0 : ["Questionner le monde", "Sciences"].indexOf(m) < 0;
  })).slice(0, 2);
  var mutualise = !el.ind;
  return {
    id: "fictif-r" + String(compteurRapport).padStart(3, "0"),
    eleveId: "fictif-e-" + cleEleve(el).replace(/[^a-z0-9]+/g, "-"),
    eleveNom: nomCourt(el), classe: el.c, heures: (el.ind || el.mut) + " h", etablissement: el.e,
    periode: periode.nom, debut: periode.debut, fin: periode.fin, periodeTexte: periode.texte,
    modalite: mutualise ? "Mutualisé" : "Individuel", copartage: mutualise ? 2 : 0,
    relation: RELATIONS[Math.floor(alea() * RELATIONS.length)],
    invest: { tendance: TENDANCES[Math.floor(alea() * TENDANCES.length)], items: { engagement: ["Se met au travail après relance"] } },
    accomp: acc, matieres: mat,
    commentaire: "Rapport fictif généré pour les tests.",
    creeJour: periode.fin
  };
}
var P1 = { nom: "Période 1", debut: DEBUT_ANNEE, fin: AN + "-10-16", texte: "Période 1 — septembre-octobre " + AN };

// [aesh (texte libre, tel que saisi dans l'application AESH), période, élèves]
var TRANSMISSIONS = [
  ["Sophie Durand", P1, [["Clara G.", "4A", PORT], ["Louis I.", "6B", TILLEULS]]],
  // cas 14 : orthographes divergentes du nom de la même AESH
  ["sophie durand", P1, [["Sami S.", "3B", PORT]]],
  ["S. Durand", P1, [["Raphaël T.", "4C", TILLEULS], ["Clara G.", "4A", PORT]]],
  ["Léa Exemplaire", P1, [["Emma E.", "6A", TILLEULS], ["Alice P.", "6B", TILLEULS], ["Chloé B.", "5A", TILLEULS]]],
  ["Hugo Fictif", P1, [["Hugo M.", "5A", TILLEULS], ["Léna M.", "5A", TILLEULS], ["Adam E.", "5A", TILLEULS]]],
  ["Nadia Démonstration", P1, [["Jules É.", "3A", TILLEULS], ["Liam D.", "3B", PORT]]],
  ["Inès Factice", P1, [["Léo E.", "6A", PORT], ["Ethan B.", "5A", PORT]]],
  ["Chloé Prototype", P1, [["Paul F.", "CP", LILAS], ["Mia E.", "CP", LILAS]]],
  ["Yanis Maquette", P1, [["Lola T.", "CM2", LILAS], ["Iris S.", "CM1", LILAS], ["Lucas I.", "CE1", LILAS]]],
  ["Omar Essai", P1, [["Mila D.", "4A", TILLEULS], ["Anna É.", "3B", PORT]]]
];

/* =============== écriture des fichiers =============== */
function ecrire(nom, contenu) {
  fs.writeFileSync(path.join(DOSSIER, nom), contenu);
  console.log("  " + nom);
}

if (!fs.existsSync(DOSSIER)) fs.mkdirSync(DOSSIER);
console.log("Date de référence " + REF + " — année scolaire " + AN + "-" + (AN + 1));

var BOM = "﻿";
ecrire("FICTIF_eleves.csv", BOM + csv([ENTETE_ELEVES].concat(ELEVES.map(ligneEleve)), ";"));
ecrire("FICTIF_eleves_collision.csv", BOM + csv([ENTETE_ELEVES].concat(ELEVES_COLLISION.map(ligneEleve)), ";"));
ecrire("FICTIF_aesh.csv", BOM + csv([ENTETE_AESH].concat(AESH.map(ligneAesh)), ";"));
ecrire("FICTIF_aesh_renfort.csv", BOM + csv([ENTETE_AESH].concat(AESH_RENFORT.map(ligneAesh)), ";"));
// export « CSV (séparateur : point-virgule) » d'Excel en français : Windows-1252, sans BOM
ecrire("FICTIF_aesh_windows1252.csv", enWindows1252(csv([ENTETE_AESH].concat(AESH.map(ligneAesh)), ";")));
// séparateur virgule, UTF-8 sans BOM : teste la détection automatique
ecrire("FICTIF_edt_eleves.csv", csv(lignesEdt(), ","));

var lignesXlsx = [ENTETE_ELEVES.map(function (h) { return { t: "s", v: h }; })].concat(ELEVES.map(function (el) {
  return [{ t: "s", v: el.e }, { t: "s", v: el.c }, { t: "s", v: el.p }, { t: "s", v: el.n },
    { t: "n", v: el.ind || "" }, { t: "n", v: el.mut || "" }, { t: "s", v: ouiNon(el.recre) }, { t: "s", v: ouiNon(el.merid) },
    { t: "s", v: (el.besoins || []).join(" | ") }, { t: "d", v: DEBUT_ANNEE }, { t: "d", v: el.fin || FIN_ANNEE }];
}));
ecrire("FICTIF_eleves.xlsx", xlsx("Élèves", lignesXlsx));

TRANSMISSIONS.forEach(function (t, i) {
  var rapports = t[2].map(function (x) {
    var el = eleveParNom(x[0], x[1], x[2]);
    if (!el) { console.error("Élève introuvable pour un rapport : " + x.join(" / ")); process.exit(1); }
    return rapport(el, t[1]);
  });
  var etabs = [];
  rapports.forEach(function (r) { if (etabs.indexOf(r.etablissement) < 0) etabs.push(r.etablissement); });
  var contenu = { format: "suivi-aesh/2", genere_le: t[1].fin, aesh: t[0], etablissements: etabs, rapports: rapports };
  var nomFichier = "FICTIF_transmission_" + String(i + 1).padStart(2, "0") + "_" + sansAccent(t[0]).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
  ecrire(nomFichier, JSON.stringify(contenu, null, 2) + "\n");
});

/* =============== bilan =============== */
var totInd = 0, totMut = 0, totQ = 0;
ELEVES.forEach(function (el) { totInd += el.ind || 0; totMut += el.mut || 0; });
AESH.forEach(function (a) { totQ += a.q; });
console.log(ELEVES.length + " élèves, " + AESH.length + " AESH, " + TRANSMISSIONS.length + " transmissions.");
console.log("Heures notifiées : " + totInd + " h individuelles + " + totMut + " h mutualisées = " + (totInd + totMut)
  + " h ; quotités cumulées : " + totQ + " h (cas 7 : capacité insuffisante), "
  + AESH_RENFORT.reduce(function (t, a) { return t + a.q; }, 0) + " h de plus avec le renfort.");
