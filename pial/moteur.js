"use strict";

/* =====================================================================
   PialMoteur — proposition d'affectations (spec §5).

   Algorithme glouton, déterministe et explicable : il ne cherche pas la
   solution optimale. À chaque tour, il prend l'unité de demande la plus
   pressante (§5.3.4), écarte les AESH qui violeraient une contrainte dure
   (§4.4) et choisit celle qui a le meilleur score (§5.3.5).

   proposer(donnees) -> {affectations, rapport}
     donnees : mêmes champs que PialModele.contexte() (etablissements,
     eleves, aesh, cours, affectations = brouillon, reglages) + annee.
     Les affectations épinglées sont reprises telles quelles ; les autres
     sont remplacées par la proposition (relance partielle, §5.4).
   classerAesh(donnees, candidat, remplaceId) -> AESH d'un créneau triées
     par score, avec les raisons (menu de la grille élève).

   Fonctions pures : ni DOM, ni IndexedDB, ni horloge, ni hasard. Tous les
   tris sont stables et départagés par clé alphabétique : mêmes données,
   même résultat (le temps de calcul est mesuré par l'appelant). Tourne
   sur le thread principal (pas de Web Worker sous file://).
   ===================================================================== */
var PialMoteur = (function () {

  var M = typeof PialModele !== "undefined" ? PialModele
    : (typeof require === "function" ? require("./modele.js") : null);

  var EPS = 1e-9;

  // §5.3.5 : tous les poids du score, et les seuils de leurs critères
  var POIDS = {
    continuite: 40,            // déjà affectée à un élève de l'unité
    memeEtablissement: 20,     // créneau voisin du jour dans le même établissement
    colle: 10,                 // journée compacte
    experienceParBesoin: 5,    // phase 4 (rapprochement des rapports)
    experienceMax: 15,
    formation: 10,             // phase 4 (table formation → besoins à valider, §7.3)
    equilibrageMax: 15,        // proportionnel à la part de quotité restante
    isole: -10,
    tropAesh: -25,             // par AESH au-delà du seuil, cumulable (4e : -25, 5e : -50…)
    ecartColleMin: 15,         // « collé » : au plus 15 min d'écart
    trouIsoleMin: 120,         // « isolé » : plus de 2 h jusqu'au créneau le plus proche
    maxAeshParEleve: 3
  };

  // §5.3.2.3 : lien besoin → matières. Aucune table n'est définie (spec
  // §14) : le critère est inactif tant que cet objet reste vide.
  // Forme attendue : { "Aide à la manipulation": ["SVT", "Technologie"] }
  var BESOINS_MATIERES = {};

  // critères d'expérience et de formation : sans effet jusqu'à la phase 4
  function scoreExperience() { return 0; }
  function scoreFormation() { return 0; }

  // motifs d'écartement d'une AESH, dans l'ordre où ils sont testés
  var ORDRE_MOTIFS = ["etablissement", "indisponibilite", "quotite", "chevauchement", "deplacement", "pause"];
  var LIBELLE_ECARTEE = {
    etablissement: "autre établissement", indisponibilite: "indisponible", quotite: "quotité",
    chevauchement: "déjà occupée", deplacement: "déplacement", pause: "pause repas"
  };
  // motif d'une heure non couverte (rapport de fin, §5.3.7)
  var LIBELLE_MOTIF = {
    quotite: "quotités épuisées",
    chevauchement: "AESH déjà occupées sur ces créneaux",
    indisponibilite: "AESH indisponibles sur ces créneaux",
    etablissement: "aucune AESH n'intervient dans l'établissement",
    deplacement: "déplacement impossible",
    pause: "pause repas des AESH",
    aucune: "aucune AESH",
    cours: "pas assez de cours non exclus",
    arrondi: "reste inférieur à un demi-cours"
  };

  function txt(s) { return String(s == null ? "" : s); }
  // « hh:mm » -> minutes, mémorisé (appelé très souvent)
  var cacheMinutes = {};
  function mn(h) {
    var v = cacheMinutes[h];
    if (v === undefined) v = cacheMinutes[h] = M.minutes(h);
    return v;
  }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function comparerCles(k1, k2) {
    for (var i = 0; i < k1.length; i++) if (k1[i] !== k2[i]) return k1[i] < k2[i] ? -1 : 1;
    return 0;
  }
  function arrondi(x) { return Math.round(x * 100) / 100; }
  function moy(x) { return (x.A + x.B) / 2; }
  function etabDe(ctx, id) { return ctx.etablissements[id] || M.etablissementParDefaut(id); }
  function semainesCreneau(c, ctx) { return M.semainesDe(c.semaine, ctx.etablissements[c.etab]); }
  function duree(c, modalite, ctx) { return M.dureeComptee(c.debut, c.fin, modalite === "periscolaire", ctx.reglages); }
  function nomsEleves(ctx, ids) { return ids.map(function (id) { var e = ctx._eleves[id]; return e ? e.nomCourt : id; }).join(", "); }
  function ordreCours(a, b) {
    return (M.JOURS.indexOf(a.jour) - M.JOURS.indexOf(b.jour)) || (mn(a.debut) - mn(b.debut))
      || (mn(a.fin) - mn(b.fin)) || cmp(txt(a.semaine), txt(b.semaine))
      || cmp(txt(a.matiere), txt(b.matiere)) || cmp(txt(a.groupe), txt(b.groupe)) || cmp(txt(a.id), txt(b.id));
  }
  function parId(a, b) { return cmp(txt(a.id), txt(b.id)); }

  /* =============== état courant du calcul =============== */
  // index tenus à jour à chaque affectation : affectations et charge A/B
  // par AESH, couverture et créneaux occupés par élève.
  function creerEtat(ctx) {
    var et = { ctx: ctx, affsParAesh: {}, charge: {}, couv: {}, occupe: {}, aeshParEleve: {} };
    et.aeshTriees = ctx.aesh.slice().sort(parId);
    ctx.eleves.forEach(function (e) {
      et.couv[e.id] = { individuel: { A: 0, B: 0 }, mutualise: { A: 0, B: 0 }, periscolaire: { A: 0, B: 0 }, jours: {} };
      et.occupe[e.id] = [];
      et.aeshParEleve[e.id] = {};
    });
    return et;
  }
  function chargeDe(et, id) { return et.charge[id] || (et.charge[id] = { A: 0, B: 0 }); }
  function affsDe(et, id) { return et.affsParAesh[id] || (et.affsParAesh[id] = []); }
  function ajouter(et, aff) {
    var ctx = et.ctx, c = aff.creneau, sem = semainesCreneau(c, ctx), d = duree(c, aff.modalite, ctx);
    affsDe(et, aff.aeshId).push(aff);
    var ch = chargeDe(et, aff.aeshId);
    sem.forEach(function (s) { ch[s] += d; });
    (aff.eleves || []).forEach(function (id) {
      var cv = et.couv[id];
      if (!cv) return;
      var k = cv[aff.modalite] ? aff.modalite : "periscolaire";
      sem.forEach(function (s) { cv[k][s] += d; });
      if (k !== "periscolaire") cv.jours[c.jour] = (cv.jours[c.jour] || 0) + d * sem.length / 2;
      et.occupe[id].push({ jour: c.jour, debut: mn(c.debut), fin: mn(c.fin), semaines: sem });
      et.aeshParEleve[id][aff.aeshId] = true;
    });
  }
  // parmi « semaines », celles où l'élève n'est pas déjà accompagné sur ce créneau
  function semainesLibres(et, eleveId, c, semaines) {
    var d = mn(c.debut), f = mn(c.fin);
    var occ = (et.occupe[eleveId] || []).filter(function (o) { return o.jour === c.jour && o.debut < f && d < o.fin; });
    return semaines.filter(function (s) { return !occ.some(function (o) { return o.semaines.indexOf(s) > -1; }); });
  }

  /* =============== contraintes dures (§4.4) =============== */
  // Première contrainte qui interdit à l'AESH de prendre l'unité u sur ces
  // semaines, ou null. Les contraintes 2 et 3 (individuel exclusif,
  // mutualisation) et la cohérence avec l'EDT des élèves sont garanties par
  // la construction des unités.
  function obstacle(et, aesh, u, semaines) {
    var ctx = et.ctx, r = ctx.reglages, c = u.creneau;
    if (r.respecterIndispos && !aesh.ignorerIndispos) {
      if ((aesh.etablissements || []).length && aesh.etablissements.indexOf(c.etab) < 0) return "etablissement";
      if (M.indisponibilite(aesh, c)) return "indisponibilite";
    }
    var d = duree(c, u.modalite, ctx), ch = chargeDe(et, aesh.id), q = aesh.quotite || 0;
    if (semaines.some(function (s) { return ch[s] + d > q + EPS; })) return "quotite";
    var deb = mn(c.debut), fin = mn(c.fin);
    var simulee = { creneau: { etab: c.etab, jour: c.jour, debut: c.debut, fin: c.fin, semaine: "toutes" }, modalite: u.modalite, periscolaire: u.periscolaire };
    var duJourTous = affsDe(et, aesh.id).filter(function (a) { return a.creneau.jour === c.jour; });
    for (var i = 0; i < semaines.length; i++) {
      var s = semaines[i];
      var duJour = duJourTous.filter(function (a) { return semainesCreneau(a.creneau, ctx).indexOf(s) > -1; });
      var j, a, ad, af;
      for (j = 0; j < duJour.length; j++) {
        a = duJour[j]; ad = mn(a.creneau.debut); af = mn(a.creneau.fin);
        if (ad < fin && deb < af) return "chevauchement";
      }
      for (j = 0; j < duJour.length; j++) {
        a = duJour[j];
        if (a.creneau.etab === c.etab) continue;
        ad = mn(a.creneau.debut); af = mn(a.creneau.fin);
        if ((deb >= af ? deb - af : ad - fin) < r.deplacementMin) return "deplacement";
      }
      var presence = fin - deb;
      duJour.forEach(function (x) { presence += mn(x.creneau.fin) - mn(x.creneau.debut); });
      if (presence <= r.seuilJourneePause) continue;
      var liste = duJour.concat([simulee]).sort(function (x, y) { return mn(x.creneau.debut) - mn(y.creneau.debut); });
      var p = M.verifierPauseRepas(liste, ctx);
      if (p && p.niveau === "erreur") return "pause";
    }
    return null;
  }

  /* =============== score (§5.3.5) =============== */
  function evaluer(et, aesh, u, semaines) {
    var ctx = et.ctx, P = POIDS, c = u.creneau, raisons = [], score = 0;
    var avec = u.eleves.filter(function (id) { return et.aeshParEleve[id] && et.aeshParEleve[id][aesh.id]; });
    if (avec.length) { score += P.continuite; raisons.push("déjà avec " + nomsEleves(ctx, avec)); }
    // créneaux voisins de l'AESH ce jour-là (semaines communes)
    var deb = mn(c.debut), fin = mn(c.fin), prec = null, suiv = null;
    affsDe(et, aesh.id).forEach(function (a) {
      if (a.creneau.jour !== c.jour) return;
      if (!semainesCreneau(a.creneau, ctx).some(function (s) { return semaines.indexOf(s) > -1; })) return;
      var ad = mn(a.creneau.debut), af = mn(a.creneau.fin);
      if (af <= deb && (!prec || af > prec.fin)) prec = { fin: af, etab: a.creneau.etab };
      if (ad >= fin && (!suiv || ad < suiv.debut)) suiv = { debut: ad, etab: a.creneau.etab };
    });
    if ((prec && prec.etab === c.etab) || (suiv && suiv.etab === c.etab)) {
      score += P.memeEtablissement; raisons.push("même établissement le " + c.jour);
    }
    var ecarts = [];
    if (prec) ecarts.push(deb - prec.fin);
    if (suiv) ecarts.push(suiv.debut - fin);
    if (ecarts.length) {
      var mini = Math.min.apply(null, ecarts);
      if (mini <= P.ecartColleMin) { score += P.colle; raisons.push("journée compacte"); }
      else if (mini > P.trouIsoleMin) { score += P.isole; raisons.push("créneau isolé (trou de plus de " + (P.trouIsoleMin / 60) + " h)"); }
    }
    // pénalité progressive : rang qu'aurait cette AESH pour chaque élève
    u.eleves.forEach(function (id) {
      var s = et.aeshParEleve[id] || {};
      if (s[aesh.id]) return;
      var rang = Object.keys(s).length + 1;
      if (rang <= P.maxAeshParEleve) return;
      score += P.tropAesh * (rang - P.maxAeshParEleve);
      raisons.push(rang + "e AESH pour " + nomsEleves(ctx, [id]));
    });
    score += scoreExperience(aesh, u, ctx) + scoreFormation(aesh, u, ctx);
    // équilibrage : part de quotité restante, dans la semaine la plus chargée
    var q = aesh.quotite || 0, ch = chargeDe(et, aesh.id), part = 1;
    semaines.forEach(function (s) { part = Math.min(part, q > 0 ? (q - ch[s]) / q : 0); });
    part = Math.max(0, part);
    score += P.equilibrageMax * part;
    raisons.push(Math.round(part * 100) + " % de quotité disponible");
    return { score: arrondi(score), raisons: raisons };
  }

  // AESH possibles pour l'unité, triées par score (égalité : identifiant)
  function choisir(et, u, semaines) {
    var res = { candidats: [], ecartees: {}, nbEcartees: 0 };
    et.aeshTriees.forEach(function (a) {
      var o = obstacle(et, a, u, semaines);
      if (o) { res.ecartees[o] = (res.ecartees[o] || 0) + 1; res.nbEcartees++; return; }
      var ev = evaluer(et, a, u, semaines);
      res.candidats.push({ aeshId: a.id, score: ev.score, raisons: ev.raisons });
    });
    res.candidats.sort(function (x, y) { return (y.score - x.score) || cmp(x.aeshId, y.aeshId); });
    res.meilleur = res.candidats[0] || null;
    return res;
  }
  // « 3 AESH écartées (2 quotité, 1 indisponible) » ; les AESH d'autres
  // établissements ne sont pas comptées : elles ne pouvaient pas venir
  function texteEcartees(ecartees, n) {
    n -= ecartees.etablissement || 0;
    if (!n) return "";
    return n + " AESH écartée" + (n > 1 ? "s" : "") + " (" + ORDRE_MOTIFS.filter(function (k) { return ecartees[k] && k !== "etablissement"; })
      .map(function (k) { return ecartees[k] + " " + LIBELLE_ECARTEE[k]; }).join(", ") + ")";
  }

  /* =============== demande (§5.2, §5.3.2-3) =============== */
  function lienMatiere(eleve, cours) {
    var m = M.normaliser(cours.matiere);
    return (eleve.besoins || []).some(function (b) {
      return (BESOINS_MATIERES[b] || []).some(function (x) { return M.normaliser(x) === m; });
    }) ? 1 : 0;
  }

  // Candidats de chaque élève (individuel), groupes mutualisés et groupes
  // périscolaires, construits une fois. Les membres effectifs d'une unité
  // sont recalculés à chaque tour.
  function preparer(ctx) {
    var d = { eleves: ctx.eleves.slice().sort(parId), individuels: {}, groupes: [], peri: [], periDemande: {} };
    var groupes = {}, peri = {};
    d.eleves.forEach(function (e) {
      var cours = (ctx._coursParEleve[e.id] || []).filter(function (co) { return co.etat !== "exclu"; }).sort(ordreCours);
      function creneauDe(co) { return { etab: co.etablissement, jour: co.jour, debut: co.debut, fin: co.fin }; }
      if (e.heuresInd > 0) {
        d.individuels[e.id] = cours.map(function (co) {
          return { cle: "ind|" + e.id + "|" + co.id, cours: co, creneau: creneauDe(co), prio: co.etat === "prioritaire",
            semaines: M.semainesDe(co.semaine, ctx.etablissements[co.etablissement]), lien: lienMatiere(e, co) };
        });
      }
      if (e.heuresMut > 0) {
        cours.forEach(function (co) {
          var k = ["mut", co.etablissement, M.normaliser(co.classe), co.jour, co.debut, co.fin, M.normaliser(co.matiere),
            M.normaliser(co.groupe), M.semaineNormalisee(co.semaine)].join("|");
          if (!groupes[k]) {
            groupes[k] = { cle: k, modalite: "mutualise", creneau: creneauDe(co), membres: [],
              semaines: M.semainesDe(co.semaine, ctx.etablissements[co.etablissement]) };
          }
          groupes[k].membres.push({ eleveId: e.id, prio: co.etat === "prioritaire" });
        });
      }
      d.periDemande[e.id] = 0;
      if (e.recreation || e.meridienne) {
        M.creneauxPeriscolaires(e, ctx).forEach(function (p) {
          if (p.etat === "exclu") return;
          var c = p.creneau;
          d.periDemande[e.id] += duree(c, "periscolaire", ctx) * semainesCreneau(c, ctx).length / 2;
          var k = ["peri", c.etab, c.jour, c.debut, c.fin, p.type].join("|");
          if (!peri[k]) {
            peri[k] = { cle: k, modalite: "periscolaire", periscolaire: p.type, membres: [],
              creneau: { etab: c.etab, jour: c.jour, debut: c.debut, fin: c.fin }, semaines: semainesCreneau(c, ctx) };
          }
          peri[k].membres.push({ eleveId: e.id, prio: p.etat === "prioritaire" });
        });
      }
    });
    d.groupes = Object.keys(groupes).sort().map(function (k) { return groupes[k]; });
    d.peri = Object.keys(peri).sort().map(function (k) { return peri[k]; });
    return d;
  }

  // Semaines à couvrir pour un élève à qui il reste « reste » heures (§5.3,
  // spec §14) : le cours entier si le reste est au moins égal à son apport ;
  // sinon, si le reste vaut au moins la moitié, une seule semaine (A, puis
  // B si A est impossible) — ou le cours entier s'il n'est pas scindable ;
  // en dessous, rien. null = pas de morceau utile.
  function morceau(reste, d, libres, etab) {
    if (!libres.length || reste <= EPS) return null;
    var apport = d * libres.length / 2;
    if (reste >= apport - EPS) return libres;
    if (reste >= apport / 2 - EPS) return libres.length === 2 && etab.alternance !== false ? ["A"] : libres;
    return null;
  }

  /* =============== proposition =============== */
  function proposer(donnees) {
    donnees = donnees || {};
    var epinglees = (donnees.affectations || []).filter(function (a) { return a.epinglee; });
    var ctx = M.contexte({ etablissements: donnees.etablissements, eleves: donnees.eleves, aesh: donnees.aesh,
      cours: donnees.cours, affectations: epinglees, reglages: donnees.reglages });
    var annee = donnees.annee || (ctx.eleves[0] && ctx.eleves[0].annee) || "";
    var et = creerEtat(ctx);
    // 1. ce que couvrent déjà les affectations épinglées
    epinglees.slice().sort(parId).forEach(function (a) { ajouter(et, a); });
    var dem = preparer(ctx);
    var nouvelles = [], tentes = {}, motifs = {}, motifsPeri = {};

    function reste(e, modalite) {
      var notifie = modalite === "individuel" ? e.heuresInd : e.heuresMut;
      return (notifie || 0) - moy(et.couv[e.id][modalite]);
    }
    function proportion(e, modalite) {
      if (modalite === "periscolaire") {
        var dm = dem.periDemande[e.id];
        return dm > 0 ? moy(et.couv[e.id].periscolaire) / dm : 1;
      }
      var n = modalite === "individuel" ? e.heuresInd : e.heuresMut;
      return n > 0 ? moy(et.couv[e.id][modalite]) / n : 1;
    }
    function chargeJour(e, jour) { return et.couv[e.id].jours[jour] || 0; }
    function deja(cle, semaines) { return tentes[cle + "|" + semaines.join("")]; }

    // Meilleure unité de chaque entité (élève en individuel, groupe
    // mutualisé, groupe périscolaire), mémorisée : elle ne dépend que de
    // l'état de ses élèves, et n'est recalculée que s'ils ont changé.
    var entites = [], parEleve = {};
    function suivre(ent, ids) { entites.push(ent); ids.forEach(function (id) { (parEleve[id] = parEleve[id] || []).push(ent); }); }
    dem.eleves.forEach(function (e) { if (dem.individuels[e.id]) suivre({ calcul: function () { return uniteIndividuelle(e); } }, [e.id]); });
    dem.groupes.forEach(function (g) { suivre({ calcul: function () { return uniteMutualisee(g); } }, g.membres.map(function (mb) { return mb.eleveId; })); });
    dem.peri.forEach(function (g) { suivre({ calcul: function () { return unitePeriscolaire(g); } }, g.membres.map(function (mb) { return mb.eleveId; })); });
    function invalider(ids) { ids.forEach(function (id) { (parEleve[id] || []).forEach(function (ent) { ent.calcule = false; }); }); }
    // unité la plus pressante (§5.3.4) : prioritaires, puis individuelles,
    // mutualisées (les plus nombreuses d'abord), périscolaires ; à égalité,
    // l'élève le moins couvert en proportion, puis préférences de l'élève
    // (jour le moins chargé, matière liée, ordre chronologique).
    function prochaineUnite() {
      var meilleure = null;
      entites.forEach(function (ent) {
        if (!ent.calcule) { ent.valeur = ent.calcul(); ent.calcule = true; }
        if (ent.valeur && (!meilleure || comparerCles(ent.valeur.cleTri, meilleure.cleTri) < 0)) meilleure = ent.valeur;
      });
      return meilleure && meilleure.u;
    }
    function uniteIndividuelle(e) {
      var meilleure = null;
      function candidate(cleTri, u) { if (!meilleure || comparerCles(cleTri, meilleure.cleTri) < 0) meilleure = { cleTri: cleTri, u: u }; }
      var liste = dem.individuels[e.id];
      var r = reste(e, "individuel");
      if (r <= EPS) return null;
      var etab = etabDe(ctx, e.etablissement), prop = proportion(e, "individuel");
      liste.forEach(function (ca) {
        var libres = semainesLibres(et, e.id, ca.creneau, ca.semaines);
        var m = morceau(r, duree(ca.creneau, "individuel", ctx), libres, etab);
        if (!m || deja(ca.cle, m)) return;
        candidate([ca.prio ? 0 : 1, 0, 0, prop, e.cle, chargeJour(e, ca.creneau.jour), -ca.lien,
          M.JOURS.indexOf(ca.creneau.jour), mn(ca.creneau.debut), ca.cle],
          { cle: ca.cle, modalite: "individuel", creneau: ca.creneau, libres: libres, morceau: m, eleves: [e.id] });
      });
      return meilleure;
    }
    function uniteMutualisee(g) {
      var etab = etabDe(ctx, g.creneau.etab), d = duree(g.creneau, "mutualise", ctx), vus = [];
      g.membres.forEach(function (mb) {
        var e = ctx._eleves[mb.eleveId], libres = semainesLibres(et, e.id, g.creneau, g.semaines);
        var m = morceau(reste(e, "mutualise"), d, libres, etab);
        if (m) vus.push({ e: e, prio: mb.prio, libres: libres, morceau: m });
      });
      if (!vus.length) return null;
      var choix = vus[0].morceau;
      vus.forEach(function (v) { if (v.morceau.length > choix.length) choix = v.morceau; });
      if (deja(g.cle, choix)) return null;
      var membres = vus.filter(function (v) { return choix.every(function (s) { return v.libres.indexOf(s) > -1; }); });
      if (!membres.length) return null;
      var libresGroupe = membres[0].libres;
      // entre groupes mutualisés, le moins couvert d'abord ; la taille du
      // groupe ne fait que départager (spec §14)
      return { cleTri: [membres.some(function (v) { return v.prio; }) ? 0 : 1, 1,
        Math.min.apply(null, membres.map(function (v) { return proportion(v.e, "mutualise"); })), -membres.length, membres[0].e.cle,
        Math.max.apply(null, membres.map(function (v) { return chargeJour(v.e, g.creneau.jour); })), 0,
        M.JOURS.indexOf(g.creneau.jour), mn(g.creneau.debut), g.cle],
        u: { cle: g.cle, modalite: "mutualise", creneau: g.creneau, libres: libresGroupe, morceau: choix,
          eleves: membres.map(function (v) { return v.e.id; }) } };
    }
    function unitePeriscolaire(g) {
      if (deja(g.cle, g.semaines)) return null;
      var membres = g.membres.filter(function (mb) { return semainesLibres(et, mb.eleveId, g.creneau, g.semaines).length === g.semaines.length; });
      if (!membres.length) return null;
      var eleves = membres.map(function (mb) { return ctx._eleves[mb.eleveId]; });
      return { cleTri: [membres.some(function (mb) { return mb.prio; }) ? 0 : 1, 2, -membres.length,
        Math.min.apply(null, eleves.map(function (e) { return proportion(e, "periscolaire"); })), eleves[0].cle, 0, 0,
        M.JOURS.indexOf(g.creneau.jour), mn(g.creneau.debut), g.cle],
        u: { cle: g.cle, modalite: "periscolaire", periscolaire: g.periscolaire, creneau: g.creneau, libres: g.semaines,
          morceau: g.semaines, eleves: membres.map(function (mb) { return mb.eleveId; }) } };
    }

    // Motifs d'un échec, par élève et modalité. Les AESH d'autres
    // établissements ne comptent que si aucune autre n'a été écartée : elles
    // n'auraient jamais pu prendre le créneau, ce n'est pas ce qui bloque.
    function noterEchec(u, ch) {
      var cles = ch.nbEcartees ? Object.keys(ch.ecartees) : ["aucune"];
      if (cles.length > 1) cles = cles.filter(function (k) { return k !== "etablissement"; });
      var cible;
      if (u.modalite === "periscolaire") cible = motifsPeri[u.cle] = motifsPeri[u.cle] || {};
      cles.forEach(function (k) {
        var n = ch.nbEcartees ? ch.ecartees[k] : 1;
        if (cible) { cible[k] = (cible[k] || 0) + n; return; }
        u.eleves.forEach(function (id) {
          var m = motifs[id] = motifs[id] || { individuel: {}, mutualise: {} };
          m[u.modalite][k] = (m[u.modalite][k] || 0) + n;
        });
      });
    }
    function essayer(u, semaines) {
      var ch = choisir(et, u, semaines);
      if (!ch.meilleur) { noterEchec(u, ch); return false; }
      var c = { etab: u.creneau.etab, jour: u.creneau.jour, debut: u.creneau.debut, fin: u.creneau.fin,
        semaine: semaines.length === 2 ? "toutes" : semaines[0] };
      var ecartees = texteEcartees(ch.ecartees, ch.nbEcartees);
      var aff = { id: "mo|" + ch.meilleur.aeshId + "|" + M.creneauCle(c), annee: annee, version: 0, aeshId: ch.meilleur.aeshId,
        creneau: c, creneauCle: M.creneauCle(c), modalite: u.modalite, eleves: u.eleves.slice().sort(),
        epinglee: false, origine: "moteur", score: ch.meilleur.score,
        raisons: ch.meilleur.raisons.concat(ecartees ? [ecartees] : []), alertes: [] };
      if (u.periscolaire) aff.periscolaire = u.periscolaire;
      ajouter(et, aff);
      nouvelles.push(aff);
      return true;
    }
    // une unité est tentée au plus une fois par jeu de semaines
    function tenter(u) {
      var m = u.morceau, scindable = u.libres.length === 2 && etabDe(ctx, u.creneau.etab).alternance !== false;
      [m, u.libres, ["A"], ["B"]].forEach(function (s) { if (s.length <= u.libres.length) tentes[u.cle + "|" + s.join("")] = true; });
      if (m.length === 2) {
        if (essayer(u, m)) return;
        if (scindable) { essayer(u, ["A"]); essayer(u, ["B"]); }   // AESH différentes en A et en B (§4.1)
      } else if (scindable) {
        if (!essayer(u, ["A"])) essayer(u, ["B"]);                 // une seule semaine pour un reste d'un demi-cours
      } else essayer(u, m);
    }

    var u, garde = 0;
    while ((u = prochaineUnite()) && garde++ < 1000000) { tenter(u); invalider(u.eleves); }

    var finales = epinglees.concat(nouvelles);
    return { affectations: finales, rapport: rapport(donnees, finales, nouvelles, epinglees, motifs, motifsPeri, dem) };
  }

  /* =============== rapport de fin (§5.3.7) =============== */
  function motifDominant(compteurs) {
    var meilleur = null;
    ORDRE_MOTIFS.concat(["aucune"]).forEach(function (k) {
      if (compteurs[k] && (!meilleur || compteurs[k] > compteurs[meilleur])) meilleur = k;
    });
    return meilleur;
  }
  function rapport(donnees, finales, nouvelles, epinglees, motifs, motifsPeri, dem) {
    var ctx = M.contexte({ etablissements: donnees.etablissements, eleves: donnees.eleves, aesh: donnees.aesh,
      cours: donnees.cours, affectations: finales, reglages: donnees.reglages });
    var s = M.synthese(ctx);
    var r = {
      heures: {
        individuel: { demande: s.indDemande, couvert: arrondi(s.indCouvert) },
        mutualise: { demande: s.mutDemande, couvert: arrondi(s.mutCouvert) },
        periscolaire: { demande: 0, couvert: 0 }
      },
      nbProposees: nouvelles.length, nbEpinglees: epinglees.length, periscolaireGere: !!ctx.reglages.gererPeriscolaire,
      sousCouverts: [], periscolaireNonCouvert: [], aesh: [], violations: []
    };
    var et = creerEtat(ctx);
    finales.forEach(function (a) { ajouter(et, a); });
    dem.eleves.forEach(function (e) {
      var cv = M.couvertureEleve(e, ctx);
      r.heures.periscolaire.demande += dem.periDemande[e.id];
      r.heures.periscolaire.couvert += Math.min(cv.peri.moy, dem.periDemande[e.id]);
      var manqueInd = Math.max(0, cv.ind.notifie - cv.ind.moy), manqueMut = Math.max(0, cv.mut.notifie - cv.mut.moy);
      if (manqueInd <= EPS && manqueMut <= EPS) return;
      var cpt = {}, m = motifs[e.id] || { individuel: {}, mutualise: {} };
      [["individuel", manqueInd], ["mutualise", manqueMut]].forEach(function (x) {
        if (x[1] <= EPS) return;
        Object.keys(m[x[0]]).forEach(function (k) { cpt[k] = (cpt[k] || 0) + m[x[0]][k]; });
      });
      var motif = motifDominant(cpt) || (cv.etat === "partiel" ? "arrondi" : "cours");
      r.sousCouverts.push({ eleveId: e.id, nomCourt: e.nomCourt, classe: e.classe, etablissement: etabDe(ctx, e.etablissement).nom,
        etat: cv.etat, manqueInd: arrondi(manqueInd), manqueMut: arrondi(manqueMut), motif: motif, libelle: LIBELLE_MOTIF[motif], detail: cpt });
    });
    dem.peri.forEach(function (g) {
      g.membres.forEach(function (mb) {
        var libres = semainesLibres(et, mb.eleveId, g.creneau, g.semaines);
        if (!libres.length) return;
        var e = ctx._eleves[mb.eleveId], motif = motifDominant(motifsPeri[g.cle] || {}) || "aucune";
        r.periscolaireNonCouvert.push({ eleveId: e.id, nomCourt: e.nomCourt, classe: e.classe, type: g.periscolaire,
          jour: g.creneau.jour, debut: g.creneau.debut, fin: g.creneau.fin, semaines: libres, prioritaire: mb.prio,
          motif: motif, libelle: LIBELLE_MOTIF[motif] });
      });
    });
    r.heures.periscolaire.demande = arrondi(r.heures.periscolaire.demande);
    r.heures.periscolaire.couvert = arrondi(r.heures.periscolaire.couvert);
    ctx.aesh.slice().sort(parId).forEach(function (a) {
      var ch = M.chargeAesh(a, ctx);
      r.aesh.push({ aeshId: a.id, nom: a.prenom + " " + a.nom, quotite: ch.quotite, A: arrondi(ch.A), B: arrondi(ch.B),
        etat: ch.etat, restantA: arrondi(ch.quotite - ch.A), restantB: arrondi(ch.quotite - ch.B) });
    });
    r.aeshSousUtilisees = r.aesh.filter(function (a) { return a.etat === "sous"; });
    // contrôle : le moteur ne doit jamais enfreindre une contrainte dure
    nouvelles.forEach(function (a) {
      M.verifierAffectation(a, ctx).forEach(function (v) {
        if (v.niveau === "erreur") r.violations.push({ affectationId: a.id, code: v.code, message: v.message });
      });
    });
    return r;
  }

  /* =============== menu de créneau (§7.1) =============== */
  // candidat : {creneau, modalite, periscolaire, eleves:[id]} ; remplaceId :
  // affectation remplacée (rejoindre un groupe, changer d'AESH). Renvoie
  // toutes les AESH : possibles d'abord, triées par score, puis écartées
  // (motif = première contrainte qui bloque). seule : n'évaluer que cette
  // AESH (le menu construit un candidat par AESH : rejoindre un groupe).
  function classerAesh(donnees, candidat, remplaceId, seule) {
    var affs = (donnees.affectations || []).filter(function (a) { return a.id !== remplaceId; });
    var ctx = M.contexte({ etablissements: donnees.etablissements, eleves: donnees.eleves, aesh: donnees.aesh,
      cours: donnees.cours, affectations: affs, reglages: donnees.reglages });
    var et = creerEtat(ctx);
    affs.slice().sort(parId).forEach(function (a) { ajouter(et, a); });
    var u = { creneau: candidat.creneau, modalite: candidat.modalite, periscolaire: candidat.periscolaire, eleves: candidat.eleves || [] };
    var semaines = semainesCreneau(candidat.creneau, ctx);
    var possibles = [], ecartees = [];
    et.aeshTriees.forEach(function (a) {
      if (seule && a.id !== seule) return;
      var o = obstacle(et, a, u, semaines);
      if (o) { ecartees.push({ aeshId: a.id, possible: false, motif: o }); return; }
      var ev = evaluer(et, a, u, semaines);
      possibles.push({ aeshId: a.id, possible: true, score: ev.score, raisons: ev.raisons });
    });
    possibles.sort(function (x, y) { return (y.score - x.score) || cmp(x.aeshId, y.aeshId); });
    return possibles.concat(ecartees);
  }

  return {
    POIDS: POIDS, BESOINS_MATIERES: BESOINS_MATIERES, LIBELLE_MOTIF: LIBELLE_MOTIF,
    proposer: proposer, classerAesh: classerAesh, morceau: morceau
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialMoteur;
