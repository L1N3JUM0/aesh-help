"use strict";

/* =====================================================================
   PialRepartition — répartition des AESH entre établissements et
   dispositifs (spec §19). Fonctions pures, sans DOM ni stockage.
   Utilisation : var R = PialRepartition.creer(PialModele).

   Une répartition dit, pour chaque AESH, combien d'heures par semaine elle
   consacre à chaque unité (établissement ou dispositif ULIS) :
     {annee, parAesh: {aeshId: {uniteId: heures}}}
   uniteId = identifiant de l'établissement, ou « ulis:<id du dispositif> ».
   Les heures sont des heures hebdomadaires (identiques en semaines A et B),
   par pas de 0,5 h ; le total d'une AESH ne dépasse pas sa quotité.

   Besoin d'une colonne (établissement) :
   - individuel : somme des heures notifiées en individuel ;
   - mutualisé brut : somme des heures notifiées en mutualisé ;
   - mutualisé estimé : une heure mutualisée peut couvrir plusieurs élèves,
     mais seulement ceux d'une même classe, au même cours (spec §4.4). Par
     classe, on choisit les cours qui couvrent le plus d'élèves encore non
     satisfaits (recouvrement glouton, départage par la clé du cours), jusqu'à
     ce que chaque élève ait ses heures notifiées ; ce qui ne peut pas être
     couvert par un cours de la classe (élève sans emploi du temps, ou pas
     assez de cours) reste compté pour sa valeur brute. L'estimation est
     bornée par la plus grande notification de la classe (minimum, si tous
     les élèves partageaient chaque cours) et par la somme brute ;
   - périscolaire : seulement si le réglage est activé ; les récréations et
     pauses méridiennes sont communes à tout l'établissement (une heure
     compte une fois, quel que soit le nombre d'élèves) ;
   - état : écart = heures allouées − besoin, avec les seuils de la
     couverture d'un élève (§4.2). Le besoin retenu est l'estimé quand tous
     les élèves notifiés en mutualisé ont un emploi du temps, le brut sinon.
   Besoin d'un dispositif ULIS : ses heures d'ouverture par semaine.
   ===================================================================== */
var PialRepartition = (function () {

  var PREFIXE_ULIS = "ulis:";
  var PAS = 0.5;
  var EPS = 1e-9;
  var DISPOSITIF_DEFAUT = {
    jours: ["lundi", "mardi", "jeudi", "vendredi"],
    matin: { debut: "09:00", fin: "12:00" },
    apresmidi: { debut: "13:30", fin: "16:00" }
  };

  function creer(M) {

    function txt(s) { return String(s == null ? "" : s); }
    function possede(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function arrondi(x) { return Math.round(x * 100) / 100; }
    function copie(x) { return JSON.parse(JSON.stringify(x)); }

    /* ---------- dispositifs (ULIS) déclarés dans Réglages ---------- */
    function idUnite(d) { return PREFIXE_ULIS + d.id; }
    function estUniteDispositif(id) { return txt(id).indexOf(PREFIXE_ULIS) === 0; }
    function plageValide(p) {
      if (!p) return false;
      var a = M.minutes(p.debut), b = M.minutes(p.fin);
      return !isNaN(a) && !isNaN(b) && b > a;
    }
    // heures d'ouverture par semaine : jours × (matin + après-midi)
    function heuresOuverture(d) {
      var par = 0;
      [d.matin, d.apresmidi].forEach(function (p) { if (plageValide(p)) par += (M.minutes(p.fin) - M.minutes(p.debut)) / 60; });
      return arrondi(par * (d.jours || []).length);
    }
    function nouveauDispositif(id, nom, etab) {
      var d = copie(DISPOSITIF_DEFAUT);
      d.id = id; d.nom = nom; d.etab = etab; d.type = "ulis";
      return d;
    }
    // renvoie le message d'erreur, ou "" si la fiche est valide
    function erreurDispositif(d) {
      if (!txt(d.nom).trim()) return "Donnez un nom au dispositif.";
      if (!txt(d.etab)) return "Choisissez l'établissement du dispositif.";
      if (!(d.jours || []).length) return "Cochez au moins un jour d'ouverture.";
      if (!plageValide(d.matin) && !plageValide(d.apresmidi)) return "Indiquez au moins une plage horaire valide (hh:mm, fin après le début).";
      return "";
    }

    /* ---------- répartition : lecture et modification ---------- */
    function vide(annee) { return { annee: annee || "", parAesh: {} }; }
    function estVide(rep) { return !rep || !Object.keys(rep.parAesh || {}).some(function (k) { return Object.keys(rep.parAesh[k]).length; }); }
    function normaliserHeures(x) {
      var n = parseFloat(String(x).replace(",", "."));
      if (isNaN(n) || n < 0) return NaN;
      return Math.round(n / PAS) * PAS;
    }
    function lignes(rep, aeshId) { return (rep && rep.parAesh && rep.parAesh[aeshId]) || {}; }
    function alloue(rep, aeshId) {
      var l = lignes(rep, aeshId), t = 0;
      Object.keys(l).forEach(function (u) { t += l[u]; });
      return arrondi(t);
    }
    // heures non réparties d'une AESH (négatives si la quotité a baissé depuis)
    function reste(rep, aesh) { return arrondi((aesh.quotite || 0) - alloue(rep, aesh.id)); }
    // nouvelle répartition où l'AESH consacre « heures » à l'unité (0 = retirer)
    function fixer(rep, aeshId, unite, heures) {
      var r = copie(rep || vide(""));
      r.parAesh = r.parAesh || {};
      var l = r.parAesh[aeshId] = r.parAesh[aeshId] || {};
      if (heures > EPS) l[unite] = heures; else delete l[unite];
      if (!Object.keys(l).length) delete r.parAesh[aeshId];
      return r;
    }
    // message si fixer(…) dépasserait la quotité, "" sinon
    function erreurSaisie(rep, aesh, unite, heures) {
      if (isNaN(heures) || heures < 0) return "Indiquez un nombre d'heures positif ou nul.";
      var autres = alloue(rep, aesh.id) - (lignes(rep, aesh.id)[unite] || 0);
      if (autres + heures > (aesh.quotite || 0) + EPS) {
        return "Au plus " + arrondi(Math.max(0, (aesh.quotite || 0) - autres)) + " h : la quotité de l'AESH est de " + (aesh.quotite || 0) + " h et " + arrondi(autres) + " h sont déjà réparties ailleurs.";
      }
      return "";
    }
    // retire les lignes d'une AESH absente (supprimée ou archivée), d'une unité qui n'existe plus (si unitesIds est donné), ou à zéro
    function nettoyer(rep, aeshIds, unitesIds) {
      var r = vide(rep && rep.annee);
      Object.keys((rep && rep.parAesh) || {}).forEach(function (a) {
        if (aeshIds.indexOf(a) < 0) return;
        Object.keys(rep.parAesh[a]).forEach(function (u) {
          if ((!unitesIds || unitesIds.indexOf(u) > -1) && rep.parAesh[a][u] > EPS) r = fixer(r, a, u, rep.parAesh[a][u]);
        });
      });
      return r;
    }
    // AESH dont le total dépasse la quotité (quotité réduite après coup)
    function enDepassement(rep, aeshs) {
      return aeshs.filter(function (a) { return alloue(rep, a.id) > (a.quotite || 0) + EPS; });
    }
    // La répartition prime sur les « établissements possibles » : allouer des heures à une AESH dans un établissement l'ajoute à
    // ses établissements possibles (si elle en a une liste ; vide = tous). valeurs : {uniteId: heures}. Renvoie la fiche modifiée
    // (marquée « modifiée » : protégée au réimport) et les identifiants ajoutés, ou {fiche: null, ajoutes: []}. Les dispositifs
    // ne comptent pas : l'AESH d'une ULIS n'intervient que dans le dispositif.
    function fichePourRepartition(aesh, valeurs) {
      var fiche = aesh, ajoutes = [];
      Object.keys(valeurs).sort().forEach(function (u) {
        if (estUniteDispositif(u) || !(valeurs[u] > EPS)) return;
        var r = M.aeshEtablissement([fiche], [fiche.id], u, true, null);
        if (r.fiches.length) { fiche = r.fiches[0]; ajoutes.push(u); }
      });
      return { fiche: ajoutes.length ? fiche : null, ajoutes: ajoutes };
    }
    // ce que le moteur et la vérification utilisent : {aeshId: {établissement: heures}}.
    // Une AESH qui a au moins une ligne y figure, même si elle n'a que du dispositif
    // (elle n'intervient alors dans aucun établissement). Sans répartition : null.
    function pourMoteur(rep) {
      if (estVide(rep)) return null;
      var out = {};
      Object.keys(rep.parAesh).forEach(function (a) {
        if (!Object.keys(rep.parAesh[a]).length) return;
        out[a] = {};
        Object.keys(rep.parAesh[a]).forEach(function (u) { if (!estUniteDispositif(u)) out[a][u] = rep.parAesh[a][u]; });
      });
      return out;
    }

    /* ---------- besoins ---------- */
    // recouvrement glouton d'une classe : heures hebdomadaires (moyenne A/B) à prévoir pour les élèves notifiés en mutualisé
    function estimerClasse(membres, ctx) {
      var brut = 0, plusGrand = 0, creneaux = {}, besoin = {}, avecEdt = true;
      membres.forEach(function (e) {
        brut += e.heuresMut; plusGrand = Math.max(plusGrand, e.heuresMut);
        besoin[e.id] = e.heuresMut;
        var cours = (ctx._coursParEleve[e.id] || []).filter(function (c) { return c.etat !== "exclu"; });
        if (!cours.length) avecEdt = false;
        cours.forEach(function (c) {
          var etab = ctx.etablissements[c.etablissement];
          var cle = [c.jour, c.debut, c.fin, M.semaineNormalisee(c.semaine), M.normaliser(c.matiere), M.normaliser(c.groupe)].join("|");
          var x = creneaux[cle] = creneaux[cle] || { cle: cle, poids: M.dureeComptee(c.debut, c.fin, false, ctx.reglages) * M.semainesDe(c.semaine, etab).length / 2, eleves: {} };
          x.eleves[e.id] = true;
        });
      });
      var total = 0, restants = Object.keys(creneaux).sort().map(function (k) { return creneaux[k]; });
      for (;;) {
        var meilleur = null, meilleurN = 0;
        restants.forEach(function (x) {
          var n = Object.keys(x.eleves).filter(function (id) { return besoin[id] > EPS; }).length;
          if (n > meilleurN) { meilleur = x; meilleurN = n; }
        });
        if (!meilleur) break;
        total += meilleur.poids;
        Object.keys(meilleur.eleves).forEach(function (id) { besoin[id] -= meilleur.poids; });
        restants.splice(restants.indexOf(meilleur), 1);
      }
      Object.keys(besoin).forEach(function (id) { if (besoin[id] > EPS) total += besoin[id]; });
      return { brut: brut, min: plusGrand, estime: Math.min(brut, Math.max(plusGrand, total)), avecEdt: avecEdt };
    }

    // heures de périscolaire à couvrir dans l'établissement (créneaux distincts, état non exclu)
    function heuresPeriscolaire(etabId, ctx) {
      if (!ctx.reglages.gererPeriscolaire) return 0;
      var vus = {}, t = 0;
      ctx.eleves.forEach(function (e) {
        if (e.etablissement !== etabId) return;
        M.creneauxPeriscolaires(e, ctx).forEach(function (p) {
          if (p.etat === "exclu") return;
          var c = p.creneau, k = [p.type, c.jour, c.debut, c.fin].join("|");
          if (vus[k]) return;
          vus[k] = true;
          t += M.dureeComptee(c.debut, c.fin, true, ctx.reglages);
        });
      });
      return t;
    }

    // donnees : {etablissements, eleves, cours, reglages, dispositifs} (fiches actives de l'année)
    function besoins(donnees) {
      var ctx = M.contexte({ etablissements: donnees.etablissements, eleves: donnees.eleves, cours: donnees.cours, aesh: [], affectations: [], reglages: donnees.reglages });
      var out = [];
      var etabs = (donnees.etablissements || []).slice().sort(function (a, b) { return txt(a.nom).localeCompare(txt(b.nom), "fr"); });
      var ids = {};
      etabs.forEach(function (e) { ids[e.id] = true; });
      // établissements cités par des élèves sans fiche d'établissement : ils ont aussi une colonne
      (donnees.eleves || []).forEach(function (e) {
        if (e.etablissement && !ids[e.etablissement]) { ids[e.etablissement] = true; etabs.push({ id: e.etablissement, nom: e.etablissementNom || e.etablissement }); }
      });
      etabs.forEach(function (et) {
        var eleves = ctx.eleves.filter(function (e) { return e.etablissement === et.id; });
        var u = { id: et.id, type: "etab", etab: et.id, nom: et.nom, nbEleves: eleves.length, ind: 0, mutBrut: 0, mutMin: 0, mutEstime: 0, peri: 0, estimation: true };
        eleves.forEach(function (e) { u.ind += e.heuresInd || 0; });
        var parClasse = {};
        eleves.forEach(function (e) {
          if (!(e.heuresMut > 0)) return;
          var k = M.normaliser(M.classeNette(e.classe));
          (parClasse[k] = parClasse[k] || []).push(e);
        });
        Object.keys(parClasse).sort().forEach(function (k) {
          var c = estimerClasse(parClasse[k], ctx);
          u.mutBrut += c.brut; u.mutMin += c.min; u.mutEstime += c.estime;
          if (!c.avecEdt) u.estimation = false;
        });
        u.ind = arrondi(u.ind); u.mutBrut = arrondi(u.mutBrut); u.mutMin = arrondi(u.mutMin); u.mutEstime = arrondi(u.mutEstime);
        u.peri = arrondi(heuresPeriscolaire(et.id, ctx));
        u.besoin = arrondi(u.ind + (u.estimation ? u.mutEstime : u.mutBrut) + u.peri);
        out.push(u);
        (donnees.dispositifs || []).filter(function (d) { return d.etab === et.id; }).forEach(function (d) {
          var h = heuresOuverture(d);
          out.push({ id: idUnite(d), type: "ulis", etab: et.id, nom: d.nom, dispositif: d, ouverture: h, besoin: h, estimation: true, ind: 0, mutBrut: 0, mutMin: 0, mutEstime: 0, peri: 0, nbEleves: 0 });
        });
      });
      // dispositif rattaché à un établissement sans colonne : colonne quand même
      (donnees.dispositifs || []).forEach(function (d) {
        if (out.some(function (u) { return u.id === idUnite(d); })) return;
        var h = heuresOuverture(d);
        out.push({ id: idUnite(d), type: "ulis", etab: d.etab, nom: d.nom, dispositif: d, ouverture: h, besoin: h, estimation: true, ind: 0, mutBrut: 0, mutMin: 0, mutEstime: 0, peri: 0, nbEleves: 0 });
      });
      return out;
    }

    // tableau complet : colonnes (besoin, alloué, écart, état), AESH (alloué, reste), totaux
    function tableau(donnees, rep) {
      var unites = besoins(donnees);
      unites.forEach(function (u) {
        u.alloue = 0; u.aesh = [];
        (donnees.aesh || []).forEach(function (a) {
          var h = lignes(rep, a.id)[u.id];
          if (h > EPS) { u.alloue += h; u.aesh.push({ aeshId: a.id, heures: h }); }
        });
        u.alloue = arrondi(u.alloue);
        u.ecart = arrondi(u.alloue - u.besoin);
        u.etat = M.etatCouverture(u.besoin, u.alloue);
      });
      var aesh = (donnees.aesh || []).map(function (a) {
        return { id: a.id, quotite: a.quotite || 0, alloue: alloue(rep, a.id), reste: reste(rep, a), lignes: copie(lignes(rep, a.id)) };
      });
      var t = { besoin: 0, alloue: 0, quotites: 0, nonReparties: 0, aeshAvecReste: 0, aeshEnDepassement: 0 };
      unites.forEach(function (u) { t.besoin += u.besoin; t.alloue += u.alloue; });
      aesh.forEach(function (a) {
        t.quotites += a.quotite;
        if (a.reste > EPS) { t.nonReparties += a.reste; t.aeshAvecReste++; }
        if (a.reste < -EPS) t.aeshEnDepassement++;
      });
      ["besoin", "alloue", "quotites", "nonReparties"].forEach(function (k) { t[k] = arrondi(t[k]); });
      // lignes de la répartition qui ne correspondent plus à rien (unité ou AESH disparue)
      var idsU = unites.map(function (u) { return u.id; }), idsA = aesh.map(function (a) { return a.id; });
      t.orphelines = 0;
      Object.keys((rep && rep.parAesh) || {}).forEach(function (a) {
        Object.keys(rep.parAesh[a]).forEach(function (u) { if (idsA.indexOf(a) < 0 || idsU.indexOf(u) < 0) t.orphelines++; });
      });
      return { unites: unites, aesh: aesh, totaux: t };
    }

    return {
      PREFIXE_ULIS: PREFIXE_ULIS, PAS: PAS, DISPOSITIF_DEFAUT: DISPOSITIF_DEFAUT,
      idUnite: idUnite, estUniteDispositif: estUniteDispositif, heuresOuverture: heuresOuverture,
      nouveauDispositif: nouveauDispositif, erreurDispositif: erreurDispositif,
      vide: vide, estVide: estVide, normaliserHeures: normaliserHeures, lignes: lignes, alloue: alloue, reste: reste,
      fixer: fixer, fichePourRepartition: fichePourRepartition, erreurSaisie: erreurSaisie, nettoyer: nettoyer, enDepassement: enDepassement, pourMoteur: pourMoteur,
      estimerClasse: estimerClasse, heuresPeriscolaire: heuresPeriscolaire, besoins: besoins, tableau: tableau
    };
  }

  return { creer: creer, PREFIXE_ULIS: PREFIXE_ULIS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialRepartition;
