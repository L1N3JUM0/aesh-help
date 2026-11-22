"use strict";

/* =====================================================================
   PialSaisie — saisie rapide et collage depuis un tableur
   (docs/SPEC-affectations-PIAL.md §7.5, §17).

   Tableau éditable aux colonnes des gabarits d'import (élèves ou AESH) :
   - les lignes déjà enregistrées sont modifiables ; une cellule modifiée
     s'enregistre en quittant la cellule (une action annulable) ;
   - une ligne nouvelle s'enregistre dès qu'elle est complète et valide
     (mêmes contrôles que l'import : PialImport.validerLigne, collisions de
     clé) ; sinon elle reste en brouillon : bord rouge et motif si elle est
     invalide, simple « À compléter » si elle est incomplète ;
   - Ctrl+V : un collage de plusieurs lignes passe par l'aperçu de l'import
     (composant partagé de PialAffectations) puis s'annule en une action ;
     une seule ligne remplit les cellules à partir de la cellule active.
   Clavier : Tab / Maj+Tab entre cellules, Entrée / Maj+Entrée vers la
   cellule du dessous / du dessus, F2 sélectionne le contenu, Échap rend à la
   cellule sa valeur d'avant.
   ===================================================================== */
var PialSaisie = (function () {

  var A = PialAffectations.interne, M = PialModele, I = PialImport;
  var etat = A.etat, ech = A.ech, pluriel = A.pluriel;
  function $(id) { return document.getElementById(id); }
  function chaque(racine, sel, fn) { Array.prototype.forEach.call(racine.querySelectorAll(sel), fn); }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  function nettoye(s) { return String(s == null ? "" : s).replace(/^\s+|\s+$/g, ""); }

  var CFG = { eleves: { p: "pe", vue: "vue-eleves" }, aesh: { p: "pa", vue: "vue-aesh" } };
  var compteur = 0;
  var sr = {
    eleves: { ouvert: false, lignes: [], interne: 0, file: Promise.resolve() },
    aesh: { ouvert: false, lignes: [], interne: 0, file: Promise.resolve() }
  };

  /* ---------- colonnes et valeurs ---------- */
  function periGere() { return !!A.contexte().reglages.gererPeriscolaire; }
  function colonnes(type) {
    var peri = periGere();
    return I.TYPES[type].champs.filter(function (c) { return type !== "eleves" || peri || (c.cle !== "recreation" && c.cle !== "meridienne"); });
  }
  function actives(type) { return type === "aesh" ? etat.aesh : etat.eleves; }
  function ficheParId(type, id) { return type === "aesh" ? A.aeshParId(id) : A.eleveParId(id); }
  function ctxExport() {
    var etabs = {};
    etat.etablissements.forEach(function (e) { etabs[e.id] = e.nom; });
    return { etablissements: etabs, gererPeriscolaire: periGere() };
  }
  // valeurs affichées d'une fiche : celles de l'export CSV (aller-retour avec l'import)
  function valsFiche(type, f) {
    var tab = I.ligneExport(type, f, ctxExport()), v = {};
    I.TYPES[type].champs.forEach(function (c, i) { v[c.cle] = tab[i]; });
    if (v.heuresInd === "0") v.heuresInd = "";
    if (v.heuresMut === "0") v.heuresMut = "";
    return v;
  }
  function valeursLigne(type, l) {
    var v = {};
    I.TYPES[type].champs.forEach(function (c) { v[c.cle] = nettoye(l.vals[c.cle]); });
    return v;
  }
  function estVide(v) { return !Object.keys(v).some(function (k) { return nettoye(v[k]); }); }
  function signature(type, vals) { return colonnes(type).map(function (c) { return nettoye(vals[c.cle]); }).join("\u0001"); }
  function ligneVide() { return { uid: "u" + (++compteur), id: null, vals: {}, original: null, etat: "vide", motifs: [], sale: false }; }
  function ligneDepuis(type, f) {
    var v = valsFiche(type, f);
    return { uid: "u" + (++compteur), id: f.id, vals: copie(v), original: copie(v), etat: "ok", motifs: [], sale: false };
  }
  function nomEtab(e) { return A.nomEtablissement(e.etablissement); }
  function trier(type, liste) {
    return liste.slice().sort(function (a, b) {
      if (type === "aesh") return (a.nom + " " + a.prenom).localeCompare(b.nom + " " + b.prenom, "fr");
      return nomEtab(a).localeCompare(nomEtab(b), "fr") || M.comparerClasses(a.classe, b.classe) || a.nomCourt.localeCompare(b.nomCourt, "fr");
    });
  }

  /* les lignes enregistrées suivent la base ; les brouillons sont gardés */
  function reconstruire(type) {
    var s = sr[type], parId = {}, vus = {}, gardees = [];
    actives(type).forEach(function (f) { parId[f.id] = f; });
    s.lignes.forEach(function (l) {
      if (l.id) {
        var f = parId[l.id];
        if (!f) return;
        vus[l.id] = true;
        l.original = valsFiche(type, f);
        if (!l.sale) { l.vals = copie(l.original); l.etat = "ok"; l.motifs = []; }
      } else if (estVide(valeursLigne(type, l))) return;
      gardees.push(l);
    });
    var nouvelles = trier(type, actives(type).filter(function (f) { return !vus[f.id]; })).map(function (f) { return ligneDepuis(type, f); });
    s.lignes = gardees.filter(function (l) { return l.id; }).concat(nouvelles, gardees.filter(function (l) { return !l.id; }), [ligneVide()]);
  }

  /* ---------- affichage ---------- */
  function classeEtat(l) { return l.etat === "erreur" ? "sr-erreur" : (l.etat === "incomplet" ? "sr-incomplet" : (l.etat === "ok" && !l.sale ? "sr-ok" : "")); }
  function statut(l) {
    if (l.etat === "erreur" || l.etat === "incomplet") return ech(l.motifs.join(" "));
    if (l.etat === "ok" && !l.sale) return "Enregistré";
    return "";
  }
  function attributs(type, c) {
    var a = "";
    if (c.cle === "heuresInd" || c.cle === "heuresMut" || c.cle === "quotite") a += ' inputmode="decimal"';
    if (c.cle === "etablissement" && type === "eleves") a += ' list="' + CFG[type].p + '-rapide-etabs"';
    if (c.cle === "classe") a += ' list="' + CFG[type].p + '-rapide-classes"';
    if (c.cle === "debutNotif" || c.cle === "finNotif") a += ' placeholder="jj/mm/aaaa"';
    if (c.cle === "recreation" || c.cle === "meridienne") a += ' placeholder="oui / non"';
    if (c.cle === "besoins" || c.cle === "etablissements" || c.cle === "formations") a += ' placeholder="A | B"';
    if (c.cle === "indisponibilites") a += ' placeholder="mer; ven-pm"';
    return a;
  }
  function ligneHtml(type, l, n) {
    var cols = colonnes(type), idStatut = "sr-s-" + l.uid;
    return '<tr class="sr-ligne ' + classeEtat(l) + '" data-uid="' + l.uid + '"><th scope="row" class="sr-num">' + n + '</th>'
      + cols.map(function (c) {
        return '<td><input type="text" class="sr-c-' + c.cle + '" data-col="' + c.cle + '" value="' + ech(l.vals[c.cle] || "") + '" autocomplete="off" spellcheck="false"'
          + ' aria-label="' + ech(I.libelleChamp(c)) + ', ligne ' + n + '" aria-describedby="' + idStatut + '"' + attributs(type, c) + (l.etat === "erreur" ? ' aria-invalid="true"' : "") + '></td>';
      }).join("") + '<td class="sr-statut" id="' + idStatut + '">' + statut(l) + '</td></tr>';
  }
  function listesHtml(type) {
    var p = CFG[type].p, ref = M.referentielClasses(M.classesEnregistrees(etat.classes, A.anneeCourante()), etat.elevesTous, etat.coursTous), vues = {}, classes = [];
    Object.keys(ref).forEach(function (e) { ref[e].forEach(function (c) { if (!vues[M.normaliser(c)]) { vues[M.normaliser(c)] = true; classes.push(c); } }); });
    classes.sort(M.comparerClasses);
    return '<datalist id="' + p + '-rapide-etabs">' + etat.etablissements.map(function (e) { return '<option value="' + ech(e.nom) + '">'; }).join("") + '</datalist>'
      + '<datalist id="' + p + '-rapide-classes">' + classes.map(function (c) { return '<option value="' + ech(c) + '">'; }).join("") + '</datalist>';
  }
  function positionFocus(type) {
    var a = document.activeElement, tr = a && a.closest && a.closest("#" + CFG[type].p + "-rapide-table tr[data-uid]");
    return tr && a.getAttribute("data-col") ? { uid: tr.getAttribute("data-uid"), col: a.getAttribute("data-col") } : null;
  }
  function rendre(type) {
    var p = CFG[type].p, table = $(p + "-rapide-table"), s = sr[type], pos = positionFocus(type);
    var h = '<thead><tr><th scope="col" class="sr-num">N°</th>' + colonnes(type).map(function (c) {
      return '<th scope="col">' + ech(I.libelleChamp(c)) + (c.obligatoire ? ' <span aria-hidden="true">*</span>' : "") + '</th>';
    }).join("") + '<th scope="col">État</th></tr></thead><tbody>';
    s.lignes.forEach(function (l, i) { h += ligneHtml(type, l, i + 1); });
    table.innerHTML = h + "</tbody>";
    $(p + "-rapide-listes").innerHTML = listesHtml(type);
    majAnnuler(type);
    if (pos) {
      var c = table.querySelector('tr[data-uid="' + pos.uid + '"] input[data-col="' + pos.col + '"]');
      if (c) c.focus();
    }
    var n = s.lignes.filter(function (l) { return l.id; }).length;
    $(p + "-rapide-compte").textContent = n ? pluriel(n, type === "aesh" ? "AESH enregistrée" : "élève enregistré", type === "aesh" ? "AESH enregistrées" : "élèves enregistrés") : "";
  }
  function ligneDe(type, el) {
    var tr = el.closest("tr[data-uid]");
    return tr ? sr[type].lignes.filter(function (l) { return l.uid === tr.getAttribute("data-uid"); })[0] : null;
  }
  function trDe(type, l) { return $(CFG[type].p + "-rapide-table").querySelector('tr[data-uid="' + l.uid + '"]'); }
  function majLigneDom(type, l) {
    var tr = trDe(type, l);
    if (!tr) return;
    tr.className = "sr-ligne " + classeEtat(l);
    tr.querySelector(".sr-statut").innerHTML = statut(l);
    chaque(tr, "input[data-col]", function (i) { if (l.etat === "erreur") i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid"); });
  }
  function annoncer(type, texte) { $(CFG[type].p + "-rapide-etat").textContent = texte; }
  function majAnnuler(type) {
    var b = $(CFG[type].p + "-rapide-annuler"), lib = A.libelleAnnulation();
    b.disabled = !lib;
    b.title = lib ? "Annuler : " + lib : "Rien à annuler";
  }
  function ajouterLigneVideSiBesoin(type) {
    var s = sr[type], derniere = s.lignes[s.lignes.length - 1];
    if (derniere && estVide(valeursLigne(type, derniere))) return;
    var l = ligneVide();
    s.lignes.push(l);
    $(CFG[type].p + "-rapide-table").querySelector("tbody").insertAdjacentHTML("beforeend", ligneHtml(type, l, s.lignes.length));
  }

  /* ---------- contrôle d'une ligne ---------- */
  function cap(m) { return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : "."); }
  /* renvoie le résultat de la validation si la ligne est enregistrable, sinon
     null en réglant l.etat (vide, incomplet, erreur) et l.motifs */
  function evaluer(type, l) {
    var v = valeursLigne(type, l), champs = I.TYPES[type].champs;
    if (estVide(v)) {
      if (l.id) { l.etat = "erreur"; l.motifs = ["Une ligne enregistrée ne se vide pas : archivez ou supprimez la fiche depuis la liste."]; }
      else { l.etat = "vide"; l.motifs = []; }
      return null;
    }
    var manquants = champs.filter(function (c) { return c.obligatoire && !v[c.cle]; }).map(I.libelleChamp);
    if (manquants.length) { l.etat = "incomplet"; l.motifs = ["À compléter : " + manquants.join(", ") + "."]; return null; }
    var r = I.validerLigne(type, v, { annee: A.anneeCourante(), gererPeriscolaire: periGere(), specialites: A.contexte().reglages.specialites });
    if (r.erreurs) {
      if (!l.id && r.erreurs.length === 1 && r.erreurs[0] === "aucune heure notifiée") { l.etat = "incomplet"; l.motifs = ["À compléter : heures notifiées."]; return null; }
      l.etat = "erreur"; l.motifs = r.erreurs.map(cap); return null;
    }
    var erreurs = [];
    if (type === "eleves") {
      var col = M.collisionEleve(etat.elevesTous, { id: l.id, annee: A.anneeCourante(), cle: M.cleEleve(r.objet.nomCourt, r.objet.classe, M.idEtablissement(v.etablissement)) });
      if (col) erreurs.push("Un élève " + col.nomCourt + " existe déjà en " + col.classe + " dans cet établissement" + (M.estArchive(col) ? " (archivé)" : "")
        + ". Écrivez une abréviation terminée par un point dans le nom (Ma., Mo.) pour les distinguer.");
    } else {
      var colA = M.collisionAesh(etat.aeshTous, { id: l.id, nom: v.nom, prenom: v.prenom });
      if (colA) erreurs.push("Une AESH " + A.nomAesh(colA) + " existe déjà" + (M.estArchive(colA) ? " (archivée)" : "") + " : même nom et même prénom.");
      (r.objet.etablissementsNoms || []).forEach(function (n) {
        if (!A.etablissementParId(M.idEtablissement(n))) erreurs.push("Établissement inconnu : « " + n + " » (il se crée avec un élève, ou à l'import).");
      });
    }
    if (erreurs.length) { l.etat = "erreur"; l.motifs = erreurs; return null; }
    l.etat = "valide"; l.motifs = [];
    return r;
  }

  /* ---------- écriture ---------- */
  function referentielActuel() { return M.referentielClasses(M.classesEnregistrees(etat.classes, A.anneeCourante()), etat.elevesTous, etat.coursTous); }
  function paramsClasses(liste) {
    var table = etat.classes, change = false, ref = referentielActuel();
    liste.forEach(function (e) {
      if (!(ref[e.etablissement] || []).some(function (c) { return M.memeClasse(c, e.classe); })) { table = M.classesAvecAjout(table, A.anneeCourante(), e.etablissement, e.classe); change = true; }
    });
    return change ? [{ magasin: "parametres", enregistrer: [{ cle: "classes", valeur: table }] }] : [];
  }
  function construireOps(type, l, v, r) {
    var ops = [], o = r.objet;
    if (type === "eleves") {
      var etabId = M.idEtablissement(v.etablissement), etab = A.etablissementParId(etabId), nom = etab ? etab.nom : v.etablissement.replace(/\s+/g, " ");
      if (!l.id) {
        var objet = M.attribuerIdentifiants("eleves", [o], etat.elevesTous)[0];
        objet.etablissement = etabId; objet.etablissementNom = nom; objet.cle = M.cleEleve(objet.nomCourt, objet.classe, etabId);
        if (!etab) ops.push({ magasin: "etablissements", enregistrer: [M.etablissementParDefaut(nom)] });
        ops.push({ magasin: "eleves", enregistrer: [objet] });
        return { ops: ops.concat(paramsClasses([objet])), id: objet.id, message: objet.nomCourt + " ajouté(e) en " + objet.classe + ".", libelle: "la création de " + objet.nomCourt };
      }
      var e = A.eleveParId(l.id), b = M.eleveModifie(e, { prenom: v.prenom, nom: v.nom, classe: v.classe, etablissement: etabId, etablissementNom: nom });
      var nouveau = { heuresInd: o.heuresInd, heuresMut: o.heuresMut, debutNotif: o.debutNotif, finNotif: o.finNotif, besoins: o.besoins };
      b.modifiesAppli = copie(e.modifiesAppli || {});
      M.CHAMPS_NOTIFICATION.forEach(function (k) {
        var avant = k === "heuresInd" || k === "heuresMut" ? (e[k] || 0) : (k === "besoins" ? (e[k] || []) : (e[k] || ""));
        if (JSON.stringify(avant) !== JSON.stringify(nouveau[k])) { b[k] = nouveau[k]; b.modifiesAppli[k] = true; }
      });
      if (!Object.keys(b.modifiesAppli).length) delete b.modifiesAppli;
      if (periGere()) {
        b.recreation = !!o.recreation; b.meridienne = !!o.meridienne;
        var ep = copie(b.etatsPeriscolaires || {});
        ["recreation", "meridienne"].forEach(function (k) {
          if (o.etatsPeriscolaires && o.etatsPeriscolaires[k]) ep[k] = o.etatsPeriscolaires[k]; else if (ep[k] === "prioritaire") delete ep[k];
        });
        if (Object.keys(ep).length) b.etatsPeriscolaires = ep; else delete b.etatsPeriscolaires;
      }
      if (JSON.stringify(b) === JSON.stringify(e)) return { rien: true };
      var cours = M.coursSuivantEleve(etat.coursTous, b);
      if (!etab) ops.push({ magasin: "etablissements", enregistrer: [M.etablissementParDefaut(nom)] });
      ops.push({ magasin: "eleves", enregistrer: [b] });
      if (cours.length) ops.push({ magasin: "cours", enregistrer: cours });
      // changement d'établissement : ses créneaux du brouillon appartenaient à l'ancien
      if (e.etablissement !== etabId) {
        var eff = M.effetsRetrait("eleves", [e.id], { affectations: etat.affectations.concat(etat.affectationsVersions), cours: etat.coursTous, aesh: etat.aeshTous });
        if (eff.supprimees.length || eff.modifiees.length) ops.push({ magasin: "affectations", supprimer: eff.supprimees, enregistrer: eff.modifiees });
      }
      return { ops: ops.concat(paramsClasses([b])), id: e.id, message: b.nomCourt + " modifié(e).", libelle: "la modification de " + b.nomCourt };
    }
    // AESH
    if (!l.id) {
      var nv = M.attribuerIdentifiants("aesh", [o], etat.aeshTous)[0];
      return { ops: [{ magasin: "aesh", enregistrer: [nv] }], id: nv.id, message: A.nomAesh(nv) + " ajoutée.", libelle: "la création de " + A.nomAesh(nv) };
    }
    var a = A.aeshParId(l.id), c = M.aeshModifiee(a, { nom: v.nom, prenom: v.prenom });
    var nouvelle = { quotite: o.quotite, email: o.email || "", etablissements: o.etablissements, indisponibilites: o.indisponibilites, formations: o.formations };
    c.modifiesAppli = copie(a.modifiesAppli || {});
    M.CHAMPS_FICHE_AESH.forEach(function (k) {
      var avantA = k === "quotite" ? (a.quotite || 0) : (k === "email" ? (a.email || "") : (a[k] || []));
      if (JSON.stringify(avantA) !== JSON.stringify(nouvelle[k])) { c[k] = nouvelle[k]; c.modifiesAppli[k] = true; }
    });
    if (!Object.keys(c.modifiesAppli).length) delete c.modifiesAppli;
    c.etablissementsNoms = o.etablissementsNoms;
    if (JSON.stringify(c) === JSON.stringify(a)) return { rien: true };
    return { ops: [{ magasin: "aesh", enregistrer: [c] }], id: a.id, message: A.nomAesh(c) + " modifiée.", libelle: "la modification de " + A.nomAesh(c) };
  }
  // met à jour les cellules d'une ligne depuis la fiche enregistrée, sauf la cellule en cours de frappe
  function rafraichirValeurs(type, l) {
    var tr = trDe(type, l), actif = document.activeElement, colActive = actif && tr && tr.contains(actif) ? actif.getAttribute("data-col") : null;
    var nouv = copie(l.original);
    if (colActive) nouv[colActive] = l.vals[colActive];
    l.vals = nouv;
    l.sale = signature(type, l.vals) !== signature(type, l.original);
    if (tr) chaque(tr, "input[data-col]", function (i) { if (i !== actif) i.value = l.vals[i.getAttribute("data-col")] || ""; });
  }
  function traiter(type, l) {
    var s = sr[type], r = evaluer(type, l);
    if (l.id && signature(type, l.vals) === signature(type, l.original)) { l.etat = "ok"; l.sale = false; l.motifs = []; majLigneDom(type, l); return Promise.resolve(); }
    if (!r) { majLigneDom(type, l); return Promise.resolve(); }
    var plan = construireOps(type, l, valeursLigne(type, l), r);
    if (plan.rien) { l.etat = "ok"; l.sale = false; l.motifs = []; l.original = copie(l.vals); majLigneDom(type, l); return Promise.resolve(); }
    s.interne++;
    return A.enregistrerPuisRendre(plan.ops, plan.message, plan.libelle).then(function () {
      s.interne--;
      var f = ficheParId(type, plan.id);
      l.id = plan.id; l.etat = "ok"; l.motifs = [];
      if (f) { l.original = valsFiche(type, f); rafraichirValeurs(type, l); }
      majLigneDom(type, l);
      majAnnuler(type);
      annoncer(type, plan.message);
      $(CFG[type].p + "-rapide-compte").textContent = pluriel(s.lignes.filter(function (x) { return x.id; }).length, type === "aesh" ? "AESH enregistrée" : "élève enregistré", type === "aesh" ? "AESH enregistrées" : "élèves enregistrés");
    }, function (err) {
      s.interne--;
      l.etat = "erreur"; l.motifs = ["Enregistrement impossible : " + (err && err.message ? err.message : err)];
      majLigneDom(type, l);
    });
  }
  function file(type, fn) {
    var s = sr[type];
    s.file = s.file.then(fn).then(null, function () { /* la ligne porte déjà son message */ });
    return s.file;
  }

  /* ---------- collage ---------- */
  var co = { type: null, imp: null, retour: null };
  function ouvrirCollage(type, texte, depart, retour) {
    var cols = colonnes(type).map(function (c) { return c.cle; }), a = I.analyserCollage(type, texte, cols, depart);
    co.type = type; co.retour = retour;
    $("co-titre").textContent = type === "aesh" ? "Coller des AESH" : "Coller des élèves";
    var intro = '<p class="aide">' + pluriel(a.lignes.length - (a.entetes ? 1 : 0), "ligne collée", "lignes collées")
      + (a.entetes ? ", en-têtes reconnus." : ", colonnes lues dans l'ordre à partir de « " + ech(I.libelleChamp(colonnes(type)[depart] || colonnes(type)[0])) + " ».") + '</p>';
    if (a.manquants.length) {
      $("co-resume").innerHTML = intro + '<p class="note alerte">Colonnes obligatoires introuvables : ' + a.manquants.map(ech).join(", ")
        + '. Collez aussi la ligne d\'en-têtes, ou placez-vous dans la première colonne avant de coller.</p>';
      $("co-details").innerHTML = "";
      $("co-appliquer").disabled = true;
      co.imp = null;
    } else {
      var imp = { type: type, lignes: a.lignesImport, correspondance: a.correspondance, premiereLigne: a.premiereLigne, collage: true, nomFichier: "collage" };
      A.calculerImport(imp);
      A.rendreApercuDans(imp, $("co-resume"), $("co-details"), { sansRemplacer: true });
      $("co-resume").insertAdjacentHTML("afterbegin", intro);
      $("co-appliquer").disabled = !(imp.planMaj.ajouts.length + imp.planMaj.modifies.length);
      co.imp = imp;
    }
    $("voile-collage").hidden = false;
    ($("co-appliquer").disabled ? $("co-annuler") : $("co-appliquer")).focus();
  }
  function fermerCollage() {
    $("voile-collage").hidden = true;
    co.imp = null;
    if (co.retour && co.retour.focus) co.retour.focus();
  }
  function appliquerCollage() {
    var imp = co.imp, type = co.type;
    if (!imp) return;
    A.appliquerCollage(imp).then(function (ok) {
      fermerCollage();
      if (ok) annoncer(type, "Collage enregistré : annulable d'un clic sur « Annuler ».");
    });
  }
  function collerLigneDansLigne(type, input, cellules) {
    var cols = colonnes(type), depart = 0, l = ligneDe(type, input), tr = trDe(type, l);
    cols.forEach(function (c, i) { if (c.cle === input.getAttribute("data-col")) depart = i; });
    cellules.forEach(function (valeur, k) {
      var c = cols[depart + k];
      if (!c) return;
      l.vals[c.cle] = nettoye(valeur);
      var champ = tr.querySelector('input[data-col="' + c.cle + '"]');
      if (champ) champ.value = l.vals[c.cle];
    });
    l.sale = true;
    ajouterLigneVideSiBesoin(type);
    file(type, function () { return traiter(type, l); });
  }

  /* ---------- ouverture et fermeture ---------- */
  function nonEnregistrees(type) {
    return sr[type].lignes.filter(function (l) {
      var v = valeursLigne(type, l);
      return !estVide(v) && (l.etat === "incomplet" || l.etat === "erreur" || (!l.id && l.etat !== "ok") || (l.id && l.sale && l.etat !== "ok"));
    }).length;
  }
  function ouvrir(type) {
    var p = CFG[type].p, s = sr[type];
    s.ouvert = true;
    $(p + "-disposition").classList.add("mode-rapide");
    $(p + "-rapide").hidden = false;
    reconstruire(type);
    rendre(type);
    var vide = $(p + "-rapide-table").querySelector("tbody tr:last-child input");
    if (vide) vide.focus();
  }
  function sortir(type) {
    var p = CFG[type].p;
    sr[type].ouvert = false;
    sr[type].lignes = [];
    $(p + "-rapide").hidden = true;
    $(p + "-disposition").classList.remove("mode-rapide");
    $(p + "-rapide-table").innerHTML = "";
    var b = $(p + "-rapide-ouvrir");
    if (b) b.focus();
  }
  function fermer(type) {
    var n = nonEnregistrees(type);
    if (!n) { sortir(type); return; }
    A.ui().confirmationForte("Quitter la saisie rapide ? " + pluriel(n, "ligne non enregistrée sera perdue", "lignes non enregistrées seront perdues") + ".", "Quitter", function () { sortir(type); });
  }

  /* ---------- clavier et événements ---------- */
  function brancher(type) {
    var p = CFG[type].p, table = $(p + "-rapide-table");
    table.addEventListener("focusin", function (ev) {
      var i = ev.target;
      if (!i.getAttribute || !i.getAttribute("data-col")) return;
      i.setAttribute("data-avant", i.value);
      i.select();
    });
    table.addEventListener("input", function (ev) {
      var i = ev.target, col = i.getAttribute && i.getAttribute("data-col");
      if (!col) return;
      var l = ligneDe(type, i);
      if (!l) return;
      l.vals[col] = i.value;
      l.sale = l.id ? signature(type, l.vals) !== signature(type, l.original) : true;
      ajouterLigneVideSiBesoin(type);
    });
    table.addEventListener("change", function (ev) {
      var i = ev.target;
      if (!i.getAttribute || !i.getAttribute("data-col")) return;
      var l = ligneDe(type, i);
      if (l) file(type, function () { return traiter(type, l); });
    });
    table.addEventListener("keydown", function (ev) {
      var i = ev.target, col = i.getAttribute && i.getAttribute("data-col");
      if (!col) return;
      if (ev.key === "Enter") {
        ev.preventDefault();
        var tr = i.closest("tr"), autre = ev.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
        if (!autre && !ev.shiftKey) { ajouterLigneVideSiBesoin(type); autre = tr.nextElementSibling; }
        var champ = autre && autre.querySelector('input[data-col="' + col + '"]');
        if (champ) champ.focus();
      } else if (ev.key === "F2") {
        ev.preventDefault();
        i.select();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        i.value = i.getAttribute("data-avant") || "";
        i.dispatchEvent(new Event("input", { bubbles: true }));
        i.select();
      }
    });
    table.addEventListener("paste", function (ev) {
      var i = ev.target;
      if (!i.getAttribute || !i.getAttribute("data-col")) return;
      var texte = ev.clipboardData ? ev.clipboardData.getData("text") : "";
      if (!texte) return;
      var lignes = I.analyserCSV(texte, "\t");
      if (!lignes.length || (lignes.length === 1 && lignes[0].length < 2)) return; // une seule cellule : collage normal
      ev.preventDefault();
      var cols = colonnes(type).map(function (c) { return c.cle; }), depart = Math.max(0, cols.indexOf(i.getAttribute("data-col")));
      if (lignes.length === 1 && Object.keys(I.correspondanceAuto(type, lignes[0])).length < 2) { collerLigneDansLigne(type, i, lignes[0]); return; }
      ouvrirCollage(type, texte, depart, i);
    });
    $(p + "-rapide-ouvrir").addEventListener("click", function () { ouvrir(type); });
    $(p + "-rapide-retour").addEventListener("click", function () { fermer(type); });
    $(p + "-rapide-annuler").addEventListener("click", function () { A.annuler(); });
  }
  brancher("eleves");
  brancher("aesh");
  $("co-appliquer").addEventListener("click", appliquerCollage);
  $("co-annuler").addEventListener("click", fermerCollage);
  $("voile-collage").addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); fermerCollage(); } });
  // les données ont changé ailleurs (annulation, import, fiche) : on relit la base, sans toucher aux brouillons
  A.surRendu(function () {
    ["eleves", "aesh"].forEach(function (type) {
      var s = sr[type];
      if (!s.ouvert) return;
      if (s.interne > 0) { majAnnuler(type); return; }
      reconstruire(type);
      rendre(type);
    });
  });
  window.addEventListener("beforeunload", function (ev) {
    if (nonEnregistrees("eleves") || nonEnregistrees("aesh")) { ev.preventDefault(); ev.returnValue = ""; }
  });

  return { ouvrir: ouvrir, fermer: fermer };
})();
