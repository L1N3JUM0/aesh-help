"use strict";

/* =====================================================================
   PialRepartitionUI — onglet « Répartition » (spec §19) et déclaration
   des dispositifs ULIS dans Réglages. Les calculs sont dans
   pial/repartition.js (fonctions pures) ; la répartition est enregistrée
   dans `parametres` (clé « repartition ») et passe par la pile
   d'annulation commune (PialAffectations.interne.enregistrerPuisRendre).
   ===================================================================== */
var PialRepartitionUI = (function () {

  var A = PialAffectations.interne, R = A.R, M = PialModele;
  var etat = A.etat, ech = A.ech, heures = A.heures, pluriel = A.pluriel;

  function $(id) { return document.getElementById(id); }
  function nombre(x) { return String(Math.round(x * 100) / 100).replace(".", ","); }
  function visible() { var v = $("vue-repartition"); return !!v && !v.classList.contains("masque"); }
  var LIB_ETAT = { sous: "manque", partiel: "presque couvert", couvert: "couvert", sur: "en trop" };
  var JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

  /* =============== écriture =============== */
  function ecrire(rep, message, libelle, opsEnPlus) {
    rep.annee = A.anneeCourante();
    return A.enregistrerPuisRendre([{ magasin: "parametres", enregistrer: [{ cle: "repartition", valeur: rep }] }].concat(opsEnPlus || []), message, libelle);
  }
  function aeshParId(id) { return etat.aesh.filter(function (a) { return a.id === id; })[0]; }
  function uniteParId(tab, id) { return tab.unites.filter(function (u) { return u.id === id; })[0]; }
  function nomUnite(u) { return (u.type === "ulis" ? "ULIS « " + u.nom + " »" : u.nom) + (u.type === "ulis" ? " (" + A.nomEtablissement(u.etab) + ")" : ""); }

  /* =============== rendu =============== */
  var tab = null;
  function rendre() {
    if (!visible()) return;
    tab = R.tableau(A.donneesRepartition(), etat.repartition);
    rendreSynthese();
    rendreReservoir();
    rendreColonnes();
  }

  function rendreSynthese() {
    var t = tab.totaux, rep = etat.repartition;
    var actif = M.contexte({ reglages: etat.reglages }).reglages.respecterRepartition;
    var blocs = [
      '<span class="bs-chiffre">Besoin : <strong>' + heures(t.besoin) + '</strong></span>',
      '<span class="bs-chiffre">Heures allouées : <strong>' + heures(t.alloue) + '</strong> sur ' + heures(t.quotites) + ' de quotités</span>',
      '<span class="bs-chiffre' + (t.nonReparties > 0 ? " rep-alerte" : "") + '" id="rep-non-reparties"><strong class="' + (t.nonReparties > 0 ? "bs-manque" : "bs-marge") + '">'
        + heures(t.nonReparties) + '</strong> non réparties' + (t.aeshAvecReste ? ' (' + pluriel(t.aeshAvecReste, "AESH", "AESH") + ')' : "") + '</span>'
    ];
    if (t.aeshEnDepassement) blocs.push('<span class="bs-chiffre"><strong class="bs-manque">' + pluriel(t.aeshEnDepassement, "AESH", "AESH") + '</strong> au-dessus de la quotité</span>');
    $("rep-synthese").innerHTML = blocs.join('<span class="bs-sep" aria-hidden="true"> · </span>') + A.sep(" · ")
      + '<span class="bs-actions"><button type="button" class="btn btn-vide" id="rep-annuler"' + (A.libelleAnnulation() ? ' title="Annuler : ' + ech(A.libelleAnnulation()) + ' (Ctrl+Z)"' : " disabled") + '>↶ Annuler</button></span>';
    $("rep-annuler").addEventListener("click", A.annuler);
    var notes = [];
    if (R.estVide(rep)) notes.push("Aucune répartition : le moteur et les saisies ne sont pas contraints par établissement. Déposez les AESH dans les colonnes, ou utilisez « Répartir… » sur leur carte.");
    else {
      if (!actif) notes.push("« Respecter la répartition » est décoché dans Réglages : la répartition est enregistrée, mais ne contraint ni le moteur ni les saisies.");
      else notes.push("Une AESH qui a au moins une ligne ne travaille qu'aux endroits et dans la limite d'heures indiqués : ses heures non réparties ne sont pas utilisables. Une AESH sans aucune ligne n'est pas contrainte.");
    }
    if (t.orphelines) notes.push(pluriel(t.orphelines, "ligne de la répartition ne correspond", "lignes de la répartition ne correspondent") + " plus à une AESH ou à une unité existante : elles sont ignorées.");
    if (tab.unites.some(function (u) { return u.type === "etab" && !u.estimation && u.mutBrut > 0; })) {
      notes.push("Sans emploi du temps pour tous les élèves notifiés en mutualisé, l'état d'un établissement se calcule sur le besoin mutualisé brut (colonnes marquées « brut »).");
    }
    $("rep-notes").innerHTML = notes.map(function (n) { return "<p>" + ech(n) + "</p>"; }).join("");
  }

  function pilule(a) {
    return '<span class="puce-aesh" style="background:' + A.couleurAesh(a.id) + '" aria-hidden="true">' + ech(A.initialesAesh(a)) + '</span>';
  }

  function rendreReservoir() {
    var liste = A.aeshTriees();
    if (!liste.length) { $("rep-reservoir").innerHTML = '<p class="vide">Aucune AESH : importez ou créez des AESH.</p>'; return; }
    $("rep-reservoir").innerHTML = liste.map(function (a) {
      var ligne = tab.aesh.filter(function (x) { return x.id === a.id; })[0];
      var parts = Object.keys(ligne.lignes).map(function (u) {
        var unite = uniteParId(tab, u);
        var hors = unite && unite.type === "etab" && (a.etablissements || []).length && a.etablissements.indexOf(unite.etab) < 0;
        return '<li>' + ech(unite ? nomUnite(unite) : "(unité supprimée)") + ' : ' + heures(ligne.lignes[u])
          + (hors ? ' <span class="rep-hors" title="Hors de ses établissements possibles (fiche AESH) : le moteur ne lui affectera rien ici tant que « Respecter les indisponibilités et les établissements possibles » est coché.">⚠ hors établissements possibles</span>' : "") + '</li>';
      }).join("");
      var classe = ligne.reste < 0 ? " depasse" : (ligne.reste > 0 ? " reste" : " complete");
      return '<div class="rep-carte' + classe + '" data-rep-aesh="' + ech(a.id) + '">'
        + '<span class="rep-poignee" data-rep-poignee title="Glisser vers une colonne" aria-hidden="true">⠿</span>' + pilule(a)
        + '<div class="rep-carte-corps"><strong>' + ech(A.nomAesh(a)) + '</strong>'
        + '<div class="rep-carte-chiffres">Quotité ' + heures(ligne.quotite) + ' · répartis ' + heures(ligne.alloue) + ' · <span class="rep-reste">'
        + (ligne.reste < 0 ? "dépassement " + heures(-ligne.reste) : "non réparties " + heures(ligne.reste)) + '</span></div>'
        + (parts ? '<ul class="rep-carte-lignes">' + parts + '</ul>' : "")
        + '</div><button type="button" class="btn btn-vide" data-rep-repartir="' + ech(a.id) + '">Répartir…</button></div>';
    }).join("");
    Array.prototype.forEach.call($("rep-reservoir").querySelectorAll("[data-rep-repartir]"), function (b) {
      b.addEventListener("click", function () { ouvrirSaisie(this.dataset.repRepartir, null); });
    });
  }

  function ligneBesoin(libelle, valeur, titre) {
    return '<tr' + (titre ? ' title="' + ech(titre) + '"' : "") + '><th scope="row">' + libelle + '</th><td>' + valeur + '</td></tr>';
  }
  function rendreColonnes() {
    if (!tab.unites.length) { $("rep-colonnes").innerHTML = '<p class="vide">Aucun établissement : importez des élèves, ou déclarez un dispositif dans Réglages.</p>'; return; }
    $("rep-colonnes").innerHTML = tab.unites.map(function (u) {
      var lignes;
      if (u.type === "ulis") {
        lignes = ligneBesoin("Ouverture du dispositif", heures(u.ouverture), "Heures d'ouverture par semaine (jours × plages), réglées dans Réglages → Dispositifs.")
          + ligneBesoin("Élèves de l'ULIS", String(u.nbEleves), "Élèves rattachés à ce dispositif (fiche élève). Leurs notifications, pour leurs inclusions, comptent dans la colonne de leur établissement.");
      } else {
        lignes = ligneBesoin("Individuel", heures(u.ind), "Somme des heures notifiées en individuel.")
          + ligneBesoin("Mutualisé brut", heures(u.mutBrut), "Somme des heures notifiées en mutualisé.")
          + ligneBesoin("Mutualisé estimé", u.mutBrut > 0 ? (u.estimation ? heures(u.mutEstime) : '<span class="rep-brut">brut</span>') : heures(0),
            u.estimation ? "Après regroupement des élèves d'une même classe sur les mêmes cours. Entre " + heures(u.mutMin) + " (tous ensemble) et " + heures(u.mutBrut) + " (jamais ensemble)."
              : "Estimation impossible : au moins un élève notifié en mutualisé n'a pas d'emploi du temps.")
          + (etat.reglages.gererPeriscolaire ? ligneBesoin("Périscolaire", heures(u.peri), "Récréations et pauses méridiennes, comptées une fois pour tout l'établissement.") : "");
      }
      var chips = u.aesh.map(function (x) {
        var a = aeshParId(x.aeshId);
        if (!a) return "";
        return '<div class="rep-chip" data-rep-chip="' + ech(a.id) + '" tabindex="0" title="Modifier les heures">' + pilule(a) + '<span>' + ech(A.nomAesh(a)) + '</span><strong>' + heures(x.heures) + '</strong>'
          + '<button type="button" class="rep-retirer" data-rep-retirer="' + ech(a.id) + '" aria-label="Retirer ' + ech(A.nomAesh(a)) + ' de cette colonne">×</button></div>';
      }).join("");
      return '<section class="rep-colonne" data-rep-unite="' + ech(u.id) + '" aria-label="' + ech(nomUnite(u)) + '">'
        + '<header><h3>' + ech(u.nom) + '</h3><span class="rep-type">' + (u.type === "ulis" ? "ULIS · " + ech(A.nomEtablissement(u.etab)) : "établissement") + '</span></header>'
        + '<table class="rep-besoins"><tbody>' + lignes + ligneBesoin("<strong>Besoin retenu</strong>", "<strong>" + heures(u.besoin) + "</strong>" + (u.type === "etab" && !u.estimation && u.mutBrut > 0 ? " (brut)" : ""))
        + '</tbody></table>'
        + '<div class="rep-bilan e-bord-' + u.etat + '"><span><strong>' + heures(u.alloue) + '</strong> allouées</span><span class="rep-ecart">'
        + (u.ecart > 0 ? "+" : (u.ecart < 0 ? "−" : "")) + nombre(Math.abs(u.ecart)) + ' h · ' + LIB_ETAT[u.etat] + '</span></div>'
        + '<div class="rep-depot" data-rep-depot>' + (chips || '<p class="vide">Déposez une AESH ici.</p>') + '</div></section>';
    }).join("");
    Array.prototype.forEach.call($("rep-colonnes").querySelectorAll("[data-rep-chip]"), function (c) {
      var unite = c.closest("[data-rep-unite]").dataset.repUnite;
      c.addEventListener("click", function (ev) { if (!ev.target.closest("[data-rep-retirer]")) ouvrirSaisie(this.dataset.repChip, unite); });
      c.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target === this) ouvrirSaisie(this.dataset.repChip, unite); });
    });
    Array.prototype.forEach.call($("rep-colonnes").querySelectorAll("[data-rep-retirer]"), function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var unite = this.closest("[data-rep-unite]").dataset.repUnite, a = aeshParId(this.dataset.repRetirer), u = uniteParId(tab, unite);
        ecrire(R.fixer(etat.repartition, a.id, unite, 0), A.nomAesh(a) + " retirée de « " + u.nom + " ».", "le retrait de " + A.nomAesh(a) + " de « " + u.nom + " »");
      });
    });
  }

  /* =============== saisie des heures (modale) =============== */
  var saisie = null;   // {aeshId, valeurs: {uniteId: texte}}
  function ouvrirSaisie(aeshId, uniteCible) {
    var a = aeshParId(aeshId);
    if (!a) return;
    var l = R.lignes(etat.repartition, aeshId), valeurs = {};
    tab.unites.forEach(function (u) { valeurs[u.id] = l[u.id] ? nombre(l[u.id]) : ""; });
    // dépôt dans une colonne : on propose les heures non réparties (ou le plus possible)
    if (uniteCible && !l[uniteCible]) {
      var reste = R.reste(etat.repartition, a);
      valeurs[uniteCible] = reste > 0 ? nombre(reste) : "";
    }
    saisie = { aeshId: aeshId, valeurs: valeurs };
    $("rep-modale-titre").textContent = "Répartir " + A.nomAesh(a);
    $("rep-modale-lignes").innerHTML = tab.unites.map(function (u) {
      return '<div class="rep-ligne-saisie"><label for="rep-h-' + ech(u.id) + '">' + ech(nomUnite(u)) + '</label>'
        + '<input type="text" inputmode="decimal" id="rep-h-' + ech(u.id) + '" data-rep-h="' + ech(u.id) + '" value="' + ech(valeurs[u.id]) + '" placeholder="0"><span>h</span></div>';
    }).join("");
    Array.prototype.forEach.call($("rep-modale-lignes").querySelectorAll("[data-rep-h]"), function (i) {
      i.addEventListener("input", majSaisie);
      i.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); validerSaisie(); } });
    });
    $("voile-repartition").hidden = false;
    majSaisie();
    var cible = $("rep-h-" + (uniteCible || (tab.unites[0] && tab.unites[0].id)));
    if (cible) { cible.focus(); cible.select(); }
  }
  function lireSaisie() {
    var out = {}, erreur = "", total = 0;
    Array.prototype.forEach.call($("rep-modale-lignes").querySelectorAll("[data-rep-h]"), function (i) {
      var t = i.value.trim();
      if (!t) return;
      var h = R.normaliserHeures(t);
      if (isNaN(h)) { erreur = "« " + t + " » n'est pas un nombre d'heures valide."; return; }
      out[i.dataset.repH] = h; total += h;
    });
    return { valeurs: out, total: total, erreur: erreur };
  }
  function majSaisie() {
    var a = aeshParId(saisie.aeshId), s = lireSaisie(), reste = (a.quotite || 0) - s.total;
    var msg = s.erreur || (reste < -1e-9 ? "Total de " + heures(s.total) + " : dépasse la quotité de " + heures(a.quotite || 0) + "." : "");
    $("rep-modale-total").innerHTML = "Total réparti : <strong>" + heures(s.total) + "</strong> sur " + heures(a.quotite || 0)
      + " · non réparties : <strong>" + heures(Math.max(0, reste)) + "</strong>";
    $("rep-modale-erreur").textContent = msg;
    $("rep-modale-erreur").hidden = !msg;
    $("rep-modale-valider").disabled = !!msg;
  }
  function fermerSaisie() { $("voile-repartition").hidden = true; saisie = null; }
  function validerSaisie() {
    if (!saisie) return;
    var a = aeshParId(saisie.aeshId), s = lireSaisie();
    if (s.erreur || s.total > (a.quotite || 0) + 1e-9) { majSaisie(); return; }
    var rep = etat.repartition;
    // lignes d'unités qui n'existent plus : conservées telles quelles
    var inconnues = Object.keys(R.lignes(rep, a.id)).filter(function (u) { return !uniteParId(tab, u); });
    inconnues.forEach(function (u) { s.valeurs[u] = R.lignes(rep, a.id)[u]; });
    var neuve = R.vide(rep.annee);
    neuve.parAesh = JSON.parse(JSON.stringify(rep.parAesh || {}));
    delete neuve.parAesh[a.id];
    Object.keys(s.valeurs).forEach(function (u) { neuve = R.fixer(neuve, a.id, u, s.valeurs[u]); });
    // la répartition prime : les établissements où elle a des heures deviennent possibles (même action, même annulation)
    var plus = R.fichePourRepartition(a, s.valeurs), message = "Répartition de " + A.nomAesh(a) + " enregistrée.", ops = [];
    if (plus.fiche) {
      ops.push({ magasin: "aesh", enregistrer: [plus.fiche] });
      var noms = plus.ajoutes.map(A.nomEtablissement);
      message = (noms.length > 1 ? noms.slice(0, -1).join(", ") + " et " + noms[noms.length - 1] + " ajoutés" : noms[0] + " ajouté")
        + " aux établissements possibles de " + A.txt(a.prenom) + " " + A.txt(a.nom).charAt(0) + ".";
    }
    fermerSaisie();
    ecrire(neuve, message, "la répartition de " + A.nomAesh(a), ops);
  }
  $("rep-modale-valider").addEventListener("click", validerSaisie);
  $("rep-modale-annuler").addEventListener("click", fermerSaisie);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && saisie) fermerSaisie(); });

  /* =============== glisser-déposer (Pointer Events) =============== */
  // la carte d'une AESH (par sa poignée) se dépose sur une colonne : la saisie des heures s'ouvre
  var SEUIL = 6, glisse = null;
  function colonneSous(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("[data-rep-unite]") : null;
  }
  function surbrillance(col) {
    Array.prototype.forEach.call(document.querySelectorAll(".rep-colonne.depot"), function (c) { if (c !== col) c.classList.remove("depot"); });
    if (col) col.classList.add("depot");
  }
  document.addEventListener("pointerdown", function (ev) {
    if (glisse || ev.button > 0 || !ev.target.closest) return;
    var poignee = ev.target.closest("[data-rep-poignee]"), carte = poignee && poignee.closest("[data-rep-aesh]");
    if (!carte) return;
    glisse = { aeshId: carte.dataset.repAesh, x0: ev.clientX, y0: ev.clientY, actif: false, fantome: null, id: ev.pointerId };
    ev.preventDefault();
  });
  document.addEventListener("pointermove", function (ev) {
    if (!glisse) return;
    if (!glisse.actif) {
      if (Math.abs(ev.clientX - glisse.x0) + Math.abs(ev.clientY - glisse.y0) < SEUIL) return;
      glisse.actif = true;
      var a = aeshParId(glisse.aeshId);
      glisse.fantome = document.createElement("div");
      glisse.fantome.className = "fantome-glisser";
      glisse.fantome.innerHTML = pilule(a) + " " + ech(A.nomAesh(a));
      document.body.appendChild(glisse.fantome);
      document.body.classList.add("glisser-en-cours");
    }
    ev.preventDefault();
    glisse.fantome.style.left = (ev.clientX + 12) + "px";
    glisse.fantome.style.top = (ev.clientY + 12) + "px";
    surbrillance(colonneSous(ev.clientX, ev.clientY));
  }, { passive: false });
  function fin(ev, annule) {
    if (!glisse) return;
    var g = glisse, col = g.actif && !annule && ev.clientX !== undefined ? colonneSous(ev.clientX, ev.clientY) : null;
    glisse = null;
    if (g.fantome && g.fantome.parentNode) g.fantome.parentNode.removeChild(g.fantome);
    document.body.classList.remove("glisser-en-cours");
    surbrillance(null);
    if (col) ouvrirSaisie(g.aeshId, col.dataset.repUnite);
  }
  document.addEventListener("pointerup", function (ev) { fin(ev, false); });
  document.addEventListener("pointercancel", function (ev) { fin(ev, true); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && glisse) fin({}, true); });

  /* =============== Réglages : dispositifs ULIS =============== */
  function ecrireDispositifs(liste, operationsEnPlus) {
    var ops = [{ magasin: "parametres", enregistrer: [{ cle: "dispositifs", valeur: liste }] }].concat(operationsEnPlus || []);
    return PialDB.appliquer(ops).then(PialAffectations.recharger).then(function () {
      rendreReglages();
      if (typeof PialAffectations.surChangement === "function") PialAffectations.surChangement();
    });
  }
  function rendreReglages() {
    var hote = $("reg-dispositifs");
    if (!hote) return;
    $("reg-dispositif-ajouter").disabled = !etat.etablissements.length;
    if (!etat.dispositifs.length) { hote.innerHTML = '<p class="vide">Aucun dispositif déclaré.</p>'; return; }
    hote.innerHTML = etat.dispositifs.map(function (d, k) {
      var p = "di" + k + "-";
      function plage(nom, v) {
        return '<div class="champ"><label>' + nom + '</label><div class="duo"><input type="text" id="' + p + nom[0] + 'd" value="' + ech(v && v.debut) + '" placeholder="hh:mm" inputmode="numeric">–'
          + '<input type="text" id="' + p + nom[0] + 'f" value="' + ech(v && v.fin) + '" placeholder="hh:mm" inputmode="numeric"></div></div>';
      }
      return '<div class="etab-param" data-dispositif="' + ech(d.id) + '" data-prefixe="' + p + '"><h3>ULIS « ' + ech(d.nom) + ' » · ' + heures(R.heuresOuverture(d)) + ' d\'ouverture par semaine</h3><div class="grille">'
        + '<div class="champ"><label for="' + p + 'nom">Nom</label><input type="text" id="' + p + 'nom" value="' + ech(d.nom) + '" maxlength="60"></div>'
        + '<div class="champ"><label for="' + p + 'etab">Établissement</label><select id="' + p + 'etab">'
        + etat.etablissements.map(function (e) { return '<option value="' + ech(e.id) + '"' + (e.id === d.etab ? " selected" : "") + '>' + ech(e.nom) + '</option>'; }).join("") + '</select></div>'
        + plage("Matin", d.matin) + plage("Après-midi", d.apresmidi)
        + '</div><div class="jours-ouvres">Jours d\'ouverture : '
        + JOURS.map(function (j) { return '<label class="case"><input type="checkbox" data-jour="' + j + '"' + ((d.jours || []).indexOf(j) > -1 ? " checked" : "") + '> ' + j + '</label>'; }).join("")
        + '</div><div class="actions"><button type="button" class="btn btn-vide" data-dispositif-enregistrer>Enregistrer</button>'
        + '<button type="button" class="btn btn-vide" data-dispositif-supprimer>Supprimer</button></div></div>';
    }).join("");
    Array.prototype.forEach.call(hote.querySelectorAll("[data-dispositif-enregistrer]"), function (b) {
      b.addEventListener("click", function () { enregistrerDispositif(this.closest("[data-dispositif]")); });
    });
    Array.prototype.forEach.call(hote.querySelectorAll("[data-dispositif-supprimer]"), function (b) {
      b.addEventListener("click", function () { supprimerDispositif(this.closest("[data-dispositif]").dataset.dispositif); });
    });
  }
  function enregistrerDispositif(bloc) {
    var p = bloc.dataset.prefixe, d = JSON.parse(JSON.stringify(etat.dispositifs.filter(function (x) { return x.id === bloc.dataset.dispositif; })[0]));
    function h(id) { var v = $(p + id).value.trim(); return v ? M.heureNormalisee(v) : ""; }
    function plage(c) {
      var a = h(c + "d"), b = h(c + "f");
      return a || b ? { debut: a, fin: b } : null;
    }
    d.nom = $(p + "nom").value.trim();
    d.etab = $(p + "etab").value;
    d.matin = plage("M");
    d.apresmidi = plage("A");
    d.jours = Array.prototype.filter.call(bloc.querySelectorAll("[data-jour]"), function (c) { return c.checked; }).map(function (c) { return c.dataset.jour; });
    var err = R.erreurDispositif(d);
    if (err) { A.ui().toast(err); return; }
    ecrireDispositifs(etat.dispositifs.map(function (x) { return x.id === d.id ? d : x; })).then(function () { A.ui().toast("Dispositif « " + d.nom + " » enregistré."); });
  }
  function supprimerDispositif(id) {
    var d = etat.dispositifs.filter(function (x) { return x.id === id; })[0], unite = R.idUnite(d);
    var concernees = Object.keys(etat.repartition.parAesh || {}).filter(function (a) { return etat.repartition.parAesh[a][unite]; });
    A.ui().confirmationForte("Supprimer le dispositif « " + d.nom + " » ?" + (concernees.length ? " Les heures qui lui sont allouées (" + pluriel(concernees.length, "AESH") + ") seront retirées de la répartition." : ""), "Supprimer", function () {
      var rep = etat.repartition;
      concernees.forEach(function (a) { rep = R.fixer(rep, a, unite, 0); });
      var ops = concernees.length ? [{ magasin: "parametres", enregistrer: [{ cle: "repartition", valeur: rep }] }] : [];
      ecrireDispositifs(etat.dispositifs.filter(function (x) { return x.id !== id; }), ops);
    });
  }
  $("reg-dispositif-ajouter").addEventListener("click", function () {
    if (!etat.etablissements.length) return;
    var college = etat.etablissements.filter(function (e) { return e.type === "college"; })[0] || etat.etablissements[0];
    var d = R.nouveauDispositif("di-" + Date.now().toString(36), "ULIS", college.id);
    ecrireDispositifs(etat.dispositifs.concat([d]));
  });

  /* =============== ouverture ; redessin après chaque écriture =============== */
  function ouvrir() { rendre(); }
  A.surRendu(function () {
    rendre();
    if (!$("vue-reglages").classList.contains("masque")) rendreReglages();
  });

  return { ouvrir: ouvrir, rendreReglages: rendreReglages };
})();
