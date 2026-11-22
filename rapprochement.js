"use strict";

/* =====================================================================
   Rapprochement — rapprochement tolérant d'un élève décrit par (prénom,
   initiale du nom, classe, établissement) avec une liste de fiches.
   Fonctions pures, sans DOM, sans stockage, sans réseau. Partagé par :
   - l'espace PIAL (rattachement des rapports importés aux élèves) ;
   - l'application AESH (« Importer mon affectation »).
   Chargé par les deux (index.html en dépend de façon FACULTATIVE : s'il est
   absent, l'application AESH démarre normalement et seule l'importation
   de l'affectation est indisponible) et par Node pour les tests.

   Profil : {prenom, initiale, classe, classeBrute, etab (jetons), etabBrut}
   (valeurs normalisées : casse, accents, ponctuation et espaces ignorés).
   ===================================================================== */
var Rapprochement = (function () {

  function txt(s) { return String(s == null ? "" : s); }
  function sansAccent(s) {
    var t = txt(s);
    return (t.normalize ? t.normalize("NFD") : t).replace(/[̀-ͯ]/g, "");
  }
  // minuscules, sans accents, tout ce qui n'est pas lettre ou chiffre devient espace
  function normaliserTexte(s) {
    return sansAccent(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^ +| +$/g, "");
  }
  function normaliserPrenom(s) { return normaliserTexte(s); }

  /* « 5ème B », « 5e B », « 5 eme B », « 5°B », « 5B » → « 5b ». Un « E »
     collé à un chiffre en majuscule (« 5E ») reste une lettre de classe. */
  function normaliserClasse(c) {
    var brut = txt(c).replace(/^\s+|\s+$/g, ""), n = normaliserTexte(brut);
    if (!n) return "";
    var m = n.match(/^([3-6])\s?(?:eme|e\s)\s*(.*)$/) || n.match(/^([3-6])\s?eme$/);
    if (m) return m[1] + (m[2] || "").replace(/ /g, "");
    m = n.match(/^([3-6])e(\d.*)$/);
    if (m) return m[1] + m[2].replace(/ /g, "");
    if (/^[3-6] ?e$/.test(n) && !/^[3-6]E$/.test(brut)) return n.charAt(0);
    if (/^(2|2nde|2de|seconde)(?: |$)/.test(n)) return "2de" + n.replace(/^(2nde|2de|seconde|2)/, "").replace(/ /g, "");
    if (/^(1|1ere|1re|premiere)(?: |$)/.test(n)) return "1re" + n.replace(/^(1ere|1re|premiere|1)/, "").replace(/ /g, "");
    if (/^(terminale|tle)(?: |$)/.test(n)) return "tle" + n.replace(/^(terminale|tle)/, "").replace(/ /g, "");
    return n.replace(/ /g, "");
  }
  var NIVEAUX = ["ps", "ms", "gs", "cp", "ce1", "ce2", "cm1", "cm2", "6", "5", "4", "3", "2de", "1re", "tle"];
  function rangNiveau(classeNorm) {
    var m = txt(classeNorm).match(/^(ps|ms|gs|cp|ce1|ce2|cm1|cm2|2de|1re|tle|[3-6])/);
    return m ? NIVEAUX.indexOf(m[1]) : -1;
  }

  var MOTS_ETAB = { college: 1, lycee: 1, ecole: 1, de: 1, du: 1, des: 1, la: 1, le: 1, les: 1, d: 1, l: 1, et: 1, cite: 1,
    groupe: 1, scolaire: 1, elementaire: 1, maternelle: 1, primaire: 1, prive: 1, public: 1, clg: 1, lyc: 1, lgt: 1, professionnel: 1,
    general: 1, technologique: 1 };
  function jetonsEtablissement(s) {
    var out = [];
    normaliserTexte(s).split(" ").forEach(function (j) {
      if (!j || MOTS_ETAB[j]) return;
      if (j === "saint" || j === "sainte") j = j === "saint" ? "st" : "ste";
      out.push(j);
    });
    return out;
  }

  function distance(a, b) {
    if (a === b) return 0;
    // Damerau-Levenshtein restreinte : l'échange de deux lettres voisines compte 1
    var prec2 = null, prec = [], i, j;
    for (j = 0; j <= b.length; j++) prec[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cour = [i];
      for (j = 1; j <= b.length; j++) {
        cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (prec2 && i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          cour[j] = Math.min(cour[j], prec2[j - 2] + 1);
        }
      }
      prec2 = prec; prec = cour;
    }
    return prec[b.length];
  }

  /* « Lucas M. » → {prenom: "lucas", initiale: "m"} ; « Ma. » (abréviation
     choisie) → initiale « ma » ; un nom complet sans point (« Lucas Martin »)
     donne l'initiale de son dernier mot. */
  function analyserNomCourt(s) {
    var mots = txt(s).replace(/\s+/g, " ").replace(/^ | $/g, "").split(" ");
    if (mots.length === 1) return { prenom: normaliserPrenom(mots[0]), initiale: "" };
    var dernier = mots[mots.length - 1], rest = mots.slice(0, -1).join(" ");
    if (/\.$/.test(dernier) || normaliserTexte(dernier).length === 1) return { prenom: normaliserPrenom(rest), initiale: normaliserTexte(dernier).replace(/ /g, "") };
    return { prenom: normaliserPrenom(mots[0]), initiale: normaliserTexte(dernier).charAt(0) };
  }

  function profil(prenom, initiale, classe, etablissement) {
    return { prenom: normaliserPrenom(prenom), initiale: normaliserTexte(initiale).replace(/ /g, ""),
      classe: normaliserClasse(classe), classeBrute: txt(classe), etab: jetonsEtablissement(etablissement), etabBrut: txt(etablissement) };
  }
  function profilDeNomCourt(nomCourt, classe, etablissement) {
    var a = analyserNomCourt(nomCourt);
    return profil(a.prenom, a.initiale, classe, etablissement);
  }
  // fiche de l'application AESH : prénom, nom complet, classe, établissement
  function profilDeFiche(fiche) {
    var nom = normaliserTexte(fiche.nom);
    return profil(fiche.prenom, /\.\s*$/.test(txt(fiche.nom)) ? nom : nom.charAt(0), fiche.classe, fiche.etablissement);
  }

  function compareJetons(a, b) {
    if (!a.length || !b.length) return "vide";
    var sa = a.slice().sort().join(" "), sb = b.slice().sort().join(" ");
    if (sa === sb) return "meme";
    var contient = function (x, y) { return x.every(function (j) { return y.indexOf(j) >= 0; }); };
    if (contient(a, b) || contient(b, a)) return "proche";
    // un jeton abrégé (« P. Gauthier » vs « Paul Gauthier »)
    var abrege = function (x, y) { return x.length === y.length && x.every(function (j, i) { return j === y[i] || (j.length === 1 && y[i].charAt(0) === j) || (y[i].length === 1 && j.charAt(0) === y[i]); }); };
    if (abrege(a, b)) return "proche";
    return "autre";
  }

  /* compare une source à un candidat. Résultat : {rejet, prenom, initiale,
     classe, etab, score}. Un prénom ou une initiale incompatible, ou un
     établissement clairement différent, écarte le candidat. */
  function comparer(src, cand) {
    var r = { rejet: false, prenom: "", initiale: "", classe: "", etab: "", score: 0 };
    var p1 = src.prenom, p2 = cand.prenom;
    if (!p1 || !p2) { r.rejet = true; return r; }
    if (p1 === p2 || p1.replace(/ /g, "") === p2.replace(/ /g, "")) { r.prenom = "exact"; r.score += 100; }
    else {
      var a = p1.replace(/ /g, ""), b = p2.replace(/ /g, ""), d = distance(a, b), lmin = Math.min(a.length, b.length);
      var premier = p1.split(" ")[0] === p2.split(" ")[0] && lmin >= 3;
      if ((lmin >= 4 && d <= 1) || (lmin >= 8 && d <= 2) || premier) { r.prenom = "proche"; r.score += 60; }
      else { r.rejet = true; return r; }
    }
    var i1 = src.initiale, i2 = cand.initiale;
    if (!i1 || !i2) { r.initiale = "vide"; r.score += 20; }
    else if (i1.indexOf(i2) === 0 || i2.indexOf(i1) === 0) { r.initiale = "ok"; r.score += 50; }
    else { r.rejet = true; return r; }
    r.etab = compareJetons(src.etab, cand.etab);
    if (r.etab === "autre") { r.rejet = true; return r; }
    r.score += r.etab === "meme" ? 40 : (r.etab === "proche" ? 25 : 10);
    if (!src.classe || !cand.classe) { r.classe = "vide"; r.score += 5; }
    else if (src.classe === cand.classe) { r.classe = "meme"; r.score += 40; }
    else {
      var d1 = rangNiveau(src.classe), d2 = rangNiveau(cand.classe);
      if (d1 >= 0 && d1 === d2) { r.classe = "niveau"; r.score += 20; }
      else if (d1 >= 0 && d2 === d1 + 1) { r.classe = "suivant"; r.score += 25; }
      else { r.classe = "autre"; r.score += 5; }
    }
    return r;
  }

  /* rapproche une source (profil) de candidats [{id, groupe?, recence?, ...profil}].
     Candidats d'un même « groupe » (fiches d'un même élève sur plusieurs années) :
     seul le meilleur est gardé (à égalité, le plus récent).
     etat :
       "auto"        un seul candidat identique en tout (prénom, initiale, classe, établissement)
       "probable"    un seul candidat compatible, mais pas identique en tout (à valider)
       "ambigu"      plusieurs candidats (doublons, ou plusieurs compatibles) : à trancher
       "introuvable" aucun candidat compatible
     Renvoie {etat, choix (candidat ou null), candidats: [{cible, comparaison, score}] triés}. */
  function rapprocher(src, candidats) {
    var garde = {}, ordre = [];
    (candidats || []).forEach(function (c, i) {
      var cmp = comparer(src, c);
      if (cmp.rejet) return;
      var cle = c.groupe == null ? "#" + i : "g" + c.groupe;
      var x = { cible: c, comparaison: cmp, score: cmp.score, ordre: i };
      var ex = garde[cle];
      if (!ex) { garde[cle] = x; ordre.push(cle); }
      else if (x.score > ex.score || (x.score === ex.score && txt(c.recence) > txt(ex.cible.recence))) garde[cle] = x;
    });
    var liste = ordre.map(function (k) { return garde[k]; });
    liste.sort(function (a, b) { return b.score - a.score || a.ordre - b.ordre; });
    var surs = liste.filter(function (x) {
      var c = x.comparaison; return c.prenom === "exact" && c.initiale === "ok" && c.classe === "meme" && c.etab === "meme";
    });
    var etat, choix = null;
    if (surs.length === 1) { etat = "auto"; choix = surs[0].cible; }
    else if (surs.length > 1) etat = "ambigu";
    else if (!liste.length) etat = "introuvable";
    else if (liste.length === 1) { etat = "probable"; choix = liste[0].cible; }
    else etat = "ambigu";
    return { etat: etat, choix: choix, candidats: liste.map(function (x) { return { cible: x.cible, comparaison: x.comparaison, score: x.score }; }) };
  }

  /* =============== rattachement des rapports (espace PIAL) =============== */
  /* rapports : rapports importés ; eleves : élèves PIAL (id, nomCourt, classe,
     etablissement = id, annee, parcours) ; nomsEtab : {id: nom} ; memoire :
     {liens: {eleveIdAesh: eleveIdPial}, ignores: {eleveIdAesh: true}} (choix
     de l'utilisateur, mémorisés). Aucun rapport n'est lu autrement qu'en
     lecture : le rattachement ne modifie rien.
     Renvoie {groupes: [{srcId, eleveNom, classe, etablissement, aesh, nb,
     dernier, etat, choix, candidats}], compte: {etat: n}, rapports: n}.
     etat : auto | probable | ambigu | introuvable | lie (choix mémorisé) | ignore. */
  function rattacherRapports(rapports, eleves, nomsEtab, memoire) {
    memoire = memoire || {};
    var liens = memoire.liens || {}, ignores = memoire.ignores || {};
    var parSrc = {}, ordre = [];
    (rapports || []).forEach(function (r) {
      if (!r.eleveId) return;
      var g = parSrc[r.eleveId];
      if (!g) { g = parSrc[r.eleveId] = { srcId: r.eleveId, nb: 0, dernier: null, aeshs: {} }; ordre.push(r.eleveId); }
      g.nb++;
      if (r.aesh) g.aeshs[r.aesh] = true;
      var d = txt(r.debut || r.creeJour);
      if (!g.dernier || d >= txt(g.dernier.debut || g.dernier.creeJour)) g.dernier = r;
    });
    var parId = {};
    var cands = (eleves || []).map(function (e) {
      parId[e.id] = e;
      var a = analyserNomCourt(e.nomCourt), p = profil(a.prenom, a.initiale, e.classe, (nomsEtab || {})[e.etablissement] || e.etablissement);
      p.id = e.id; p.groupe = e.parcours || e.id; p.recence = txt(e.annee); p.eleve = e;
      return p;
    });
    var res = { groupes: [], compte: { auto: 0, probable: 0, ambigu: 0, introuvable: 0, lie: 0, ignore: 0 }, rapports: 0 };
    ordre.forEach(function (id) {
      var g = parSrc[id], r = g.dernier;
      var item = { srcId: id, eleveNom: r.eleveNom, classe: r.classe, etablissement: r.etablissement, aesh: Object.keys(g.aeshs).join(", "),
        nb: g.nb, dernier: txt(r.debut || r.creeJour), etat: "", choix: null, candidats: [] };
      if (ignores[id]) item.etat = "ignore";
      else if (liens[id] && parId[liens[id]]) { item.etat = "lie"; item.choix = cands.filter(function (c) { return c.id === liens[id]; })[0]; }
      else {
        var rr = rapprocher(profilDeNomCourt(r.eleveNom, r.classe, r.etablissement), cands);
        item.etat = rr.etat; item.choix = rr.choix; item.candidats = rr.candidats;
      }
      res.compte[item.etat]++;
      res.rapports += g.nb;
      res.groupes.push(item);
    });
    return res;
  }

  return {
    normaliserTexte: normaliserTexte, normaliserClasse: normaliserClasse, jetonsEtablissement: jetonsEtablissement,
    distance: distance, analyserNomCourt: analyserNomCourt, profil: profil, profilDeNomCourt: profilDeNomCourt,
    profilDeFiche: profilDeFiche, comparer: comparer, rapprocher: rapprocher, rattacherRapports: rattacherRapports
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Rapprochement;
