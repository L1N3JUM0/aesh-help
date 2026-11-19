"use strict";

/* =====================================================================
   PialTests — assertions du module Affectations, sans dépendance.

   Ce fichier est partagé par deux lanceurs qui exécutent exactement les
   mêmes tests :
   - pial/tests.html (navigateur, y compris en file://) ;
   - outils/tests-node.js (ligne de commande, Node sans npm).

   executer(env) renvoie une promesse de {reussis, echecs, ignores, lignes}.
   env = {
     modele: PialModele, zip: PialZip (facultatif), importFichiers:
     PialImport (facultatif), moteur: PialMoteur (facultatif),
     lireExemple: function (nom) -> Promise<Uint8Array|null> (null = fichier
       indisponible, par ex. navigateur en file:// : le test est ignoré)
   }
   Les tests ne touchent jamais à IndexedDB ni aux données réelles.
   ===================================================================== */
var PialTests = (function () {

  /* =============== mini-lanceur =============== */
  function EchecAssertion(message) { this.message = message; }

  function egal(obtenu, attendu, message) {
    var a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a !== b) throw new EchecAssertion((message ? message + " — " : "") + "obtenu " + a + ", attendu " + b);
  }
  function vrai(valeur, message) {
    if (!valeur) throw new EchecAssertion(message || "condition fausse");
  }
  function proche(obtenu, attendu, message) {
    if (Math.abs(obtenu - attendu) > 1e-6) throw new EchecAssertion((message ? message + " — " : "") + "obtenu " + obtenu + ", attendu " + attendu);
  }
  function Ignore(motif) { this.motif = motif; }

  /* =============== jeu de données minimal =============== */
  // construit un petit contexte autour de deux collèges (alternance A/B) et
  // d'une école (sans alternance). Les champs non précisés prennent des
  // valeurs neutres.
  function fixture(M, options) {
    options = options || {};
    var cA = M.etablissementParDefaut("Collège Test Alpha");
    var cB = M.etablissementParDefaut("Collège Test Bêta");
    var ec = M.etablissementParDefaut("École Test Gamma");
    if (options.etab) options.etab(cA, cB, ec);
    var an = "2026-2027";
    function eleve(prenom, nom, classe, etab, ind, mut, extra) {
      var court = M.nomCourt(prenom, nom), cle = M.cleEleve(court, classe, etab.nom);
      var e = { id: M.idEleve(an, cle), cle: cle, annee: an, nomCourt: court, classe: classe, etablissement: etab.id,
        heuresInd: ind || 0, heuresMut: mut || 0, recreation: false, meridienne: false, besoins: [] };
      Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
      return e;
    }
    var e = {
      ind: eleve("Lucas", "Martin", "5B", cA, 6, 0),
      mut1: eleve("Léa", "Durand", "5B", cA, 0, 4),
      mut2: eleve("Hugo", "Petit", "5B", cA, 0, 4),
      mut3: eleve("Zoé", "Roux", "5B", cA, 0, 4),
      lv2Esp: eleve("Inès", "Blanc", "4A", cA, 0, 4),
      lv2All: eleve("Noé", "Garnier", "4A", cA, 0, 4),
      autreClasse: eleve("Emma", "Faure", "5C", cA, 0, 4),
      peri: eleve("Tom", "Leroy", "6A", cA, 4, 0, { recreation: true, meridienne: true }),
      peri2: eleve("Lina", "Morel", "3A", cA, 0, 3, { recreation: true }),
      portB: eleve("Sami", "Noir", "6A", cB, 6, 0),
      ecole: eleve("Mia", "Vert", "CP", ec, 6, 0)
    };
    var cours = [], n = 0;
    function co(el, etab, jour, debut, fin, matiere, semaine, groupe, etat) {
      n++;
      cours.push({ id: "c" + n, eleveId: el.id, etablissement: etab.id, classe: el.classe, jour: jour, debut: debut, fin: fin,
        matiere: matiere, semaine: semaine || "", groupe: groupe || "", etat: etat || "normal" });
    }
    // 5B : une journée complète le lundi, identique pour les quatre élèves
    [e.ind, e.mut1, e.mut2, e.mut3].forEach(function (el) {
      [["08:00", "08:55"], ["08:55", "09:50"], ["10:05", "11:00"], ["11:00", "11:55"], ["11:55", "12:50"],
        ["12:50", "13:45"], ["13:45", "14:40"], ["14:40", "15:35"], ["15:35", "16:30"]].forEach(function (h, i) {
        co(el, cA, "lundi", h[0], h[1], i % 2 ? "Français" : "Mathématiques");
      });
      co(el, cA, "mardi", "08:00", "08:55", "SVT", "A");      // semaine A seulement
      co(el, cA, "mardi", "08:55", "09:50", "Technologie", "B");
      co(el, cA, "mercredi", "08:00", "08:55", "Anglais");
      co(el, cA, "vendredi", "09:00", "09:55", "Histoire-Géographie");
      co(el, cA, "vendredi", "14:00", "14:55", "EPS");
    });
    co(e.autreClasse, cA, "lundi", "08:00", "08:55", "Mathématiques");
    // 4A : même créneau de LV2, groupes différents (cas 1)
    co(e.lv2Esp, cA, "jeudi", "10:05", "11:00", "LV2", "", "LV2 espagnol");
    co(e.lv2All, cA, "jeudi", "10:05", "11:00", "LV2", "", "LV2 allemand");
    co(e.peri, cA, "lundi", "08:00", "11:55", "Français");
    co(e.peri, cA, "lundi", "13:30", "16:30", "Mathématiques");
    co(e.peri2, cA, "lundi", "08:00", "11:55", "Français");
    co(e.portB, cB, "lundi", "09:00", "09:55", "Français");
    co(e.portB, cB, "lundi", "10:00", "10:55", "Français");
    co(e.ecole, ec, "lundi", "08:30", "09:30", "Français", "A");
    var aesh = [
      { id: "aesh|x", nom: "X", prenom: "Ana", quotite: 24, etablissements: [], indisponibilites: [] },
      { id: "aesh|y", nom: "Y", prenom: "Bob", quotite: 2, etablissements: [cA.id], indisponibilites: ["mer", "ven-pm"] }
    ];
    return {
      an: an, cA: cA, cB: cB, ec: ec, e: e, cours: cours, aesh: aesh,
      ctx: function (affectations, reglages) {
        return M.contexte({ etablissements: [cA, cB, ec], eleves: Object.keys(e).map(function (k) { return e[k]; }),
          aesh: aesh, cours: cours, affectations: affectations || [], reglages: reglages || {} });
      }
    };
  }
  var compteurAff = 0;
  function aff(aeshId, etab, jour, debut, fin, modalite, eleves, semaine, extra) {
    compteurAff++;
    var a = { id: "a" + String(compteurAff).padStart(4, "0"), version: 0, aeshId: aeshId,
      creneau: { etab: etab.id, jour: jour, debut: debut, fin: fin, semaine: semaine || "toutes" },
      modalite: modalite, eleves: eleves.map(function (el) { return el.id; }), epinglee: true, origine: "manuel" };
    Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; });
    return a;
  }
  function codes(violations) { return violations.map(function (v) { return v.code; }); }
  function avecCode(violations, code) { return violations.filter(function (v) { return v.code === code; }); }

  /* =============== tests du modèle =============== */
  function testsModele(t, M) {
    t("clés : nom court et minimisation", function () {
      egal(M.nomCourt("Lucas", "Martin"), "Lucas M.");
      egal(M.nomCourt(" Inès ", "  échantillon "), "Inès É.");
      egal(M.nomCourt("Lucas", "Ma."), "Lucas Ma.", "abréviation choisie conservée");
      egal(M.nomCourt("Marie  Lou", "dupont"), "Marie Lou D.");
    });
    t("clés : format et normalisation", function () {
      egal(M.cleEleve("Lucas M.", "5B", "Collège Paul Gauthier"), "lucas m.|5b|college paul gauthier");
      egal(M.cleEleve("LUCAS  m.", " 5b", "COLLÈGE PAUL GAUTHIER"), "lucas m.|5b|college paul gauthier");
      egal(M.idEleve("2026-2027", "lucas m.|5b|x"), "2026-2027|lucas m.|5b|x");
      egal(M.idAesh("Durand", "Sophie"), "durand|sophie");
      egal(M.idAesh(" DURAND ", "sophie"), "durand|sophie");
    });
    t("clés : collisions", function () {
      var cles = [M.cleEleve(M.nomCourt("Lucas", "Martin"), "5B", "C"), M.cleEleve(M.nomCourt("Lucas", "Moreau"), "5B", "C"),
        M.cleEleve(M.nomCourt("Lucas", "Martin"), "5A", "C")];
      egal(M.collisions(cles), { "lucas m.|5b|c": [0, 1] });
      var levees = [M.cleEleve(M.nomCourt("Lucas", "Ma."), "5B", "C"), M.cleEleve(M.nomCourt("Lucas", "Mo."), "5B", "C")];
      egal(M.collisions(levees), {}, "collision levée par abréviation");
    });
    t("années scolaires, niveaux, types d'établissement", function () {
      egal(M.anneeScolaire("2026-11-18"), "2026-2027");
      egal(M.anneeScolaire("2027-03-01"), "2026-2027");
      egal(M.anneeScolaire("2027-08-20"), "2027-2028");
      egal(["6A", "5eme B", "4", "3e2", "CP", "ce1", "CM2 b", "2nde 3", "1re G", "TG2", "ULIS"].map(M.niveauClasse),
        ["6e", "5e", "4e", "3e", "CP", "CE1", "CM2", "2de", "1re", "Tle", "Autre"]);
      egal(M.typeEtablissement("École Jean Moulin"), "ecole");
      egal(M.typeEtablissement("Lycée Victor Hugo"), "lycee");
      egal(M.typeEtablissement("Collège Paul Gauthier"), "college");
      egal(M.etablissementParDefaut("Collège X").alternance, true);
      egal(M.etablissementParDefaut("École Y").alternance, false);
      egal(M.etablissementParDefaut("École Y").joursOuvres.indexOf("mercredi"), -1);
    });
    t("jours et heures", function () {
      egal(["lundi", "Mardi", "mer", "Mer.", "JEUDI", "ven", "dimanche", "lu"].map(M.jourNormalise),
        ["lundi", "mardi", "mercredi", "mercredi", "jeudi", "vendredi", "", ""]);
      egal(M.minutes("08:00"), 480);
      egal(M.minutes("8h30"), 510);
      egal(M.minutes("14h"), 840);
      vrai(isNaN(M.minutes("25:00")) && isNaN(M.minutes("abc")), "heures invalides");
      egal(M.heureNormalisee("8h5"), "08:05");
    });
    t("durées comptées (arrondi à l'heure, minimum 1 h)", function () {
      egal(M.dureeComptee("08:00", "08:55"), 1, "55 min");
      egal(M.dureeComptee("10:00", "11:50"), 2, "1 h 50");
      egal(M.dureeComptee("10:00", "10:30"), 1, "30 min → minimum 1 h");
      egal(M.dureeComptee("10:00", "11:29"), 1, "1 h 29");
      egal(M.dureeComptee("10:00", "11:30"), 2, "1 h 30");
      proche(M.dureeComptee("10:00", "10:15", true), 0.25, "périscolaire : durée réelle");
      proche(M.dureeComptee("08:00", "08:55", false, { dureeReelle: true }), 55 / 60, "réglage durée réelle");
      egal(M.dureeComptee("09:00", "08:00"), 0, "créneau incohérent");
    });
    t("semaines A/B", function () {
      var college = M.etablissementParDefaut("Collège X"), ecole = M.etablissementParDefaut("École Y");
      egal(M.semainesDe("", college), ["A", "B"]);
      egal(M.semainesDe("toutes", college), ["A", "B"]);
      egal(M.semainesDe("A", college), ["A"]);
      egal(M.semainesDe(" b ", college), ["B"]);
      egal(M.semainesDe("A", ecole), ["A", "B"], "sans alternance : A = B");
      egal(M.semaineNormalisee("Semaine A"), "A");
    });

    t("couverture d'un élève : états et moyenne A/B", function () {
      var f = fixture(M), e = f.e;
      function couverture(liste) { return M.couvertureEleve(e.ind, f.ctx(liste)); }
      var h = [["08:00", "08:55"], ["08:55", "09:50"], ["10:05", "11:00"], ["11:00", "11:55"], ["11:55", "12:50"], ["12:50", "13:45"]];
      var six = h.map(function (x) { return aff("aesh|x", f.cA, "lundi", x[0], x[1], "individuel", [e.ind]); });
      var c = couverture(six);
      egal([c.ind.moy, c.ind.etat, c.etat], [6, "couvert", "couvert"]);
      c = couverture(six.slice(0, 5));
      egal([c.ind.moy, c.ind.etat], [5, "sous"], "écart de 1 h");
      var partiel = six.slice(0, 5).concat([aff("aesh|x", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind], "A")]);
      c = couverture(partiel);
      egal([c.ind.A, c.ind.B, c.ind.moy, c.ind.etat], [6, 5, 5.5, "partiel"], "cours de semaine A seulement");
      c = couverture(six.concat([aff("aesh|x", f.cA, "lundi", "13:45", "14:40", "individuel", [e.ind])]));
      egal(c.ind.etat, "sur");
      egal(M.etatCouverture(0, 0), "couvert");
    });
    t("couverture : individuel, mutualisé et périscolaire séparés ; état le plus défavorable", function () {
      var f = fixture(M), e = f.e;
      var liste = [
        aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.peri]),
        aff("aesh|x", f.cA, "lundi", "10:00", "10:15", "periscolaire", [e.peri, e.peri2], "toutes", { periscolaire: "recreation" })
      ];
      var c = M.couvertureEleve(e.peri, f.ctx(liste));
      egal([c.ind.moy, c.mut.moy], [1, 0]);
      proche(c.peri.moy, 0.25, "périscolaire compté à part");
      egal(c.ind.etat, "sous");
      var f2 = fixture(M);
      var c2 = M.couvertureEleve(f2.e.ind, f2.ctx([]));
      egal([c2.ind.etat, c2.mut.etat, c2.etat], ["sous", "couvert", "sous"]);
    });
    t("charge d'une AESH : 1 h quel que soit le nombre d'élèves, états", function () {
      var f = fixture(M), e = f.e;
      var liste = [
        aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "mutualise", [e.mut1, e.mut2, e.mut3]),
        aff("aesh|x", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind], "A"),
        aff("aesh|x", f.cA, "lundi", "10:00", "10:15", "periscolaire", [e.peri], "toutes", { periscolaire: "recreation" })
      ];
      var ch = M.chargeAesh(f.aesh[0], f.ctx(liste));
      proche(ch.A, 2.25); proche(ch.B, 1.25); proche(ch.moy, 1.75);
      egal(M.etatCharge(24, 24, 24), "complete");
      egal(M.etatCharge(21.5, 21.5, 24), "sous", "89,6 %");
      egal(M.etatCharge(21.6, 21.6, 24), "complete", "90 %");
      egal(M.etatCharge(25, 19, 24), "depassement", "dépassement en semaine A seulement");
      egal(M.etatCharge(0, 0, 24), "sous");
    });

    /* ---------- les 7 contraintes dures ---------- */
    t("contrainte 1 : pas de chevauchement", function () {
      var f = fixture(M), e = f.e;
      var a1 = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]);
      var a2 = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.autreClasse]);
      var v = M.verifierAffectation(a2, f.ctx([a1, a2]));
      egal(avecCode(v, "chevauchement").length, 1);
      var b1 = aff("aesh|x", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind], "A");
      var b2 = aff("aesh|x", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind], "B");
      egal(avecCode(M.verifierAffectation(b2, f.ctx([b1, b2])), "chevauchement"), [], "A et B ne se chevauchent pas");
      var c1 = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]);
      var c2 = aff("aesh|x", f.cA, "lundi", "08:55", "09:50", "individuel", [e.ind]);
      egal(avecCode(M.verifierAffectation(c2, f.ctx([c1, c2])), "chevauchement"), [], "créneaux contigus");
    });
    t("contrainte 2 : individuel exclusif", function () {
      var f = fixture(M), e = f.e;
      var a = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind, e.mut1]);
      egal(avecCode(M.verifierAffectation(a, f.ctx([a])), "individuel").length, 1);
      var b = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]);
      egal(avecCode(M.verifierAffectation(b, f.ctx([b])), "individuel"), []);
    });
    t("contrainte 3 : mutualisation (cas 2 : trois élèves, même cours, même groupe)", function () {
      var f = fixture(M), e = f.e;
      var a = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "mutualise", [e.mut1, e.mut2, e.mut3]);
      egal(M.verifierAffectation(a, f.ctx([a])), [], "aucune violation");
      var ctx = f.ctx([]);
      var c1 = M.coursSurCreneau(e.mut1.id, a.creneau, ctx)[0], c2 = M.coursSurCreneau(e.mut2.id, a.creneau, ctx)[0];
      vrai(M.peutMutualiser(e.mut1, c1, e.mut2, c2), "peutMutualiser");
    });
    t("contrainte 3 : mutualisation (cas 1 : groupes de LV2 différents)", function () {
      var f = fixture(M), e = f.e;
      var a = aff("aesh|x", f.cA, "jeudi", "10:05", "11:00", "mutualise", [e.lv2Esp, e.lv2All]);
      egal(avecCode(M.verifierAffectation(a, f.ctx([a])), "mutualisation").length, 1);
      var ctx = f.ctx([]);
      vrai(!M.peutMutualiser(e.lv2Esp, M.coursSurCreneau(e.lv2Esp.id, a.creneau, ctx)[0], e.lv2All, M.coursSurCreneau(e.lv2All.id, a.creneau, ctx)[0]));
    });
    t("contrainte 3 : pas de mutualisation entre classes, ni sans notification mutualisée", function () {
      var f = fixture(M), e = f.e;
      var a = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "mutualise", [e.mut1, e.autreClasse]);
      egal(avecCode(M.verifierAffectation(a, f.ctx([a])), "mutualisation").length, 1, "classes différentes");
      var b = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "mutualise", [e.mut1, e.ind]);
      vrai(avecCode(M.verifierAffectation(b, f.ctx([b])), "mutualisation").length >= 1, "élève non notifié en mutualisé");
    });
    t("contrainte 3 : périscolaire mutualisable entre classes d'un même établissement", function () {
      var f = fixture(M), e = f.e;
      var a = aff("aesh|x", f.cA, "lundi", "10:00", "10:15", "periscolaire", [e.peri, e.peri2], "toutes", { periscolaire: "recreation" });
      egal(M.verifierAffectation(a, f.ctx([a])), []);
      var b = aff("aesh|x", f.cA, "lundi", "12:00", "13:30", "periscolaire", [e.peri, e.peri2], "toutes", { periscolaire: "meridienne" });
      egal(codes(M.verifierAffectation(b, f.ctx([b]))), ["notification"], "pause méridienne non notifiée pour Lina");
      var c = aff("aesh|x", f.cA, "lundi", "10:00", "10:15", "periscolaire", [e.peri, e.portB], "toutes", { periscolaire: "recreation" });
      vrai(avecCode(M.verifierAffectation(c, f.ctx([c])), "mutualisation").length === 1, "autre établissement");
    });
    t("présence de l'élève, semaine du cours, cours exclu", function () {
      var f = fixture(M), e = f.e;
      var a = aff("aesh|x", f.cA, "jeudi", "15:00", "15:55", "individuel", [e.ind]);
      egal(codes(M.verifierAffectation(a, f.ctx([a]))), ["presence"]);
      var b = aff("aesh|x", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind], "toutes");
      egal(codes(M.verifierAffectation(b, f.ctx([b]))), ["presence"], "cours en semaine A seulement");
      f.cours.forEach(function (c) { if (c.eleveId === e.ind.id && c.jour === "mercredi") c.etat = "exclu"; });
      var c = aff("aesh|x", f.cA, "mercredi", "08:00", "08:55", "individuel", [e.ind]);
      egal(codes(M.verifierAffectation(c, f.ctx([c]))), ["exclu"]);
    });
    t("contrainte 4 : 1 h entre deux établissements", function () {
      var f = fixture(M), e = f.e;
      var a1 = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]);
      var a2 = aff("aesh|x", f.cB, "lundi", "09:00", "09:55", "individuel", [e.portB]);
      egal(avecCode(M.verifierAffectation(a2, f.ctx([a1, a2])), "deplacement").length, 1, "5 min d'écart");
      egal(avecCode(M.verifierAffectation(a1, f.ctx([a1, a2])), "deplacement").length, 1, "signalé des deux côtés");
      var a3 = aff("aesh|x", f.cB, "lundi", "10:00", "10:55", "individuel", [e.portB]);
      egal(avecCode(M.verifierAffectation(a3, f.ctx([a1, a3])), "deplacement"), [], "65 min d'écart");
      var a4 = aff("aesh|x", f.cA, "lundi", "08:55", "09:50", "individuel", [e.ind]);
      egal(avecCode(M.verifierAffectation(a4, f.ctx([a1, a4])), "deplacement"), [], "même établissement");
    });
    t("contrainte 5 : quotité respectée en semaine A et en semaine B", function () {
      var f = fixture(M), e = f.e; // aesh|y : quotité 2 h
      var l = [
        aff("aesh|y", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]),
        aff("aesh|y", f.cA, "lundi", "08:55", "09:50", "individuel", [e.ind]),
        aff("aesh|y", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind], "A")
      ];
      var v = M.verifierAffectation(l[2], f.ctx(l));
      egal(avecCode(v, "quotite").length, 1, "3 h en semaine A");
      vrai(/semaine A/.test(avecCode(v, "quotite")[0].message));
      var l2 = [l[0], aff("aesh|y", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind], "A"),
        aff("aesh|y", f.cA, "mardi", "08:55", "09:50", "individuel", [e.ind], "B")];
      egal(avecCode(M.verifierAffectation(l2[1], f.ctx(l2)), "quotite"), [], "2 h en A, 2 h en B");
    });
    t("contrainte 6 : pause repas (plage, réglage par établissement, pause méridienne)", function () {
      var f = fixture(M), e = f.e;
      var lundi = [["08:00", "08:55"], ["08:55", "09:50"], ["10:05", "11:00"], ["11:00", "11:55"], ["11:55", "12:50"],
        ["12:50", "13:45"], ["13:45", "14:40"], ["14:40", "15:35"], ["15:35", "16:30"]];
      var pleine = lundi.map(function (h) { return aff("aesh|x", f.cA, "lundi", h[0], h[1], "individuel", [e.ind]); });
      var v = avecCode(M.verifierAffectation(pleine[0], f.ctx(pleine)), "pause");
      egal([v.length, v[0] && v[0].niveau], [1, "erreur"], "journée pleine sans pause");
      var trou = pleine.filter(function (a, i) { return i !== 5; }); // libre 12:50-13:45
      egal(avecCode(M.verifierAffectation(trou[0], f.ctx(trou)), "pause"), [], "pause de 55 min dans la plage");
      var f2 = fixture(M, { etab: function (cA) { cA.pauseRepas = { debut: "13:50", fin: "15:00" }; } });
      var pleine2 = lundi.map(function (h) { return aff("aesh|x", f2.cA, "lundi", h[0], h[1], "individuel", [f2.e.ind]); });
      var trou2 = pleine2.filter(function (a, i) { return i !== 5; });
      egal(avecCode(M.verifierAffectation(trou2[0], f2.ctx(trou2)), "pause").length, 1, "plage réglée par établissement");
      var courte = pleine.slice(0, 6); // 08:00-13:45 : moins de 6 h de présence
      egal(avecCode(M.verifierAffectation(courte[0], f.ctx(courte)), "pause"), [], "journée de moins de 6 h");
      // pause méridienne accompagnée : pause possible hors plage, signalée
      var f3 = fixture(M);
      var l3 = [["08:00", "08:55"], ["08:55", "09:50"], ["11:00", "11:55"]].map(function (h) { return aff("aesh|x", f3.cA, "lundi", h[0], h[1], "individuel", [f3.e.ind]); })
        .concat([aff("aesh|x", f3.cA, "lundi", "11:55", "13:45", "periscolaire", [f3.e.peri], "toutes", { periscolaire: "meridienne" })])
        .concat([["13:45", "14:40"], ["14:40", "15:35"], ["15:35", "16:30"]].map(function (h) { return aff("aesh|x", f3.cA, "lundi", h[0], h[1], "individuel", [f3.e.ind]); }));
      var v3 = avecCode(M.verifierAffectation(l3[0], f3.ctx(l3)), "pause");
      egal([v3.length, v3[0] && v3[0].niveau], [1, "info"], "pause 09:50-11:00 hors plage : signalée, non bloquante");
    });
    t("contrainte 7 : indisponibilités et établissements possibles", function () {
      var f = fixture(M), e = f.e; // aesh|y : indisponible mer et ven-pm, seulement collège Alpha
      function v(a, reglages) { return codes(M.verifierAffectation(a, f.ctx([a], reglages))).filter(function (c) { return c === "indisponibilite" || c === "etablissement"; }); }
      egal(v(aff("aesh|y", f.cA, "mercredi", "08:00", "08:55", "individuel", [e.ind])), ["indisponibilite"]);
      egal(v(aff("aesh|y", f.cA, "vendredi", "14:00", "14:55", "individuel", [e.ind])), ["indisponibilite"], "vendredi après-midi");
      egal(v(aff("aesh|y", f.cA, "vendredi", "09:00", "09:55", "individuel", [e.ind])), [], "vendredi matin");
      egal(v(aff("aesh|y", f.cB, "lundi", "09:00", "09:55", "individuel", [e.portB])), ["etablissement"]);
      egal(v(aff("aesh|y", f.cA, "mercredi", "08:00", "08:55", "individuel", [e.ind]), { respecterIndispos: false }), [], "réglage global désactivé");
      f.aesh[1].ignorerIndispos = true;
      egal(v(aff("aesh|y", f.cA, "mercredi", "08:00", "08:55", "individuel", [e.ind])), [], "désactivé pour cette AESH");
    });
    t("motifs d'indisponibilité pour le menu d'un créneau", function () {
      var f = fixture(M), e = f.e;
      var a1 = aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.autreClasse]);
      var ctx = f.ctx([a1]);
      var candidat = { creneau: { etab: f.cA.id, jour: "lundi", debut: "08:00", fin: "08:55", semaine: "toutes" }, modalite: "individuel", eleves: [e.ind.id] };
      egal(codes(M.motifsIndisponibilite("aesh|x", candidat, ctx)), ["chevauchement"]);
      egal(codes(M.motifsIndisponibilite("aesh|x", candidat, ctx, a1.id)), [], "en remplaçant l'affectation existante");
      egal(codes(M.motifsIndisponibilite("aesh|y", { creneau: { etab: f.cB.id, jour: "lundi", debut: "09:00", fin: "09:55", semaine: "toutes" }, modalite: "individuel", eleves: [e.portB.id] }, ctx)), ["etablissement"]);
    });
    t("créneaux périscolaires d'un élève", function () {
      var f = fixture(M), e = f.e;
      var p = M.creneauxPeriscolaires(e.peri, f.ctx([]));
      egal(p.map(function (x) { return x.type + " " + x.creneau.jour + " " + x.creneau.debut; }),
        ["recreation lundi 10:00", "recreation lundi 15:00", "meridienne lundi 12:00"]);
      egal(M.creneauxPeriscolaires(e.peri2, f.ctx([])).map(function (x) { return x.type + " " + x.creneau.debut; }), ["recreation 10:00"], "matin seulement");
    });
    t("état prioritaire / normal / exclu des créneaux périscolaires", function () {
      var f = fixture(M), e = f.e;
      e.peri.etatsPeriscolaires = { meridienne: "prioritaire", "recreation|lundi|15:00": "exclu" };
      var ctx = f.ctx([]);
      egal(M.creneauxPeriscolaires(e.peri, ctx).map(function (x) { return x.type + " " + x.creneau.debut + " " + x.etat; }),
        ["recreation 10:00 normal", "recreation 15:00 exclu", "meridienne 12:00 prioritaire"]);
      var a = aff("aesh|x", f.cA, "lundi", "15:00", "15:15", "periscolaire", [e.peri], "toutes", { periscolaire: "recreation" });
      egal(codes(M.verifierAffectation(a, f.ctx([a]))), ["exclu"], "temps périscolaire exclu");
    });
    t("alertes : conflits, notifications, dépassements ; déterministes", function () {
      var f = fixture(M), e = f.e;
      e.ind.finNotif = "2026-12-09";
      e.mut1.finNotif = "2026-11-14";
      e.mut2.finNotif = "2027-07-04";
      var l = [aff("aesh|y", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]),
        aff("aesh|y", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]),
        aff("aesh|y", f.cA, "lundi", "08:55", "09:50", "individuel", [e.ind])];
      var al = M.alertes(f.ctx(l), "2026-11-19");
      var notif = al.filter(function (a) { return a.type === "notification"; });
      egal(notif.map(function (a) { return a.niveau + " " + a.eleveId; }), ["erreur " + e.mut1.id, "attention " + e.ind.id]);
      vrai(al.some(function (a) { return a.code === "chevauchement"; }), "conflit manuel listé");
      egal(al.filter(function (a) { return a.code === "quotite"; }).map(function (a) { return /semaine (A|B)/.exec(a.message)[1]; }),
        ["A", "B"], "une seule alerte de quotité par AESH et par semaine");
      vrai(al.some(function (a) { return a.type === "charge" && a.aeshId === "aesh|y"; }));
      egal(al[0].niveau, "erreur", "erreurs en tête");
      egal(JSON.stringify(M.alertes(f.ctx(l), "2026-11-19")), JSON.stringify(al), "deux calculs identiques");
    });
    t("synthèse du bandeau", function () {
      var f = fixture(M), e = f.e;
      var s = M.synthese(f.ctx([aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "mutualise", [e.mut1, e.mut2])]));
      egal([s.indDemande, s.indCouvert, s.mutDemande, s.mutCouvert], [22, 0, 27, 2]);
    });
  }

  /* =============== tests ZIP =============== */
  function base64(s) {
    var b = atob(s), o = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i);
    return o;
  }
  function texte(octets) { return new TextDecoder("utf-8").decode(octets); }
  // archive produite par un autre outil (Python zipfile) : une entrée
  // compressée en deflate, au nom accentué, et une entrée vide stockée
  var ZIP_DEFLATE = "UEsDBBQAAAgIAABQc13xdB+5HgAAAKQBAAATAAAAZG9zc2llci/DqWzDqHZlLnR4dDvcmXN4RVmqQmJycn5uQWJ63uGVOgqHRwUVBpEgAFBLAwQUAAAAAAAAUHNdAAAAAAAAAAAAAAAACAAAAHZpZGUudHh0UEsBAhQAFAAACAgAAFBzXfF0H7keAAAApAEAABMAAAAAAAAAAAAAAIABAAAAAGRvc3NpZXIvw6lsw6h2ZS50eHRQSwECFAAUAAAAAAAAUHNdAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAgAFPAAAAdmlkZS50eHRQSwUGAAAAAAIAAgB3AAAAdQAAAAAA";

  function testsZip(t, Z, env) {
    t("CRC32", function () {
      egal(Z.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
      egal(Z.crc32(new Uint8Array(0)), 0);
    });
    t("écriture « store » puis relecture (aller-retour)", function () {
      var fichiers = [
        { nom: "Sophie D./message.txt", donnees: "Objet : affectation\r\nBonjour Sophie,\r\n" },
        { nom: "Sophie D./emploi-du-temps.html", donnees: "<p>Élève : Lucas M. — 5B</p>" },
        { nom: "recapitulatif.csv", donnees: new Uint8Array([0xEF, 0xBB, 0xBF, 0x41, 0x3B, 0x42]) },
        { nom: "vide.txt", donnees: "" }
      ];
      var octets = Z.ecrire(fichiers, new Date(2026, 10, 19, 10, 30, 0));
      var liste = Z.entrees(octets);
      egal(liste.map(function (e) { return [e.nom, e.methode]; }),
        fichiers.map(function (f) { return [f.nom, 0]; }), "noms et méthode store");
      egal(JSON.stringify(Array.prototype.slice.call(Z.ecrire(fichiers, new Date(2026, 10, 19, 10, 30, 0)))),
        JSON.stringify(Array.prototype.slice.call(octets)), "écriture reproductible");
      return Z.lire(octets).then(function (contenu) {
        egal(Object.keys(contenu), fichiers.map(function (f) { return f.nom; }));
        egal(texte(contenu["Sophie D./emploi-du-temps.html"]), "<p>Élève : Lucas M. — 5B</p>");
        egal(Array.prototype.slice.call(contenu["recapitulatif.csv"]), [0xEF, 0xBB, 0xBF, 0x41, 0x3B, 0x42]);
        egal(contenu["vide.txt"].length, 0);
      });
    });
    t("lecture d'une archive compressée (deflate) produite par un autre outil", function () {
      if (typeof DecompressionStream === "undefined") throw new Ignore("DecompressionStream indisponible");
      return Z.lire(base64(ZIP_DEFLATE)).then(function (contenu) {
        egal(Object.keys(contenu), ["dossier/élève.txt", "vide.txt"]);
        egal(texte(contenu["dossier/élève.txt"]), new Array(21).join("Élève accompagné, "));
      });
    });
    t("filtre des entrées et détection d'une archive corrompue", function () {
      var octets = Z.ecrire([{ nom: "a.txt", donnees: "abc" }, { nom: "b.txt", donnees: "def" }]);
      return Z.lire(octets, function (n) { return n === "b.txt"; }).then(function (c) {
        egal(Object.keys(c), ["b.txt"]);
        var abime = octets.slice();
        abime[30 + 5] = 0x5A; // premier octet des données de a.txt
        return Z.lire(abime).then(function () { throw new EchecAssertion("CRC non vérifié"); }, function (err) {
          egal(err.message, "crc-invalide");
        });
      }).then(function () {
        var refus = false;
        try { Z.entrees(new TextEncoder().encode("pas une archive")); } catch (e) { refus = e.message === "zip-invalide"; }
        vrai(refus, "fichier qui n'est pas un ZIP");
      });
    });
    t("lecture de exemples/FICTIF_eleves.xlsx", function () {
      return env.lireExemple("FICTIF_eleves.xlsx").then(function (octets) {
        if (!octets) throw new Ignore("fichier d'exemple non accessible (page ouverte en file://)");
        if (typeof DecompressionStream === "undefined") throw new Ignore("DecompressionStream indisponible");
        return Z.lire(octets).then(function (c) {
          vrai(c["xl/workbook.xml"] && c["xl/worksheets/sheet1.xml"] && c["xl/sharedStrings.xml"], "parties du classeur");
          vrai(/Collège Fictif des Tilleuls/.test(texte(c["xl/sharedStrings.xml"])), "texte UTF-8");
        });
      });
    });
  }

  /* =============== tests d'import (CSV / XLSX) =============== */
  function octetsLatin1(s) {
    var o = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  }
  function testsImport(t, I, M, Z, env) {
    var AN = "2026-2027";
    t("CSV : décodage UTF-8 (avec et sans BOM) et Windows-1252", function () {
      var avecBom = new Uint8Array([0xEF, 0xBB, 0xBF].concat(Array.prototype.slice.call(new TextEncoder().encode("Prénom;Quotité"))));
      egal(I.decoderTexte(avecBom), { texte: "Prénom;Quotité", encodage: "utf-8" });
      egal(I.decoderTexte(new TextEncoder().encode("Élève")), { texte: "Élève", encodage: "utf-8" });
      egal(I.decoderTexte(octetsLatin1("Hélène;Quotité;École")), { texte: "Hélène;Quotité;École", encodage: "windows-1252" });
    });
    t("CSV : séparateur détecté et guillemets", function () {
      egal(I.detecterSeparateur('Nom;"Besoins, divers";Classe\r\nA;B;C'), ";");
      egal(I.detecterSeparateur('Nom,"Besoins; divers",Classe\nA,B,C'), ",");
      egal(I.detecterSeparateur("\r\n\r\nNom,Prenom\n"), ",");
      egal(I.analyserCSV('a;"b ""c"" d";"e\r\nf"\r\n\r\n;;\r\ng;h;i', ";"), [["a", 'b "c" d', "e\r\nf"], ["g", "h", "i"]]);
      egal(I.analyserCSV("x,y\nz,", ","), [["x", "y"], ["z", ""]]);
    });
    t("correspondance des colonnes par synonymes (casse et accents ignorés)", function () {
      var entetes = ["Établissement", "CLASSE", "Prénom élève", "NOM ÉLÈVE", "Heures individuelles", "h_mutualisées", "Fin notif"];
      var c = I.correspondanceAuto("eleves", entetes);
      egal([c.etablissement, c.classe, c.prenom, c.nom, c.heuresInd, c.heuresMut, c.finNotif], [0, 1, 2, 3, 4, 5, 6]);
      egal(I.champsManquants("eleves", c), []);
      egal(I.champsManquants("eleves", I.correspondanceAuto("eleves", ["nom_eleve", "Classe"])), ["Établissement", "Prénom"]);
      egal(I.correspondanceAuto("eleves", ["nom_eleve"]).nom, 0, "nom_eleve");
      var memo = I.correspondanceAMemoriser(["Bidule", "Machin"], { nom: 0, prenom: 1 });
      egal(memo, { nom: "bidule", prenom: "machin" });
      var c2 = I.correspondanceAuto("eleves", ["Machin", "Bidule"], memo);
      egal([c2.nom, c2.prenom], [1, 0], "correspondance mémorisée");
      var e = I.correspondanceAuto("edt", ["Etablissement", "Classe", "Eleve", "Jour", "Debut", "Fin", "Matiere", "Semaine", "Groupe", "Priorite"]);
      egal(I.champsManquants("edt", e), []);
    });
    t("conversion des valeurs : nombres, oui/non, dates, heures", function () {
      egal([I.nombre("1,5"), I.nombre("6 h"), I.nombre(""), I.nombre("4.5")], [1.5, 6, 0, 4.5]);
      vrai(isNaN(I.nombre("six")));
      egal([I.booleen("Oui"), I.booleen("x"), I.booleen(""), I.booleen("NON"), I.booleen("peut-être")], [true, true, false, false, null]);
      egal([I.dateIso("2026-09-01"), I.dateIso("01/09/2026"), I.dateIso("4/7/27"), I.dateIso("46266"), I.dateIso(""), I.dateIso("bientôt")],
        ["2026-09-01", "2026-09-01", "2027-07-04", "2026-09-01", "", null]);
      egal([I.heure("08:00"), I.heure("8h05"), I.heure("08:00:00"), I.heure("0.3333333333"), I.heure("0.6041666667"), I.heure("midi")],
        ["08:00", "08:05", "08:00", "08:00", "14:30", ""]);
    });
    t("gabarits : UTF-8 avec BOM, « ; », lignes d'exemple reconnues", function () {
      ["eleves", "aesh", "edt"].forEach(function (type) {
        var g = I.gabarit(type);
        egal(g.charCodeAt(0), 0xFEFF, type + " : BOM");
        var lignes = I.analyserCSV(g.slice(1));
        egal(lignes.length, 3, type + " : en-tête + 2 exemples");
        var corr = I.correspondanceAuto(type, lignes[0]);
        egal(I.champsManquants(type, corr), [], type + " : en-têtes reconnues");
        var ap = I.apercu(type, lignes.slice(1), corr, { annee: AN, elevesConnus: {} });
        egal([ap.exemples, ap.valides.length], [[2, 3], 0], type + " : exemples écartés");
      });
    });
    t("aperçu élèves : minimisation, erreurs, doublons, collisions", function () {
      var entetes = ["Etablissement", "Classe", "Prenom", "Nom", "Heures_individuelles", "Heures_mutualisees", "Recreation", "Pause_meridienne", "Besoins", "Debut_notification", "Fin_notification"];
      var lignes = [
        ["Collège Alpha", "5B", "Lucas", "Martin", "6", "", "non", "non", "secretaire, scripteur | Inventé", "01/09/2026", "04/07/2027"],
        ["Collège Alpha", "5B", "Lucas", "Moreau", "", "4", "non", "non", "", "", ""],
        ["Collège Alpha", "5A", "Léa", "Dupont", "1,5", "", "oui", "", "", "", ""],
        ["Collège Alpha", "5A", "Léa", "Dupont", "1,5", "", "oui", "", "", "", ""],
        ["Collège Alpha", "5A", "Tom", "Petit", "", "", "non", "non", "", "", ""],
        ["Collège Alpha", "5C", "Lucas", "Ma.", "3", "", "non", "non", "", "", ""],
        ["École Bêta", "CP", "", "Roux", "3", "", "peut-être", "non", "", "", ""]
      ];
      var ap = I.apercu("eleves", lignes, I.correspondanceAuto("eleves", entetes), { annee: AN });
      egal(ap.collisions, [{ cle: "lucas m.|5b|college alpha", lignes: [2, 3] }], "collision bloquée");
      egal(ap.doublons, [{ ligne: 5, premiere: 4 }]);
      egal(ap.erreurs.map(function (e) { return e.ligne; }), [6, 8]);
      vrai(/aucune heure/.test(ap.erreurs[0].motifs.join()), "aucune heure notifiée");
      egal(ap.valides.map(function (e) { return e.id; }), [AN + "|lea d.|5a|college alpha", AN + "|lucas ma.|5c|college alpha"]);
      egal(ap.valides[0].heuresInd, 1.5);
      egal(ap.valides[0].recreation, true);
      egal(ap.etablissements, ["Collège Alpha"]);
      vrai(JSON.stringify(ap).indexOf("Dupont") < 0 && JSON.stringify(ap).indexOf("Martin") < 0, "aucun nom de famille conservé");
      var ap2 = I.apercu("eleves", [lignes[0]], I.correspondanceAuto("eleves", entetes), { annee: AN });
      egal(ap2.valides[0].besoins, ["Secrétaire, scripteur"], "besoin reconnu sans casse ni accent");
      egal(ap2.avertissements.length, 1, "besoin hors liste signalé");
      egal([ap2.valides[0].debutNotif, ap2.valides[0].finNotif], ["2026-09-01", "2027-07-04"]);
      var prio = ["Collège Alpha", "6A", "Tom", "Petit", "6", "", "oui", "Prioritaire", "", "", ""];
      var ap3 = I.apercu("eleves", [prio, lignes[0]], I.correspondanceAuto("eleves", entetes), { annee: AN });
      egal([ap3.valides[0].recreation, ap3.valides[0].meridienne, ap3.valides[0].etatsPeriscolaires], [true, true, { meridienne: "prioritaire" }],
        "« prioritaire » = oui + état par défaut");
      vrai(!("etatsPeriscolaires" in ap3.valides[1]), "« oui » / « non » : aucun état transmis");
    });
    t("aperçu AESH : quotité, indisponibilités, e-mail", function () {
      var entetes = ["Nom", "Prenom", "Quotite_hebdo", "Email", "Etablissements", "Indisponibilites", "Formations"];
      var ap = I.apercu("aesh", [
        ["Durand", "Sophie", "24", "s.d@exemple.invalid", "Collège Alpha | École Bêta", "Mercredi; ven-PM", "TSA | LSF"],
        ["Petit", "Paul", "vingt", "", "", "", ""],
        ["Roux", "Ana", "20", "pas-un-mail", "", "lundi matin", ""]
      ], I.correspondanceAuto("aesh", entetes), { annee: AN });
      egal(ap.valides.length, 1);
      var a = ap.valides[0];
      egal([a.id, a.quotite, a.indisponibilites, a.etablissements, a.formations],
        ["durand|sophie", 24, ["mer", "ven-pm"], ["college alpha", "ecole beta"], ["TSA", "LSF"]]);
      egal(ap.erreurs.map(function (e) { return e.ligne; }), [3, 4]);
      egal(ap.erreurs[1].motifs.length, 2, "e-mail et indisponibilité");
      egal(ap.etablissements, ["Collège Alpha", "École Bêta"]);
    });
    t("aperçu emplois du temps : élève connu, nom complet réduit, semaines, priorités", function () {
      var connus = {}; connus["lucas m.|5b|college alpha"] = true;
      var entetes = ["Etablissement", "Classe", "Eleve", "Jour", "Debut", "Fin", "Matiere", "Semaine", "Groupe", "Priorite"];
      var ap = I.apercu("edt", [
        ["Collège Alpha", "5B", "Lucas M.", "Lundi", "08:00", "08:55", "Mathématiques", "", "", "prioritaire"],
        ["Collège Alpha", "5B", "Lucas Martin", "mar", "0.375", "0.4131944444", "LV2", "B", "ESP2", ""],
        ["Collège Alpha", "5B", "Lucas M.", "Lundi", "08:00", "08:55", "Mathématiques", "", "", "prioritaire"],
        ["Collège Alpha", "5B", "Inès B.", "lundi", "08:00", "08:55", "Français", "", "", ""],
        ["Collège Alpha", "5B", "Lucas M.", "jeudi", "10:00", "09:00", "EPS", "C", "", "facultatif"]
      ], I.correspondanceAuto("edt", entetes), { annee: AN, elevesConnus: connus });
      egal(ap.valides.length, 2);
      egal([ap.valides[1].eleveCle, ap.valides[1].jour, ap.valides[1].debut, ap.valides[1].fin, ap.valides[1].semaine],
        ["lucas m.|5b|college alpha", "mardi", "09:00", "09:55", "B"], "nom complet réduit, heures Excel");
      egal(ap.valides[0].etat, "prioritaire");
      egal(ap.doublons, [{ ligne: 4, premiere: 2 }]);
      egal(ap.erreurs.map(function (e) { return [e.ligne, e.motifs.length]; }), [[5, 1], [6, 3]]);
    });
    t("plan de fusion : mettre à jour ou remplacer", function () {
      var existants = [{ id: "a", q: 1, ignorerIndispos: true }, { id: "b", q: 2 }, { id: "c", q: 3 }];
      var nouveaux = [{ id: "a", q: 1 }, { id: "b", q: 5 }, { id: "d", q: 4 }];
      var p = I.planFusion(existants, nouveaux, "id", "maj");
      egal([p.ajouts.length, p.modifies.length, p.inchanges.length, p.supprimes.length], [1, 1, 1, 0]);
      var r = I.planFusion(existants, nouveaux, "id", "remplacer");
      egal(r.supprimes.map(function (x) { return x.id; }), ["c"]);
    });

    /* ---------- fichiers du dossier exemples/ ---------- */
    function lireExemple(nom) {
      return env.lireExemple(nom).then(function (octets) {
        if (!octets) throw new Ignore("fichiers d'exemple non accessibles (page ouverte en file://) — lancer node outils/tests-node.js");
        return I.lireFichier(nom, octets, Z);
      });
    }
    function apercuFichier(type, lu, options) {
      var corr = I.correspondanceAuto(type, lu.lignes[0]);
      egal(I.champsManquants(type, corr), [], type + " : colonnes reconnues");
      return I.apercu(type, lu.lignes.slice(1), corr, options);
    }
    function sansErreur(ap, nom) {
      egal([ap.erreurs, ap.collisions, ap.doublons, ap.exemples], [[], [], [], []], nom + " : ni erreur, ni collision, ni doublon");
    }
    var elevesCsv = null;
    t("exemples : FICTIF_eleves.csv s'importe sans erreur", function () {
      return lireExemple("FICTIF_eleves.csv").then(function (lu) {
        egal([lu.encodage, lu.separateur], ["utf-8", ";"]);
        var ap = apercuFichier("eleves", lu, { annee: AN });
        sansErreur(ap, "élèves");
        egal(ap.valides.length, 45);
        egal(ap.etablissements.length, 3);
        elevesCsv = ap.valides;
      });
    });
    t("exemples : FICTIF_eleves.xlsx donne exactement les mêmes élèves que le CSV", function () {
      if (typeof DecompressionStream === "undefined") throw new Ignore("DecompressionStream indisponible");
      return lireExemple("FICTIF_eleves.xlsx").then(function (lu) {
        egal(lu.format, "xlsx");
        var ap = apercuFichier("eleves", lu, { annee: AN });
        sansErreur(ap, "élèves XLSX");
        if (!elevesCsv) throw new Ignore("CSV non lu");
        egal(ap.valides, elevesCsv);
      });
    });
    t("exemples : AESH en UTF-8 et en Windows-1252 identiques", function () {
      return Promise.all([lireExemple("FICTIF_aesh.csv"), lireExemple("FICTIF_aesh_windows1252.csv")]).then(function (l) {
        egal([l[0].encodage, l[1].encodage], ["utf-8", "windows-1252"]);
        var a = apercuFichier("aesh", l[0], { annee: AN }), b = apercuFichier("aesh", l[1], { annee: AN });
        sansErreur(a, "AESH"); sansErreur(b, "AESH 1252");
        egal(a.valides.length, 14);
        egal(b.valides, a.valides);
        vrai(a.valides.some(function (x) { return x.nom === "Démonstration" && x.indisponibilites.join() === "ven-pm"; }), "accents et indisponibilités");
      });
    });
    t("exemples : FICTIF_edt_eleves.csv (séparateur virgule) s'importe sans erreur", function () {
      return lireExemple("FICTIF_edt_eleves.csv").then(function (lu) {
        if (!elevesCsv) throw new Ignore("élèves non lus");
        egal(lu.separateur, ",");
        var connus = {};
        elevesCsv.forEach(function (e) { connus[e.cle] = true; });
        var ap = apercuFichier("edt", lu, { annee: AN, elevesConnus: connus });
        sansErreur(ap, "EDT");
        vrai(ap.valides.length > 1000, "plus de 1 000 cours");
        vrai(ap.valides.some(function (c) { return c.etat === "prioritaire"; }) && ap.valides.some(function (c) { return c.etat === "exclu"; }), "cas 9");
        var avecCours = {};
        ap.valides.forEach(function (c) { avecCours[c.eleveId] = true; });
        egal(Object.keys(avecCours).length, 45, "chaque élève a un emploi du temps");
      });
    });
    t("exemples : FICTIF_eleves_collision.csv bloque les deux « Lucas M. » (cas 10)", function () {
      return lireExemple("FICTIF_eleves_collision.csv").then(function (lu) {
        var ap = apercuFichier("eleves", lu, { annee: AN });
        egal(ap.collisions, [{ cle: "lucas m.|5b|college fictif des tilleuls", lignes: [2, 3] }]);
        egal(ap.valides.length, 1);
      });
    });
  }

  /* =============== données d'exemple pour le moteur =============== */
  // horaires des collèges du jeu d'exemple, saisis à l'étape 6 de
  // exemples/SCENARIO-DEMO.md (les paramètres d'établissement ne s'importent pas)
  var HORAIRES_DEMO = {
    recreations: [{ debut: "09:50", fin: "10:05" }, { debut: "15:20", fin: "15:35" }],
    meridienne: { debut: "11:55", fin: "13:30" }
  };
  // importe élèves, AESH et EDT de exemples/ comme le ferait l'interface ;
  // renvoie les données d'entrée du moteur (brouillon vide)
  function chargerExemples(env) {
    var I = env.importFichiers, M = env.modele, AN = "2026-2027";
    function lire(nom) {
      return env.lireExemple(nom).then(function (octets) {
        if (!octets) throw new Ignore("fichiers d'exemple non accessibles (page ouverte en file://) — lancer node outils/tests-node.js");
        return I.lireFichier(nom, octets, env.zip);
      });
    }
    function valides(type, lu, options) { return I.apercu(type, lu.lignes.slice(1), I.correspondanceAuto(type, lu.lignes[0]), options).valides; }
    return Promise.all([lire("FICTIF_eleves.csv"), lire("FICTIF_aesh.csv"), lire("FICTIF_edt_eleves.csv")]).then(function (l) {
      var eleves = valides("eleves", l[0], { annee: AN }), connus = {}, noms = {};
      eleves.forEach(function (e) { connus[e.cle] = true; noms[e.etablissement] = e.etablissementNom; });
      var etabs = Object.keys(noms).sort().map(function (id) {
        var e = M.etablissementParDefaut(noms[id]);
        if (e.type === "college") e = JSON.parse(JSON.stringify(Object.assign(e, HORAIRES_DEMO)));
        return e;
      });
      return { annee: AN, etablissements: etabs, eleves: eleves, aesh: valides("aesh", l[1], { annee: AN }),
        cours: valides("edt", l[2], { annee: AN, elevesConnus: connus }), affectations: [], reglages: {} };
    });
  }
  // jeu agrandi pour la mesure du temps de calcul : n copies des
  // établissements, élèves, cours et AESH
  function agrandir(M, d, n) {
    var o = { annee: d.annee, etablissements: [], eleves: [], aesh: [], cours: [], affectations: [], reglages: d.reglages };
    for (var k = 0; k < n; k++) {
      var suffixe = k ? " (copie " + k + ")" : "", ids = {}, eleves = {};
      d.etablissements.forEach(function (e) {
        var c = JSON.parse(JSON.stringify(e));
        c.nom = e.nom + suffixe; c.id = M.idEtablissement(c.nom); ids[e.id] = c.id;
        o.etablissements.push(c);
      });
      d.eleves.forEach(function (e) {
        var c = JSON.parse(JSON.stringify(e));
        c.etablissement = ids[e.etablissement]; c.etablissementNom = e.etablissementNom + suffixe;
        c.cle = M.cleEleve(c.nomCourt, c.classe, c.etablissementNom); c.id = M.idEleve(c.annee, c.cle); eleves[e.id] = c.id;
        o.eleves.push(c);
      });
      d.cours.forEach(function (co) {
        var c = JSON.parse(JSON.stringify(co));
        c.id = k + "|" + co.id; c.eleveId = eleves[co.eleveId]; c.etablissement = ids[co.etablissement];
        o.cours.push(c);
      });
      d.aesh.forEach(function (a) {
        var c = JSON.parse(JSON.stringify(a));
        c.id = a.id + suffixe; c.nom = a.nom + suffixe;
        c.etablissements = a.etablissements.map(function (id) { return ids[id]; });
        o.aesh.push(c);
      });
    }
    return o;
  }
  function avecAffectations(d, affs) {
    var o = {};
    Object.keys(d).forEach(function (k) { o[k] = d[k]; });
    o.affectations = affs;
    return o;
  }
  // juge indépendant : verifierAffectation sur chaque affectation proposée
  function violationsMoteur(M, d, res) {
    var ctx = M.contexte(avecAffectations(d, res.affectations)), out = [];
    res.affectations.forEach(function (a) {
      if (a.epinglee) return;
      M.verifierAffectation(a, ctx).forEach(function (v) { if (v.niveau === "erreur") out.push(a.id + " : " + v.message); });
    });
    return out;
  }

  /* =============== tests du moteur =============== */
  function testsMoteur(t, P, M, env) {
    // petit collège à une classe : élèves, cours et AESH à la demande
    function mini() {
      var etab = M.etablissementParDefaut("Collège Mini"), an = "2026-2027", eleves = [], cours = [], n = 0;
      return {
        etab: etab,
        eleve: function (prenom, ind, mut, extra) {
          var court = M.nomCourt(prenom, "Test"), cle = M.cleEleve(court, "5A", etab.nom);
          var e = { id: M.idEleve(an, cle), cle: cle, annee: an, nomCourt: court, classe: "5A", etablissement: etab.id,
            heuresInd: ind || 0, heuresMut: mut || 0, recreation: false, meridienne: false, besoins: [] };
          Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
          eleves.push(e);
          return e;
        },
        cours: function (e, jour, debut, fin, extra) {
          n++;
          var c = { id: "c" + String(n).padStart(3, "0"), eleveId: e.id, etablissement: etab.id, classe: "5A", jour: jour, debut: debut, fin: fin,
            matiere: "Français", semaine: "", groupe: "", etat: "normal" };
          Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
          cours.push(c);
          return c;
        },
        donnees: function (aesh, affectations) {
          return { annee: an, etablissements: [etab], eleves: eleves, aesh: aesh, cours: cours, affectations: affectations || [], reglages: {} };
        }
      };
    }
    function aeshMini(id, quotite, extra) {
      var a = { id: id, nom: id, prenom: "Test", quotite: quotite, etablissements: [], indisponibilites: [] };
      Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; });
      return a;
    }
    function heures(M2, d, res, e) { return M2.couvertureEleve(e, M2.contexte(avecAffectations(d, res.affectations))); }
    function proposees(res) { return res.affectations.filter(function (a) { return a.origine === "moteur" && !a.epinglee; }); }

    t("moteur : prioritaires d'abord, exclus jamais", function () {
      var m = mini(), e = m.eleve("Lucas", 2);
      ["08:00", "09:00", "10:00"].forEach(function (h, i) { m.cours(e, "lundi", h, h.replace(":00", ":55"), { etat: i === 1 ? "exclu" : "normal" }); });
      var prio = m.cours(e, "vendredi", "15:00", "15:55", { etat: "prioritaire" });
      var res = P.proposer(m.donnees([aeshMini("a", 24)]));
      var c = proposees(res).map(function (a) { return a.creneau.jour + " " + a.creneau.debut; });
      egal(c, ["vendredi 15:00", "lundi 08:00"], "le prioritaire d'abord, puis l'ordre chronologique");
      vrai(c.indexOf("lundi 09:00") < 0, "cours exclu jamais couvert");
      egal(violationsMoteur(M, m.donnees([aeshMini("a", 24)]), res), []);
      vrai(prio, "");
    });
    t("moteur : répartition sur les jours de la semaine", function () {
      var m = mini(), e = m.eleve("Léa", 3);
      ["lundi", "mardi"].forEach(function (j) { ["08:00", "09:00", "10:00", "11:00"].forEach(function (h) { m.cours(e, j, h, h.replace(":00", ":55")); }); });
      var res = P.proposer(m.donnees([aeshMini("a", 24)]));
      egal(proposees(res).map(function (a) { return a.creneau.jour + " " + a.creneau.debut; }).sort(), ["lundi 08:00", "lundi 09:00", "mardi 08:00"]);
    });
    t("moteur : reste d'un demi-cours couvert en semaine A seulement", function () {
      var m = mini(), e = m.eleve("Hugo", 1.5);
      ["08:00", "09:00", "10:00"].forEach(function (h) { m.cours(e, "lundi", h, h.replace(":00", ":55")); });
      var d = m.donnees([aeshMini("a", 24)]), res = P.proposer(d);
      egal(proposees(res).map(function (a) { return a.creneau.debut + " " + a.creneau.semaine; }), ["08:00 toutes", "09:00 A"]);
      proche(heures(M, d, res, e).ind.moy, 1.5);
      egal(P.morceau(0.4, 1, ["A", "B"], m.etab), null, "moins d'un demi-cours : rien");
      egal(P.morceau(0.5, 1, ["A", "B"], M.etablissementParDefaut("École Mini")), ["A", "B"], "sans alternance : cours entier");
    });
    t("moteur : AESH différentes en semaine A et en semaine B", function () {
      var m = mini(), e = m.eleve("Zoé", 1), autre = m.eleve("Noé", 2);
      m.cours(e, "lundi", "08:00", "08:55");
      m.cours(autre, "mardi", "08:00", "08:55", { semaine: "A" });
      m.cours(autre, "mardi", "09:00", "09:55", { semaine: "B" });
      function epingle(aeshId, debut, semaine) {
        return { id: "e-" + aeshId, version: 0, aeshId: aeshId, creneau: { etab: m.etab.id, jour: "mardi", debut: debut, fin: debut.replace(":00", ":55"), semaine: semaine },
          modalite: "individuel", eleves: [autre.id], epinglee: true, origine: "manuel" };
      }
      // p a déjà sa semaine B pleine, q sa semaine A : personne ne peut prendre lundi en A et B
      var d = m.donnees([aeshMini("p", 1), aeshMini("q", 1)], [epingle("p", "09:00", "B"), epingle("q", "08:00", "A")]);
      var res = P.proposer(d);
      egal(proposees(res).map(function (a) { return a.aeshId + " " + a.creneau.semaine; }), ["p A", "q B"]);
      proche(heures(M, d, res, e).ind.moy, 1);
      egal(violationsMoteur(M, d, res), []);
    });
    t("moteur : épinglages repris tels quels, même en conflit ; relance partielle", function () {
      var f = fixture(M), e = f.e;
      // aesh|y (quotité 2 h) : trois heures épinglées, dont une en chevauchement
      var pins = [aff("aesh|y", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]),
        aff("aesh|y", f.cA, "lundi", "08:00", "08:55", "individuel", [e.autreClasse]),
        aff("aesh|y", f.cA, "lundi", "10:05", "11:00", "individuel", [e.ind])];
      var d = { annee: f.an, etablissements: [f.cA, f.cB, f.ec], eleves: Object.keys(e).map(function (k) { return e[k]; }),
        aesh: f.aesh, cours: f.cours, affectations: pins, reglages: {} };
      var avant = JSON.stringify(pins);
      var res = P.proposer(d);
      egal(JSON.stringify(res.affectations.filter(function (a) { return a.epinglee; })), avant, "épinglées inchangées");
      vrai(!proposees(res).some(function (a) { return a.aeshId === "aesh|y"; }), "rien de plus pour une AESH en dépassement");
      egal(violationsMoteur(M, d, res), []);
      // relance : les non épinglées sont remplacées, avec le même résultat
      var res2 = P.proposer(avecAffectations(d, res.affectations));
      egal(JSON.stringify(res2.affectations), JSON.stringify(res.affectations), "relance sur sa propre proposition");
      // épingler une proposition : elle est reprise, le reste est recalculé
      var gardee = JSON.parse(JSON.stringify(proposees(res)[0]));
      gardee.epinglee = true;
      var res3 = P.proposer(avecAffectations(d, pins.concat([gardee])));
      vrai(res3.affectations.some(function (a) { return JSON.stringify(a) === JSON.stringify(gardee); }), "proposition épinglée conservée");
      egal(violationsMoteur(M, d, res3), []);
    });
    t("moteur : AESH d'un créneau classées par score, avec les raisons", function () {
      var f = fixture(M), e = f.e;
      var d = { annee: f.an, etablissements: [f.cA, f.cB, f.ec], eleves: Object.keys(e).map(function (k) { return e[k]; }),
        aesh: f.aesh, cours: f.cours, affectations: [aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind])], reglages: {} };
      var l = P.classerAesh(d, { creneau: { etab: f.cA.id, jour: "lundi", debut: "08:55", fin: "09:50", semaine: "toutes" }, modalite: "individuel", eleves: [e.ind.id] });
      egal(l.map(function (x) { return x.aeshId + " " + x.possible; }), ["aesh|x true", "aesh|y true"]);
      vrai(l[0].score > l[1].score, "continuité et journée compacte");
      vrai(l[0].raisons.indexOf("déjà avec Lucas M.") > -1 && l[0].raisons.indexOf("journée compacte") > -1, l[0].raisons.join(" ; "));
      var mer = P.classerAesh(d, { creneau: { etab: f.cA.id, jour: "mercredi", debut: "08:00", fin: "08:55", semaine: "toutes" }, modalite: "individuel", eleves: [e.ind.id] });
      egal(mer.map(function (x) { return x.aeshId + " " + (x.motif || x.possible); }), ["aesh|x true", "aesh|y indisponibilite"]);
    });

    /* ---------- sur les données d'exemple ---------- */
    var exemples = null, resultat = null;
    function charger() {
      if (!exemples) exemples = chargerExemples(env).then(function (d) { return { d: d, res: P.proposer(d) }; });
      return exemples.then(function (x) { resultat = x; return x; });
    }
    function eleveNomme(nomCourt, classe) {
      return resultat.d.eleves.filter(function (e) { return e.nomCourt === nomCourt && (!classe || e.classe === classe); })[0];
    }
    function affsDe(eleve) { return resultat.res.affectations.filter(function (a) { return a.eleves.indexOf(eleve.id) > -1; }); }

    t("moteur (exemples) : déterministe, y compris sur des données mélangées", function () {
      return charger().then(function (x) {
        egal(JSON.stringify(P.proposer(x.d)), JSON.stringify(x.res), "deux exécutions");
        function melanger(l) { var c = l.slice().reverse(); return c.slice(7).concat(c.slice(0, 7)); }
        var m = {};
        Object.keys(x.d).forEach(function (k) { m[k] = Array.isArray(x.d[k]) ? melanger(x.d[k]) : x.d[k]; });
        egal(JSON.stringify(P.proposer(m).affectations), JSON.stringify(x.res.affectations), "ordre des données sans effet");
      });
    });
    t("moteur (exemples) : aucune des 7 contraintes dures n'est violée", function () {
      return charger().then(function (x) {
        vrai(proposees(x.res).length > 100, "proposition non vide");
        egal(violationsMoteur(M, x.d, x.res), []);
        egal(x.res.rapport.violations, []);
      });
    });
    t("moteur (exemples) : jeu agrandi ×4 (180 élèves, 56 AESH), contraintes respectées", function () {
      return charger().then(function (x) {
        var g = agrandir(M, x.d, 4), res = P.proposer(g);
        egal([g.eleves.length, g.aesh.length], [180, 56]);
        egal(violationsMoteur(M, g, res), []);
      });
    });
    t("moteur (exemples) : cas 1 et 2 — mutualisation", function () {
      return charger().then(function () {
        var rose = eleveNomme("Rose É."), arthur = eleveNomme("Arthur S.");
        vrai(!affsDe(rose).some(function (a) { return a.eleves.indexOf(arthur.id) > -1 && /lv2/i.test(M.coursSurCreneau(rose.id, a.creneau, M.contexte(resultat.d))[0].matiere); }),
          "cas 1 : groupes de LV2 différents jamais ensemble");
        var trio = ["Hugo M.", "Léna M.", "Adam E."].map(function (n) { return eleveNomme(n, "5A").id; });
        vrai(resultat.res.affectations.some(function (a) { return a.modalite === "mutualise" && trio.every(function (id) { return a.eleves.indexOf(id) > -1; }); }),
          "cas 2 : les trois élèves mutualisés ensemble");
      });
    });
    t("moteur (exemples) : cas 3, 4 et 6 — déplacements, indisponibilités, école", function () {
      return charger().then(function (x) {
        vrai(proposees(x.res).some(function (a) { return a.raisons.some(function (r) { return /déplacement\)/.test(r) || /\d+ déplacement/.test(r); }); }),
          "cas 3 : la règle du déplacement a écarté au moins une AESH");
        var hugo = proposees(x.res).filter(function (a) { return a.aeshId === "fictif|hugo"; });
        vrai(hugo.length > 0 && !hugo.some(function (a) { return a.creneau.jour === "mercredi"; }), "cas 4 : rien le mercredi pour Hugo Fictif");
        vrai(!proposees(x.res).some(function (a) { return a.aeshId === "demonstration|nadia" && a.creneau.jour === "vendredi" && M.minutes(a.creneau.fin) > 720; }),
          "cas 4 : rien le vendredi après-midi pour Nadia Démonstration");
        var lilas = proposees(x.res).filter(function (a) { return a.creneau.etab === M.idEtablissement("École Fictive des Lilas"); });
        vrai(lilas.length > 0 && lilas.every(function (a) { return a.creneau.jour !== "mercredi" && a.creneau.semaine === "toutes"; }), "cas 6 : école sans mercredi ni alternance");
      });
    });
    t("moteur (exemples) : cas 5 — cours de semaine B affecté en semaine B", function () {
      return charger().then(function (x) {
        var ctx = M.contexte(x.d);
        var surB = proposees(x.res).filter(function (a) {
          return a.modalite !== "periscolaire" && a.eleves.every(function (id) {
            return M.coursSurCreneau(id, a.creneau, ctx).every(function (co) { return M.semaineNormalisee(co.semaine) === "B"; });
          });
        });
        vrai(surB.length > 0, "au moins un cours de semaine B couvert");
        egal(surB.filter(function (a) { return a.creneau.semaine !== "B"; }), []);
      });
    });
    t("moteur (exemples) : cas 7 et 8 — capacité insuffisante, pause méridienne prioritaire", function () {
      return charger().then(function (x) {
        var r = x.res.rapport;
        vrai(r.sousCouverts.some(function (s) { return s.motif === "quotite"; }), "cas 7 : sous-couvertures signalées, motif quotité");
        vrai(r.heures.individuel.couvert + r.heures.mutualise.couvert < r.heures.individuel.demande + r.heures.mutualise.demande, "cas 7");
        var louis = eleveNomme("Louis I.");
        var merid = affsDe(louis).filter(function (a) { return a.periscolaire === "meridienne"; });
        vrai(merid.length >= 4, "cas 8 : pause méridienne couverte chaque jour (" + merid.length + ")");
        egal(r.periscolaireNonCouvert.filter(function (p) { return p.eleveId === louis.id && p.type === "meridienne"; }), []);
      });
    });
    t("moteur (exemples) : cas 9 — prioritaires couverts d'abord, exclus jamais", function () {
      return charger().then(function (x) {
        var ctx = M.contexte(x.d), nathan = eleveNomme("Nathan C.");
        var etats = affsDe(nathan).map(function (a) { return M.coursSurCreneau(nathan.id, a.creneau, ctx)[0].etat; });
        vrai(etats.length > 0 && etats.every(function (s) { return s === "prioritaire"; }), "Nathan C. : " + etats.join(", "));
        var exclus = x.d.cours.filter(function (c) { return c.etat === "exclu"; });
        vrai(exclus.length > 0, "cours exclus présents");
        vrai(!x.res.affectations.some(function (a) {
          return a.modalite !== "periscolaire" && a.eleves.some(function (id) { return M.coursSurCreneau(id, a.creneau, ctx).every(function (co) { return co.etat === "exclu"; }); });
        }), "aucun cours exclu couvert");
      });
    });
  }

  /* =============== exécution =============== */
  function executer(env) {
    var tests = [];
    function t(nom, fn) { tests.push({ groupe: groupeCourant, nom: nom, fn: fn }); }
    var groupeCourant = "modèle";
    testsModele(t, env.modele);
    if (env.zip) { groupeCourant = "zip"; testsZip(t, env.zip, env); }
    if (env.importFichiers) { groupeCourant = "import"; testsImport(t, env.importFichiers, env.modele, env.zip, env); }
    if (env.moteur && env.importFichiers) { groupeCourant = "moteur"; testsMoteur(t, env.moteur, env.modele, env); }
    var bilan = { reussis: 0, echecs: [], ignores: 0, lignes: [] };
    return tests.reduce(function (p, test) {
      return p.then(function () {
        return new Promise(function (resolve) { resolve(test.fn()); }).then(function () {
          bilan.reussis++;
          bilan.lignes.push({ etat: "ok", groupe: test.groupe, nom: test.nom });
        }, function (err) {
          if (err instanceof Ignore) {
            bilan.ignores++;
            bilan.lignes.push({ etat: "ignore", groupe: test.groupe, nom: test.nom, message: err.motif });
          } else {
            var msg = err instanceof EchecAssertion ? err.message : (err && err.stack) || String(err);
            bilan.echecs.push({ groupe: test.groupe, nom: test.nom, message: msg });
            bilan.lignes.push({ etat: "echec", groupe: test.groupe, nom: test.nom, message: msg });
          }
        });
      });
    }, Promise.resolve()).then(function () { return bilan; });
  }

  return { executer: executer, chargerExemples: chargerExemples, agrandir: agrandir, HORAIRES_DEMO: HORAIRES_DEMO };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialTests;
