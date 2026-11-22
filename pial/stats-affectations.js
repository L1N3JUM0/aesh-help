"use strict";

/* =====================================================================
   PialStatsAff — statistiques filtrables des affectations (spec §7.4).
   Fonctions pures, sans DOM ni stockage : elles calculent des tableaux que
   l'interface (onglet Statistiques) dessine avec graphiques.js et exporte
   en CSV. Utilisation : var S = PialStatsAff.creer(PialModele).

   donnees = {etablissements: [{id, nom}], eleves, aesh, cours,
     affectations, reglages}  (d'une année et d'une version : le brouillon
     ou une version validée ; les fiches archivées sont écartées)
   filtres = {etab (id), niveau ("5e"…), classe, aeshId, modalite
     ("individuel" | "mutualise"), semaine ("A" | "B")} — tout est facultatif.

   Règles :
   - heures couvertes d'un élève = min(heures affectées, heures notifiées),
     par modalité (individuel, mutualisé), moyenne des semaines A et B sauf
     si une semaine est choisie ;
   - avec un filtre AESH, les élèves retenus sont ceux qu'elle accompagne et
     la couverture ne compte que SES affectations ;
   - les temps périscolaires ne comptent pas dans la couverture (ils ont
     leur propre indicateur) et n'existent que si le réglage « Gérer les
     temps périscolaires » est coché.
   ===================================================================== */
var PialStatsAff = (function () {

  var GRAVITE = { sous: 3, partiel: 2, sur: 1, couvert: 0 };
  var ORDRE_NIVEAUX = ["PS", "MS", "GS", "CP", "CE1", "CE2", "CM1", "CM2", "6e", "5e", "4e", "3e", "2de", "1re", "Tle", "Autre"];

  function arrondi(x) { return Math.round(x * 100) / 100; }
  function txt(s) { return String(s == null ? "" : s); }
  function taux(couvert, notifie) { return notifie > 0 ? arrondi(couvert / notifie * 100) : null; }

  function creer(M) {

    function nomEtab(ctx, id) { var e = ctx.etablissements[id]; return e ? (e.nom || id) : id; }
    function nomAesh(a) { return (txt(a.prenom) + " " + txt(a.nom)).trim() || a.id; }

    // listes proposées par les filtres
    function options(donnees) {
      var d = M.donneesActives(donnees || {}), niveaux = {}, classes = {};
      (d.eleves || []).forEach(function (e) {
        niveaux[M.niveauClasse(e.classe)] = true;
        if (txt(e.classe).trim()) classes[e.classe] = true;
      });
      return {
        etablissements: (d.etablissements || []).map(function (e) { return { id: e.id, nom: e.nom || e.id }; }).sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); }),
        niveaux: ORDRE_NIVEAUX.filter(function (n) { return niveaux[n]; }),
        classes: Object.keys(classes).sort(M.comparerClasses),
        aesh: (d.aesh || []).map(function (a) { return { id: a.id, nom: nomAesh(a) }; }).sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); })
      };
    }

    function calculer(donnees, filtres) {
      var f = filtres || {}, d = M.donneesActives(donnees || {}), ctx = M.contexte(d);
      var sem = f.semaine === "A" || f.semaine === "B" ? f.semaine : "";
      var modalite = f.modalite === "individuel" || f.modalite === "mutualise" ? f.modalite : "";
      var filtreEleve = !!(f.etab || f.niveau || f.classe);

      function duree(aff) {
        return sem ? M.dureeAffectation(aff, sem, ctx) : (M.dureeAffectation(aff, "A", ctx) + M.dureeAffectation(aff, "B", ctx)) / 2;
      }

      // 1. élèves retenus par les filtres d'élève, affectations retenues par les filtres d'AESH et de modalité
      var eleves = ctx.eleves.filter(function (e) {
        if (f.etab && e.etablissement !== f.etab) return false;
        if (f.niveau && M.niveauClasse(e.classe) !== f.niveau) return false;
        if (f.classe && txt(e.classe) !== f.classe) return false;
        return true;
      });
      var affs = ctx.affectations.filter(function (a) {
        if (f.aeshId && a.aeshId !== f.aeshId) return false;
        if (modalite && a.modalite !== modalite) return false;
        return true;
      });
      var affsCours = affs.filter(function (a) { return a.modalite !== "periscolaire"; });
      if (f.aeshId) {
        var servis = {};
        affsCours.forEach(function (a) { (a.eleves || []).forEach(function (id) { servis[id] = true; }); });
        eleves = eleves.filter(function (e) { return servis[e.id]; });
      }
      var ids = {};
      eleves.forEach(function (e) { ids[e.id] = true; });

      // 2. couverture par élève
      var lignes = [];
      eleves.forEach(function (e) {
        var x = { eleve: e, ind: { notifie: e.heuresInd || 0, couvert: 0 }, mut: { notifie: e.heuresMut || 0, couvert: 0 } };
        affsCours.forEach(function (a) {
          if ((a.eleves || []).indexOf(e.id) < 0) return;
          (a.modalite === "individuel" ? x.ind : x.mut).couvert += duree(a);
        });
        var genres = modalite === "individuel" ? ["ind"] : (modalite === "mutualise" ? ["mut"] : ["ind", "mut"]);
        x.genres = genres;
        x.notifie = 0; x.couvert = 0; x.etat = "couvert";
        var actif = false;
        genres.forEach(function (g) {
          var v = x[g];
          if (v.notifie > 0 || v.couvert > 0) actif = true;
          v.utile = Math.min(v.couvert, v.notifie);
          v.etat = M.etatCouverture(v.notifie, v.couvert);
          x.notifie += v.notifie; x.couvert += v.utile;
          if (GRAVITE[v.etat] > GRAVITE[x.etat]) x.etat = v.etat;
        });
        if (actif) lignes.push(x);
      });

      function groupe(cleDe, libelleDe, tri) {
        var par = {};
        lignes.forEach(function (x) {
          var k = cleDe(x), g = par[k] = par[k] || { cle: k, libelle: libelleDe(x), nbEleves: 0, indNotifie: 0, indCouvert: 0, mutNotifie: 0, mutCouvert: 0 };
          g.nbEleves++;
          g.indNotifie += x.genres.indexOf("ind") >= 0 ? x.ind.notifie : 0; g.indCouvert += x.genres.indexOf("ind") >= 0 ? x.ind.utile : 0;
          g.mutNotifie += x.genres.indexOf("mut") >= 0 ? x.mut.notifie : 0; g.mutCouvert += x.genres.indexOf("mut") >= 0 ? x.mut.utile : 0;
        });
        return Object.keys(par).map(function (k) {
          var g = par[k];
          g.notifie = arrondi(g.indNotifie + g.mutNotifie); g.couvert = arrondi(g.indCouvert + g.mutCouvert);
          g.nonCouvert = arrondi(g.notifie - g.couvert); g.taux = taux(g.couvert, g.notifie);
          g.indTaux = taux(g.indCouvert, g.indNotifie); g.mutTaux = taux(g.mutCouvert, g.mutNotifie);
          ["indNotifie", "indCouvert", "mutNotifie", "mutCouvert"].forEach(function (c) { g[c] = arrondi(g[c]); });
          return g;
        }).sort(tri);
      }
      var multiEtab = {};
      lignes.forEach(function (x) { multiEtab[x.eleve.etablissement] = true; });
      multiEtab = Object.keys(multiEtab).length > 1;

      var global = { notifie: 0, couvert: 0, nbEleves: lignes.length };
      var etats = { couvert: 0, partiel: 0, sous: 0, sur: 0 };
      lignes.forEach(function (x) { global.notifie += x.notifie; global.couvert += x.couvert; etats[x.etat]++; });
      global.notifie = arrondi(global.notifie); global.couvert = arrondi(global.couvert);
      global.nonCouvert = arrondi(global.notifie - global.couvert); global.taux = taux(global.couvert, global.notifie);

      var parEtab = groupe(function (x) { return x.eleve.etablissement; }, function (x) { return nomEtab(ctx, x.eleve.etablissement); },
        function (p, q) { return p.libelle.localeCompare(q.libelle, "fr"); });
      var parNiveau = groupe(function (x) { return M.niveauClasse(x.eleve.classe); }, function (x) { return M.niveauClasse(x.eleve.classe); },
        function (p, q) { return ORDRE_NIVEAUX.indexOf(p.cle) - ORDRE_NIVEAUX.indexOf(q.cle); });
      var parClasse = groupe(function (x) { return x.eleve.etablissement + "|" + txt(x.eleve.classe); },
        function (x) { return (txt(x.eleve.classe) || "sans classe") + (multiEtab ? " — " + nomEtab(ctx, x.eleve.etablissement) : ""); },
        function (p, q) { return M.comparerClasses(p.libelle, q.libelle) || p.cle.localeCompare(q.cle, "fr"); });

      // 3. affectations retenues pour la charge, les changements, les priorités
      var affsSel = affs.filter(function (a) {
        if (!filtreEleve) return true;
        return (a.eleves || []).some(function (id) { return ids[id]; });
      });
      var chargeComplete = !filtreEleve && !modalite;

      var aeshListe = ctx.aesh.filter(function (a) { return !f.aeshId || a.id === f.aeshId; });
      var charges = aeshListe.map(function (a) {
        var A = 0, B = 0;
        affsSel.forEach(function (aff) {
          if (aff.aeshId !== a.id) return;
          A += M.dureeAffectation(aff, "A", ctx); B += M.dureeAffectation(aff, "B", ctx);
        });
        var valeur = sem === "A" ? A : (sem === "B" ? B : (A + B) / 2);
        var etat = chargeComplete ? M.etatCharge(sem ? valeur : A, sem ? valeur : B, a.quotite || 0, ctx.reglages) : null;
        return { id: a.id, libelle: nomAesh(a), charge: arrondi(valeur), quotite: a.quotite || 0, taux: (a.quotite || 0) > 0 ? arrondi(valeur / a.quotite * 100) : null, etat: etat };
      }).filter(function (c) { return c.charge > 0 || c.quotite > 0; }).sort(function (p, q) { return q.charge - p.charge || p.libelle.localeCompare(q.libelle, "fr"); });
      var chargeResume = { nbAesh: charges.length, total: 0, moyenne: 0, complete: 0, sous: 0, depassement: 0, evalue: chargeComplete };
      charges.forEach(function (c) {
        chargeResume.total += c.charge;
        if (c.etat) chargeResume[c.etat === "depassement" ? "depassement" : (c.etat === "sous" ? "sous" : "complete")]++;
      });
      chargeResume.total = arrondi(chargeResume.total);
      chargeResume.moyenne = charges.length ? arrondi(chargeResume.total / charges.length) : 0;

      // nombre d'AESH par élève (accompagnements de cours, hors périscolaire)
      var parEleve = {};
      affsSel.forEach(function (a) {
        if (a.modalite === "periscolaire") return;
        (a.eleves || []).forEach(function (id) { if (ids[id]) { parEleve[id] = parEleve[id] || {}; parEleve[id][a.aeshId] = true; } });
      });
      var repartAesh = {}, somme = 0, nbEl = 0;
      Object.keys(parEleve).forEach(function (id) {
        var n = Object.keys(parEleve[id]).length;
        repartAesh[n] = (repartAesh[n] || 0) + 1; somme += n; nbEl++;
      });
      var aeshParEleve = { moyenne: nbEl ? arrondi(somme / nbEl) : 0, nbEleves: nbEl,
        repartition: Object.keys(repartAesh).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return { nb: n, eleves: repartAesh[n] }; }) };

      // changements d'établissement d'une AESH dans une même journée
      var semaines = sem ? [sem] : ["A", "B"];
      var changements = aeshListe.map(function (a) {
        var r = { id: a.id, libelle: nomAesh(a), A: 0, B: 0 };
        semaines.forEach(function (s) {
          var parJour = {};
          affsSel.forEach(function (aff) {
            if (aff.aeshId !== a.id) return;
            if (M.semainesDe(aff.creneau.semaine, ctx.etablissements[aff.creneau.etab]).indexOf(s) < 0) return;
            (parJour[aff.creneau.jour] = parJour[aff.creneau.jour] || []).push(aff.creneau);
          });
          Object.keys(parJour).forEach(function (j) {
            var l = parJour[j].sort(function (p, q) { return M.minutes(p.debut) - M.minutes(q.debut); });
            for (var i = 1; i < l.length; i++) if (l[i].etab !== l[i - 1].etab) r[s]++;
          });
        });
        r.total = r.A + r.B; r.moyenne = arrondi(sem ? r[sem] : (r.A + r.B) / 2);
        return r;
      }).filter(function (r) { return r.total > 0; }).sort(function (p, q) { return q.total - p.total || p.libelle.localeCompare(q.libelle, "fr"); });

      // part des heures sur les cours prioritaires (heures d'AESH, un créneau compte une fois)
      var hTotal = 0, hPrio = 0;
      affsSel.forEach(function (a) {
        if (a.modalite === "periscolaire") return;
        var h = duree(a); hTotal += h;
        var prio = (a.eleves || []).some(function (id) {
          if (filtreEleve && !ids[id]) return false;
          return (ctx._coursParEleve[id] || []).some(function (co) {
            return co.etat === "prioritaire" && M.chevauchent({ etab: co.etablissement, jour: co.jour, debut: co.debut, fin: co.fin, semaine: co.semaine }, a.creneau, ctx);
          });
        });
        if (prio) hPrio += h;
      });
      var prioritaires = { heures: arrondi(hPrio), total: arrondi(hTotal), part: taux(hPrio, hTotal) };

      // temps périscolaires
      var peri = { active: !!ctx.reglages.gererPeriscolaire && !modalite, recreation: 0, meridienne: 0 };
      if (peri.active) affsSel.forEach(function (a) {
        if (a.modalite !== "periscolaire") return;
        var h = duree(a);
        if (a.periscolaire === "recreation") peri.recreation += h; else if (a.periscolaire === "meridienne") peri.meridienne += h;
      });
      peri.recreation = arrondi(peri.recreation); peri.meridienne = arrondi(peri.meridienne);

      return { filtres: { etab: f.etab || "", niveau: f.niveau || "", classe: f.classe || "", aeshId: f.aeshId || "", modalite: modalite, semaine: sem },
        global: global, etats: etats, parEtab: parEtab, parNiveau: parNiveau, parClasse: parClasse,
        charges: charges, chargeResume: chargeResume, aeshParEleve: aeshParEleve, changements: changements,
        prioritaires: prioritaires, periscolaire: peri };
    }

    // évolution de la couverture d'une version à l'autre : versions = [{libelle, donnees}]
    function evolution(versions, filtres) {
      return (versions || []).map(function (v) {
        var r = calculer(v.donnees, filtres);
        return { libelle: v.libelle, taux: r.global.taux, notifie: r.global.notifie, couvert: r.global.couvert, nonCouvert: r.global.nonCouvert, nbEleves: r.global.nbEleves };
      });
    }

    /* exports CSV : séparateur « ; », nombres à la française, BOM (Excel) */
    function cellule(v) {
      var s = v == null ? "" : (typeof v === "number" ? String(v).replace(".", ",") : String(v));
      if (/^[=+\-@]/.test(s) && typeof v !== "number") s = "'" + s;
      return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function csv(entetes, lignes) {
      return "﻿" + [entetes].concat(lignes).map(function (l) { return l.map(cellule).join(";"); }).join("\r\n") + "\r\n";
    }
    function tauxTxt(t) { return t == null ? "" : t; }
    var ENT_GROUPE = ["Libellé", "Élèves", "Heures notifiées", "Heures couvertes", "Heures non couvertes", "Taux de couverture (%)",
      "Individuel : notifiées", "Individuel : couvertes", "Individuel : taux (%)", "Mutualisé : notifiées", "Mutualisé : couvertes", "Mutualisé : taux (%)"];
    function ligneGroupe(g) {
      return [g.libelle, g.nbEleves, g.notifie, g.couvert, g.nonCouvert, tauxTxt(g.taux), g.indNotifie, g.indCouvert, tauxTxt(g.indTaux), g.mutNotifie, g.mutCouvert, tauxTxt(g.mutTaux)];
    }
    var LIB_ETAT = { depassement: "dépassement", complete: "complète", sous: "sous-utilisée" };
    function tableauxCsv(r) {
      return {
        "couverture-etablissements": csv(ENT_GROUPE, r.parEtab.map(ligneGroupe)),
        "couverture-niveaux": csv(ENT_GROUPE, r.parNiveau.map(ligneGroupe)),
        "couverture-classes": csv(ENT_GROUPE, r.parClasse.map(ligneGroupe)),
        "charge-aesh": csv(["AESH", "Quotité (h)", "Charge (h)", "Charge / quotité (%)", "État"], r.charges.map(function (c) { return [c.libelle, c.quotite, c.charge, tauxTxt(c.taux), c.etat ? LIB_ETAT[c.etat] : ""]; })),
        "changements-etablissement": csv(["AESH", "Semaine A", "Semaine B", "Moyenne par semaine"], r.changements.map(function (c) { return [c.libelle, c.A, c.B, c.moyenne]; })),
        "aesh-par-eleve": csv(["Nombre d'AESH", "Élèves"], r.aeshParEleve.repartition.map(function (x) { return [x.nb, x.eleves]; })),
        "etats-de-couverture": csv(["État", "Élèves"], [["couvert", r.etats.couvert], ["partiellement couvert", r.etats.partiel], ["sous-couvert", r.etats.sous], ["sur-couvert", r.etats.sur]])
      };
    }
    function evolutionCsv(ev) {
      return csv(["Version", "Heures notifiées", "Heures couvertes", "Heures non couvertes", "Taux de couverture (%)", "Élèves"],
        ev.map(function (e) { return [e.libelle, e.notifie, e.couvert, e.nonCouvert, tauxTxt(e.taux), e.nbEleves]; }));
    }

    return { options: options, calculer: calculer, evolution: evolution, tableauxCsv: tableauxCsv, evolutionCsv: evolutionCsv, csv: csv };
  }

  return { creer: creer, ORDRE_NIVEAUX: ORDRE_NIVEAUX };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialStatsAff;
