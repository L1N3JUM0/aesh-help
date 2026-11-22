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
  function referentiel() { return M.referentielClasses(M.classesEnregistrees(etat.classes, A.anneeCourante()), etat.eleves, etat.cours); }
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
    var lignes = etat.aesh.map(function (a) { return { a: a, ch: M.chargeAesh(a, ctx), n: elevesDeAesh(a) }; }).filter(function (l) {
      var a = l.a;
      if (etab === "__tous" && (a.etablissements || []).length) return false;
      if (etab && etab !== "__tous" && (a.etablissements || []).length && a.etablissements.indexOf(etab) < 0) return false;
      if (spec && !(a.formations || []).some(function (f) { return M.normaliser(f) === M.normaliser(spec); })) return false;
      if (charge && l.ch.etat !== charge) return false;
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
    etat.aesh.forEach(function (a) { (a.formations || []).forEach(function (f) { if (!specs.some(function (s) { return M.normaliser(s) === M.normaliser(f); })) specs.push(f); }); });
    remplirSelect($("pa-spec"), specs.map(function (s) { return { valeur: s, libelle: s }; }), "Toutes");
  }
  function rendreAesh() {
    if ($("vue-aesh").classList.contains("masque")) return;
    majAnnuler("pa-annuler");
    var focus = document.activeElement, focusLigne = focus && focus.closest && focus.closest("#pa-table") && focus.getAttribute("data-aesh");
    var lignes = filtresAesh(), ctx = A.contexte();
    $("pa-compte").textContent = etat.aesh.length ? (lignes.length === etat.aesh.length ? pluriel(etat.aesh.length, "AESH", "AESH") : lignes.length + " sur " + etat.aesh.length) : "";
    var h = '<thead><tr>' + COLONNES_AESH.map(function (c) { return teteTriable(c, pa.tri); }).join("") + '</tr></thead><tbody>';
    if (!lignes.length) {
      h += '<tr><td colspan="' + COLONNES_AESH.length + '" class="vide">' + (etat.aesh.length ? "Aucune AESH ne correspond à ces critères."
        : "Aucune AESH. Ajoutez-en une avec « + Nouvelle AESH », ou importez le fichier des AESH (onglet Importer).") + '</td></tr>';
    }
    lignes.forEach(function (l) {
      var a = l.a, ch = l.ch;
      var titre = A.LIB_ETAT_AESH[ch.etat] + (ch.A !== ch.B ? " — semaine A : " + heures(ch.A) + ", semaine B : " + heures(ch.B) : "");
      h += '<tr data-aesh="' + ech(a.id) + '" tabindex="0"' + (pa.ouvert === a.id ? ' class="actif" aria-selected="true"' : "") + '>'
        + '<td><span class="puce-aesh" style="background:' + A.couleurAesh(a.id) + '">' + ech(A.initialesAesh(a)) + '</span> <strong>' + ech(A.nomAesh(a)) + '</strong>'
        + (a.ignorerIndispos ? ' <span class="badge-ignore" title="Indisponibilités et établissements possibles ignorés">indispos ignorées</span>' : "") + '</td>'
        + '<td class="col-secondaire col-texte">' + ech(nomsEtabs(a)) + '</td>'
        + '<td>' + heures(a.quotite || 0) + '</td>'
        + '<td class="col-jauges"><span class="pastille-etat e-' + ch.etat + '">' + A.LIB_ETAT_AESH[ch.etat] + '</span>' + A.jauge("Charge", ch.moy, ch.quotite, ch.etat, titre) + '</td>'
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
    brancherLignes($("pa-table"), "data-aesh", ouvrirAesh);
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
    $("pa-jauges").innerHTML = '<span class="pastille-etat e-' + ch.etat + '">' + A.LIB_ETAT_AESH[ch.etat] + '</span>' + A.jauge("Charge", ch.moy, ch.quotite, ch.etat, titre)
      + '<p class="aide" style="margin:4px 0 0">' + pluriel(elevesDeAesh(a), "élève accompagné", "élèves accompagnés") + ' dans le brouillon.</p>';
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
  $("pa-reinitialiser").addEventListener("click", function () {
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
    var erreurs = [], collision = v.nom && v.prenom ? M.collisionAesh(etat.aesh, { nom: v.nom, prenom: v.prenom }) : null;
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
    var objet = M.attribuerIdentifiants("aesh", [r.objet], etat.aesh)[0];
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
        var eleves = M.elevesDeClasse(etat.eleves, e.id, c), arch = eleves.filter(M.estArchive).length, id = "cl-" + k + "-" + ech(e.id);
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
    if (M.elevesDeClasse(etat.eleves, etab, classe).length) { A.ui().toast("La classe " + classe + " a des élèves : elle ne se retire pas."); return; }
    A.enregistrerPuisRendre([{ magasin: "parametres", enregistrer: [tableClasses(M.classesSansClasse(etat.classes, A.anneeCourante(), etab, classe))] }],
      "Classe " + classe + " retirée.", "le retrait de la classe " + classe);
  }
  function renommerClasse(etab, de, saisie) {
    var vers = M.classeNette(saisie);
    if (!vers || vers === de) return;
    var r = M.renommerClasse(etat.eleves, etat.cours, etab, de, vers);
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

  return { ouvrir: ouvrir };
})();
