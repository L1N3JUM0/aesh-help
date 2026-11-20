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
      // temps périscolaires gérés, sauf si le test dit le contraire
      ctx: function (affectations, reglages) {
        var r = { gererPeriscolaire: true };
        Object.keys(reglages || {}).forEach(function (k) { r[k] = reglages[k]; });
        return M.contexte({ etablissements: [cA, cB, ec], eleves: Object.keys(e).map(function (k) { return e[k]; }),
          aesh: aesh, cours: cours, affectations: affectations || [], reglages: r });
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
    t("annulation : opérations inverses (création, modification, suppression)", function () {
      function appliquer(base, ops) {
        var o = {};
        Object.keys(base).forEach(function (m) { o[m] = {}; base[m].forEach(function (x) { o[m][x.id] = x; }); });
        ops.forEach(function (op) {
          o[op.magasin] = o[op.magasin] || {};
          (op.supprimer || []).forEach(function (id) { delete o[op.magasin][id]; });
          (op.enregistrer || []).forEach(function (x) { o[op.magasin][x.id] = x; });
        });
        var r = {};
        Object.keys(o).forEach(function (m) { r[m] = Object.keys(o[m]).sort().map(function (id) { return o[m][id]; }); });
        return r;
      }
      var base = { affectations: [{ id: "a", aeshId: "x", epinglee: true }, { id: "b", aeshId: "y" }, { id: "mo|x|1", aeshId: "x" }],
        cours: [{ id: "c1", etat: "normal" }] };
      // « Proposer » : supprime et réécrit le même identifiant, en crée un autre ; plus un changement d'état de cours
      var ops = [{ magasin: "affectations", supprimer: ["b", "mo|x|1"], enregistrer: [{ id: "mo|x|1", aeshId: "x", score: 3 }, { id: "mo|z|2", aeshId: "z" }] },
        { magasin: "cours", enregistrer: [{ id: "c1", etat: "exclu" }] }];
      var inv = M.operationsInverses(ops, base);
      var apres = appliquer(base, ops);
      egal(apres.affectations.map(function (x) { return x.id; }), ["a", "mo|x|1", "mo|z|2"]);
      egal(appliquer(apres, inv), appliquer(base, []), "retour exact à l'état d'avant");
      base.cours[0].etat = "modifié ensuite";
      egal(inv[0].enregistrer[0].etat, "normal", "copies : l'inverse ne suit pas les objets d'origine");
    });
    t("comparatif de deux versions : élève × créneau × semaine", function () {
      var f = fixture(M), e = f.e, etabs = [f.cA, f.cB, f.ec];
      var avant = [
        aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]),
        aff("aesh|x", f.cA, "lundi", "08:55", "09:50", "individuel", [e.ind]),
        aff("aesh|y", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind]),
        aff("aesh|y", f.cA, "lundi", "10:05", "11:00", "mutualise", [e.mut1, e.mut2]),
        aff("aesh|x", f.ec, "lundi", "08:30", "09:30", "individuel", [e.ecole])
      ];
      var apres = [
        aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind], "A"),   // scindé : rien ne change en A
        aff("aesh|y", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind], "B"),   // changement en B seulement
        aff("aesh|x", f.cA, "lundi", "08:55", "09:50", "individuel", [e.ind], "A"),
        aff("aesh|x", f.cA, "lundi", "08:55", "09:50", "individuel", [e.ind], "B"),   // A + B = toutes : identique
        aff("aesh|y", f.cA, "lundi", "10:05", "11:00", "mutualise", [e.mut1]),        // mut2 quitte le groupe
        aff("aesh|y", f.cA, "mercredi", "08:00", "08:55", "individuel", [e.ind]),
        aff("aesh|x", f.ec, "lundi", "08:30", "09:30", "individuel", [e.ecole], "A")  // école : pas d'alternance
      ];
      var c = M.comparerAffectations(avant, apres, etabs);
      egal(c.lignes.map(function (l) {
        return [l.eleveId === e.ind.id ? "ind" : (l.eleveId === e.mut2.id ? "mut2" : l.eleveId), l.type, l.jour, l.debut, l.semaines.join(""),
          l.avant && l.avant.aeshIds.join(), l.apres && l.apres.aeshIds.join()];
      }).sort(), [
        ["ind", "ajout", "mercredi", "08:00", "AB", null, "aesh|y"],
        ["ind", "changement", "lundi", "08:00", "B", "aesh|x", "aesh|y"],
        ["ind", "retrait", "mardi", "08:00", "AB", "aesh|y", null],
        ["mut2", "retrait", "lundi", "10:05", "AB", "aesh|y", null]
      ]);
      egal(c.resume, { ajout: 1, retrait: 2, changement: 1 });
      egal(M.comparerAffectations(avant, avant, etabs).lignes, [], "version comparée à elle-même");
      var modal = M.comparerAffectations([avant[3]], [aff("aesh|y", f.cA, "lundi", "10:05", "11:00", "individuel", [e.mut1])], etabs);
      egal(modal.lignes.map(function (l) { return [l.type, l.avant.modalite, l.apres && l.apres.modalite]; }),
        [["retrait", "mutualise", null], ["changement", "mutualise", "individuel"]], "changement de modalité ; mut2 retiré (lignes triées par élève)");
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
    t("trous et journées courtes d'une AESH", function () {
      var m = M.mesureJournee([[480, 535], [700, 755], [540, 600]], 120);
      egal([m.presence, m.ecarts, m.trous], [170, [5, 100], 0], "trié, écarts de 5 et 100 min");
      egal(M.mesureJournee([[480, 535], [700, 755], [540, 600]], 60).trous, 1, "écart max 1 h : un trou");
      egal(M.mesureJournee([[480, 600], [540, 660]], 120), { presence: 180, ecarts: [], trous: 0 }, "chevauchement fusionné");
      egal(M.mesureJournee([], 120), { presence: 0, ecarts: [], trous: 0 });
      var f = fixture(M), e = f.e;
      var l = [aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "individuel", [e.ind]),
        aff("aesh|x", f.cA, "lundi", "11:00", "11:55", "individuel", [e.ind]),
        aff("aesh|x", f.cA, "mardi", "08:00", "08:55", "individuel", [e.ind], "A")];
      var j = M.journeesAesh(f.aesh[0], f.ctx(l));
      egal([j.A.trous, j.A.courtes, j.B.trous, j.B.courtes], [1, 2, 1, 1], "lundi : 2 h 05 d'écart et 1 h 50 de présence ; mardi en A seulement");
      egal(j.A.jours.lundi.ecarts, [125]);
      var j2 = M.journeesAesh(f.aesh[0], f.ctx(l, { ecartMax: 150, journeeMin: 60 }));
      egal([j2.A.trous, j2.A.courtes], [0, 1], "réglages : écart max 2 h 30, journée courte sous 1 h");
    });
    t("synthèse du bandeau", function () {
      var f = fixture(M), e = f.e;
      var s = M.synthese(f.ctx([aff("aesh|x", f.cA, "lundi", "08:00", "08:55", "mutualise", [e.mut1, e.mut2])]));
      egal([s.indDemande, s.indCouvert, s.mutDemande, s.mutCouvert], [22, 0, 27, 2]);
      // capacité : 24 + 2 h de quotité, 1 h affectée à Ana (A et B)
      egal([s.quotites, s.affecteesA, s.affecteesB, s.affectees, s.libres, s.ecartTheorique], [26, 1, 1, 1, 25, 23]);
      // dépassement : les heures libres ne deviennent pas négatives
      var l = ["08:00", "08:55", "10:05"].map(function (d, i) {
        return aff("aesh|y", f.cA, "lundi", d, ["08:55", "09:50", "11:00"][i], "individuel", [e.ind]);
      });
      var s2 = M.synthese(f.ctx(l));
      egal([s2.affecteesA, s2.libresA, s2.libresB], [3, 24, 24], "Bob dépasse de 1 h : 0 h libre pour lui, pas −1");
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
      var ap = I.apercu("eleves", lignes, I.correspondanceAuto("eleves", entetes), { annee: AN, gererPeriscolaire: true });
      egal(ap.collisions, [{ cle: "lucas m.|5b|college alpha", lignes: [2, 3] }], "collision bloquée");
      egal(ap.doublons, [{ ligne: 5, premiere: 4 }]);
      egal(ap.erreurs.map(function (e) { return e.ligne; }), [6, 8]);
      vrai(/aucune heure/.test(ap.erreurs[0].motifs.join()), "aucune heure notifiée");
      egal(ap.valides.map(function (e) { return e.id; }), [AN + "|lea d.|5a|college alpha", AN + "|lucas ma.|5c|college alpha"]);
      egal(ap.valides[0].heuresInd, 1.5);
      egal(ap.valides[0].recreation, true);
      egal(ap.etablissements, ["Collège Alpha"]);
      vrai(JSON.stringify(ap).indexOf("Dupont") < 0 && JSON.stringify(ap).indexOf("Martin") < 0, "aucun nom de famille conservé");
      var ap2 = I.apercu("eleves", [lignes[0]], I.correspondanceAuto("eleves", entetes), { annee: AN, gererPeriscolaire: true });
      egal(ap2.valides[0].besoins, ["Secrétaire, scripteur"], "besoin reconnu sans casse ni accent");
      egal(ap2.avertissements.length, 1, "besoin hors liste signalé");
      egal([ap2.valides[0].debutNotif, ap2.valides[0].finNotif], ["2026-09-01", "2027-07-04"]);
      var prio = ["Collège Alpha", "6A", "Tom", "Petit", "6", "", "oui", "Prioritaire", "", "", ""];
      var ap3 = I.apercu("eleves", [prio, lignes[0]], I.correspondanceAuto("eleves", entetes), { annee: AN, gererPeriscolaire: true });
      egal([ap3.valides[0].recreation, ap3.valides[0].meridienne, ap3.valides[0].etatsPeriscolaires], [true, true, { meridienne: "prioritaire" }],
        "« prioritaire » = oui + état par défaut");
      vrai(!("etatsPeriscolaires" in ap3.valides[1]), "« oui » / « non » : aucun état transmis");
      // temps périscolaires non gérés (réglage par défaut) : colonnes ignorées, signalées si remplies
      var douteux = ["Collège Alpha", "5D", "Inès", "Vrai", "2", "", "peut-être", "non", "", "", ""];
      var ap4 = I.apercu("eleves", [prio, lignes[2], lignes[4], lignes[5], douteux], I.correspondanceAuto("eleves", entetes), { annee: AN });
      egal(ap4.erreurs.map(function (e) { return e.ligne; }), [4], "« peut-être » n'est plus une erreur ; l'absence d'heures en reste une");
      egal(ap4.valides.map(function (e) { return [e.recreation, e.meridienne, e.etatsPeriscolaires]; }), [0, 1, 2, 3].map(function () { return [undefined, undefined, undefined]; }),
        "récréation et pause méridienne absentes de l'objet importé");
      egal(ap4.periscolaireIgnore, [2, 3, 6], "lignes dont les colonnes périscolaires sont remplies (« non » ne compte pas)");
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
  // options.renfort : ajoute FICTIF_aesh_renfort.csv (scénario, relance)
  function chargerExemples(env, options) {
    options = options || {};
    var I = env.importFichiers, M = env.modele, AN = "2026-2027";
    function lire(nom) {
      return env.lireExemple(nom).then(function (octets) {
        if (!octets) throw new Ignore("fichiers d'exemple non accessibles (page ouverte en file://) — lancer node outils/tests-node.js");
        return I.lireFichier(nom, octets, env.zip);
      });
    }
    function valides(type, lu, options) { return I.apercu(type, lu.lignes.slice(1), I.correspondanceAuto(type, lu.lignes[0]), options).valides; }
    var fichiers = ["FICTIF_eleves.csv", "FICTIF_aesh.csv", "FICTIF_edt_eleves.csv"].concat(options.renfort ? ["FICTIF_aesh_renfort.csv"] : []);
    return Promise.all(fichiers.map(lire)).then(function (l) {
      var eleves = valides("eleves", l[0], { annee: AN, gererPeriscolaire: true }), connus = {}, noms = {};
      eleves.forEach(function (e) { connus[e.cle] = true; noms[e.etablissement] = e.etablissementNom; });
      var etabs = Object.keys(noms).sort().map(function (id) {
        var e = M.etablissementParDefaut(noms[id]);
        if (e.type === "college") e = JSON.parse(JSON.stringify(Object.assign(e, HORAIRES_DEMO)));
        return e;
      });
      var aesh = valides("aesh", l[1], { annee: AN }).concat(l[3] ? valides("aesh", l[3], { annee: AN }) : []);
      return { annee: AN, etablissements: etabs, eleves: eleves, aesh: aesh,
        cours: valides("edt", l[2], { annee: AN, elevesConnus: connus }), affectations: [], reglages: { gererPeriscolaire: true } };
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
          return { annee: an, etablissements: [etab], eleves: eleves, aesh: aesh, cours: cours, affectations: affectations || [], reglages: { gererPeriscolaire: true } };
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
        aesh: f.aesh, cours: f.cours, affectations: pins, reglages: { gererPeriscolaire: true } };
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

    t("moteur : interrupteur « ignorer les indisponibilités » d'une AESH", function () {
      var m = mini(), e = m.eleve("Lucas", 1);
      m.cours(e, "lundi", "08:00", "08:55");
      var autre = M.etablissementParDefaut("Collège Ailleurs");
      var a = aeshMini("a", 24, { indisponibilites: ["lun"], etablissements: [autre.id] });
      egal(proposees(P.proposer(m.donnees([a]))).length, 0, "indisponible le lundi, autre établissement : rien");
      a.ignorerIndispos = true;
      egal(proposees(P.proposer(m.donnees([a]))).map(function (x) { return x.aeshId + " " + x.creneau.jour; }), ["a lundi"], "interrupteur : indisponibilité et établissement ignorés");
      var d = m.donnees([a]);
      d.reglages.respecterIndispos = false;
      a.ignorerIndispos = false;
      egal(proposees(P.proposer(d)).length, 1, "réglage global décoché : même effet pour toutes");
    });
    t("moteur : passe d'échanges — élève ramené de 4 à 3 AESH", function () {
      var m = mini(), L = m.eleve("Lucas", 4), R = m.eleve("Rose", 1), S = m.eleve("Sami", 1), T2 = m.eleve("Tom", 1);
      ["08:00", "09:00", "10:00", "11:00"].forEach(function (h) { m.cours(L, "lundi", h, h.replace(":00", ":55")); });
      [R, S, T2].forEach(function (e) { m.cours(e, "lundi", "08:00", "08:55"); });
      function prop(aeshId, h, eleves) {
        var x = aff(aeshId, m.etab, "lundi", h, h.replace(":00", ":55"), "individuel", eleves);
        x.epinglee = false; x.origine = "moteur";
        return x;
      }
      // Lucas : quatre AESH ; à 08:00, c et d sont prises (épinglées), b est avec Rose
      var brouillon = [prop("a", "08:00", [L]), prop("b", "09:00", [L]), prop("c", "10:00", [L]), prop("d", "11:00", [L]),
        prop("b", "08:00", [R]), aff("c", m.etab, "lundi", "08:00", "08:55", "individuel", [S]), aff("d", m.etab, "lundi", "08:00", "08:55", "individuel", [T2])];
      var d = m.donnees(["a", "b", "c", "d"].map(function (id) { return aeshMini(id, 24); }), brouillon);
      var res = P.ameliorerAffectations(d);
      function aeshDe(e) { var o = {}; res.affectations.forEach(function (x) { if (x.eleves.indexOf(e.id) > -1) o[x.aeshId] = true; }); return Object.keys(o).sort(); }
      egal(res.nbEchanges, 1);
      egal([aeshDe(L), aeshDe(R)], [["b", "c", "d"], ["a"]], "b prend Lucas à 08:00, a prend Rose");
      var lucas8 = res.affectations.filter(function (x) { return x.eleves[0] === L.id && x.creneau.debut === "08:00"; })[0];
      egal(lucas8.id, "mo|b|" + lucas8.creneauCle, "identifiant recalculé");
      vrai(/^échangé avec Test a pour limiter Lucas T\. à 3 AESH$/.test(lucas8.raisons[0]), lucas8.raisons.join());
      egal(res.affectations.filter(function (x) { return x.epinglee; }).map(function (x) { return x.aeshId; }), ["c", "d"], "épinglées intactes");
      egal(violationsMoteur(M, d, res), [], "aucune contrainte dure enfreinte");
      egal(JSON.stringify(P.ameliorerAffectations(d)), JSON.stringify(res), "déterministe");
      // Rose épinglée avec b : pas d'échange à 08:00, mais a peut reprendre le 09:00 de b (réattribution)
      brouillon[4].epinglee = true;
      res = P.ameliorerAffectations(m.donnees(d.aesh, brouillon));
      egal([res.nbEchanges, aeshDe(L)], [1, ["a", "c", "d"]]);
      vrai(res.affectations.some(function (x) { return x.aeshId === "a" && x.creneau.debut === "09:00" && x.raisons[0] === "repris à Test b pour limiter Lucas T. à 3 AESH"; }), "raison de la réattribution");
    });
    t("moteur : score des trous et des journées courtes", function () {
      var m = mini(), e = m.eleve("Lucas", 1), autre = m.eleve("Emma", 2);
      m.cours(e, "lundi", "14:00", "14:55");
      function classer(pins, debut) {
        var l = P.classerAesh(m.donnees([aeshMini("a", 24), aeshMini("b", 24)], pins), { creneau: { etab: m.etab.id, jour: "lundi",
          debut: debut, fin: debut.replace(":00", ":55"), semaine: "toutes" }, modalite: "individuel", eleves: [e.id] });
        var o = {}; l.forEach(function (x) { o[x.aeshId] = x; });
        return o;
      }
      // « a » accompagne Emma à 08:00 : prendre 14:00 laisse un trou de 5 h
      var c = classer([aff("a", m.etab, "lundi", "08:00", "08:55", "individuel", [autre])], "14:00");
      vrai(c.a.raisons.indexOf("laisse un trou de plus de 2 h le lundi") > -1, c.a.raisons.join(" ; "));
      vrai(c.b.raisons.indexOf("journée de moins de 2 h le lundi") > -1, c.b.raisons.join(" ; "));
      vrai(Math.abs(c.b.score - c.a.score - (30 - 10 + 15 / 24)) < 0.01, "trou −30 contre journée courte −10 (et 1 h d'équilibrage) : " + (c.b.score - c.a.score));
      vrai(c.a.raisons.indexOf("même établissement le lundi") < 0, "voisin à 5 h : pas de bonus « même établissement »");
      vrai(c.b.score > c.a.score, "b d'abord");
      // « a » à 08:00 et 12:00 : 10:00 comble le trou
      var c2 = classer([aff("a", m.etab, "lundi", "08:00", "08:55", "individuel", [autre]), aff("a", m.etab, "lundi", "12:00", "12:55", "individuel", [autre])], "10:00");
      vrai(c2.a.raisons.indexOf("comble un trou le lundi") > -1, c2.a.raisons.join(" ; "));
      vrai(c2.a.raisons.indexOf("journée de moins de 2 h le lundi") < 0 && c2.a.raisons.indexOf("complète une journée courte le lundi") > -1, c2.a.raisons.join(" ; "));
      vrai(c2.a.score > c2.b.score, "a d'abord");
    });
    t("moteur : passe d'échanges sur les trous", function () {
      var m = mini(), L = m.eleve("Lucas", 1), R = m.eleve("Rose", 1), S = m.eleve("Sami", 1), T2 = m.eleve("Tom", 1);
      m.cours(L, "lundi", "08:00", "08:55"); m.cours(R, "lundi", "14:00", "14:55");
      m.cours(S, "lundi", "09:00", "09:55"); m.cours(T2, "lundi", "15:00", "15:55");
      function prop(aeshId, h, eleve) {
        var x = aff(aeshId, m.etab, "lundi", h, h.replace(":00", ":55"), "individuel", [eleve]);
        x.epinglee = false; x.origine = "moteur";
        return x;
      }
      // a : 08:00 et 14:00 ; b : 09:00 et 15:00 — un trou chacune
      var d = m.donnees([aeshMini("a", 24), aeshMini("b", 24)], [prop("a", "08:00", L), prop("a", "14:00", R), prop("b", "09:00", S), prop("b", "15:00", T2)]);
      function trous(affs) {
        var ctx = M.contexte(avecAffectations(d, affs)), n = 0;
        d.aesh.forEach(function (a) { var j = M.journeesAesh(a, ctx); n += j.A.trous + j.B.trous; });
        return n;
      }
      var res = P.ameliorerTrousAffectations(d);
      egal(trous(d.affectations), 4);
      egal(trous(res.affectations), 0, "les deux journées regroupées");
      vrai(res.nbMouvements > 0);
      egal(violationsMoteur(M, d, res), [], "aucune contrainte dure enfreinte");
      [L, R, S, T2].forEach(function (e) { proche(heures(M, d, res, e).ind.moy, 1, "couverture inchangée"); });
      vrai(res.affectations.some(function (x) { return /pour réduire les trous des journées$/.test(x.raisons[0]); }), "raison");
      egal(JSON.stringify(P.ameliorerTrousAffectations(d)), JSON.stringify(res), "déterministe");
      // épinglées : rien ne bouge
      var pins = d.affectations.map(function (x) { var c = JSON.parse(JSON.stringify(x)); c.epinglee = true; return c; });
      egal(P.ameliorerTrousAffectations(m.donnees(d.aesh, pins)).nbMouvements, 0);
    });
    t("moteur : entre groupes mutualisés, le moins couvert d'abord", function () {
      var m = mini(), a = m.eleve("Ana", 0, 2), b = m.eleve("Bea", 0, 2), c = m.eleve("Cyr", 0, 1);
      [a, b].forEach(function (e) { m.cours(e, "lundi", "08:00", "08:55"); m.cours(e, "lundi", "09:00", "09:55"); });
      m.cours(c, "mardi", "08:00", "08:55");
      // Ana et Bea ont déjà une heure sur deux ; Cyr n'a rien
      var pin = aff("p", m.etab, "lundi", "08:00", "08:55", "mutualise", [a, b]);
      var d = m.donnees([aeshMini("a", 1), aeshMini("p", 1)], [pin]);
      var res = P.proposer(d);
      egal(proposees(res).map(function (x) { return x.eleves.length + " " + x.creneau.jour; }), ["1 mardi"],
        "Cyr (0 %) passe avant le groupe de deux (50 %) : la taille ne fait que départager");
    });
    t("moteur : pénalité progressive au-delà de 3 AESH par élève", function () {
      var m = mini(), e = m.eleve("Lucas", 6);
      ["08:00", "09:00", "10:00", "11:00"].forEach(function (h) { m.cours(e, "lundi", h, h.replace(":00", ":55")); });
      m.cours(e, "mardi", "08:00", "08:55");
      function avec(n) {
        var pins = ["a", "b", "c", "d"].slice(0, n).map(function (id, i) {
          return aff(id, m.etab, "lundi", ["08:00", "09:00", "10:00", "11:00"][i], ["08:55", "09:55", "10:55", "11:55"][i], "individuel", [e]);
        });
        var aesh = ["a", "b", "c", "d", "z"].map(function (id) { return aeshMini(id, 24); });
        return P.classerAesh(m.donnees(aesh, pins), { creneau: { etab: m.etab.id, jour: "mardi", debut: "08:00", fin: "08:55", semaine: "toutes" },
          modalite: "individuel", eleves: [e.id] }).filter(function (x) { return x.aeshId === "z"; })[0];
      }
      var z2 = avec(2), z3 = avec(3), z4 = avec(4);
      egal([z2.score - z3.score, z3.score - z4.score], [25, 25], "4e AESH : -25, 5e : -50");
      vrai(z3.raisons.indexOf("4e AESH pour Lucas T.") > -1 && z4.raisons.indexOf("5e AESH pour Lucas T.") > -1, z4.raisons.join(" ; "));
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
    t("moteur (exemples) : la passe sur les trous ne change pas la couverture", function () {
      return charger().then(function (x) {
        var avant = P.OPTIONS.echangesTrous, sans;
        try { P.OPTIONS.echangesTrous = false; sans = P.proposer(x.d); } finally { P.OPTIONS.echangesTrous = avant; }
        function couv(res) {
          var ctx = M.contexte(avecAffectations(x.d, res.affectations));
          return x.d.eleves.map(function (e) { var c = M.couvertureEleve(e, ctx); return [c.ind.A, c.ind.B, c.mut.A, c.mut.B, c.peri.A, c.peri.B].join(); });
        }
        egal(couv(x.res), couv(sans), "couverture A/B de chaque élève identique");
        vrai(x.res.rapport.trous.A + x.res.rapport.trous.B <= sans.rapport.trous.A + sans.rapport.trous.B, "pas plus de trous");
        vrai(x.res.rapport.aesh.every(function (a) { return typeof a.trousA === "number" && typeof a.courtesB === "number"; }), "trous par AESH dans le rapport");
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
    t("moteur (exemples) : périscolaires prioritaires couverts sur les 3 jeux, 1 ou 12 ordres", function () {
      return Promise.all([charger(), chargerExemples(env, { renfort: true })]).then(function (x) {
        var d = x[0].d;
        var doublees = avecAffectations(d, []);
        doublees.aesh = d.aesh.concat(d.aesh.map(function (a) { var c = JSON.parse(JSON.stringify(a)); c.id = a.id + "-bis"; c.nom = a.nom + " bis"; return c; }));
        var louis = eleveNomme("Louis I.");
        [["pénurie", d], ["renfort", x[1]], ["AESH doublées", doublees]].forEach(function (j) {
          [P.proposer(j[1]), P.proposerMeilleur(j[1], 12)].forEach(function (res, i) {
            var lib = j[0] + (i ? ", 12 ordres" : ", 1 ordre");
            egal(res.rapport.periscolaireNonCouvert.filter(function (p) { return p.prioritaire; }), [], lib + " : aucun prioritaire non couvert");
            egal(res.rapport.qualite.periPrioNonCouvert, 0, lib);
            var merid = res.affectations.filter(function (a) { return a.periscolaire === "meridienne" && a.eleves.indexOf(louis.id) > -1; });
            vrai(merid.length >= 4, lib + " : pause méridienne de Louis I. couverte (" + merid.length + ")");
          });
        });
      });
    });
    t("moteur (exemples) : plusieurs ordres de départage — meilleur résultat, déterministe", function () {
      return charger().then(function (x) {
        var ids = x.d.aesh.map(function (a) { return a.id; });
        egal(P.ordreAesh(ids, 0), ids.slice().sort(), "ordre 0 : identifiants triés");
        egal(P.ordreAesh(ids, 3), P.ordreAesh(ids.slice().reverse(), 3), "permutation indépendante de l'ordre des lignes");
        egal(P.ordreAesh(ids, 3).slice().sort(), ids.slice().sort(), "permutation");
        vrai(JSON.stringify(P.ordreAesh(ids, 1)) !== JSON.stringify(P.ordreAesh(ids, 2)), "ordres différents");
        var m = P.proposerMeilleur(x.d, 6);
        egal(m.rapport.ordres.essais.length, 6);
        vrai(P.comparerQualite(m.rapport.qualite, x.res.rapport.qualite) <= 0, "au moins aussi bon que l'ordre 0");
        m.rapport.ordres.essais.forEach(function (e) { vrai(P.comparerQualite(m.rapport.qualite, e.qualite) <= 0, "meilleur que l'ordre " + e.ordre); });
        egal(JSON.stringify(P.proposerMeilleur(x.d, 6)), JSON.stringify(m), "relance identique");
        var melange = avecAffectations(x.d, []);
        melange.aesh = x.d.aesh.slice().reverse();
        egal(JSON.stringify(P.proposerMeilleur(melange, 6).affectations), JSON.stringify(m.affectations), "ordre des lignes du fichier sans effet");
        egal(violationsMoteur(M, x.d, m), []);
        egal(JSON.stringify(P.proposerMeilleur(x.d, 1).affectations), JSON.stringify(x.res.affectations), "n = 1 : résultat d'un seul ordre");
        // critères dans l'ordre : la couverture passe avant tout le reste
        var q = { couvert: 10, periPrioNonCouvert: 0, elevesPlusDe3: 0, trous: 0, courtes: 0, periNormalNonCouvert: 0 };
        function avec(k, v) { var o = JSON.parse(JSON.stringify(q)); o[k] = v; return o; }
        vrai(P.comparerQualite(avec("couvert", 11), q) < 0 && P.comparerQualite(avec("periPrioNonCouvert", 1), avec("elevesPlusDe3", 5)) > 0
          && P.comparerQualite(avec("elevesPlusDe3", 1), avec("trous", 9)) > 0 && P.comparerQualite(avec("trous", 1), avec("courtes", 9)) > 0
          && P.comparerQualite(avec("courtes", 1), avec("periNormalNonCouvert", 9)) > 0 && P.comparerQualite(q, q) === 0, "ordre des critères");
      });
    });
    t("moteur (exemples) : le renfort de deux AESH fait remonter la couverture (scénario)", function () {
      return Promise.all([charger(), chargerExemples(env, { renfort: true })]).then(function (x) {
        var avant = x[0].res, d = avecAffectations(x[1], avant.affectations), apres = P.proposer(d);
        egal(x[1].aesh.length, x[0].d.aesh.length + 2);
        function total(r) { return r.heures.individuel.couvert + r.heures.mutualise.couvert; }
        vrai(total(apres.rapport) > total(avant.rapport), total(avant.rapport) + " h → " + total(apres.rapport) + " h");
        vrai(apres.rapport.sousCouverts.length < avant.rapport.sousCouverts.length, "moins d'élèves sous-couverts");
        egal(violationsMoteur(M, d, apres), []);
      });
    });
    t("moteur (exemples) : temps périscolaires non gérés — absents du moteur et du rapport", function () {
      return charger().then(function (x) {
        var d = avecAffectations(x.d, x.res.affectations);
        d.reglages = { gererPeriscolaire: false };
        var ctx = M.contexte(d);
        egal(ctx.affectations.filter(function (a) { return a.modalite === "periscolaire"; }), [], "affectations périscolaires ignorées");
        egal(M.creneauxPeriscolaires(eleveNomme("Louis I."), ctx), [], "aucun créneau périscolaire");
        var res = P.proposer(d);
        var peri = res.affectations.filter(function (a) { return a.modalite === "periscolaire"; });
        vrai(peri.every(function (a) { return a.epinglee; }), "aucune affectation périscolaire proposée");
        egal([res.rapport.heures.periscolaire, res.rapport.periscolaireNonCouvert], [{ demande: 0, couvert: 0 }, []]);
        egal(violationsMoteur(M, d, res), []);
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
