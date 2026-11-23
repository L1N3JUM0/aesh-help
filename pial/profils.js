"use strict";

/* =====================================================================
   PialProfils — onglets « Élèves » et « AESH » de l'espace PIAL
   (docs/SPEC-affectations-PIAL.md §7.5, §17).

   Liste (recherche, filtres, tri, jauges), fiche dans un panneau (même
   composant que la grille d'Affectations : enregistrement automatique,
   annulation), création. Passe par PialAffectations.interne : mêmes
   données, même pile d'annulation, mêmes règles de contrôle que l'import
   (PialImport.validerLigne).
   ===================================================================== */
var PialProfils = (function () {

  var A = PialAffectations.interne, M = PialModele, I = PialImport;
  var etat = A.etat, ech = A.ech, heures = A.heures, pluriel = A.pluriel;
  function $(id) { return document.getElementById(id); }
  function chaque(racine, sel, fn) { Array.prototype.forEach.call(racine.querySelectorAll(sel), fn); }
  function dateFr(iso) { return iso ? iso.slice(0, 10).split("-").reverse().join("/") : ""; }
  function joursAvant(iso) { return iso ? Math.round((new Date(iso + "T12:00:00") - new Date(A.aujourdhui() + "T12:00:00")) / 86400000) : null; }
  function remplirSelect(sel, valeurs, libelleTous) {
    var val = sel.value;
    sel.innerHTML = (libelleTous ? '<option value="">' + ech(libelleTous) + '</option>' : "") + valeurs.map(function (v) {
      return '<option value="' + ech(v.valeur) + '">' + ech(v.libelle) + '</option>';
    }).join("");
    if (valeurs.some(function (v) { return v.valeur === val; })) sel.value = val;
  }
  function etablissementsTries() {
    return etat.etablissements.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
  }
  function referentiel() { return M.referentielClasses(M.classesEnregistrees(etat.classes, A.anneeCourante()), etat.elevesTous, etat.coursTous); }
  // bouton « ↶ Annuler » de l'onglet : même pile que l'onglet Affectations
  function majAnnuler(id) {
    var b = $(id), lib = A.libelleAnnulation();
    b.disabled = !lib;
    b.title = lib ? "Annuler : " + lib + " (Ctrl+Z)" : "Rien à annuler";
  }
  function teteTriable(col, tri) {
    var actif = tri.cle === col.cle;
    return '<th' + (col.classe ? ' class="' + col.classe + '"' : "") + ' aria-sort="' + (actif ? (tri.sens > 0 ? "ascending" : "descending") : "none") + '">'
      + '<button type="button" class="tri" data-tri="' + col.cle + '">' + col.lib + (actif ? (tri.sens > 0 ? " ▲" : " ▼") : "") + '</button></th>';
  }
  // flèches haut / bas entre les lignes, Entrée ou Espace pour ouvrir
  function brancherLignes(corps, attr, ouvrir, basculer) {
    chaque(corps, "tr[" + attr + "]", function (tr) {
      tr.addEventListener("click", function () { ouvrir(tr.getAttribute(attr)); });
      tr.addEventListener("keydown", function (ev) {
        if (ev.target !== tr) return;
        if (ev.key === "Enter" || (ev.key === " " && !basculer)) { ev.preventDefault(); ouvrir(tr.getAttribute(attr)); }
        else if (ev.key === " ") { ev.preventDefault(); basculer(tr.getAttribute(attr)); }
        else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
          ev.preventDefault();
          var autre = ev.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling;
          if (autre && autre.hasAttribute(attr)) autre.focus();
        }
      });
    });
  }

  /* =============== onglet Élèves =============== */
  var pe = { tri: { cle: "classe", sens: 1 }, ouvert: null };
  var LIB_MODALITE = { ind: "Individuel", mut: "Mutualisé", deux: "Individuel et mutualisé" };
  function proportion(cv) {
    if (!cv) return 2; // archivé : après les élèves actifs
    var d = cv.ind.notifie + cv.mut.notifie;
    return d ? (Math.min(cv.ind.moy, cv.ind.notifie) + Math.min(cv.mut.moy, cv.mut.notifie)) / d : 1;
  }
  var COLONNES_ELEVES = [
    { cle: "nom", lib: "Élève", cmp: function (a, b) { return a.e.nomCourt.localeCompare(b.e.nomCourt, "fr"); } },
    { cle: "classe", lib: "Classe", cmp: function (a, b) { return M.comparerClasses(a.e.classe, b.e.classe); } },
    { cle: "etab", lib: "Établissement", classe: "col-secondaire", cmp: function (a, b) { return A.nomEtablissement(a.e.etablissement).localeCompare(A.nomEtablissement(b.e.etablissement), "fr"); } },
    { cle: "notif", lib: "Notification", classe: "col-secondaire", cmp: function (a, b) { return ((a.e.heuresInd || 0) + (a.e.heuresMut || 0)) - ((b.e.heuresInd || 0) + (b.e.heuresMut || 0)); } },
    { cle: "couv", lib: "Couverture", cmp: function (a, b) { return proportion(a.cv) - proportion(b.cv); } },
    { cle: "fin", lib: "Fin de notification", classe: "col-secondaire", cmp: function (a, b) { return (a.e.finNotif || "9999").localeCompare(b.e.finNotif || "9999"); } }
  ];
  function filtresEleves() {
    var ctx = A.contexte(), etab = $("pe-etab").value, classe = $("pe-classe").value, niveau = $("pe-niveau").value, dispositif = $("pe-dispositif").value,
      modalite = $("pe-modalite").value, couv = $("pe-couverture").value, mots = M.normaliser($("pe-recherche").value).split(" ").filter(Boolean);
    var lignes = etat.elevesTous.filter(function (e) { return $("pe-archives").checked || !M.estArchive(e); })
      .map(function (e) { return { e: e, cv: M.estArchive(e) ? null : M.couvertureEleve(e, ctx) }; }).filter(function (l) {
      var e = l.e;
      if (couv && !l.cv) return false;
      if (etab && e.etablissement !== etab) return false;
      if (classe && M.normaliser(e.classe) !== M.normaliser(classe)) return false;
      if (niveau && M.niveauClasse(e.classe) !== niveau) return false;
      if (dispositif === "aucun" ? M.estEnDispositif(e) : (dispositif === "ulis" ? !M.estEnDispositif(e) : (dispositif && !(e.dispositif && e.dispositif.id === dispositif)))) return false;
      if (modalite === "ind" && !(e.heuresInd > 0)) return false;
      if (modalite === "mut" && !(e.heuresMut > 0)) return false;
      if (modalite === "deux" && !(e.heuresInd > 0 && e.heuresMut > 0)) return false;
      if (couv && l.cv.etat !== couv) return false;
      if (mots.length) {
        var texte = M.normaliser([e.nomCourt, e.classe, A.nomEtablissement(e.etablissement)].join(" "));
        if (!mots.every(function (m) { return texte.indexOf(m) > -1; })) return false;
      }
      return true;
    });
    var col = COLONNES_ELEVES.filter(function (c) { return c.cle === pe.tri.cle; })[0] || COLONNES_ELEVES[1];
    var base = [COLONNES_ELEVES[2], COLONNES_ELEVES[1], COLONNES_ELEVES[0]];
    lignes.sort(function (a, b) {
      return (pe.tri.sens * col.cmp(a, b)) || base.reduce(function (r, c) { return r || c.cmp(a, b); }, 0);
    });
    return lignes;
  }
  function remplirFiltresEleves() {
    remplirSelect($("pe-etab"), etablissementsTries().map(function (e) { return { valeur: e.id, libelle: e.nom }; }), "Tous");
    var etab = $("pe-etab").value, ref = referentiel(), classes = [], niveaux = {};
    Object.keys(ref).forEach(function (id) { if (!etab || id === etab) ref[id].forEach(function (c) { if (classes.indexOf(c) < 0) classes.push(c); }); });
    classes.sort(M.comparerClasses);
    etat.elevesTous.forEach(function (e) { if (!etab || e.etablissement === etab) niveaux[M.niveauClasse(e.classe)] = true; });
    remplirSelect($("pe-classe"), classes.map(function (c) { return { valeur: c, libelle: c }; }), "Toutes");
    remplirSelect($("pe-niveau"), M.NIVEAUX.filter(function (n) { return niveaux[n]; }).map(function (n) { return { valeur: n, libelle: n }; }), "Tous");
    remplirSelect($("pe-dispositif"), [{ valeur: "ulis", libelle: "Élèves d'ULIS" }, { valeur: "aucun", libelle: "Hors dispositif" }]
      .concat(etat.dispositifs.map(function (d) { return { valeur: d.id, libelle: "ULIS « " + d.nom + " »" }; })), "Tous");
  }
  function finNotif(e) {
    if (!e.finNotif) return '<span class="aide">—</span>';
    var j = joursAvant(e.finNotif);
    return dateFr(e.finNotif) + (j < 0 ? ' <span class="badge badge-difficile">échue</span>' : (j <= 30 ? ' <span class="badge badge-construction">dans ' + pluriel(j, "jour") + '</span>' : ""));
  }
  function dispositifLibelle(e) {
    var d = M.dispositifEleve(e, etat.dispositifs);
    return (d ? "ULIS « " + d.nom + " »" : "Dispositif introuvable") + (e.dispositif.classeReference ? " · classe de référence " + e.dispositif.classeReference : "");
  }
  function rendreEleves() {
    if ($("vue-eleves").classList.contains("masque")) return;
    majAnnuler("pe-annuler");
    var focus = document.activeElement, focusLigne = focus && focus.closest && focus.closest("#pe-table") && focus.getAttribute("data-eleve");
    var lignes = filtresEleves(), ctx = A.contexte();
    nettoyerSelection("eleves", lignes.map(function (l) { return l.e.id; }));
    var baseE = $("pe-archives").checked ? etat.elevesTous.length : etat.eleves.length, masquesE = etat.elevesTous.length - etat.eleves.length;
    $("pe-compte").textContent = baseE ? (lignes.length === baseE ? pluriel(baseE, "élève") : lignes.length + " sur " + baseE) + " · année " + A.anneeCourante()
      + (!$("pe-archives").checked && masquesE ? " · " + pluriel(masquesE, "archivé masqué", "archivés masqués") : "") : (masquesE ? "Aucun élève actif · " + pluriel(masquesE, "archivé masqué", "archivés masqués") : "");
    var h = '<thead><tr>' + caseTete("eleves") + COLONNES_ELEVES.map(function (c) { return teteTriable(c, pe.tri); }).join("") + '</tr></thead><tbody>';
    if (!lignes.length) {
      h += '<tr><td colspan="' + (COLONNES_ELEVES.length + 1) + '" class="vide">' + (baseE ? "Aucun élève ne correspond à ces critères."
        : "Aucun élève pour l'année " + ech(A.anneeCourante()) + ". Ajoutez-en un avec « + Nouvel élève », ou importez le fichier des élèves (onglet Importer).") + '</td></tr>';
    }
    lignes.forEach(function (l) {
      var e = l.e, cv = l.cv, cls = [pe.ouvert === e.id ? "actif" : "", M.estArchive(e) ? "archive" : ""].filter(Boolean).join(" ");
      h += '<tr data-eleve="' + ech(e.id) + '" tabindex="0"' + (cls ? ' class="' + cls + '"' : "") + (pe.ouvert === e.id ? ' aria-selected="true"' : "") + '>'
        + caseLigne("eleves", e.id, e.nomCourt)
        + '<td><strong>' + ech(e.nomCourt) + '</strong>' + (M.estEnDispositif(e) ? ' <span class="badge-ulis" title="' + ech(dispositifLibelle(e)) + '">ULIS</span>' : "") + (M.estArchive(e) ? ' <span class="badge badge-archive">archivé</span>' : "") + '</td><td>' + ech(e.classe) + '</td>'
        + '<td class="col-secondaire">' + ech(A.nomEtablissement(e.etablissement)) + '</td>'
        + '<td class="col-secondaire">' + [e.heuresInd ? heures(e.heuresInd) + " ind." : "", e.heuresMut ? heures(e.heuresMut) + " mut." : ""].filter(Boolean).join(" · ") + '</td>'
        + '<td class="col-jauges">' + (cv ? '<span class="pastille-etat e-' + cv.etat + '">' + A.LIB_ETAT_ELEVE[cv.etat] + '</span>' + A.jaugesEleve(e, cv) : '<span class="aide">archivé le ' + dateFr(e.archiveLe) + '</span>') + '</td>'
        + '<td class="col-secondaire">' + finNotif(e) + '</td></tr>';
    });
    $("pe-table").innerHTML = h + "</tbody>";
    chaque($("pe-table"), "[data-tri]", function (b) {
      b.addEventListener("click", function () {
        var k = this.dataset.tri;
        pe.tri = { cle: k, sens: pe.tri.cle === k ? -pe.tri.sens : 1 };
        rendreEleves();
        var bt = $("pe-table").querySelector('[data-tri="' + k + '"]'); if (bt) bt.focus();
      });
    });
    brancherLignes($("pe-table"), "data-eleve", ouvrirEleve, basculerLigne($("pe-table")));
    brancherSelection("eleves", $("pe-table"));
    if (focusLigne) { var tr = $("pe-table").querySelector('tr[data-eleve="' + focusLigne.replace(/"/g, '\\"') + '"]'); if (tr) tr.focus(); }
    rendrePanneauEleve(ctx);
  }
  function rendrePanneauEleve(ctx) {
    var e = pe.ouvert && A.eleveParId(pe.ouvert);
    $("pe-disposition").classList.toggle("avec-fiche", !!e);
    $("pe-panneau").hidden = !e;
    if (!e) { pe.ouvert = null; $("pe-fiche").innerHTML = ""; return; }
    var arch = M.estArchive(e), cv = arch ? null : M.couvertureEleve(e, ctx);
    $("pe-titre").textContent = e.nomCourt + " — " + e.classe;
    $("pe-sous-titre").textContent = A.nomEtablissement(e.etablissement)
      + (e.finNotif ? " · fin de notification le " + dateFr(e.finNotif) : "");
    $("pe-jauges").innerHTML = cv ? '<span class="pastille-etat e-' + cv.etat + '">' + A.LIB_ETAT_ELEVE[cv.etat] + '</span>' + A.jaugesEleve(e, cv) : "";
    boutonsArchivage("pe", e, arch);
    A.rendreFicheEleve(e, { hote: "pe-fiche", ouverte: true });
  }
  function ouvrirEleve(id) {
    pe.ouvert = id;
    rendreEleves();
    $("pe-panneau").scrollTop = 0;
    $("pe-titre").focus();
  }
  function fermerEleve() {
    var id = pe.ouvert;
    pe.ouvert = null;
    rendreEleves();
    var tr = id && $("pe-table").querySelector('tr[data-eleve="' + id.replace(/"/g, '\\"') + '"]');
    if (tr) tr.focus();
  }

  ["pe-etab", "pe-classe", "pe-niveau", "pe-dispositif", "pe-modalite", "pe-couverture"].forEach(function (id) {
    $(id).addEventListener("change", function () { if (id === "pe-etab") remplirFiltresEleves(); rendreEleves(); });
  });
  $("pe-recherche").addEventListener("input", rendreEleves);
  $("pe-archives").addEventListener("change", rendreEleves);
  $("pe-reinitialiser").addEventListener("click", function () {
    $("pe-archives").checked = false;
    ["pe-recherche", "pe-etab", "pe-classe", "pe-niveau", "pe-dispositif", "pe-modalite", "pe-couverture"].forEach(function (id) { $(id).value = ""; });
    remplirFiltresEleves(); rendreEleves();
  });
  $("pe-annuler").addEventListener("click", function () { A.annuler(); });
  $("pe-fermer").addEventListener("click", fermerEleve);
  $("pe-edt").addEventListener("click", function () { if (pe.ouvert) A.voirGrilleEleve(pe.ouvert); });
  $("pe-panneau").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) { ev.preventDefault(); fermerEleve(); }
  });

  /* ---------- changer l'établissement et la classe d'un élève (fiche) ---------- */
  var ident = null;   // {id}
  function ouvrirIdentite(id) {
    var e = A.eleveParId(id);
    if (!e) return;
    ident = { id: id };
    $("id-titre").textContent = "Établissement et classe de " + e.nomCourt;
    remplirSelect($("id-etab"), etablissementsTries().map(function (x) { return { valeur: x.id, libelle: x.nom }; }), "");
    $("id-etab").value = e.etablissement;
    remplirClassesIdentite(e.classe);
    $("id-classe-autre").value = "";
    $("voile-identite").hidden = false;
    majIdentite();
    $("id-etab").focus();
  }
  function remplirClassesIdentite(choisie) {
    var etab = $("id-etab").value, classes = (referentiel()[etab] || []).slice();
    if (choisie && !classes.some(function (c) { return M.memeClasse(c, choisie); }) && etab === A.eleveParId(ident.id).etablissement) classes.push(choisie);
    remplirSelect($("id-classe"), classes.sort(M.comparerClasses).map(function (c) { return { valeur: c, libelle: c }; }).concat([{ valeur: NOUVEAU, libelle: "Autre classe…" }]), "");
    var existe = choisie && classes.some(function (c) { return M.memeClasse(c, choisie); });
    $("id-classe").value = existe ? classes.filter(function (c) { return M.memeClasse(c, choisie); })[0] : (classes.length ? classes[0] : NOUVEAU);
  }
  function fermerIdentite() { ident = null; $("voile-identite").hidden = true; }
  // plan de l'action (PialModele.planIdentite) et son aperçu
  function calculIdentite() {
    var e = A.eleveParId(ident.id), etabId = $("id-etab").value, nomE = A.nomEtablissement(etabId);
    var classe = $("id-classe").value === NOUVEAU ? M.classeNette($("id-classe-autre").value) : $("id-classe").value;
    var r = { plan: null, classe: classe, nomE: nomE, etabId: etabId, lignes: [], erreurs: [] };
    if (!classe) { r.erreurs.push("Indiquez la classe."); return r; }
    var choixAff = document.querySelector('input[name="id-aff"]:checked'), choixCours = document.querySelector('input[name="id-cours"]:checked');
    r.plan = M.planIdentite({ eleves: etat.elevesTous, cours: etat.coursTous, aesh: etat.aeshTous, etablissements: etat.etablissements,
      affectations: etat.affectations.concat(etat.affectationsVersions) }, e.id, { classe: classe, etablissement: etabId, etablissementNom: nomE },
      { affectations: choixAff ? choixAff.value : "", cours: choixCours ? choixCours.value : "" });
    var p = r.plan;
    if (p.collisions.length) r.erreurs.push("Un élève porte déjà le même nom court (" + ech(p.collisions[0].avec.nomCourt) + ") en " + ech(classe) + " à " + ech(nomE) + ". Rien n'est écrit : écrivez une abréviation terminée par un point dans l'une des deux fiches.");
    else if (p.inchange) r.lignes.push("Aucun changement : l'élève est déjà dans cette classe de cet établissement.");
    return r;
  }
  function majIdentite() {
    var e = A.eleveParId(ident.id), autre = $("id-classe").value === NOUVEAU;
    $("id-classe-autre-champ").hidden = !autre;
    // les choix ne sont proposés qu'à l'aperçu : on garde ceux déjà faits
    var c = calculIdentite(), p = c.plan, h = "";
    if (p && p.ok) {
      var etabChange = c.etabId !== e.etablissement;
      h += '<ul class="id-lignes"><li>' + (etabChange ? "Établissement : " + ech(A.nomEtablissement(e.etablissement)) + " → <strong>" + ech(c.nomE) + "</strong>. " : "") + "Classe : " + ech(e.classe) + " → <strong>" + ech(c.classe) + "</strong>.</li>"
        + (p.dispositifRetire ? '<li>Il quitte son dispositif (un dispositif appartient à un établissement) ; l\'historique de ses inclusions est conservé.</li>' : "")
        + '<li>Cours de l\'ancienne classe : ' + pluriel(p.nbCours, "cours") + '.</li>'
        + (p.versions.length ? '<li>Versions validées inchangées (' + p.versions.join(", ") + ').</li>' : "") + "</ul>";
      h += '<fieldset class="id-choix"><legend>Cours de l\'ancienne classe</legend>'
        + '<label class="case"><input type="radio" name="id-cours" value="garder"' + (p.choix.cours === "garder" ? " checked" : "") + '> Les garder, rattachés à la nouvelle classe (horaires inchangés jusqu\'au prochain import des emplois du temps)</label>'
        + '<label class="case"><input type="radio" name="id-cours" value="retirer"' + (p.choix.cours === "retirer" ? " checked" : "") + '> Les retirer (l\'élève n\'a plus d\'emploi du temps jusqu\'à un nouvel import)</label></fieldset>';
      if (p.affectations.length) {
        h += '<fieldset class="id-choix"><legend>Affectations du brouillon concernées : ' + p.affectations.length + '</legend>'
          + '<label class="case"><input type="radio" name="id-aff" value="retirer"' + (p.choix.affectations === "retirer" ? " checked" : "") + '> Retirer ces affectations (un groupe mutualisé est seulement quitté par cet élève)</label>'
          + '<label class="case"><input type="radio" name="id-aff" value="garder"' + (p.choix.affectations === "garder" ? " checked" : "") + '> Les garder, signalées en alerte jusqu\'à vérification du créneau</label></fieldset>';
      }
    } else if (c.lignes.length) h += "<p>" + c.lignes.join(" ") + "</p>";
    $("id-apercu").innerHTML = h;
    Array.prototype.forEach.call($("id-apercu").querySelectorAll("input[type=radio]"), function (r) { r.addEventListener("change", majIdentite); });
    $("id-erreurs").innerHTML = c.erreurs.join("<br>");
    $("id-erreurs").hidden = !c.erreurs.length;
    $("id-appliquer").disabled = !(p && p.ok) || !!c.erreurs.length;
  }
  function appliquerIdentite() {
    if (!ident) return;
    var c = calculIdentite(), p = c.plan;
    if (!p || !p.ok || c.erreurs.length) { majIdentite(); return; }
    var e = A.eleveParId(ident.id), ops = p.ops.concat(paramsClasses([p.eleve]));
    // établissement jamais créé ici : il existe forcément (liste déroulante)
    fermerIdentite();
    A.enregistrerPuisRendre(ops, e.nomCourt + " : " + c.classe + " à " + c.nomE + (p.affectations.length ? (p.choix.affectations === "retirer" ? " — affectations retirées." : " — affectations gardées en alerte.") : "."),
      "le changement de classe ou d'établissement de " + e.nomCourt);
  }
  $("id-etab").addEventListener("change", function () { if (!ident) return; remplirClassesIdentite(""); majIdentite(); });
  $("id-classe").addEventListener("change", majIdentite);
  $("id-classe-autre").addEventListener("input", majIdentite);
  $("id-appliquer").addEventListener("click", appliquerIdentite);
  $("id-annuler").addEventListener("click", fermerIdentite);
  $("voile-identite").addEventListener("click", function (ev) { if (ev.target === this) fermerIdentite(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && ident) fermerIdentite(); });

  /* ---------- création d'un élève ---------- */
  var NOUVEAU = "__nouveau";
  var ne = { tente: false, retour: null };
  function periGere() { return !!A.contexte().reglages.gererPeriscolaire; }
  function remplirClassesNe() {
    var etab = $("ne-etab").value, classes = etab && etab !== NOUVEAU ? (referentiel()[etab] || []) : [];
    remplirSelect($("ne-classe"), classes.map(function (c) { return { valeur: c, libelle: c }; }).concat([{ valeur: NOUVEAU, libelle: "Autre classe…" }]), "");
    if (!classes.length) $("ne-classe").value = NOUVEAU;
    afficherAutres();
  }
  function afficherAutres() {
    $("ne-etab-autre-champ").hidden = $("ne-etab").value !== NOUVEAU;
    $("ne-classe-autre-champ").hidden = $("ne-classe").value !== NOUVEAU;
  }
  function lireNe() {
    var etabId = $("ne-etab").value, nouvelEtab = etabId === NOUVEAU, etabNom = nouvelEtab ? $("ne-etab-autre").value.replace(/\s+/g, " ").trim() : A.nomEtablissement(etabId);
    var classe = $("ne-classe").value === NOUVEAU ? $("ne-classe-autre").value : $("ne-classe").value;
    var besoins = [];
    chaque($("ne-besoins"), "[data-besoin]", function (c) { if (c.checked) besoins.push(I.ACCOMP[+c.dataset.besoin]); });
    var v = { etablissement: etabId ? etabNom : "", classe: classe.replace(/\s+/g, " ").trim(), prenom: $("ne-prenom").value.trim(), nom: $("ne-nom").value.trim(),
      heuresInd: $("ne-ind").value.trim(), heuresMut: $("ne-mut").value.trim(), besoins: besoins.join(" | "),
      debutNotif: $("ne-debut").value, finNotif: $("ne-fin").value,
      recreation: periGere() ? $("ne-recre").value : "", meridienne: periGere() ? $("ne-merid").value : "" };
    return { v: v, nouvelEtab: nouvelEtab && etabNom ? etabNom : null, etabId: nouvelEtab ? M.idEtablissement(etabNom) : etabId };
  }
  // contrôle pendant la saisie : aperçu de ce qui sera enregistré, collision
  // de clé tout de suite, autres erreurs après un premier essai
  function verifierNe() {
    var l = lireNe(), v = l.v, r = I.validerLigne("eleves", v, { annee: A.anneeCourante(), gererPeriscolaire: periGere() });
    var apercu = "", erreurs = [], collision = null;
    if (v.prenom && v.nom) {
      var nc = M.nomCourt(v.prenom, v.nom);
      apercu = 'Sera enregistré : <strong>' + ech(nc) + '</strong>' + (v.classe ? ' — ' + ech(v.classe) : "") + (v.etablissement ? ' — ' + ech(v.etablissement) : "")
        + (M.abregerNom(v.nom) !== v.nom.replace(/\s+/g, " ") ? ' <span class="aide">(le nom « ' + ech(v.nom) + ' » n\'est pas conservé)</span>' : "");
      if (v.classe && v.etablissement) {
        collision = M.collisionEleve(etat.elevesTous, { annee: A.anneeCourante(), cle: M.cleEleve(nc, v.classe, l.etabId) });
      }
    }
    if (collision) erreurs.push("Un élève " + collision.nomCourt + " existe déjà en " + collision.classe + " dans cet établissement" + (M.estArchive(collision) ? " (archivé)" : "")
      + ". Différenciez-les en écrivant une abréviation terminée par un point dans le nom (ex. « Ma. » et « Mo. »).");
    if (ne.tente && r.erreurs) erreurs = erreurs.concat(r.erreurs.map(function (m) { return m.charAt(0).toUpperCase() + m.slice(1) + "."; }));
    $("ne-apercu").innerHTML = apercu;
    $("ne-erreurs").innerHTML = erreurs.length ? '<ul class="liste-motifs">' + erreurs.map(function (m) { return "<li>" + ech(m) + "</li>"; }).join("") + '</ul>' : "";
    $("ne-erreurs").hidden = !erreurs.length;
    $("ne-creer").disabled = $("ne-creer-autre").disabled = !!collision;
    // établissement choisi dans la liste : son identifiant fait foi (clé comprise)
    if (r.objet) { r.objet.etablissement = l.etabId; r.objet.cle = M.cleEleve(r.objet.nomCourt, r.objet.classe, l.etabId); r.objet.id = M.idEleve(r.objet.annee, r.objet.cle); }
    return { ok: !r.erreurs && !collision, objet: r.objet, nouvelEtab: l.nouvelEtab, collision: collision };
  }
  function ouvrirCreationEleve() {
    ne.tente = false;
    ne.retour = document.activeElement;
    var etabs = etablissementsTries();
    remplirSelect($("ne-etab"), etabs.map(function (e) { return { valeur: e.id, libelle: e.nom }; }).concat([{ valeur: NOUVEAU, libelle: "Nouvel établissement…" }]), etabs.length ? "Choisir…" : "");
    $("ne-etab").value = $("pe-etab").value || (etabs.length === 1 ? etabs[0].id : (etabs.length ? "" : NOUVEAU));
    remplirClassesNe();
    if ($("pe-classe").value && $("ne-etab").value === $("pe-etab").value) { $("ne-classe").value = $("pe-classe").value; afficherAutres(); }
    ["ne-etab-autre", "ne-classe-autre", "ne-prenom", "ne-nom", "ne-ind", "ne-mut", "ne-debut", "ne-fin"].forEach(function (id) { $(id).value = ""; });
    $("ne-peri").hidden = !periGere();
    $("ne-recre").value = "non"; $("ne-merid").value = "non";
    $("ne-besoins").innerHTML = I.ACCOMP.map(function (b, i) {
      return '<label class="pastille-case"><input type="checkbox" data-besoin="' + i + '"> ' + ech(b) + '</label>';
    }).join("");
    $("ne-besoins-details").open = false;
    verifierNe();
    $("voile-nouvel-eleve").hidden = false;
    ($("ne-etab").value ? ($("ne-classe").value && $("ne-classe").value !== NOUVEAU ? $("ne-prenom") : $("ne-classe")) : $("ne-etab")).focus();
  }
  function fermerCreationEleve() {
    $("voile-nouvel-eleve").hidden = true;
    if (ne.retour && ne.retour.focus) ne.retour.focus();
  }
  function creerEleve(encore) {
    ne.tente = true;
    var r = verifierNe();
    if (!r.ok) { var p = $("ne-erreurs"); if (!p.hidden) p.focus(); return; }
    var objet = M.attribuerIdentifiants("eleves", [r.objet], etat.elevesTous)[0], ops = [];
    if (r.nouvelEtab && !A.etablissementParId(M.idEtablissement(r.nouvelEtab))) ops.push({ magasin: "etablissements", enregistrer: [M.etablissementParDefaut(r.nouvelEtab)] });
    ops.push({ magasin: "eleves", enregistrer: [objet] });
    // « Autre classe… » : la classe entre dans le référentiel de l'établissement (§17)
    if (!(referentiel()[objet.etablissement] || []).some(function (c) { return M.memeClasse(c, objet.classe); })) {
      ops.push({ magasin: "parametres", enregistrer: [tableClasses(M.classesAvecAjout(etat.classes, A.anneeCourante(), objet.etablissement, objet.classe))] });
    }
    A.enregistrerPuisRendre(ops, objet.nomCourt + " ajouté(e) en " + objet.classe + "." + (r.nouvelEtab ? " Établissement créé : vérifiez ses horaires dans Réglages." : ""),
      "la création de " + objet.nomCourt).then(function () {
      if (encore) {
        // même établissement et même classe : on enchaîne
        ne.tente = false;
        var etabId = objet.etablissement;
        remplirSelect($("ne-etab"), etablissementsTries().map(function (e) { return { valeur: e.id, libelle: e.nom }; }).concat([{ valeur: NOUVEAU, libelle: "Nouvel établissement…" }]), "Choisir…");
        $("ne-etab").value = etabId; remplirClassesNe(); $("ne-classe").value = objet.classe; afficherAutres();
        ["ne-prenom", "ne-nom"].forEach(function (id) { $(id).value = ""; });
        verifierNe();
        $("ne-prenom").focus();
      } else {
        $("voile-nouvel-eleve").hidden = true;
        ouvrirEleve(objet.id);
      }
    });
  }
  $("pe-nouveau").addEventListener("click", ouvrirCreationEleve);
  $("ne-etab").addEventListener("change", function () { remplirClassesNe(); verifierNe(); if (this.value === NOUVEAU) $("ne-etab-autre").focus(); });
  $("ne-classe").addEventListener("change", function () { afficherAutres(); verifierNe(); if (this.value === NOUVEAU) $("ne-classe-autre").focus(); });
  $("voile-nouvel-eleve").addEventListener("input", verifierNe);
  $("voile-nouvel-eleve").addEventListener("change", verifierNe);
  $("ne-creer").addEventListener("click", function () { creerEleve(false); });
  $("ne-creer-autre").addEventListener("click", function () { creerEleve(true); });
  $("ne-annuler").addEventListener("click", fermerCreationEleve);
  $("voile-nouvel-eleve").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { ev.preventDefault(); fermerCreationEleve(); }
    if (ev.key === "Enter" && ev.target.tagName === "INPUT" && ev.target.type !== "checkbox") { ev.preventDefault(); creerEleve(ev.ctrlKey || ev.metaKey); }
  });

  /* =============== onglet AESH =============== */
  var pa = { tri: { cle: "nom", sens: 1 }, ouvert: null };
  function elevesDeAesh(a) {
    var vus = {};
    etat.affectations.forEach(function (x) { if (x.aeshId === a.id) x.eleves.forEach(function (id) { vus[id] = true; }); });
    return Object.keys(vus).length;
  }
  function nomsEtabs(a) { return (a.etablissements || []).length ? a.etablissements.map(A.nomEtablissement).join(", ") : "tous"; }
  var COLONNES_AESH = [
    { cle: "nom", lib: "AESH", cmp: function (x, y) { return (x.a.nom + " " + x.a.prenom).localeCompare(y.a.nom + " " + y.a.prenom, "fr"); } },
    { cle: "etab", lib: "Établissements possibles", classe: "col-secondaire", cmp: function (x, y) { return nomsEtabs(x.a).localeCompare(nomsEtabs(y.a), "fr"); } },
    { cle: "quotite", lib: "Quotité", cmp: function (x, y) { return (x.a.quotite || 0) - (y.a.quotite || 0); } },
    { cle: "charge", lib: "Charge", cmp: function (x, y) { return (x.ch.quotite ? x.ch.moy / x.ch.quotite : 0) - (y.ch.quotite ? y.ch.moy / y.ch.quotite : 0); } },
    { cle: "eleves", lib: "Élèves", classe: "col-secondaire", cmp: function (x, y) { return x.n - y.n; } },
    { cle: "spec", lib: "Spécialités", classe: "col-secondaire", cmp: function (x, y) { return (x.a.formations || []).join().localeCompare((y.a.formations || []).join(), "fr"); } }
  ];
  function filtresAesh() {
    var ctx = A.contexte(), etab = $("pa-etab").value, spec = $("pa-spec").value, charge = $("pa-charge").value,
      mots = M.normaliser($("pa-recherche").value).split(" ").filter(Boolean);
    var lignes = etat.aeshTous.filter(function (a) { return $("pa-archives").checked || !M.estArchive(a); })
      .map(function (a) { return { a: a, ch: M.chargeAesh(a, ctx), n: elevesDeAesh(a) }; }).filter(function (l) {
      var a = l.a;
      if (etab === "__tous" && (a.etablissements || []).length) return false;
      if (etab && etab !== "__tous" && (a.etablissements || []).length && a.etablissements.indexOf(etab) < 0) return false;
      if (spec && !(a.formations || []).some(function (f) { return M.normaliser(f) === M.normaliser(spec); })) return false;
      if (charge && (M.estArchive(a) || l.ch.etat !== charge)) return false;
      if (mots.length) {
        var texte = M.normaliser([a.prenom, a.nom, a.email || "", nomsEtabs(a), (a.formations || []).join(" ")].join(" "));
        if (!mots.every(function (m) { return texte.indexOf(m) > -1; })) return false;
      }
      return true;
    });
    var col = COLONNES_AESH.filter(function (c) { return c.cle === pa.tri.cle; })[0] || COLONNES_AESH[0];
    lignes.sort(function (x, y) { return (pa.tri.sens * col.cmp(x, y)) || COLONNES_AESH[0].cmp(x, y); });
    return lignes;
  }
  function remplirFiltresAesh() {
    remplirSelect($("pa-etab"), etablissementsTries().map(function (e) { return { valeur: e.id, libelle: e.nom }; })
      .concat([{ valeur: "__tous", libelle: "Sans restriction (tous établissements)" }]), "Tous");
    var specs = (A.contexte().reglages.specialites || []).map(function (s) { return s.nom; });
    etat.aeshTous.forEach(function (a) { (a.formations || []).forEach(function (f) { if (!specs.some(function (s) { return M.normaliser(s) === M.normaliser(f); })) specs.push(f); }); });
    remplirSelect($("pa-spec"), specs.map(function (s) { return { valeur: s, libelle: s }; }), "Toutes");
  }
  function rendreAesh() {
    if ($("vue-aesh").classList.contains("masque")) return;
    majAnnuler("pa-annuler");
    var focus = document.activeElement, focusLigne = focus && focus.closest && focus.closest("#pa-table") && focus.getAttribute("data-aesh");
    var lignes = filtresAesh(), ctx = A.contexte();
    nettoyerSelection("aesh", lignes.map(function (l) { return l.a.id; }));
    var baseA = $("pa-archives").checked ? etat.aeshTous.length : etat.aesh.length, masqueesA = etat.aeshTous.length - etat.aesh.length;
    $("pa-compte").textContent = baseA ? (lignes.length === baseA ? pluriel(baseA, "AESH", "AESH") : lignes.length + " sur " + baseA)
      + (!$("pa-archives").checked && masqueesA ? " · " + pluriel(masqueesA, "archivée masquée", "archivées masquées") : "") : (masqueesA ? "Aucune AESH active · " + pluriel(masqueesA, "archivée masquée", "archivées masquées") : "");
    var h = '<thead><tr>' + caseTete("aesh") + COLONNES_AESH.map(function (c) { return teteTriable(c, pa.tri); }).join("") + '</tr></thead><tbody>';
    if (!lignes.length) {
      h += '<tr><td colspan="' + (COLONNES_AESH.length + 1) + '" class="vide">' + (baseA ? "Aucune AESH ne correspond à ces critères."
        : "Aucune AESH. Ajoutez-en une avec « + Nouvelle AESH », ou importez le fichier des AESH (onglet Importer).") + '</td></tr>';
    }
    lignes.forEach(function (l) {
      var a = l.a, ch = l.ch;
      var titre = A.LIB_ETAT_AESH[ch.etat] + (ch.A !== ch.B ? " — semaine A : " + heures(ch.A) + ", semaine B : " + heures(ch.B) : "");
      var arch = M.estArchive(a), cls = [pa.ouvert === a.id ? "actif" : "", arch ? "archive" : ""].filter(Boolean).join(" ");
      h += '<tr data-aesh="' + ech(a.id) + '" tabindex="0"' + (cls ? ' class="' + cls + '"' : "") + (pa.ouvert === a.id ? ' aria-selected="true"' : "") + '>'
        + caseLigne("aesh", a.id, A.nomAesh(a))
        + '<td><span class="puce-aesh" style="background:' + A.couleurAesh(a.id) + '">' + ech(A.initialesAesh(a)) + '</span> <strong>' + ech(A.nomAesh(a)) + '</strong>'
        + (arch ? ' <span class="badge badge-archive">archivée</span>' : "")
        + (a.ignorerIndispos ? ' <span class="badge-ignore" title="Indisponibilités et établissements possibles ignorés">indispos ignorées</span>' : "") + '</td>'
        + '<td class="col-secondaire col-texte">' + ech(nomsEtabs(a)) + '</td>'
        + '<td>' + heures(a.quotite || 0) + '</td>'
        + '<td class="col-jauges">' + (arch ? '<span class="aide">archivée le ' + dateFr(a.archiveLe) + '</span>' : '<span class="pastille-etat e-' + ch.etat + '">' + A.LIB_ETAT_AESH[ch.etat] + '</span>' + A.jauge("Charge", ch.moy, ch.quotite, ch.etat, titre)) + '</td>'
        + '<td class="col-secondaire">' + l.n + '</td>'
        + '<td class="col-secondaire col-texte">' + ech((a.formations || []).join(", ")) + '</td></tr>';
    });
    $("pa-table").innerHTML = h + "</tbody>";
    chaque($("pa-table"), "[data-tri]", function (b) {
      b.addEventListener("click", function () {
        var k = this.dataset.tri;
        pa.tri = { cle: k, sens: pa.tri.cle === k ? -pa.tri.sens : 1 };
        rendreAesh();
        var bt = $("pa-table").querySelector('[data-tri="' + k + '"]'); if (bt) bt.focus();
      });
    });
    brancherLignes($("pa-table"), "data-aesh", ouvrirAesh, basculerLigne($("pa-table")));
    brancherSelection("aesh", $("pa-table"));
    if (focusLigne) { var tr = $("pa-table").querySelector('tr[data-aesh="' + focusLigne.replace(/"/g, '\\"') + '"]'); if (tr) tr.focus(); }
    rendrePanneauAesh(ctx);
  }
  function rendrePanneauAesh(ctx) {
    var a = pa.ouvert && A.aeshParId(pa.ouvert);
    $("pa-disposition").classList.toggle("avec-fiche", !!a);
    $("pa-panneau").hidden = !a;
    if (!a) { pa.ouvert = null; $("pa-fiche").innerHTML = ""; return; }
    var ch = M.chargeAesh(a, ctx);
    var titre = A.LIB_ETAT_AESH[ch.etat] + (ch.A !== ch.B ? " — semaine A : " + heures(ch.A) + ", semaine B : " + heures(ch.B) : "");
    $("pa-titre").textContent = A.nomAesh(a);
    $("pa-sous-titre").textContent = (a.email ? a.email + " · " : "") + "établissements : " + nomsEtabs(a)
      + ((a.indisponibilites || []).length ? " · indisponible : " + a.indisponibilites.map(A.texteIndispo).join(", ") : "");
    var archA = M.estArchive(a);
    $("pa-jauges").innerHTML = archA ? "" : '<span class="pastille-etat e-' + ch.etat + '">' + A.LIB_ETAT_AESH[ch.etat] + '</span>' + A.jauge("Charge", ch.moy, ch.quotite, ch.etat, titre)
      + '<p class="aide" style="margin:4px 0 0">' + pluriel(elevesDeAesh(a), "élève accompagné", "élèves accompagnés") + ' dans le brouillon.</p>';
    boutonsArchivage("pa", a, archA);
    A.rendreFicheAesh(a, { hote: "pa-fiche", ouverte: true });
  }
  function ouvrirAesh(id) {
    pa.ouvert = id;
    rendreAesh();
    $("pa-panneau").scrollTop = 0;
    $("pa-titre").focus();
  }
  function fermerAesh() {
    var id = pa.ouvert;
    pa.ouvert = null;
    rendreAesh();
    var tr = id && $("pa-table").querySelector('tr[data-aesh="' + id.replace(/"/g, '\\"') + '"]');
    if (tr) tr.focus();
  }
  ["pa-etab", "pa-spec", "pa-charge"].forEach(function (id) { $(id).addEventListener("change", rendreAesh); });
  $("pa-recherche").addEventListener("input", rendreAesh);
  $("pa-archives").addEventListener("change", rendreAesh);
  $("pa-reinitialiser").addEventListener("click", function () {
    $("pa-archives").checked = false;
    ["pa-recherche", "pa-etab", "pa-spec", "pa-charge"].forEach(function (id) { $(id).value = ""; });
    rendreAesh();
  });
  $("pa-annuler").addEventListener("click", function () { A.annuler(); });
  $("pa-fermer").addEventListener("click", fermerAesh);
  $("pa-edt").addEventListener("click", function () { if (pa.ouvert) A.voirGrilleAesh(pa.ouvert); });
  $("pa-panneau").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) { ev.preventDefault(); fermerAesh(); }
  });

  /* ---------- création d'une AESH ---------- */
  var na = { tente: false, retour: null };
  function lireNa() {
    var etabs = [];
    chaque($("na-etabs"), "[data-na-etab]", function (c) { if (c.checked) etabs.push(c.dataset.naEtab); });
    var v = { nom: $("na-nom").value.trim(), prenom: $("na-prenom").value.trim(), quotite: $("na-quotite").value.trim(), email: $("na-email").value.trim(),
      etablissements: etabs.map(A.nomEtablissement).join(" | "), indisponibilites: "", formations: "" };
    return { v: v, etabs: etabs };
  }
  function verifierNa() {
    var l = lireNa(), v = l.v, r = I.validerLigne("aesh", v, { annee: A.anneeCourante(), specialites: A.contexte().reglages.specialites });
    var erreurs = [], collision = v.nom && v.prenom ? M.collisionAesh(etat.aeshTous, { nom: v.nom, prenom: v.prenom }) : null;
    $("na-apercu").innerHTML = v.nom && v.prenom ? 'Sera enregistrée : <strong>' + ech(v.prenom.replace(/\s+/g, " ") + " " + v.nom.replace(/\s+/g, " ")) + '</strong>'
      + (v.quotite ? ' — ' + ech(v.quotite.replace(".", ",")) + ' h par semaine' : "") + ' — ' + (l.etabs.length ? ech(l.etabs.map(A.nomEtablissement).join(", ")) : "tous établissements") : "";
    if (collision) erreurs.push("Une AESH " + A.nomAesh(collision) + " existe déjà" + (M.estArchive(collision) ? " (archivée)" : "") + " : deux AESH ne peuvent pas avoir le même nom et le même prénom.");
    if (na.tente && r.erreurs) erreurs = erreurs.concat(r.erreurs.map(function (m) { return m.charAt(0).toUpperCase() + m.slice(1) + "."; }));
    $("na-erreurs").innerHTML = erreurs.length ? '<ul class="liste-motifs">' + erreurs.map(function (m) { return "<li>" + ech(m) + "</li>"; }).join("") + '</ul>' : "";
    $("na-erreurs").hidden = !erreurs.length;
    $("na-creer").disabled = $("na-creer-autre").disabled = !!collision;
    // établissements cochés : leurs identifiants font foi
    if (r.objet) { r.objet.etablissements = l.etabs; r.objet.etablissementsNoms = l.etabs.map(A.nomEtablissement); }
    return { ok: !r.erreurs && !collision, objet: r.objet };
  }
  function ouvrirCreationAesh() {
    na.tente = false;
    na.retour = document.activeElement;
    ["na-nom", "na-prenom", "na-quotite", "na-email"].forEach(function (id) { $(id).value = ""; });
    var filtre = $("pa-etab").value;
    $("na-etabs").innerHTML = etablissementsTries().map(function (e) {
      return '<label class="pastille-case"><input type="checkbox" data-na-etab="' + ech(e.id) + '"' + (filtre === e.id ? " checked" : "") + '> ' + ech(e.nom) + '</label>';
    }).join("") || '<span class="aide">Aucun établissement : créez d\'abord un élève ou importez un fichier.</span>';
    verifierNa();
    $("voile-nouvelle-aesh").hidden = false;
    $("na-nom").focus();
  }
  function fermerCreationAesh() {
    $("voile-nouvelle-aesh").hidden = true;
    if (na.retour && na.retour.focus) na.retour.focus();
  }
  function creerAesh(encore) {
    na.tente = true;
    var r = verifierNa();
    if (!r.ok) { if (!$("na-erreurs").hidden) $("na-erreurs").focus(); return; }
    var objet = M.attribuerIdentifiants("aesh", [r.objet], etat.aeshTous)[0];
    A.enregistrerPuisRendre([{ magasin: "aesh", enregistrer: [objet] }], A.nomAesh(objet) + " ajoutée.", "la création de " + A.nomAesh(objet)).then(function () {
      if (encore) {
        na.tente = false;
        ["na-nom", "na-prenom", "na-email"].forEach(function (id) { $(id).value = ""; });
        verifierNa();
        $("na-nom").focus();
      } else {
        $("voile-nouvelle-aesh").hidden = true;
        ouvrirAesh(objet.id);
      }
    });
  }
  $("pa-nouveau").addEventListener("click", ouvrirCreationAesh);
  $("voile-nouvelle-aesh").addEventListener("input", verifierNa);
  $("voile-nouvelle-aesh").addEventListener("change", verifierNa);
  $("na-creer").addEventListener("click", function () { creerAesh(false); });
  $("na-creer-autre").addEventListener("click", function () { creerAesh(true); });
  $("na-annuler").addEventListener("click", fermerCreationAesh);
  $("voile-nouvelle-aesh").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { ev.preventDefault(); fermerCreationAesh(); }
    if (ev.key === "Enter" && ev.target.tagName === "INPUT" && ev.target.type !== "checkbox") { ev.preventDefault(); creerAesh(ev.ctrlKey || ev.metaKey); }
  });

  /* =============== référentiel des classes (Réglages) =============== */
  function tableClasses(valeur) { return { cle: "classes", valeur: valeur }; }
  function pluriel0(n, un, plu) { return n + " " + (n > 1 ? plu : un); }
  function rendreClasses() {
    var hote = $("reg-classes");
    if (!hote) return;
    var ref = referentiel(), etabs = etablissementsTries(), h = "";
    if (!etabs.length) { hote.innerHTML = '<p class="vide">Aucun établissement pour l\'instant : importez un fichier ou créez un élève.</p>'; return; }
    etabs.forEach(function (e) {
      var classes = ref[e.id] || [];
      h += '<div class="etab-param" data-classes-etab="' + ech(e.id) + '"><h3>' + ech(e.nom) + '</h3>';
      if (!classes.length) h += '<p class="aide">Aucune classe.</p>';
      classes.forEach(function (c, k) {
        var eleves = M.elevesDeClasse(etat.elevesTous, e.id, c), arch = eleves.filter(M.estArchive).length, id = "cl-" + k + "-" + ech(e.id);
        h += '<div class="classe-ligne" data-classe="' + ech(c) + '"><input type="text" id="' + id + '" value="' + ech(c) + '" maxlength="30" aria-label="Nom de la classe ' + ech(c) + '" data-classe-nom>'
          + '<button type="button" class="btn btn-vide" data-classe-renommer disabled>Renommer</button>'
          + '<button type="button" class="btn btn-vide" data-classe-retirer' + (eleves.length ? ' disabled title="Cette classe a des élèves : changez-les de classe d\'abord."' : "") + '>Retirer</button>'
          + '<span class="aide">' + (eleves.length ? pluriel0(eleves.length, "élève", "élèves") + (arch ? " (dont " + arch + " archivé" + (arch > 1 ? "s" : "") + ")" : "") : "aucun élève") + '</span></div>';
      });
      h += '<div class="classe-ligne classe-ajout"><input type="text" maxlength="30" placeholder="Nouvelle classe (ex. : 5B)" aria-label="Nouvelle classe de ' + ech(e.nom) + '" data-classe-nouvelle>'
        + '<button type="button" class="btn btn-vide" data-classe-ajouter>Ajouter</button></div></div>';
    });
    hote.innerHTML = h;
    chaque(hote, ".etab-param", function (bloc) {
      var etab = bloc.getAttribute("data-classes-etab");
      chaque(bloc, ".classe-ligne[data-classe]", function (ligne) {
        var champ = ligne.querySelector("[data-classe-nom]"), bouton = ligne.querySelector("[data-classe-renommer]"), actuelle = ligne.getAttribute("data-classe");
        champ.addEventListener("input", function () { bouton.disabled = !M.classeNette(champ.value) || M.classeNette(champ.value) === actuelle; });
        champ.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && !bouton.disabled) { ev.preventDefault(); renommerClasse(etab, actuelle, champ.value); } });
        bouton.addEventListener("click", function () { renommerClasse(etab, actuelle, champ.value); });
        ligne.querySelector("[data-classe-retirer]").addEventListener("click", function () { retirerClasse(etab, actuelle); });
      });
      var nouvelle = bloc.querySelector("[data-classe-nouvelle]");
      nouvelle.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); ajouterClasse(etab, nouvelle.value); } });
      bloc.querySelector("[data-classe-ajouter]").addEventListener("click", function () { ajouterClasse(etab, nouvelle.value); });
    });
  }
  function ajouterClasse(etab, saisie) {
    var c = M.classeNette(saisie);
    if (!c) { A.ui().toast("Écrivez le nom de la classe (ex. : 5B)."); return; }
    if ((referentiel()[etab] || []).some(function (x) { return M.memeClasse(x, c); })) { A.ui().toast("La classe " + c + " existe déjà dans cet établissement."); return; }
    A.enregistrerPuisRendre([{ magasin: "parametres", enregistrer: [tableClasses(M.classesAvecAjout(etat.classes, A.anneeCourante(), etab, c))] }],
      "Classe " + c + " ajoutée.", "l'ajout de la classe " + c);
  }
  function retirerClasse(etab, classe) {
    if (M.elevesDeClasse(etat.elevesTous, etab, classe).length) { A.ui().toast("La classe " + classe + " a des élèves : elle ne se retire pas."); return; }
    A.enregistrerPuisRendre([{ magasin: "parametres", enregistrer: [tableClasses(M.classesSansClasse(etat.classes, A.anneeCourante(), etab, classe))] }],
      "Classe " + classe + " retirée.", "le retrait de la classe " + classe);
  }
  function renommerClasse(etab, de, saisie) {
    var vers = M.classeNette(saisie);
    if (!vers || vers === de) return;
    var r = M.renommerClasse(etat.elevesTous, etat.coursTous, etab, de, vers);
    if (r.collisions.length) {
      A.ui().toast("Renommage impossible : " + pluriel0(r.collisions.length, "élève porterait", "élèves porteraient") + " le même nom court qu'un élève déjà en " + vers + " ("
        + r.collisions.slice(0, 3).map(function (c) { return c.eleve.nomCourt; }).join(", ") + (r.collisions.length > 3 ? "…" : "") + "). Écrivez une abréviation terminée par un point dans l'une des deux fiches, puis réessayez.");
      return;
    }
    var fusion = (referentiel()[etab] || []).some(function (x) { return M.memeClasse(x, vers) && !M.memeClasse(x, de); });
    var ops = [{ magasin: "parametres", enregistrer: [tableClasses(M.classesRenommee(etat.classes, A.anneeCourante(), etab, de, vers))] }];
    if (r.eleves.length) ops.push({ magasin: "eleves", enregistrer: r.eleves });
    if (r.cours.length) ops.push({ magasin: "cours", enregistrer: r.cours });
    function faire() { A.enregistrerPuisRendre(ops, "Classe " + de + " renommée en " + vers + ".", "le renommage de la classe " + de + " en " + vers); }
    if (!r.eleves.length) { faire(); return; }
    A.ui().confirmationForte("Renommer " + de + " en " + vers + " (" + A.nomEtablissement(etab) + ") : " + pluriel0(r.eleves.length, "élève change", "élèves changent") + " de classe"
      + (r.cours.length ? " et " + pluriel0(r.cours.length, "cours suit", "cours suivent") + " leur classe" : "") + ". Leurs affectations et leurs rapports sont conservés."
      + (fusion ? " La classe " + vers + " existe déjà : les deux classes seront réunies." : "") + " Vous pourrez annuler.", "Renommer", faire);
  }

  /* =============== archivage, rétablissement, suppression définitive (§17) =============== */
  function donneesRetrait() {
    return { eleves: etat.elevesTous, aesh: etat.aeshTous, cours: etat.coursTous, affectations: etat.affectations.concat(etat.affectationsVersions) };
  }
  function nomFiche(type, f) { return type === "aesh" ? A.nomAesh(f) : f.nomCourt + " (" + f.classe + ")"; }
  function fichesDe(type, ids) {
    return ids.map(function (id) { return type === "aesh" ? A.aeshParId(id) : A.eleveParId(id); }).filter(Boolean);
  }
  function listeNoms(type, fiches) {
    var noms = fiches.slice(0, 5).map(function (f) { return nomFiche(type, f); });
    return noms.join(", ") + (fiches.length > 5 ? " et " + (fiches.length - 5) + " autre(s)" : "");
  }
  // boutons du panneau selon l'état de la fiche (prefixe : "pe" ou "pa")
  function boutonsArchivage(prefixe, f, arch) {
    $(prefixe + "-archiver").hidden = arch;
    $(prefixe + "-retablir").hidden = !arch;
    $(prefixe + "-supprimer").hidden = !arch;
    $(prefixe + "-edt").hidden = arch;
    var n = $(prefixe + "-archive-note");
    n.hidden = !arch;
    if (arch) n.textContent = (prefixe === "pa" ? "Archivée" : "Archivé") + " le " + dateFr(f.archiveLe) + (f.archiveMotif ? " — " + f.archiveMotif : "")
      + ". Hors des listes actives, du calcul des affectations et des menus de créneau ; les versions validées sont inchangées.";
  }

  var ar = { type: null, ids: [], retour: null };
  function resumeArchivage() {
    var r = M.operationsArchivage(ar.type, ar.ids, A.aujourdhui(), "", donneesRetrait()), e = r.effets, f = r.fiches, aesh = ar.type === "aesh";
    if (!f.length) return { r: r, html: '<p class="note alerte">' + (aesh ? "Ces AESH sont déjà archivées." : "Ces élèves sont déjà archivés.") + '</p>' };
    var creneaux = e.supprimees.length + e.modifiees.length, h = '<p><strong>' + ech(listeNoms(ar.type, f)) + '</strong> '
      + (f.length > 1 ? (aesh ? "seront archivées." : "seront archivés.") : (aesh ? "sera archivée." : "sera archivé.")) + '</p><ul class="liste-motifs">'
      + '<li>' + (f.length > 1 ? (aesh ? "Elles sortent" : "Ils sortent") : (aesh ? "Elle sort" : "Il sort")) + ' des listes actives, du calcul des affectations et des menus de créneau.</li>'
      + '<li>' + (creneaux ? pluriel(creneaux, "créneau du brouillon retiré", "créneaux du brouillon retirés")
        + (e.mutualisees ? ", dont " + pluriel(e.mutualisees, "groupe mutualisé quitté", "groupes mutualisés quittés") + " (le créneau reste pour les autres élèves)" : "")
        + (aesh ? " : les élèves concernés redeviennent à couvrir." : ".") : "Aucun créneau du brouillon à retirer.") + '</li>'
      + (!aesh && e.cours ? '<li>' + pluriel(e.cours, "cours conservé", "cours conservés") + ' (ils reviennent avec le rétablissement).</li>' : "")
      + (e.versions.length ? '<li>Versions validées inchangées (' + e.versions.join(", ") + ').</li>' : "")
      + '</ul><p class="aide">Une seule action, annulable.</p>';
    return { r: r, html: h };
  }
  function ouvrirArchivage(type, ids) {
    ar.type = type; ar.ids = ids.slice(); ar.retour = document.activeElement;
    var s = resumeArchivage();
    $("ar-titre").textContent = type === "aesh" ? "Archiver cette AESH" : (ids.length > 1 ? "Archiver ces élèves" : "Archiver cet élève");
    $("ar-resume").innerHTML = s.html;
    $("ar-date").value = A.aujourdhui(); $("ar-date").max = A.aujourdhui();
    $("ar-motif").value = "";
    $("ar-erreur").hidden = true;
    $("ar-confirmer").disabled = !s.r.fiches.length;
    $("voile-archiver").hidden = false;
    $("ar-date").focus();
  }
  function fermerArchivage() {
    $("voile-archiver").hidden = true;
    if (ar.retour && ar.retour.focus) ar.retour.focus();
  }
  function confirmerArchivage() {
    var date = $("ar-date").value;
    if (!M.dateArchivageValide(date, A.aujourdhui())) {
      $("ar-erreur").textContent = "La date d'archivage doit être celle d'aujourd'hui ou une date passée.";
      $("ar-erreur").hidden = false;
      return;
    }
    var r = M.operationsArchivage(ar.type, ar.ids, date, $("ar-motif").value, donneesRetrait());
    if (!r.fiches.length) { fermerArchivage(); return; }
    var nom = r.fiches.length > 1 ? pluriel(r.fiches.length, ar.type === "aesh" ? "AESH" : "élève", ar.type === "aesh" ? "AESH" : "élèves") : nomFiche(ar.type, r.fiches[0]);
    fermerArchivage();
    A.enregistrerPuisRendre(r.ops, nom + (r.fiches.length > 1 ? " : archivage fait." : (ar.type === "aesh" ? " archivée." : " archivé(e).")), "l'archivage de " + nom);
  }
  function retablir(type, ids) {
    var r = M.operationsRetablissement(type, ids, donneesRetrait());
    if (!r.fiches.length) return;
    var nom = r.fiches.length > 1 ? r.fiches.length + " fiches" : nomFiche(type, r.fiches[0]);
    A.enregistrerPuisRendre(r.ops, nom + " rétabli(e). Les créneaux retirés à l'archivage ne sont pas remis : annulez tout de suite pour les retrouver.", "le rétablissement de " + nom);
  }
  function supprimerDefinitivement(type, ids) {
    var r = M.operationsSuppression(type, ids, donneesRetrait()), e = r.effets, aesh = type === "aesh";
    if (!r.fiches.length) return;
    var creneaux = e.supprimees.length + e.modifiees.length, parties = [];
    if (!aesh) parties.push(pluriel(e.cours, "cours", "cours"));
    parties.push(pluriel(creneaux, "créneau du brouillon", "créneaux du brouillon") + (e.mutualisees ? " (dont " + pluriel(e.mutualisees, "groupe mutualisé quitté", "groupes mutualisés quittés") + ")" : ""));
    if (!aesh && e.exclusions) parties.push(pluriel(e.exclusions, "mention dans une liste « ne pas affecter »", "mentions dans des listes « ne pas affecter »"));
    var msg = "Supprimer définitivement " + listeNoms(type, r.fiches) + " ? Sont supprimés : la fiche, " + parties.join(", ") + ". "
      + (e.versions.length ? "Les versions validées " + e.versions.join(", ") + " gardent ses créneaux et restent lisibles. " : "")
      + "Les rapports déjà reçus ne sont pas touchés. Cette action est irréversible, et l'historique d'annulation est effacé : exportez une sauvegarde si vous hésitez.";
    A.ui().confirmationForte(msg, "Supprimer définitivement", function () {
      A.enregistrerPuisRendre(r.ops, r.fiches.length > 1 ? r.fiches.length + " fiches supprimées définitivement." : nomFiche(type, r.fiches[0]) + " supprimé(e) définitivement.").then(function () { A.viderAnnulation(); });
    }, { libelle: "Exporter une sauvegarde", cb: A.ui().exporterSauvegarde });
  }
  $("pe-archiver").addEventListener("click", function () { if (pe.ouvert) ouvrirArchivage("eleves", [pe.ouvert]); });
  $("pe-retablir").addEventListener("click", function () { if (pe.ouvert) retablir("eleves", [pe.ouvert]); });
  $("pe-supprimer").addEventListener("click", function () { if (pe.ouvert) supprimerDefinitivement("eleves", [pe.ouvert]); });
  $("pa-archiver").addEventListener("click", function () { if (pa.ouvert) ouvrirArchivage("aesh", [pa.ouvert]); });
  $("pa-retablir").addEventListener("click", function () { if (pa.ouvert) retablir("aesh", [pa.ouvert]); });
  $("pa-supprimer").addEventListener("click", function () { if (pa.ouvert) supprimerDefinitivement("aesh", [pa.ouvert]); });
  $("ar-confirmer").addEventListener("click", confirmerArchivage);
  $("ar-annuler").addEventListener("click", fermerArchivage);
  $("voile-archiver").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { ev.preventDefault(); fermerArchivage(); }
    if (ev.key === "Enter" && ev.target.tagName === "INPUT") { ev.preventDefault(); confirmerArchivage(); }
  });

  /* =============== sélection et actions groupées (§17) =============== */
  var sel = { eleves: {}, aesh: {} }, derniereCase = { eleves: null, aesh: null };
  var BARRES = { eleves: "pe", aesh: "pa" };
  function idsSel(type) { return Object.keys(sel[type]); }
  function majSelection(type, table) {
    var p = BARRES[type], cases = table.querySelectorAll("input[data-sel]"), n = idsSel(type).length, tout = $(p + "-tout"), coches = 0;
    Array.prototype.forEach.call(cases, function (c) { if (c.checked) coches++; });
    if (tout) { tout.checked = cases.length > 0 && coches === cases.length; tout.indeterminate = coches > 0 && coches < cases.length; }
    $(p + "-groupe").hidden = !n;
    $(p + "-groupe-n").textContent = n + (type === "aesh" ? (n > 1 ? " AESH sélectionnées" : " AESH sélectionnée") : (n > 1 ? " élèves sélectionnés" : " élève sélectionné"));
  }
  // retire de la sélection les lignes qui ne sont plus affichées (aucune action sur des fiches cachées)
  function nettoyerSelection(type, visibles) {
    var v = {};
    visibles.forEach(function (id) { v[id] = true; });
    Object.keys(sel[type]).forEach(function (id) { if (!v[id]) delete sel[type][id]; });
  }
  function caseTete(type) {
    return '<th class="col-case"><label class="case-ligne"><input type="checkbox" id="' + BARRES[type] + '-tout" aria-label="Sélectionner toute la liste affichée"></label></th>';
  }
  function caseLigne(type, id, libelle) {
    return '<td class="col-case"><label class="case-ligne"><input type="checkbox" data-sel="' + ech(id) + '"' + (sel[type][id] ? " checked" : "") + ' aria-label="Sélectionner ' + ech(libelle) + '"></label></td>';
  }
  function brancherSelection(type, table) {
    var cases = table.querySelectorAll("input[data-sel]");
    chaque(table, "td.col-case, th.col-case", function (c) { c.addEventListener("click", function (ev) { ev.stopPropagation(); }); });
    Array.prototype.forEach.call(cases, function (c, i) {
      c.addEventListener("click", function (ev) {
        var debut = ev.shiftKey && derniereCase[type] !== null && derniereCase[type] < cases.length ? Math.min(derniereCase[type], i) : i,
          fin = ev.shiftKey && derniereCase[type] !== null && derniereCase[type] < cases.length ? Math.max(derniereCase[type], i) : i;
        for (var k = debut; k <= fin; k++) {
          cases[k].checked = c.checked;
          if (c.checked) sel[type][cases[k].dataset.sel] = true; else delete sel[type][cases[k].dataset.sel];
        }
        derniereCase[type] = i;
        majSelection(type, table);
      });
    });
    var tout = $(BARRES[type] + "-tout");
    tout.addEventListener("click", function () {
      Array.prototype.forEach.call(cases, function (c) {
        c.checked = tout.checked;
        if (tout.checked) sel[type][c.dataset.sel] = true; else delete sel[type][c.dataset.sel];
      });
      majSelection(type, table);
    });
    majSelection(type, table);
  }
  function basculerLigne(table) {
    return function (id) {
      var tr = table.querySelector('tr[data-eleve="' + id.replace(/"/g, '\\"') + '"], tr[data-aesh="' + id.replace(/"/g, '\\"') + '"]'), c = tr && tr.querySelector("input[data-sel]");
      if (c) c.click();
    };
  }

  var gr = { type: null, action: null, retour: null, calcul: null };
  var TITRES_GROUPE = { classe: "Changer de classe", etab: "Changer d'établissement", matiere: "État d'une matière", "etab-ajout": "Ajouter un établissement possible",
    "etab-retrait": "Retirer un établissement possible", spec: "Ajouter une spécialité" };
  function fichesActivesSel(type) { return fichesDe(type, idsSel(type)).filter(function (f) { return !M.estArchive(f); }); }
  function optionsEtabs(valeurNouveau) {
    return etablissementsTries().map(function (e) { return '<option value="' + ech(e.id) + '">' + ech(e.nom) + '</option>'; }).join("")
      + (valeurNouveau ? '<option value="' + NOUVEAU + '">Nouvel établissement…</option>' : "");
  }
  function classesProposees(fiches) {
    var ref = referentiel(), vues = {}, out = [];
    fiches.forEach(function (e) { (ref[e.etablissement] || []).forEach(function (c) { if (!vues[M.normaliser(c)]) { vues[M.normaliser(c)] = true; out.push(c); } }); });
    return out.sort(M.comparerClasses);
  }
  function matieresSel(fiches) {
    var par = {}, ordre = [];
    fiches.forEach(function (e) {
      M.matieresEleve(e, etat.cours).forEach(function (m) {
        if (!par[m.cle]) { par[m.cle] = { cle: m.cle, libelle: m.libelle, eleves: 0 }; ordre.push(m.cle); }
        par[m.cle].eleves++;
      });
    });
    return ordre.map(function (k) { return par[k]; }).sort(function (a, b) { return a.libelle.localeCompare(b.libelle, "fr"); });
  }
  function champsGroupe(action, fiches) {
    var champClasse = function (libelle, aide) {
      return '<div class="champ"><label for="gr-classe">' + libelle + '</label><input type="text" id="gr-classe" list="gr-classes-liste" maxlength="30" autocomplete="off"' + (aide ? ' aria-describedby="gr-classe-aide"' : "") + '>'
        + '<datalist id="gr-classes-liste">' + classesProposees(fiches).map(function (c) { return '<option value="' + ech(c) + '">'; }).join("") + '</datalist>'
        + (aide ? '<p class="aide" id="gr-classe-aide" style="margin:4px 0 0">' + aide + '</p>' : "") + '</div>';
    };
    if (action === "classe") return champClasse("Nouvelle classe", "Chaque élève reste dans son établissement.");
    if (action === "etab") return '<div class="champ"><label for="gr-etab">Nouvel établissement</label><select id="gr-etab"><option value="">Choisir…</option>' + optionsEtabs(true) + '</select></div>'
      + '<div class="champ" id="gr-etab-autre-champ" hidden><label for="gr-etab-autre">Nom du nouvel établissement</label><input type="text" id="gr-etab-autre" autocomplete="off"></div>'
      + champClasse("Classe dans le nouvel établissement", "Laissez vide pour garder la classe actuelle.");
    if (action === "matiere") {
      var ms = matieresSel(fiches);
      return '<div class="champ"><label for="gr-matiere">Matière</label><select id="gr-matiere">' + (ms.length ? ms.map(function (m) { return '<option value="' + ech(m.cle) + '">' + ech(m.libelle) + ' (' + pluriel(m.eleves, "élève") + ')</option>'; }).join("") : '<option value="">Aucun cours importé</option>') + '</select></div>'
        + '<div class="champ"><label for="gr-etat">État</label><select id="gr-etat"><option value="exclu">Exclu</option><option value="prioritaire">Prioritaire</option><option value="normal">Normal</option></select></div>';
    }
    if (action === "etab-ajout" || action === "etab-retrait") return '<div class="champ"><label for="gr-etab">Établissement</label><select id="gr-etab"><option value="">Choisir…</option>' + optionsEtabs(false) + '</select></div>';
    if (action === "spec") return '<div class="champ"><label for="gr-spec">Spécialité</label><input type="text" id="gr-spec" list="gr-spec-liste" maxlength="60" autocomplete="off">'
      + '<datalist id="gr-spec-liste">' + (A.contexte().reglages.specialites || []).map(function (s) { return '<option value="' + ech(s.nom) + '">'; }).join("") + '</datalist></div>';
    return "";
  }
  // classes ajoutées au référentiel : {etablissement: [classe]} des fiches déplacées
  function paramsClasses(fiches) {
    var table = etat.classes, change = false;
    fiches.forEach(function (e) {
      if (!(referentiel()[e.etablissement] || []).some(function (c) { return M.memeClasse(c, e.classe); })) { table = M.classesAvecAjout(table, A.anneeCourante(), e.etablissement, e.classe); change = true; }
    });
    return change ? [{ magasin: "parametres", enregistrer: [tableClasses(table)] }] : [];
  }
  /* calcul de l'action : {ops, lignes (html), erreurs, message, libelle} ; sans ops, rien n'est à faire */
  function calculGroupe() {
    var type = gr.type, action = gr.action, fiches = fichesActivesSel(type), ids = fiches.map(function (f) { return f.id; });
    var r = { ops: [], lignes: [], erreurs: [], message: "", libelle: "" };
    var n = fiches.length;
    function inchanges(k) { if (k) r.lignes.push(pluriel(k, "fiche déjà dans cet état, inchangée", "fiches déjà dans cet état, inchangées") + "."); }
    if (action === "classe") {
      var classe = M.classeNette($("gr-classe").value);
      if (!classe) return r;
      var d = M.deplacerEleves(etat.elevesTous, etat.coursTous, ids, { classe: classe });
      if (d.collisions.length) r.erreurs.push(pluriel(d.collisions.length, "élève porterait", "élèves porteraient") + " le même nom court qu'un élève déjà en " + classe + " ou qu'un autre élève de la sélection ("
        + d.collisions.slice(0, 4).map(function (c) { return c.eleve.nomCourt; }).join(", ") + (d.collisions.length > 4 ? "…" : "") + "). Rien n'est écrit : écrivez une abréviation terminée par un point dans l'une des fiches, ou retirez ces élèves de la sélection.");
      r.lignes.push(pluriel(d.eleves.length, "élève passe", "élèves passent") + " en " + ech(classe) + ".");
      if (d.cours.length) r.lignes.push(pluriel(d.cours.length, "cours suit", "cours suivent") + " leur classe.");
      inchanges(d.inchanges);
      if (!d.eleves.length) return r;
      r.ops = [{ magasin: "eleves", enregistrer: d.eleves }];
      if (d.cours.length) r.ops.push({ magasin: "cours", enregistrer: d.cours });
      r.ops = r.ops.concat(paramsClasses(d.eleves));
      r.message = pluriel(d.eleves.length, "élève passe", "élèves passent") + " en " + classe + ".";
      r.libelle = "le passage de " + pluriel(d.eleves.length, "élève", "élèves") + " en " + classe;
    } else if (action === "etab") {
      var choix = $("gr-etab").value, nouveau = choix === NOUVEAU, nom = nouveau ? $("gr-etab-autre").value.replace(/\s+/g, " ").trim() : (choix ? A.nomEtablissement(choix) : "");
      if (!nom) return r;
      var etabId = nouveau ? M.idEtablissement(nom) : choix, ch = { etablissement: etabId, etablissementNom: nom }, nvClasse = M.classeNette($("gr-classe").value);
      if (nvClasse) ch.classe = nvClasse;
      var dp = M.deplacerEleves(etat.elevesTous, etat.coursTous, ids, ch);
      if (dp.collisions.length) r.erreurs.push(pluriel(dp.collisions.length, "élève porterait", "élèves porteraient") + " le même nom court qu'un élève déjà dans " + nom + " ("
        + dp.collisions.slice(0, 4).map(function (c) { return c.eleve.nomCourt + " en " + c.eleve.classe; }).join(", ") + (dp.collisions.length > 4 ? "…" : "") + "). Rien n'est écrit : précisez une autre classe, ou retirez ces élèves de la sélection.");
      r.lignes.push(pluriel(dp.eleves.length, "élève passe", "élèves passent") + " dans " + ech(nom) + (nvClasse ? ", classe " + ech(nvClasse) : ", classe conservée") + ".");
      if (nouveau && !A.etablissementParId(etabId)) r.lignes.push("L'établissement sera créé avec ses paramètres par défaut (vérifiez ses horaires dans Réglages).");
      if (dp.cours.length) r.lignes.push(pluriel(dp.cours.length, "cours suit", "cours suivent") + " : " + (dp.cours.length > 1 ? "leurs horaires restent ceux" : "son horaire reste celui") + " de l'ancien établissement jusqu'à un nouvel import des emplois du temps.");
      inchanges(dp.inchanges);
      if (!dp.eleves.length) return r;
      var partis = dp.eleves.filter(function (e) { return A.eleveParId(e.id).etablissement !== e.etablissement; }).map(function (e) { return e.id; });
      var eff = M.effetsRetrait("eleves", partis, donneesRetrait());
      if (eff.supprimees.length || eff.modifiees.length) r.lignes.push(pluriel(eff.supprimees.length + eff.modifiees.length, "créneau du brouillon retiré", "créneaux du brouillon retirés")
        + (eff.mutualisees ? ", dont " + pluriel(eff.mutualisees, "groupe mutualisé quitté", "groupes mutualisés quittés") : "") + " (ils appartenaient à l'ancien établissement).");
      if (eff.versions.length) r.lignes.push("Versions validées inchangées (" + eff.versions.join(", ") + ").");
      if (nouveau && !A.etablissementParId(etabId)) r.ops.push({ magasin: "etablissements", enregistrer: [M.etablissementParDefaut(nom)] });
      r.ops.push({ magasin: "eleves", enregistrer: dp.eleves });
      if (dp.cours.length) r.ops.push({ magasin: "cours", enregistrer: dp.cours });
      if (eff.supprimees.length || eff.modifiees.length) r.ops.push({ magasin: "affectations", supprimer: eff.supprimees, enregistrer: eff.modifiees });
      r.ops = r.ops.concat(paramsClasses(dp.eleves));
      r.message = pluriel(dp.eleves.length, "élève passe", "élèves passent") + " dans " + nom + ".";
      r.libelle = "le passage de " + pluriel(dp.eleves.length, "élève", "élèves") + " dans " + nom;
    } else if (action === "matiere") {
      var cle = $("gr-matiere").value, etatM = $("gr-etat").value;
      if (!cle) return r;
      var libM = (matieresSel(fiches).filter(function (m) { return m.cle === cle; })[0] || { libelle: cle }).libelle;
      var em = M.etatMatiereGroupe(etat.elevesTous, etat.cours, ids, cle, etatM);
      r.lignes.push(ech(libM) + " : « " + etatM + " » pour " + pluriel(em.eleves.length, "élève", "élèves") + ", " + pluriel(em.cours.length, "créneau modifié", "créneaux modifiés") + ".");
      if (em.sansCours) r.lignes.push(pluriel(em.sansCours, "élève n'a", "élèves n'ont") + " aucun cours dans cette matière : l'état sera appliqué à leurs cours importés plus tard.");
      if (!em.eleves.length && !em.cours.length) { r.lignes.push("Rien à modifier."); return r; }
      if (em.eleves.length) r.ops.push({ magasin: "eleves", enregistrer: em.eleves });
      if (em.cours.length) r.ops.push({ magasin: "cours", enregistrer: em.cours });
      r.message = libM + " : " + etatM + " pour " + pluriel(em.eleves.length, "élève", "élèves") + ".";
      r.libelle = "l'état de la matière " + libM + " pour " + pluriel(n, "élève", "élèves");
    } else if (action === "etab-ajout" || action === "etab-retrait") {
      var eid = $("gr-etab").value;
      if (!eid) return r;
      var ajout = action === "etab-ajout", ae = M.aeshEtablissement(etat.aeshTous, ids, eid, ajout, etat.etablissements.map(function (e) { return e.id; }));
      if (ae.bloquees.length) r.erreurs.push(ae.bloquees.map(A.nomAesh).join(", ") + (ae.bloquees.length > 1 ? " n'ont" : " n'a") + " que cet établissement possible : le retirer la rendrait inutilisable. Retirez-" + (ae.bloquees.length > 1 ? "les" : "la") + " de la sélection.");
      if (ae.fiches.length) r.lignes.push(pluriel(ae.fiches.length, "AESH modifiée", "AESH modifiées") + " : " + (ajout ? "ajout de " : "retrait de ") + ech(A.nomEtablissement(eid)) + ".");
      if (!ajout && ae.fiches.some(function (a) { return !(etat.aeshTous.filter(function (x) { return x.id === a.id; })[0].etablissements || []).length; })) r.lignes.push("Une AESH sans restriction est limitée à tous les autres établissements.");
      if (ajout && ae.inchanges) r.lignes.push(pluriel(ae.inchanges, "AESH l'a déjà ou n'a aucune restriction", "AESH l'ont déjà ou n'ont aucune restriction") + " : inchangée(s).");
      else inchanges(ae.inchanges);
      if (!ae.fiches.length) return r;
      r.ops = [{ magasin: "aesh", enregistrer: ae.fiches }];
      r.message = pluriel(ae.fiches.length, "AESH modifiée", "AESH modifiées") + ".";
      r.libelle = (ajout ? "l'ajout" : "le retrait") + " d'un établissement possible pour " + pluriel(ae.fiches.length, "AESH", "AESH");
    } else if (action === "spec") {
      var sp = M.classeNette($("gr-spec").value);
      if (!sp) return r;
      var as = M.aeshSpecialite(etat.aeshTous, ids, sp);
      if (as.fiches.length) r.lignes.push(pluriel(as.fiches.length, "AESH reçoit", "AESH reçoivent") + " la spécialité « " + ech(sp) + " ».");
      inchanges(as.inchanges);
      if (!as.fiches.length) return r;
      r.ops = [{ magasin: "aesh", enregistrer: as.fiches }];
      r.message = "Spécialité « " + sp + " » ajoutée à " + pluriel(as.fiches.length, "AESH", "AESH") + ".";
      r.libelle = "l'ajout de la spécialité " + sp + " à " + pluriel(as.fiches.length, "AESH", "AESH");
    }
    return r;
  }
  function majGroupe() {
    var r = gr.calcul = calculGroupe();
    $("gr-apercu").innerHTML = r.lignes.length ? '<ul class="liste-motifs">' + r.lignes.map(function (l) { return "<li>" + l + "</li>"; }).join("") + "</ul>" : '<p class="aide">Renseignez le champ ci-dessus pour voir ce qui changera.</p>';
    $("gr-erreurs").innerHTML = r.erreurs.length ? '<ul class="liste-motifs">' + r.erreurs.map(function (m) { return "<li>" + ech(m) + "</li>"; }).join("") + "</ul>" : "";
    $("gr-erreurs").hidden = !r.erreurs.length;
    $("gr-appliquer").disabled = !r.ops.length || !!r.erreurs.length;
  }
  function ouvrirGroupe(type, action) {
    var tous = fichesDe(type, idsSel(type)), fiches = tous.filter(function (f) { return !M.estArchive(f); });
    if (!fiches.length) { A.ui().toast("La sélection ne contient que des fiches archivées."); return; }
    gr.type = type; gr.action = action; gr.retour = document.activeElement;
    $("gr-titre").textContent = TITRES_GROUPE[action];
    $("gr-cible").textContent = pluriel(fiches.length, type === "aesh" ? "AESH concernée" : "élève concerné", type === "aesh" ? "AESH concernées" : "élèves concernés")
      + (tous.length > fiches.length ? " (" + pluriel(tous.length - fiches.length, type === "aesh" ? "archivée ignorée" : "archivé ignoré", type === "aesh" ? "archivées ignorées" : "archivés ignorés") + ")" : "") + " : " + listeNoms(type, fiches) + ".";
    $("gr-champs").innerHTML = champsGroupe(action, fiches);
    majGroupe();
    $("voile-groupe").hidden = false;
    var premier = $("gr-champs").querySelector("input, select"); if (premier) premier.focus();
  }
  function fermerGroupe() {
    $("voile-groupe").hidden = true;
    if (gr.retour && gr.retour.focus) gr.retour.focus();
  }
  function appliquerGroupe() {
    majGroupe();
    var r = gr.calcul;
    if (!r.ops.length || r.erreurs.length) { if (r.erreurs.length) $("gr-erreurs").focus(); return; }
    fermerGroupe();
    A.enregistrerPuisRendre(r.ops, r.message, r.libelle);
  }
  $("voile-groupe").addEventListener("input", majGroupe);
  $("voile-groupe").addEventListener("change", function (ev) {
    if (ev.target.id === "gr-etab" && gr.action === "etab") { $("gr-etab-autre-champ").hidden = ev.target.value !== NOUVEAU; if (ev.target.value === NOUVEAU) $("gr-etab-autre").focus(); }
    majGroupe();
  });
  $("gr-appliquer").addEventListener("click", appliquerGroupe);
  $("gr-annuler").addEventListener("click", fermerGroupe);
  $("voile-groupe").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { ev.preventDefault(); fermerGroupe(); }
    if (ev.key === "Enter" && ev.target.tagName === "INPUT") { ev.preventDefault(); appliquerGroupe(); }
  });
  ["eleves", "aesh"].forEach(function (type) {
    chaque($(BARRES[type] + "-groupe"), "[data-groupe]", function (b) {
      b.addEventListener("click", function () {
        var a = this.dataset.groupe;
        if (a === "aucune") { sel[type] = {}; derniereCase[type] = null; if (type === "eleves") rendreEleves(); else rendreAesh(); return; }
        if (a === "archiver") { ouvrirArchivage(type, idsSel(type)); return; }
        ouvrirGroupe(type, a);
      });
    });
  });

  /* =============== export CSV (§17) =============== */
  // au format des gabarits d'import (UTF-8 avec BOM, « ; ») : la sélection si elle existe, sinon la liste affichée (filtres compris)
  function exporter(type) {
    var eleves = type === "eleves", choisis = idsSel(type), fiches;
    if (choisis.length) fiches = fichesDe(type, choisis);
    else fiches = (eleves ? filtresEleves().map(function (l) { return l.e; }) : filtresAesh().map(function (l) { return l.a; }));
    if (!fiches.length) { A.ui().toast("Rien à exporter : la liste est vide."); return; }
    var etabs = {};
    etat.etablissements.forEach(function (e) { etabs[e.id] = e.nom; });
    var csv = I.exporterCSV(type, fiches, { etablissements: etabs, gererPeriscolaire: periGere() });
    A.ui().telecharger(I.TYPES[type].fichier, csv, "text/csv");
    A.ui().toast(pluriel(fiches.length, eleves ? "élève exporté" : "AESH exportée", eleves ? "élèves exportés" : "AESH exportées") + " dans " + I.TYPES[type].fichier + (choisis.length ? " (sélection)." : " (liste affichée)."));
  }
  $("pe-exporter").addEventListener("click", function () { exporter("eleves"); });
  $("pa-exporter").addEventListener("click", function () { exporter("aesh"); });

  /* =============== ouverture, redessin =============== */
  function ouvrir(type) {
    if (type === "eleves") { remplirFiltresEleves(); rendreEleves(); }
    if (type === "aesh") { remplirFiltresAesh(); rendreAesh(); }
    if (type === "reglages") rendreClasses();
  }
  A.surRendu(function () {
    if (!$("vue-eleves").classList.contains("masque")) { remplirFiltresEleves(); rendreEleves(); }
    if (!$("vue-aesh").classList.contains("masque")) { remplirFiltresAesh(); rendreAesh(); }
    if (!$("vue-reglages").classList.contains("masque")) rendreClasses();
  });

  return { ouvrir: ouvrir, ouvrirIdentite: ouvrirIdentite };
})();
