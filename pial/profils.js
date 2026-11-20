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
  function referentiel() { return M.referentielClasses({}, etat.eleves, etat.cours); }
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
  function brancherLignes(corps, attr, ouvrir) {
    chaque(corps, "tr[" + attr + "]", function (tr) {
      tr.addEventListener("click", function () { ouvrir(tr.getAttribute(attr)); });
      tr.addEventListener("keydown", function (ev) {
        if (ev.target !== tr) return;
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ouvrir(tr.getAttribute(attr)); }
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
    var ctx = A.contexte(), etab = $("pe-etab").value, classe = $("pe-classe").value, niveau = $("pe-niveau").value,
      modalite = $("pe-modalite").value, couv = $("pe-couverture").value, mots = M.normaliser($("pe-recherche").value).split(" ").filter(Boolean);
    var lignes = etat.eleves.map(function (e) { return { e: e, cv: M.couvertureEleve(e, ctx) }; }).filter(function (l) {
      var e = l.e;
      if (etab && e.etablissement !== etab) return false;
      if (classe && M.normaliser(e.classe) !== M.normaliser(classe)) return false;
      if (niveau && M.niveauClasse(e.classe) !== niveau) return false;
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
    etat.eleves.forEach(function (e) { if (!etab || e.etablissement === etab) niveaux[M.niveauClasse(e.classe)] = true; });
    remplirSelect($("pe-classe"), classes.map(function (c) { return { valeur: c, libelle: c }; }), "Toutes");
    remplirSelect($("pe-niveau"), M.NIVEAUX.filter(function (n) { return niveaux[n]; }).map(function (n) { return { valeur: n, libelle: n }; }), "Tous");
  }
  function finNotif(e) {
    if (!e.finNotif) return '<span class="aide">—</span>';
    var j = joursAvant(e.finNotif);
    return dateFr(e.finNotif) + (j < 0 ? ' <span class="badge badge-difficile">échue</span>' : (j <= 30 ? ' <span class="badge badge-construction">dans ' + pluriel(j, "jour") + '</span>' : ""));
  }
  function rendreEleves() {
    if ($("vue-eleves").classList.contains("masque")) return;
    majAnnuler("pe-annuler");
    var focus = document.activeElement, focusLigne = focus && focus.closest && focus.closest("#pe-table") && focus.getAttribute("data-eleve");
    var lignes = filtresEleves(), ctx = A.contexte();
    $("pe-compte").textContent = etat.eleves.length ? (lignes.length === etat.eleves.length ? pluriel(etat.eleves.length, "élève") : lignes.length + " sur " + etat.eleves.length) + " · année " + A.anneeCourante() : "";
    var h = '<thead><tr>' + COLONNES_ELEVES.map(function (c) { return teteTriable(c, pe.tri); }).join("") + '</tr></thead><tbody>';
    if (!lignes.length) {
      h += '<tr><td colspan="' + COLONNES_ELEVES.length + '" class="vide">' + (etat.eleves.length ? "Aucun élève ne correspond à ces critères."
        : "Aucun élève pour l'année " + ech(A.anneeCourante()) + ". Ajoutez-en un avec « + Nouvel élève », ou importez le fichier des élèves (onglet Importer).") + '</td></tr>';
    }
    lignes.forEach(function (l) {
      var e = l.e, cv = l.cv;
      h += '<tr data-eleve="' + ech(e.id) + '" tabindex="0"' + (pe.ouvert === e.id ? ' class="actif" aria-selected="true"' : "") + '>'
        + '<td><strong>' + ech(e.nomCourt) + '</strong></td><td>' + ech(e.classe) + '</td>'
        + '<td class="col-secondaire">' + ech(A.nomEtablissement(e.etablissement)) + '</td>'
        + '<td class="col-secondaire">' + [e.heuresInd ? heures(e.heuresInd) + " ind." : "", e.heuresMut ? heures(e.heuresMut) + " mut." : ""].filter(Boolean).join(" · ") + '</td>'
        + '<td class="col-jauges"><span class="pastille-etat e-' + cv.etat + '">' + A.LIB_ETAT_ELEVE[cv.etat] + '</span>' + A.jaugesEleve(e, cv) + '</td>'
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
    brancherLignes($("pe-table"), "data-eleve", ouvrirEleve);
    if (focusLigne) { var tr = $("pe-table").querySelector('tr[data-eleve="' + focusLigne.replace(/"/g, '\\"') + '"]'); if (tr) tr.focus(); }
    rendrePanneauEleve(ctx);
  }
  function rendrePanneauEleve(ctx) {
    var e = pe.ouvert && A.eleveParId(pe.ouvert);
    $("pe-disposition").classList.toggle("avec-fiche", !!e);
    $("pe-panneau").hidden = !e;
    if (!e) { pe.ouvert = null; $("pe-fiche").innerHTML = ""; return; }
    var cv = M.couvertureEleve(e, ctx);
    $("pe-titre").textContent = e.nomCourt + " — " + e.classe;
    $("pe-sous-titre").textContent = A.nomEtablissement(e.etablissement)
      + (e.finNotif ? " · fin de notification le " + dateFr(e.finNotif) : "");
    $("pe-jauges").innerHTML = '<span class="pastille-etat e-' + cv.etat + '">' + A.LIB_ETAT_ELEVE[cv.etat] + '</span>' + A.jaugesEleve(e, cv);
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

  ["pe-etab", "pe-classe", "pe-niveau", "pe-modalite", "pe-couverture"].forEach(function (id) {
    $(id).addEventListener("change", function () { if (id === "pe-etab") remplirFiltresEleves(); rendreEleves(); });
  });
  $("pe-recherche").addEventListener("input", rendreEleves);
  $("pe-reinitialiser").addEventListener("click", function () {
    ["pe-recherche", "pe-etab", "pe-classe", "pe-niveau", "pe-modalite", "pe-couverture"].forEach(function (id) { $(id).value = ""; });
    remplirFiltresEleves(); rendreEleves();
  });
  $("pe-annuler").addEventListener("click", function () { A.annuler(); });
  $("pe-fermer").addEventListener("click", fermerEleve);
  $("pe-edt").addEventListener("click", function () { if (pe.ouvert) A.voirGrilleEleve(pe.ouvert); });
  $("pe-panneau").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) { ev.preventDefault(); fermerEleve(); }
  });

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
        collision = M.collisionEleve(etat.eleves, { annee: A.anneeCourante(), cle: M.cleEleve(nc, v.classe, l.etabId) });
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
    var objet = M.attribuerIdentifiants("eleves", [r.objet], etat.eleves)[0], ops = [];
    if (r.nouvelEtab && !A.etablissementParId(M.idEtablissement(r.nouvelEtab))) ops.push({ magasin: "etablissements", enregistrer: [M.etablissementParDefaut(r.nouvelEtab)] });
    ops.push({ magasin: "eleves", enregistrer: [objet] });
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

  /* =============== ouverture, redessin =============== */
  function ouvrir(type) {
    if (type === "eleves") { remplirFiltresEleves(); rendreEleves(); }
  }
  A.surRendu(function () {
    if (!$("vue-eleves").classList.contains("masque")) { remplirFiltresEleves(); rendreEleves(); }
  });

  return { ouvrir: ouvrir };
})();
