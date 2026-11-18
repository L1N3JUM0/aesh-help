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
     PialImport (facultatif),
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

  /* =============== exécution =============== */
  function executer(env) {
    var tests = [];
    function t(nom, fn) { tests.push({ groupe: groupeCourant, nom: nom, fn: fn }); }
    var groupeCourant = "modèle";
    testsModele(t, env.modele);
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

  return { executer: executer };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialTests;
