"use strict";

/* =====================================================================
   Statistiques des affectations (spec §7.4) — interface de l'onglet
   « Statistiques », section « Affectations ». Les calculs sont dans
   stats-affectations.js (pur, testé) ; ici : chargement des données de
   l'année et de la version choisies, filtres, graphiques SVG
   (graphiques.js, sans bibliothèque), tableaux, export CSV, impression.
   Chargé après app.js et affectations.js (toast et téléchargement : ceux de l'application).
   ===================================================================== */
var PialStatsUI = (function () {

  var S = (typeof PialStatsAff !== "undefined" && typeof PialModele !== "undefined") ? PialStatsAff.creer(PialModele) : null;
  var brut = null;        // {etablissements, eleves, aesh, cours, affectations, versions, reglages} (toutes années)
  var courant = null;     // dernier résultat affiché (pour l'export et l'impression)
  var ongletAff = false;

  function $(id) { return document.getElementById(id); }
  function ech(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function jour(iso) { return iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : ""; }
  function isoJour(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  // toast et téléchargement : ceux de l'application (passés à PialAffectations)
  function ui() { return PialAffectations.interne.ui(); }
  function toast(m) { ui().toast(m); }
  function telecharger(nom, contenu, type) { ui().telecharger(nom, contenu, type); }

  var LIB_ETAT = { couvert: "Couverts", partiel: "Partiellement couverts", sous: "Sous-couverts", sur: "Sur-couverts" };
  var LIB_CHARGE = { depassement: "Dépassement", complete: "Complète", sous: "Sous-utilisée" };

  function fr(x) { return String(x).replace(".", ","); }
  function pct(t) { return t == null ? "—" : fr(t) + " %"; }
  function pluriel(n, un, plusieurs) { return n + " " + (n > 1 ? (plusieurs || un + "s") : un); }
  function valeur(id) { var e = $(id); return e ? e.value : ""; }

  function charger() {
    return Promise.all(PialDB.MAGASINS_AFFECTATIONS.map(PialDB.tous)).then(function (r) {
      var p = {};
      PialDB.MAGASINS_AFFECTATIONS.forEach(function (nom, i) { p[nom] = r[i] || []; });
      var reg = (p.parametres || []).filter(function (x) { return x.cle === "reglages"; })[0];
      brut = { etablissements: p.etablissements, eleves: p.eleves, aesh: p.aesh, cours: p.cours, affectations: p.affectations,
        versions: p.versions || [], reglages: (reg && reg.valeur) || {} };
    });
  }

  function anneesDisponibles() {
    var a = {};
    brut.eleves.forEach(function (e) { if (e.annee) a[e.annee] = true; });
    brut.versions.forEach(function (v) { if (v.annee) a[v.annee] = true; });
    return Object.keys(a).sort();
  }
  function versionsDe(annee) {
    return brut.versions.filter(function (v) { return v.annee === annee; }).sort(function (p, q) { return p.numero - q.numero; });
  }
  // données d'une année et d'une version (« brouillon » ou un numéro)
  function donneesPour(annee, cle) {
    var num = cle === "brouillon" ? 0 : +cle;
    return { etablissements: brut.etablissements, aesh: brut.aesh, reglages: brut.reglages,
      eleves: brut.eleves.filter(function (e) { return e.annee === annee; }),
      cours: brut.cours.filter(function (c) { return c.annee === annee; }),
      affectations: brut.affectations.filter(function (a) { return a.version === num && (num > 0 || a.annee === annee); }) };
  }

  function remplir(id, valeurs, libelleTous, courantVal) {
    var sel = $(id);
    sel.innerHTML = '<option value="">' + ech(libelleTous) + '</option>' + valeurs.map(function (v) {
      return '<option value="' + ech(v.valeur) + '">' + ech(v.libelle) + '</option>';
    }).join("");
    if (courantVal && valeurs.some(function (v) { return v.valeur === courantVal; })) sel.value = courantVal;
  }
  function remplirFiltres(garder) {
    var annees = anneesDisponibles(), selAnnee = $("s2-annee"), ancienne = garder ? selAnnee.value : "";
    selAnnee.innerHTML = annees.map(function (a) { return '<option value="' + ech(a) + '">' + ech(a) + '</option>'; }).join("");
    var defaut = typeof PialAffectations !== "undefined" ? PialAffectations.anneeCourante() : "";
    selAnnee.value = annees.indexOf(ancienne) > -1 ? ancienne : (annees.indexOf(defaut) > -1 ? defaut : (annees[annees.length - 1] || ""));
    remplirVersions(garder);
    remplirFiltresDonnees(garder);
  }
  function remplirVersions(garder) {
    var annee = valeur("s2-annee"), sel = $("s2-version"), ancienne = garder ? sel.value : "";
    var html = '<option value="brouillon">Brouillon (en cours de travail)</option>';
    versionsDe(annee).slice().reverse().forEach(function (v) {
      html += '<option value="' + v.numero + '">Version n° ' + v.numero + (v.dateEffet ? " — effet " + ech(jour(v.dateEffet)) : "") + '</option>';
    });
    sel.innerHTML = html;
    if (ancienne && sel.querySelector('option[value="' + ancienne + '"]')) sel.value = ancienne;
  }
  function remplirFiltresDonnees(garder) {
    var d = donneesPour(valeur("s2-annee"), valeur("s2-version") || "brouillon"), o = S.options(d);
    var avant = { etab: valeur("s2-etab"), niveau: valeur("s2-niveau"), classe: valeur("s2-classe"), aesh: valeur("s2-aesh") };
    remplir("s2-etab", o.etablissements.map(function (e) { return { valeur: e.id, libelle: e.nom }; }), "Tous les établissements", garder && avant.etab);
    remplir("s2-niveau", o.niveaux.map(function (n) { return { valeur: n, libelle: n }; }), "Tous les niveaux", garder && avant.niveau);
    remplir("s2-classe", o.classes.map(function (c) { return { valeur: c, libelle: c }; }), "Toutes les classes", garder && avant.classe);
    remplir("s2-aesh", o.aesh.map(function (a) { return { valeur: a.id, libelle: a.nom }; }), "Toutes les AESH", garder && avant.aesh);
  }
  function filtres() {
    return { etab: valeur("s2-etab"), niveau: valeur("s2-niveau"), classe: valeur("s2-classe"), aeshId: valeur("s2-aesh"),
      modalite: valeur("s2-modalite"), semaine: valeur("s2-semaine") };
  }

  /* ---------- tableaux ---------- */
  function tableau(entetes, lignes, classes) {
    if (!lignes.length) return "";
    return '<div class="tableau-conteneur"><table class="tableau"><thead><tr>' + entetes.map(function (h) { return '<th>' + ech(h) + '</th>'; }).join("")
      + '</tr></thead><tbody>' + lignes.map(function (l) { return '<tr>' + l.map(function (c, i) { return '<td' + (i && classes !== false ? ' style="text-align:right"' : '') + '>' + c + '</td>'; }).join("") + '</tr>'; }).join("") + '</tbody></table></div>';
  }
  function tableauGroupes(liste, titreCol) {
    return tableau([titreCol, "Élèves", "Notifiées", "Couvertes", "Non couvertes", "Taux", "Individuel", "Mutualisé"],
      liste.map(function (g) {
        return [ech(g.libelle), g.nbEleves, fr(g.notifie) + " h", fr(g.couvert) + " h", fr(g.nonCouvert) + " h", pct(g.taux),
          g.indNotifie ? pct(g.indTaux) : "—", g.mutNotifie ? pct(g.mutTaux) : "—"];
      }));
  }
  function donneesTaux(liste) { return liste.filter(function (g) { return g.taux != null; }).map(function (g) { return { libelle: g.libelle, valeur: Math.round(g.taux) }; }); }

  /* ---------- rendu ---------- */
  var VIDE = "Aucune donnée pour cette sélection.";
  function rendre() {
    if (!brut || !S) return;
    var annee = valeur("s2-annee"), cle = valeur("s2-version") || "brouillon", f = filtres();
    var d = donneesPour(annee, cle), r = S.calculer(d, f);
    var evo = S.evolution(versionsDe(annee).map(function (v) { return { libelle: "Version " + v.numero, donnees: donneesPour(annee, String(v.numero)) }; })
      .concat([{ libelle: "Brouillon", donnees: donneesPour(annee, "brouillon") }]), f);
    courant = { r: r, evo: evo, annee: annee, cle: cle };

    var nbFiltres = Object.keys(f).filter(function (k) { return f[k]; }).length;
    var res = $("s2-resume");
    res.className = r.global.nbEleves ? "note" : "note alerte";
    res.textContent = "Année " + annee + " · " + (cle === "brouillon" ? "brouillon" : "version n° " + cle) + " · " + pluriel(r.global.nbEleves, "élève") + " dans la sélection"
      + (nbFiltres ? " (" + pluriel(nbFiltres, "filtre actif", "filtres actifs") + ")" : "")
      + (f.aeshId ? ". La couverture ne compte que les affectations de l'AESH choisie." : "")
      + (f.semaine ? ". Semaine " + f.semaine + " uniquement." : ". Heures moyennes des semaines A et B.");
    $("s2-vide").hidden = !!brut.eleves.length;

    function carte(valeurTxt, label) { return '<div class="carte-chiffre"><div class="cc-valeur">' + valeurTxt + '</div><div class="cc-label">' + label + '</div></div>'; }
    $("s2-cles").innerHTML = carte(pct(r.global.taux), "taux de couverture")
      + carte(fr(r.global.notifie) + " h", "heures notifiées") + carte(fr(r.global.couvert) + " h", "heures couvertes") + carte(fr(r.global.nonCouvert) + " h", "heures non couvertes")
      + carte(r.aeshParEleve.nbEleves ? fr(r.aeshParEleve.moyenne) : "—", "AESH par élève (en moyenne)")
      + carte(pct(r.prioritaires.part), "heures sur cours prioritaires");

    $("s2-etats").innerHTML = PialGraphiques.camembert(Object.keys(LIB_ETAT).map(function (k) { return { libelle: LIB_ETAT[k], valeur: r.etats[k] }; }), { texteVide: VIDE });
    $("s2-etab-graph").innerHTML = PialGraphiques.barresHorizontales(donneesTaux(r.parEtab), { texteVide: VIDE, largeur: 560 });
    $("s2-etab-tab").innerHTML = tableauGroupes(r.parEtab, "Établissement");
    $("s2-niveaux").innerHTML = PialGraphiques.barresVerticales(donneesTaux(r.parNiveau), { texteVide: VIDE, largeur: 560 });
    $("s2-niveaux-tab").innerHTML = tableauGroupes(r.parNiveau, "Niveau");
    $("s2-classes").innerHTML = PialGraphiques.barresHorizontales(donneesTaux(r.parClasse), { texteVide: VIDE, largeur: 560 });
    $("s2-classes-tab").innerHTML = tableauGroupes(r.parClasse, "Classe");

    $("s2-charge").innerHTML = PialGraphiques.barresHorizontales(r.charges.filter(function (c) { return c.charge > 0; }).map(function (c) { return { libelle: c.libelle, valeur: c.charge }; }), { texteVide: VIDE, largeur: 560 });
    $("s2-charge-note").textContent = r.chargeResume.evalue
      ? pluriel(r.chargeResume.nbAesh, "AESH", "AESH") + " · charge moyenne " + fr(r.chargeResume.moyenne) + " h · " + pluriel(r.chargeResume.sous, "AESH en sous-utilisation", "AESH en sous-utilisation")
        + " · " + pluriel(r.chargeResume.depassement, "dépassement") + ". Indicateur de charge, à ne pas interpréter comme une évaluation individuelle."
      : "Heures comprises dans la sélection : l'état de charge (sous-utilisation, dépassement) n'est donné que sans filtre d'établissement, de niveau, de classe ni de modalité.";
    $("s2-charge-tab").innerHTML = tableau(["AESH", "Quotité", "Charge", "Charge / quotité", "État"], r.charges.map(function (c) {
      return [ech(c.libelle), fr(c.quotite) + " h", fr(c.charge) + " h", pct(c.taux), c.etat ? LIB_CHARGE[c.etat] : "—"];
    }));
    $("s2-aesh-eleve").innerHTML = r.aeshParEleve.nbEleves
      ? '<p class="aide">En moyenne <strong>' + fr(r.aeshParEleve.moyenne) + '</strong> AESH par élève accompagné.</p>'
        + tableau(["Nombre d'AESH", "Élèves"], r.aeshParEleve.repartition.map(function (x) { return [x.nb, x.eleves]; }))
      : PialGraphiques.messageVide(VIDE);
    $("s2-changements").innerHTML = r.changements.length
      ? tableau(["AESH", "Semaine A", "Semaine B", "Moyenne par semaine"], r.changements.map(function (c) { return [ech(c.libelle), c.A, c.B, fr(c.moyenne)]; }))
      : PialGraphiques.messageVide("Aucun changement d'établissement dans une même journée.");
    $("s2-prio").textContent = r.prioritaires.total
      ? fr(r.prioritaires.heures) + " h sur " + fr(r.prioritaires.total) + " h d'accompagnement (" + pct(r.prioritaires.part) + ") recouvrent un cours marqué « prioritaire »."
      : "Aucune heure d'accompagnement dans la sélection.";
    $("s2-peri-carte").hidden = !r.periscolaire.active;
    $("s2-peri").textContent = r.periscolaire.active ? "Récréation : " + fr(r.periscolaire.recreation) + " h · Pause méridienne : " + fr(r.periscolaire.meridienne) + " h (durées réelles)." : "";
    $("s2-evolution").innerHTML = PialGraphiques.barresVerticales(courant.evo.filter(function (e) { return e.taux != null; }).map(function (e) { return { libelle: e.libelle, valeur: Math.round(e.taux) }; }), { texteVide: "Pas encore de version à comparer.", largeur: 560 });
    $("s2-evolution-tab").innerHTML = tableau(["Version", "Notifiées", "Couvertes", "Non couvertes", "Taux"], courant.evo.map(function (e) {
      return [ech(e.libelle), fr(e.notifie) + " h", fr(e.couvert) + " h", fr(e.nonCouvert) + " h", pct(e.taux)];
    }));
  }

  /* ---------- export CSV et impression ---------- */
  function exporter(nom) {
    if (!courant) return;
    var contenu = nom === "evolution" ? S.evolutionCsv(courant.evo) : S.tableauxCsv(courant.r)[nom];
    if (!contenu) return;
    telecharger("stats-affectations_" + nom + "_" + courant.annee + "_" + (courant.cle === "brouillon" ? "brouillon" : "v" + courant.cle) + ".csv", contenu, "text/csv");
  }
  function imprimer() {
    if (!courant) return;
    var blocs = [];
    Array.prototype.forEach.call(document.querySelectorAll("#s-bloc-aff [data-imp]"), function (carte) {
      var chk = carte.querySelector('input[type="checkbox"]');
      if (chk && !chk.checked) return;
      var titre = carte.querySelector("h2");
      var corps = Array.prototype.map.call(carte.children, function (el) { return el.classList.contains("entete-graphique") || el.classList.contains("actions") ? "" : el.outerHTML; }).join("");
      blocs.push('<div class="bloc-impression-stat"><h3>' + ech(titre ? titre.textContent : "") + '</h3>' + corps + '</div>');
    });
    if (!blocs.length) { toast("Cochez au moins un bloc à imprimer."); return; }
    var entete = '<div class="entete-impression-stats"><div class="ei-etab">Affectations des AESH</div><div class="ei-periode">Année ' + ech(courant.annee) + ' · '
      + (courant.cle === "brouillon" ? "brouillon" : "version n° " + ech(courant.cle)) + ' · ' + ech($("s2-resume").textContent) + '</div><div class="ei-date">Édité le ' + jour(isoJour(new Date())) + '</div></div>';
    $("impression").innerHTML = '<div class="impression-stats">' + entete + blocs.join("") + '</div>';
    window.print();
  }

  /* ---------- onglets Rapports / Affectations ---------- */
  function montrer(aff) {
    ongletAff = aff;
    $("s-bloc-rapports").hidden = aff;
    $("s-bloc-aff").hidden = !aff;
    $("s-onglet-rapports").className = "btn " + (aff ? "btn-vide" : "btn-plein");
    $("s-onglet-aff").className = "btn " + (aff ? "btn-plein" : "btn-vide");
    $("s-onglet-rapports").setAttribute("aria-pressed", aff ? "false" : "true");
    $("s-onglet-aff").setAttribute("aria-pressed", aff ? "true" : "false");
    if (aff) actualiser(true);
  }
  function actualiser(garder) {
    if (!S) return Promise.resolve();
    return charger().then(function () { remplirFiltres(garder); rendre(); }).catch(function () { toast("Impossible de lire les affectations."); });
  }

  function initialiser() {
    if (!$("s-onglet-aff")) return;
    if (!S) { $("s-onglet-aff").hidden = true; return; }
    $("s-onglet-rapports").addEventListener("click", function () { montrer(false); });
    $("s-onglet-aff").addEventListener("click", function () { montrer(true); });
    $("s2-annee").addEventListener("change", function () { remplirVersions(false); remplirFiltresDonnees(false); rendre(); });
    $("s2-version").addEventListener("change", function () { remplirFiltresDonnees(true); rendre(); });
    ["s2-etab", "s2-niveau", "s2-classe", "s2-aesh", "s2-modalite", "s2-semaine"].forEach(function (id) { $(id).addEventListener("change", rendre); });
    $("s2-reinitialiser").addEventListener("click", function () {
      ["s2-etab", "s2-niveau", "s2-classe", "s2-aesh", "s2-modalite", "s2-semaine"].forEach(function (id) { $(id).value = ""; });
      rendre();
    });
    $("s2-imprimer").addEventListener("click", imprimer);
    Array.prototype.forEach.call(document.querySelectorAll("#s-bloc-aff [data-csv]"), function (b) {
      b.addEventListener("click", function () { exporter(this.getAttribute("data-csv")); });
    });
  }

  // appelé à l'ouverture de l'onglet Statistiques : la section visible est mise à jour
  function afficher() { if (ongletAff) actualiser(true); }

  return { initialiser: initialiser, afficher: afficher, montrer: montrer };
})();

PialStatsUI.initialiser();
