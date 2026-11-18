"use strict";

/* =====================================================================
   PialAffectations — module « Affectations » de l'espace PIAL
   (docs/SPEC-affectations-PIAL.md).

   Ce fichier tient l'état en mémoire du module (chargé depuis IndexedDB
   via PialDB) et l'interface : import des fichiers élèves / AESH /
   emplois du temps, paramètres des établissements, onglet Affectations.
   Toutes les règles de calcul sont dans modele.js (fonctions pures).
   Les utilitaires d'interface communs (toast, confirmation renforcée,
   téléchargement, navigation) sont fournis par app.js via initialiser().
   ===================================================================== */
var PialAffectations = (function () {

  var M = PialModele, I = PialImport;
  var ui = null; // {toast, confirmationForte, telecharger, vue}

  function $(id) { return document.getElementById(id); }
  function txt(s) { return String(s == null ? "" : s); }
  function ech(s) { return txt(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function pluriel(n, mot, motPluriel) { return n + " " + (n > 1 ? (motPluriel || mot + "s") : mot); }
  function heures(x) { return (Math.round(x * 100) / 100).toString().replace(".", ",") + " h"; }

  /* =============== état en mémoire =============== */
  var etat = {
    etablissements: [], eleves: [], aesh: [], cours: [],
    affectations: [],          // brouillon (version 0) de l'année en cours
    versions: [], correspondances: {}, reglages: {}
  };

  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function anneeCourante() { return M.anneeScolaire(aujourdhui()); }

  function recharger() {
    return Promise.all(PialDB.MAGASINS_AFFECTATIONS.map(PialDB.tous)).then(function (r) {
      var parNom = {};
      PialDB.MAGASINS_AFFECTATIONS.forEach(function (nom, i) { parNom[nom] = r[i] || []; });
      var annee = anneeCourante();
      etat.etablissements = parNom.etablissements;
      etat.eleves = parNom.eleves.filter(function (e) { return e.annee === annee; });
      etat.aesh = parNom.aesh;
      etat.cours = parNom.cours.filter(function (c) { return c.annee === annee; });
      etat.affectations = parNom.affectations.filter(function (a) { return a.version === 0 && a.annee === annee; });
      etat.versions = parNom.versions;
      etat.correspondances = {};
      parNom.correspondances.forEach(function (c) { etat.correspondances[c.type] = c.colonnes; });
      var reg = parNom.parametres.filter(function (p) { return p.cle === "reglages"; })[0];
      etat.reglages = (reg && reg.valeur) || {};
    });
  }

  function compteurs() {
    return { eleves: etat.eleves.length, aesh: etat.aesh.length, cours: etat.cours.length, affectations: etat.affectations.length };
  }

  function contexte() {
    return M.contexte({
      etablissements: etat.etablissements, eleves: etat.eleves, aesh: etat.aesh,
      cours: etat.cours, affectations: etat.affectations, reglages: etat.reglages
    });
  }
  function etablissementParId(id) { return etat.etablissements.filter(function (e) { return e.id === id; })[0]; }
  function nomEtablissement(id) { var e = etablissementParId(id); return e ? e.nom : id; }

  /* =============== import : gabarits =============== */
  Array.prototype.forEach.call(document.querySelectorAll("[data-gabarit]"), function (b) {
    b.addEventListener("click", function () {
      var type = this.dataset.gabarit;
      ui.telecharger(I.TYPES[type].fichier, I.gabarit(type), "text/csv");
    });
  });

  /* =============== import : lecture et correspondance =============== */
  var importEnCours = null; // {type, nomFichier, lignes, correspondance, apercu, plan}

  function lireOctets(fichier) {
    return new Promise(function (resolve, reject) {
      var l = new FileReader();
      l.onload = function () { resolve(new Uint8Array(l.result)); };
      l.onerror = function () { reject(l.error); };
      l.readAsArrayBuffer(fichier);
    });
  }
  function messageImport(classe, html) { $("imp-etat").innerHTML = html ? '<p class="note ' + classe + '">' + html + '</p>' : ""; }
  function fermerImport() {
    importEnCours = null;
    $("imp-correspondance").hidden = true;
    $("imp-apercu").hidden = true;
  }

  $("imp-choisir").addEventListener("click", function () { $("imp-fichier").click(); });
  $("imp-fichier").addEventListener("change", function () {
    var fichier = this.files[0]; this.value = "";
    if (!fichier) return;
    // présélection du type d'après le nom du fichier
    var n = M.normaliser(fichier.name);
    if (/edt|emploi/.test(n)) $("imp-type").value = "edt";
    else if (/aesh/.test(n)) $("imp-type").value = "aesh";
    else if (/eleve/.test(n)) $("imp-type").value = "eleves";
    var type = $("imp-type").value;
    fermerImport();
    messageImport("", "Lecture de « " + ech(fichier.name) + " »…");
    lireOctets(fichier).then(function (octets) {
      return I.lireFichier(fichier.name, octets, PialZip);
    }).then(function (lu) {
      if (lu.lignes.length < 2) { messageImport("alerte", "Ce fichier ne contient aucune ligne de données."); return; }
      importEnCours = { type: type, nomFichier: fichier.name, lignes: lu.lignes };
      importEnCours.correspondance = I.correspondanceAuto(type, lu.lignes[0], etat.correspondances[type]);
      messageImport("", "« " + ech(fichier.name) + " » : " + pluriel(lu.lignes.length - 1, "ligne") + " lue" + (lu.lignes.length > 2 ? "s" : "")
        + (lu.format === "csv" ? " (encodage " + (lu.encodage === "utf-8" ? "UTF-8" : "Windows-1252") + ", séparateur « " + (lu.separateur === "\t" ? "tabulation" : lu.separateur) + " »)" : " (XLSX, première feuille)")
        + ". Type : " + ech(I.TYPES[type].libelle) + ".");
      rendreCorrespondance();
    }).catch(function (err) {
      var m = err && err.message;
      if (m === "decompression-indisponible") messageImport("alerte", "Ce navigateur ne sait pas lire les fichiers XLSX. Enregistrez le fichier en CSV et réimportez-le.");
      else if (m === "xls-ancien-format") messageImport("alerte", "Les fichiers .xls (ancien format Excel) ne sont pas lus. Enregistrez le fichier en CSV ou en XLSX et réimportez-le.");
      else messageImport("alerte", "Impossible de lire ce fichier. Enregistrez-le en CSV et réimportez-le.");
    });
  });
  $("imp-type").addEventListener("change", function () {
    if (!importEnCours) return;
    importEnCours.type = this.value;
    importEnCours.correspondance = I.correspondanceAuto(this.value, importEnCours.lignes[0], etat.correspondances[this.value]);
    $("imp-apercu").hidden = true;
    rendreCorrespondance();
  });

  function rendreCorrespondance() {
    var imp = importEnCours, entetes = imp.lignes[0], exemple = imp.lignes[1] || [];
    var options = '<option value="-1">— non utilisée —</option>' + entetes.map(function (h, i) {
      return '<option value="' + i + '">' + ech(h || ("Colonne " + (i + 1))) + '</option>';
    }).join("");
    $("imp-corps-correspondance").innerHTML = I.TYPES[imp.type].champs.map(function (c) {
      var i = imp.correspondance[c.cle];
      return '<tr><td>' + ech(I.libelleChamp(c)) + (c.obligatoire ? " *" : "") + '</td>'
        + '<td><select data-champ="' + c.cle + '">' + options + '</select></td>'
        + '<td>' + (i != null && i > -1 ? ech(exemple[i]) : "") + '</td></tr>';
    }).join("");
    Array.prototype.forEach.call($("imp-corps-correspondance").querySelectorAll("select"), function (s) {
      var i = imp.correspondance[s.dataset.champ];
      s.value = String(i != null ? i : -1);
      s.addEventListener("change", function () {
        imp.correspondance[this.dataset.champ] = parseInt(this.value, 10);
        $("imp-apercu").hidden = true;
        var td = this.parentNode.nextSibling, j = parseInt(this.value, 10);
        td.textContent = j > -1 ? txt(exemple[j]) : "";
      });
    });
    $("imp-correspondance").hidden = false;
  }
  $("imp-annuler").addEventListener("click", function () { fermerImport(); messageImport("", ""); });
  $("imp-annuler2").addEventListener("click", function () { fermerImport(); messageImport("", ""); });

  /* =============== import : aperçu =============== */
  function elevesConnus() {
    var connus = {};
    etat.eleves.forEach(function (e) { connus[e.cle] = true; });
    return connus;
  }
  function existantsDuType(type) {
    if (type === "eleves") return etat.eleves;
    if (type === "aesh") return etat.aesh;
    return etat.cours;
  }
  // conserve les champs saisis dans l'application lors d'une mise à jour
  function fusionnerObjet(type, existant, nouveau) {
    if (!existant) return nouveau;
    var o = {};
    Object.keys(nouveau).forEach(function (k) { o[k] = nouveau[k]; });
    if (type === "aesh") { o.ignorerIndispos = !!existant.ignorerIndispos; o.alias = existant.alias || []; }
    if (type === "edt" && nouveau.etat === "normal" && existant.etat) o.etat = existant.etat;
    return o;
  }

  $("imp-verifier").addEventListener("click", function () {
    var imp = importEnCours;
    if (!imp) return;
    var manquants = I.champsManquants(imp.type, imp.correspondance);
    if (manquants.length) { ui.toast("Colonne(s) obligatoire(s) non choisie(s) : " + manquants.join(", ") + "."); return; }
    imp.apercu = I.apercu(imp.type, imp.lignes.slice(1), imp.correspondance, { annee: anneeCourante(), elevesConnus: elevesConnus() });
    var cleId = "id";
    imp.planMaj = I.planFusion(existantsDuType(imp.type), imp.apercu.valides, cleId, "maj");
    imp.planRemplacer = I.planFusion(existantsDuType(imp.type), imp.apercu.valides, cleId, "remplacer");
    rendreApercu();
  });

  function listeMotifs(titre, elements, max) {
    if (!elements.length) return "";
    max = max || 60;
    return '<p class="note alerte" style="margin-bottom:4px"><strong>' + titre + '</strong></p><ul class="liste-motifs">'
      + elements.slice(0, max).map(function (x) { return "<li>" + x + "</li>"; }).join("")
      + (elements.length > max ? "<li>… et " + (elements.length - max) + " autre(s).</li>" : "") + "</ul>";
  }

  function rendreApercu() {
    var imp = importEnCours, ap = imp.apercu;
    var nouveauxEtabs = ap.etablissements.filter(function (n) { return !etablissementParId(M.idEtablissement(n)); });
    $("imp-resume").innerHTML = '<div class="compteurs-import">'
      + '<span><strong>' + ap.valides.length + '</strong> ligne(s) reconnue(s)</span>'
      + '<span><strong>' + ap.erreurs.length + '</strong> en erreur</span>'
      + '<span><strong>' + ap.doublons.length + '</strong> doublon(s) ignoré(s)</span>'
      + '<span><strong>' + ap.collisions.length + '</strong> collision(s) bloquée(s)</span>'
      + (ap.exemples.length ? '<span><strong>' + ap.exemples.length + '</strong> ligne(s) d\'exemple du gabarit ignorée(s)</span>' : '')
      + '</div>'
      + '<p class="note">Mettre à jour : ' + imp.planMaj.ajouts.length + ' ajout(s), ' + imp.planMaj.modifies.length + ' modification(s), '
      + imp.planMaj.inchanges.length + ' inchangé(s). Remplacer supprimerait en plus ' + imp.planRemplacer.supprimes.length + ' enregistrement(s) absent(s) du fichier.</p>'
      + (nouveauxEtabs.length ? '<p class="note">Nouvel(s) établissement(s) créé(s) à l\'import : ' + nouveauxEtabs.map(ech).join(", ") + '. Vérifiez ensuite leurs horaires dans Réglages.</p>' : '');
    var h = "";
    h += listeMotifs("Collisions : ces élèves ont la même clé (prénom, initiale, classe, établissement) et sont bloqués. Différenciez-les en écrivant une abréviation terminée par un point dans la colonne Nom (ex. « Ma. » et « Mo. »).",
      ap.collisions.map(function (c) { return "Lignes " + c.lignes.join(", ") + " : " + ech(c.cle); }));
    h += listeMotifs("Lignes en erreur (non importées)", ap.erreurs.map(function (e) { return "Ligne " + e.ligne + " : " + e.motifs.map(ech).join(" ; "); }));
    h += listeMotifs("Avertissements", ap.avertissements.map(function (a) { return "Ligne " + a.ligne + " : " + ech(a.motif); }));
    if (ap.exemples.length) h += '<p class="aide">Lignes d\'exemple du gabarit ignorées : ' + ap.exemples.join(", ") + '.</p>';
    if (ap.doublons.length) h += '<p class="aide">Doublons ignorés (lignes identiques à une ligne précédente) : ' + ap.doublons.map(function (d) { return d.ligne; }).join(", ") + '.</p>';
    $("imp-details").innerHTML = h;
    $("imp-maj").disabled = !ap.valides.length;
    $("imp-remplacer").disabled = !ap.valides.length;
    $("imp-apercu").hidden = false;
  }

  /* =============== import : écriture en base =============== */
  function operationsImport(mode) {
    var imp = importEnCours, type = imp.type, plan = mode === "remplacer" ? imp.planRemplacer : imp.planMaj;
    var magasin = type === "eleves" ? "eleves" : (type === "aesh" ? "aesh" : "cours");
    var parId = {};
    existantsDuType(type).forEach(function (e) { parId[e.id] = e; });
    var aEnregistrer = plan.ajouts.concat(plan.modifies).map(function (n) { return fusionnerObjet(type, parId[n.id], n); });
    var ops = [{ magasin: magasin, supprimer: plan.supprimes.map(function (s) { return s.id; }), enregistrer: aEnregistrer }];
    // élèves supprimés : leurs cours et leurs créneaux du brouillon partent avec eux
    var suppr = {};
    plan.supprimes.forEach(function (s) { suppr[s.id] = true; });
    var coursSuppr = [], affSuppr = [], affModif = [];
    if (type === "eleves" && plan.supprimes.length) {
      coursSuppr = etat.cours.filter(function (c) { return suppr[c.eleveId]; }).map(function (c) { return c.id; });
      etat.affectations.forEach(function (a) {
        var restants = a.eleves.filter(function (id) { return !suppr[id]; });
        if (restants.length === a.eleves.length) return;
        if (!restants.length) affSuppr.push(a.id);
        else { var b = JSON.parse(JSON.stringify(a)); b.eleves = restants; affModif.push(b); }
      });
      ops.push({ magasin: "cours", supprimer: coursSuppr });
    }
    if (type === "aesh" && plan.supprimes.length) {
      etat.affectations.forEach(function (a) { if (suppr[a.aeshId]) affSuppr.push(a.id); });
    }
    if (affSuppr.length || affModif.length) ops.push({ magasin: "affectations", supprimer: affSuppr, enregistrer: affModif });
    // nouveaux établissements avec leurs paramètres par défaut (§2.5)
    var nouveaux = imp.apercu.etablissements.filter(function (n) { return !etablissementParId(M.idEtablissement(n)); })
      .map(M.etablissementParDefaut);
    if (nouveaux.length) ops.push({ magasin: "etablissements", enregistrer: nouveaux });
    ops.push({ magasin: "correspondances", enregistrer: [{ type: type, colonnes: I.correspondanceAMemoriser(imp.lignes[0], imp.correspondance) }] });
    return { ops: ops, plan: plan, coursSuppr: coursSuppr.length, affSuppr: affSuppr.length + affModif.length, nouveauxEtabs: nouveaux.length };
  }
  function ecrireImport(mode) {
    var r = operationsImport(mode), imp = importEnCours;
    return PialDB.appliquer(r.ops).then(recharger).then(function () {
      fermerImport();
      messageImport("ok", "« " + ech(imp.nomFichier) + " » importé : " + r.plan.ajouts.length + " ajout(s), " + r.plan.modifies.length + " modification(s)"
        + (mode === "remplacer" ? ", " + r.plan.supprimes.length + " suppression(s)" : "") + "."
        + (r.nouveauxEtabs ? " " + pluriel(r.nouveauxEtabs, "établissement créé", "établissements créés") + " : vérifiez leurs horaires dans Réglages." : ""));
      ui.toast("Import enregistré.");
      rendreEtablissements();
      if (typeof PialAffectations.surChangement === "function") PialAffectations.surChangement();
    });
  }
  $("imp-maj").addEventListener("click", function () { if (importEnCours) ecrireImport("maj"); });
  $("imp-remplacer").addEventListener("click", function () {
    if (!importEnCours) return;
    var r = operationsImport("remplacer"), libelle = I.TYPES[importEnCours.type].libelle.toLowerCase();
    var msg = "Remplacer les " + libelle + " de l'année " + anneeCourante() + " par le contenu de ce fichier : "
      + r.plan.ajouts.length + " ajout(s), " + r.plan.modifies.length + " modification(s), " + r.plan.supprimes.length + " suppression(s)"
      + (r.coursSuppr ? ", " + r.coursSuppr + " cours supprimé(s) avec les élèves" : "")
      + (r.affSuppr ? ", " + r.affSuppr + " créneau(x) d'affectation retiré(s) ou modifié(s)" : "")
      + ". Cette action est irréversible.";
    ui.confirmationForte(msg, "Remplacer", function () { ecrireImport("remplacer"); }, { libelle: "Exporter une sauvegarde", cb: ui.exporterSauvegarde });
  });

  /* =============== réglages : établissements =============== */
  var JOURS_OUVRABLES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  function champHeure(id, valeur) { return '<input type="text" id="' + id + '" value="' + ech(valeur || "") + '" placeholder="hh:mm" inputmode="numeric">'; }
  function rendreEtablissements() {
    var hote = $("reg-etablissements");
    var liste = etat.etablissements.slice().sort(function (a, b) { return txt(a.nom).localeCompare(txt(b.nom), "fr"); });
    if (!liste.length) { hote.innerHTML = '<p class="vide">Aucun établissement pour l\'instant : importez un fichier.</p>'; return; }
    hote.innerHTML = liste.map(function (e, k) {
      var r = e.recreations || [], p = "et" + k + "-";
      return '<div class="etab-param" data-etab="' + ech(e.id) + '" data-prefixe="' + p + '"><h3>' + ech(e.nom) + '</h3><div class="grille">'
        + '<div class="champ"><label for="' + p + 'type">Type</label><select id="' + p + 'type">'
        + ["ecole", "college", "lycee"].map(function (t) { return '<option value="' + t + '"' + (e.type === t ? " selected" : "") + '>' + { ecole: "École", college: "Collège", lycee: "Lycée" }[t] + '</option>'; }).join("")
        + '</select></div>'
        + '<div class="champ"><label class="case" style="margin-top:24px"><input type="checkbox" id="' + p + 'alt"' + (e.alternance ? " checked" : "") + '> Alternance semaines A/B</label></div>'
        + '<div class="champ"><label>Récréation du matin</label><div class="duo">' + champHeure(p + "r1d", r[0] && r[0].debut) + "–" + champHeure(p + "r1f", r[0] && r[0].fin) + '</div></div>'
        + '<div class="champ"><label>Récréation de l\'après-midi</label><div class="duo">' + champHeure(p + "r2d", r[1] && r[1].debut) + "–" + champHeure(p + "r2f", r[1] && r[1].fin) + '</div></div>'
        + '<div class="champ"><label>Pause méridienne</label><div class="duo">' + champHeure(p + "md", e.meridienne && e.meridienne.debut) + "–" + champHeure(p + "mf", e.meridienne && e.meridienne.fin) + '</div></div>'
        + '<div class="champ"><label>Plage de pause repas des AESH</label><div class="duo">' + champHeure(p + "pd", e.pauseRepas && e.pauseRepas.debut) + "–" + champHeure(p + "pf", e.pauseRepas && e.pauseRepas.fin) + '</div></div>'
        + '</div><div class="jours-ouvres">Jours de classe : '
        + JOURS_OUVRABLES.map(function (j) { return '<label class="case"><input type="checkbox" data-jour="' + j + '"' + ((e.joursOuvres || []).indexOf(j) > -1 ? " checked" : "") + '> ' + j + '</label>'; }).join("")
        + '</div><div class="actions"><button type="button" class="btn btn-vide" data-enregistrer-etab>Enregistrer</button></div></div>';
    }).join("");
    Array.prototype.forEach.call(hote.querySelectorAll("[data-enregistrer-etab]"), function (b) {
      b.addEventListener("click", function () { enregistrerEtablissement(this.closest(".etab-param")); });
    });
  }
  function enregistrerEtablissement(bloc) {
    var p = bloc.dataset.prefixe, e = JSON.parse(JSON.stringify(etablissementParId(bloc.dataset.etab)));
    function h(id) { return M.heureNormalisee($(p + id).value); }
    function plage(d, f, libelle, facultatif) {
      var a = h(d), b = h(f);
      if (facultatif && !$(p + d).value.trim() && !$(p + f).value.trim()) return null;
      if (!a || !b || M.minutes(b) <= M.minutes(a)) throw new Error(libelle);
      return { debut: a, fin: b };
    }
    try {
      e.type = $(p + "type").value;
      e.alternance = $(p + "alt").checked;
      e.recreations = [plage("r1d", "r1f", "récréation du matin", true), plage("r2d", "r2f", "récréation de l'après-midi", true)].filter(Boolean);
      e.meridienne = plage("md", "mf", "pause méridienne", true);
      e.pauseRepas = plage("pd", "pf", "plage de pause repas");
    } catch (err) {
      ui.toast("Horaires invalides : " + err.message + " (format hh:mm, fin après le début).");
      return;
    }
    e.joursOuvres = Array.prototype.filter.call(bloc.querySelectorAll("[data-jour]"), function (c) { return c.checked; }).map(function (c) { return c.dataset.jour; });
    PialDB.appliquer([{ magasin: "etablissements", enregistrer: [e] }]).then(recharger).then(function () {
      rendreEtablissements();
      ui.toast("Paramètres de « " + e.nom + " » enregistrés.");
      if (typeof PialAffectations.surChangement === "function") PialAffectations.surChangement();
    });
  }

  /* =============== réglages : règles de calcul =============== */
  function rendreRegles() {
    var r = M.contexte({ reglages: etat.reglages }).reglages;
    $("reg-duree-reelle").checked = !!r.dureeReelle;
    $("reg-indispos").checked = !!r.respecterIndispos;
    $("reg-pause").value = r.pauseRepasMin;
  }
  $("reg-enregistrer-regles").addEventListener("click", function () {
    var pause = parseInt($("reg-pause").value, 10);
    if (isNaN(pause) || pause < 0 || pause > 120) { ui.toast("Durée de pause invalide (0 à 120 minutes)."); return; }
    var valeur = {};
    Object.keys(etat.reglages).forEach(function (k) { valeur[k] = etat.reglages[k]; });
    valeur.dureeReelle = $("reg-duree-reelle").checked;
    valeur.respecterIndispos = $("reg-indispos").checked;
    valeur.pauseRepasMin = pause;
    PialDB.appliquer([{ magasin: "parametres", enregistrer: [{ cle: "reglages", valeur: valeur }] }]).then(recharger).then(function () {
      ui.toast("Règles de calcul enregistrées.");
      if (typeof PialAffectations.surChangement === "function") PialAffectations.surChangement();
    });
  });

  /* =============== onglet Affectations : outils =============== */
  var semaineAffichee = "A";
  var eleveOuvert = null;     // id de l'élève dont la grille est affichée
  var ctxCourant = null, violationsParAff = {};

  var COULEURS_AESH = ["#1F3B63", "#2F6B4F", "#8A4FB0", "#B0473C", "#2A7F8F", "#9A6B12", "#5A5FC8", "#A33F7A",
    "#4F7A28", "#C25E1B", "#3E6E9E", "#7B5B3A", "#0F7A5C", "#6B4C9A", "#8F2D2D", "#2F5F7A"];
  function aeshTriees() {
    return etat.aesh.slice().sort(function (a, b) { return (txt(a.nom) + " " + txt(a.prenom)).localeCompare(txt(b.nom) + " " + txt(b.prenom), "fr"); });
  }
  function couleurAesh(id) {
    var i = aeshTriees().map(function (a) { return a.id; }).indexOf(id);
    return COULEURS_AESH[(i < 0 ? 0 : i) % COULEURS_AESH.length];
  }
  function aeshParId(id) { return etat.aesh.filter(function (a) { return a.id === id; })[0]; }
  function eleveParId(id) { return etat.eleves.filter(function (e) { return e.id === id; })[0]; }
  function nomAesh(a) { return a ? a.prenom + " " + a.nom : "AESH inconnue"; }
  function initialesAesh(a) { return a ? (txt(a.prenom).charAt(0) + txt(a.nom).charAt(0)).toUpperCase() : "?"; }

  var LIB_ETAT_ELEVE = { sous: "sous-couvert", partiel: "partiellement couvert", couvert: "couvert", sur: "sur-couvert" };
  var LIB_ETAT_AESH = { depassement: "dépassement", complete: "charge complète", sous: "sous-utilisée" };

  function recalculer() {
    ctxCourant = contexte();
    violationsParAff = {};
    etat.affectations.forEach(function (a) { violationsParAff[a.id] = M.verifierAffectation(a, ctxCourant); });
  }
  function erreursDe(aff) { return (violationsParAff[aff.id] || []).filter(function (v) { return v.niveau === "erreur"; }); }

  var compteurId = 0;
  function nouvelId() { compteurId++; return "m-" + Date.now().toString(36) + "-" + compteurId; }

  /* =============== bandeau de synthèse =============== */
  function rendreSynthese(alertes) {
    var s = M.synthese(ctxCourant);
    $("aff-synthese").innerHTML =
      '<span class="bs-chiffre">Individuel : <strong>' + heures(s.indCouvert) + '</strong> / ' + heures(s.indDemande) + '</span>'
      + '<span class="bs-chiffre">Mutualisé : <strong>' + heures(s.mutCouvert) + '</strong> / ' + heures(s.mutDemande) + '</span>'
      + '<span class="bs-chiffre"><strong>' + s.elevesSous + '</strong> élève(s) sous-couvert(s)</span>'
      + '<span class="bs-chiffre"><strong>' + s.aeshDepassement + '</strong> AESH en dépassement · <strong>' + s.aeshSous + '</strong> sous-utilisée(s)</span>'
      + '<span class="bs-chiffre"><strong>' + alertes.length + '</strong> alerte(s)</span>'
      + '<span class="bs-actions">'
      + '<span class="selecteur-semaine" role="group" aria-label="Semaine affichée">'
      + '<button type="button" data-semaine="A" aria-pressed="' + (semaineAffichee === "A") + '">Semaine A</button>'
      + '<button type="button" data-semaine="B" aria-pressed="' + (semaineAffichee === "B") + '">Semaine B</button></span>'
      + '<button type="button" class="btn btn-vide" disabled title="Disponible avec le moteur de proposition (phase 2)">Proposer</button>'
      + '<button type="button" class="btn btn-vide" disabled title="Disponible avec les versions (phase 2)">Valider la version</button>'
      + '</span>';
    Array.prototype.forEach.call($("aff-synthese").querySelectorAll("[data-semaine]"), function (b) {
      b.addEventListener("click", function () { semaineAffichee = this.dataset.semaine; rendreAffectations(); });
    });
  }

  /* =============== filtres =============== */
  function remplirSelect(id, valeurs, libelleTous) {
    var sel = $(id), val = sel.value;
    sel.innerHTML = '<option value="">' + libelleTous + '</option>' + valeurs.map(function (v) {
      return '<option value="' + ech(v.valeur) + '">' + ech(v.libelle) + '</option>';
    }).join("");
    if (valeurs.some(function (v) { return v.valeur === val; })) sel.value = val;
  }
  function remplirFiltres() {
    remplirSelect("af-etab", etat.etablissements.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); })
      .map(function (e) { return { valeur: e.id, libelle: e.nom }; }), "Tous");
    var niveaux = {}, classes = {};
    etat.eleves.forEach(function (e) {
      if ($("af-etab").value && e.etablissement !== $("af-etab").value) return;
      niveaux[M.niveauClasse(e.classe)] = true; classes[e.classe] = true;
    });
    remplirSelect("af-niveau", M.NIVEAUX.filter(function (n) { return niveaux[n]; }).map(function (n) { return { valeur: n, libelle: n }; }), "Tous");
    remplirSelect("af-classe", Object.keys(classes).sort(function (a, b) { return a.localeCompare(b, "fr", { numeric: true }); })
      .map(function (c) { return { valeur: c, libelle: c }; }), "Toutes");
    remplirSelect("af-aesh", aeshTriees().map(function (a) { return { valeur: a.id, libelle: nomAesh(a) }; }), "Toutes");
  }
  ["af-etab", "af-niveau", "af-classe", "af-aesh", "af-etat"].forEach(function (id) {
    $(id).addEventListener("change", function () { if (id === "af-etab") remplirFiltres(); rendreAffectations(); });
  });
  $("af-reinitialiser").addEventListener("click", function () {
    ["af-etab", "af-niveau", "af-classe", "af-aesh", "af-etat"].forEach(function (id) { $(id).value = ""; });
    remplirFiltres(); rendreAffectations();
  });

  /* =============== vue d'ensemble =============== */
  function jauge(libelle, couvert, cible, etatJauge, titre) {
    var pct = cible > 0 ? Math.min(100, Math.round(couvert / cible * 100)) : (couvert > 0 ? 100 : 0);
    return '<div class="jauge" title="' + ech(titre || "") + '"><span class="j-lib">' + libelle + '</span>'
      + '<span class="j-barre"><span class="e-' + etatJauge + '" style="width:' + pct + '%"></span></span>'
      + '<span class="j-val">' + heures(couvert) + ' / ' + heures(cible) + '</span></div>';
  }
  function titreAB(partie, nom) {
    return partie.A !== partie.B ? nom + " — semaine A : " + heures(partie.A) + ", semaine B : " + heures(partie.B) : nom;
  }
  function jaugesEleve(e, cv) {
    var h = "";
    if (cv.ind.notifie > 0 || cv.ind.moy > 0) h += jauge("Individuel", cv.ind.moy, cv.ind.notifie, cv.ind.etat, titreAB(cv.ind, LIB_ETAT_ELEVE[cv.ind.etat]));
    if (cv.mut.notifie > 0 || cv.mut.moy > 0) h += jauge("Mutualisé", cv.mut.moy, cv.mut.notifie, cv.mut.etat, titreAB(cv.mut, LIB_ETAT_ELEVE[cv.mut.etat]));
    if (cv.peri.moy > 0 || e.recreation || e.meridienne) h += '<div class="jauge"><span class="j-lib">Périscol.</span><span class="j-barre"></span><span class="j-val">' + heures(cv.peri.moy) + '</span></div>';
    return h;
  }
  function elevesFiltres() {
    var fe = $("af-etab").value, fn = $("af-niveau").value, fc = $("af-classe").value, fa = $("af-aesh").value, fs = $("af-etat").value;
    return etat.eleves.filter(function (e) {
      if (fe && e.etablissement !== fe) return false;
      if (fn && M.niveauClasse(e.classe) !== fn) return false;
      if (fc && e.classe !== fc) return false;
      if (fa && !etat.affectations.some(function (a) { return a.aeshId === fa && a.eleves.indexOf(e.id) > -1; })) return false;
      if (fs && fs.indexOf("eleve:") === 0 && M.couvertureEleve(e, ctxCourant).etat !== fs.slice(6)) return false;
      return true;
    }).sort(function (a, b) {
      return nomEtablissement(a.etablissement).localeCompare(nomEtablissement(b.etablissement), "fr")
        || a.classe.localeCompare(b.classe, "fr", { numeric: true }) || a.nomCourt.localeCompare(b.nomCourt, "fr");
    });
  }
  function aeshFiltrees() {
    var fe = $("af-etab").value, fa = $("af-aesh").value, fs = $("af-etat").value;
    return aeshTriees().filter(function (a) {
      if (fa && a.id !== fa) return false;
      if (fe && (a.etablissements || []).length && a.etablissements.indexOf(fe) < 0) return false;
      if (fs && fs.indexOf("aesh:") === 0 && M.chargeAesh(a, ctxCourant).etat !== fs.slice(5)) return false;
      return true;
    });
  }
  function rendreEnsemble() {
    var eleves = elevesFiltres();
    $("aff-liste-eleves").innerHTML = eleves.length ? eleves.map(function (e) {
      var cv = M.couvertureEleve(e, ctxCourant);
      return '<li data-eleve="' + ech(e.id) + '" tabindex="0"><div class="lj-tete"><span class="lj-nom">' + ech(e.nomCourt) + '</span>'
        + '<span class="lj-meta">' + ech(e.classe) + ' · ' + ech(nomEtablissement(e.etablissement)) + '</span></div>' + jaugesEleve(e, cv) + '</li>';
    }).join("") : '<li class="vide">' + (etat.eleves.length ? "Aucun élève ne correspond à ces filtres." : "Aucun élève : importez le fichier des élèves (onglet Importer).") + '</li>';
    var aesh = aeshFiltrees();
    $("aff-liste-aesh").innerHTML = aesh.length ? aesh.map(function (a) {
      var ch = M.chargeAesh(a, ctxCourant);
      var titre = LIB_ETAT_AESH[ch.etat] + (ch.A !== ch.B ? " — semaine A : " + heures(ch.A) + ", semaine B : " + heures(ch.B) : "");
      return '<li data-aesh="' + ech(a.id) + '" tabindex="0"' + ($("af-aesh").value === a.id ? ' class="actif"' : '') + '><div class="lj-tete"><span class="lj-nom">'
        + '<span class="puce-aesh" style="background:' + couleurAesh(a.id) + '">' + ech(initialesAesh(a)) + '</span> ' + ech(nomAesh(a)) + '</span>'
        + '<span class="lj-meta">' + ((a.etablissements || []).length ? ech(a.etablissements.map(nomEtablissement).join(", ")) : "tous établissements") + '</span></div>'
        + jauge("Charge", ch.moy, ch.quotite, ch.etat, titre) + '</li>';
    }).join("") : '<li class="vide">' + (etat.aesh.length ? "Aucune AESH ne correspond à ces filtres." : "Aucune AESH : importez le fichier des AESH.") + '</li>';
    Array.prototype.forEach.call($("aff-liste-eleves").querySelectorAll("[data-eleve]"), function (li) {
      li.addEventListener("click", function () { ouvrirGrilleEleve(this.dataset.eleve); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") ouvrirGrilleEleve(this.dataset.eleve); });
    });
    Array.prototype.forEach.call($("aff-liste-aesh").querySelectorAll("[data-aesh]"), function (li) {
      function basculer() { $("af-aesh").value = $("af-aesh").value === li.dataset.aesh ? "" : li.dataset.aesh; rendreAffectations(); }
      li.addEventListener("click", basculer);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") basculer(); });
    });
  }

  /* =============== grille élève =============== */
  // affectations de l'élève sur un créneau horaire, pour une semaine donnée
  function affsEleveCreneau(eleveId, etab, jour, debut, fin, semaine) {
    return etat.affectations.filter(function (a) {
      return a.eleves.indexOf(eleveId) > -1 && a.creneau.etab === etab && a.creneau.jour === jour
        && a.creneau.debut === debut && a.creneau.fin === fin
        && (!semaine || M.semainesDe(a.creneau.semaine, etablissementParId(a.creneau.etab)).indexOf(semaine) > -1);
    });
  }
  // cases de la grille d'un élève pour la semaine affichée : cours + temps périscolaires
  function casesEleve(e) {
    var etab = etablissementParId(e.etablissement);
    var cases = (ctxCourant._coursParEleve[e.id] || []).filter(function (c) {
      return M.semainesDe(c.semaine, etab).indexOf(semaineAffichee) > -1;
    }).map(function (c) { return { type: "cours", cours: c, jour: c.jour, debut: c.debut, fin: c.fin }; });
    M.creneauxPeriscolaires(e, ctxCourant).forEach(function (p) {
      cases.push({ type: "periscolaire", periscolaire: p.type, jour: p.creneau.jour, debut: p.creneau.debut, fin: p.creneau.fin });
    });
    return cases;
  }
  function ouvrirGrilleEleve(id) {
    eleveOuvert = id;
    $("aff-ensemble").hidden = true;
    $("aff-grille-eleve").hidden = false;
    rendreGrilleEleve();
    window.scrollTo(0, 0);
  }
  $("aff-retour-ensemble").addEventListener("click", function () {
    eleveOuvert = null;
    $("aff-grille-eleve").hidden = true;
    $("aff-ensemble").hidden = false;
    rendreEnsemble();
  });

  function puceAff(aff) {
    var a = aeshParId(aff.aeshId), conflit = erreursDe(aff).length > 0;
    var titre = nomAesh(a) + (aff.modalite === "mutualise" ? " (mutualisé, " + aff.eleves.length + " élève(s))" : aff.modalite === "periscolaire" ? " (périscolaire)" : " (individuel)")
      + (aff.creneau.semaine !== "toutes" ? " — semaine " + aff.creneau.semaine : "")
      + (conflit ? " — " + erreursDe(aff).map(function (v) { return v.message; }).join(" ") : "");
    return '<span class="puce-aesh' + (conflit ? " conflit" : "") + '" style="background:' + couleurAesh(aff.aeshId) + '" title="' + ech(titre) + '">'
      + (aff.epinglee ? "🔒" : "") + ech(initialesAesh(a)) + (aff.modalite === "mutualise" ? "+" : "") + (conflit ? " ⚠" : "") + '</span>';
  }

  function rendreGrilleEleve() {
    var e = eleveParId(eleveOuvert);
    if (!e) { $("aff-retour-ensemble").click(); return; }
    var etab = etablissementParId(e.etablissement) || M.etablissementParDefaut(e.etablissement);
    var cv = M.couvertureEleve(e, ctxCourant);
    $("ge-titre").textContent = e.nomCourt + " — " + e.classe;
    $("ge-sous-titre").textContent = nomEtablissement(e.etablissement) + " · notifié : "
      + [e.heuresInd ? heures(e.heuresInd) + " individuelles" : "", e.heuresMut ? heures(e.heuresMut) + " mutualisées" : "",
        e.recreation ? "récréations" : "", e.meridienne ? "pause méridienne" : ""].filter(Boolean).join(", ")
      + (e.finNotif ? " · fin de notification le " + e.finNotif.split("-").reverse().join("/") : "")
      + (etab.alternance ? " · semaine " + semaineAffichee + " affichée" : "");
    $("ge-jauges").innerHTML = '<span class="pastille-etat e-' + cv.etat + '">' + LIB_ETAT_ELEVE[cv.etat] + '</span>' + jaugesEleve(e, cv);
    var cases = casesEleve(e);
    var jours = (etab.joursOuvres && etab.joursOuvres.length ? etab.joursOuvres : M.JOURS.slice(0, 5)).slice();
    cases.forEach(function (c) { if (jours.indexOf(c.jour) < 0) jours.push(c.jour); });
    jours.sort(function (a, b) { return M.JOURS.indexOf(a) - M.JOURS.indexOf(b); });
    var lignes = {};
    cases.forEach(function (c) { lignes[c.debut + "-" + c.fin] = { debut: c.debut, fin: c.fin }; });
    var ordre = Object.keys(lignes).map(function (k) { return lignes[k]; })
      .sort(function (a, b) { return M.minutes(a.debut) - M.minutes(b.debut) || M.minutes(a.fin) - M.minutes(b.fin); });
    var h = '<thead><tr><th class="heure">Horaire</th>' + jours.map(function (j) { return "<th>" + j + "</th>"; }).join("") + '</tr></thead><tbody>';
    if (!ordre.length) h += '<tr><td colspan="' + (jours.length + 1) + '" class="vide">Aucun cours importé pour cet élève (semaine ' + semaineAffichee + ').</td></tr>';
    ordre.forEach(function (l) {
      h += '<tr><td class="heure">' + l.debut + '–' + l.fin + '</td>';
      jours.forEach(function (j) {
        var ici = cases.filter(function (c) { return c.jour === j && c.debut === l.debut && c.fin === l.fin; });
        h += "<td>" + ici.map(function (c, k) {
          var affs = affsEleveCreneau(e.id, e.etablissement, j, l.debut, l.fin, semaineAffichee);
          var cle = j + "|" + l.debut + "|" + l.fin + "|" + k;
          if (c.type === "periscolaire") {
            return '<div class="cellule-cours periscolaire" tabindex="0" data-case="' + ech(cle) + '"><div class="cc-mat">' + (c.periscolaire === "meridienne" ? "Pause méridienne" : "Récréation") + '</div>'
              + affs.filter(function (a) { return a.modalite === "periscolaire"; }).map(puceAff).join("") + '</div>';
          }
          var co = c.cours;
          return '<div class="cellule-cours ' + (co.etat !== "normal" ? co.etat : "") + '" tabindex="0" data-case="' + ech(cle) + '">'
            + '<div class="cc-mat">' + ech(co.matiere) + (co.groupe ? " · " + ech(co.groupe) : "") + (co.semaine ? " (sem. " + co.semaine + ")" : "") + '</div>'
            + (co.etat !== "normal" ? '<div class="cc-etat">' + co.etat + '</div>' : "")
            + affs.filter(function (a) { return a.modalite !== "periscolaire"; }).map(puceAff).join("") + '</div>';
        }).join("") + "</td>";
      });
      h += "</tr>";
    });
    $("ge-table").innerHTML = h + "</tbody>";
    var index = {};
    jours.forEach(function (j) {
      ordre.forEach(function (l) {
        cases.filter(function (c) { return c.jour === j && c.debut === l.debut && c.fin === l.fin; })
          .forEach(function (c, k) { index[j + "|" + l.debut + "|" + l.fin + "|" + k] = c; });
      });
    });
    Array.prototype.forEach.call($("ge-table").querySelectorAll("[data-case]"), function (d) {
      d.addEventListener("click", function () { ouvrirMenuCreneau(e, index[this.dataset.case]); });
      d.addEventListener("keydown", function (ev) { if (ev.key === "Enter") ouvrirMenuCreneau(e, index[this.dataset.case]); });
    });
  }

  /* =============== menu d'un créneau (§7.1) =============== */
  var menu = null; // {eleve, cas, modalite, semaine}

  function modalitesPossibles(e, cas) {
    if (cas.type === "periscolaire") return ["periscolaire"];
    var m = [];
    if (e.heuresInd > 0) m.push("individuel");
    if (e.heuresMut > 0) m.push("mutualise");
    return m.length ? m : ["individuel"];
  }
  var LIB_MODALITE = { individuel: "Individuel", mutualise: "Mutualisé", periscolaire: "Périscolaire" };

  function ouvrirMenuCreneau(e, cas) {
    if (!cas) return;
    var etab = etablissementParId(e.etablissement);
    menu = {
      eleve: e, cas: cas, modalite: modalitesPossibles(e, cas)[0],
      semaine: cas.type === "cours" && cas.cours.semaine ? cas.cours.semaine : "toutes",
      alternance: !!(etab && etab.alternance)
    };
    rendreMenu();
    $("voile-creneau").hidden = false;
    $("mc-fermer").focus();
  }
  function fermerMenu() { menu = null; $("voile-creneau").hidden = true; }
  $("mc-fermer").addEventListener("click", fermerMenu);
  $("voile-creneau").addEventListener("click", function (ev) { if (ev.target === this) fermerMenu(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && menu) fermerMenu(); });

  function creneauMenu() {
    var c = menu.cas;
    return { etab: menu.eleve.etablissement, jour: c.jour, debut: c.debut, fin: c.fin, semaine: menu.semaine };
  }
  // affectations de l'élève sur ce créneau, toutes semaines confondues
  function affsActuelles() {
    var c = menu.cas;
    return affsEleveCreneau(menu.eleve.id, menu.eleve.etablissement, c.jour, c.debut, c.fin, null).filter(function (a) {
      return menu.cas.type === "periscolaire" ? a.modalite === "periscolaire" : a.modalite !== "periscolaire";
    });
  }
  // affectation qu'une AESH a déjà sur ce créneau et que l'élève peut rejoindre :
  // mutualisé = même classe, même cours, même groupe (§2.4) ; périscolaire =
  // même temps périscolaire. Sinon l'AESH est simplement « déjà occupée ».
  function affARejoindre(aeshId) {
    if (menu.modalite === "individuel") return null;
    var cr = creneauMenu();
    return etat.affectations.filter(function (a) {
      if (!(a.aeshId === aeshId && a.modalite === menu.modalite && a.creneau.etab === cr.etab && a.creneau.jour === cr.jour
        && a.creneau.debut === cr.debut && a.creneau.fin === cr.fin && a.creneau.semaine === cr.semaine
        && a.eleves.indexOf(menu.eleve.id) < 0)) return false;
      if (a.modalite === "periscolaire") return a.periscolaire === menu.cas.periscolaire;
      return a.eleves.every(function (id) {
        return M.coursSurCreneau(id, a.creneau, ctxCourant).some(function (co) { return M.memeCours(co, menu.cas.cours); });
      });
    })[0] || null;
  }
  function candidat(aeshId) {
    var rejoindre = affARejoindre(aeshId);
    return {
      remplaceId: rejoindre ? rejoindre.id : null,
      aff: {
        creneau: rejoindre ? rejoindre.creneau : creneauMenu(), modalite: menu.modalite,
        periscolaire: menu.cas.type === "periscolaire" ? menu.cas.periscolaire : undefined,
        eleves: (rejoindre ? rejoindre.eleves : []).concat([menu.eleve.id])
      }
    };
  }

  function rendreMenu() {
    var e = menu.eleve, c = menu.cas;
    $("mc-titre").textContent = e.nomCourt + " — " + c.jour + " " + c.debut + "–" + c.fin;
    $("mc-sous-titre").textContent = c.type === "periscolaire"
      ? (c.periscolaire === "meridienne" ? "Pause méridienne" : "Récréation") + " · " + nomEtablissement(e.etablissement)
      : c.cours.matiere + (c.cours.groupe ? " · " + c.cours.groupe : "") + " · " + e.classe + " · " + nomEtablissement(e.etablissement)
        + (c.cours.semaine ? " · semaine " + c.cours.semaine + " seulement" : "");
    var h = "";

    // affectations en place
    var actuelles = affsActuelles();
    h += '<div class="mc-section"><h4>Affectation actuelle</h4>';
    h += actuelles.length ? actuelles.map(function (a) {
      var v = violationsParAff[a.id] || [];
      var autres = a.eleves.filter(function (id) { return id !== e.id; }).map(function (id) { var x = eleveParId(id); return x ? x.nomCourt : id; });
      return '<div class="mc-actuelle">' + puceAff(a) + " <strong>" + ech(nomAesh(aeshParId(a.aeshId))) + "</strong> · " + LIB_MODALITE[a.modalite]
        + (a.creneau.semaine !== "toutes" ? " · semaine " + a.creneau.semaine : "")
        + (autres.length ? " · avec " + ech(autres.join(", ")) : "")
        + v.map(function (x) { return '<div class="' + (x.niveau === "erreur" ? "mc-alerte" : "mc-info") + '">' + (x.niveau === "erreur" ? "⚠ " : "ℹ ") + ech(x.message) + '</div>'; }).join("")
        + '<div class="actions" style="margin-top:6px">'
        + '<button type="button" class="btn btn-vide" data-epingler="' + ech(a.id) + '">' + (a.epinglee ? "Désépingler" : "Épingler") + '</button>'
        + '<button type="button" class="btn btn-danger" data-retirer="' + ech(a.id) + '">Retirer' + (autres.length ? " cet élève" : "") + '</button></div></div>';
    }).join("") : '<p class="aide">Aucune AESH sur ce créneau.</p>';
    h += '</div>';

    // état du cours
    if (c.type === "cours") {
      h += '<div class="mc-section"><h4>État du créneau</h4><div class="mc-boutons">'
        + ["prioritaire", "normal", "exclu"].map(function (s) {
          return '<button type="button" class="btn btn-vide" data-etat-cours="' + s + '" aria-pressed="' + (c.cours.etat === s) + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</button>';
        }).join("") + '</div></div>';
    }

    // paramètres de la nouvelle affectation
    var modalites = modalitesPossibles(e, c);
    if (modalites.length > 1) {
      h += '<div class="mc-section"><h4>Modalité</h4><div class="mc-boutons">' + modalites.map(function (m) {
        return '<button type="button" class="btn btn-vide" data-modalite="' + m + '" aria-pressed="' + (menu.modalite === m) + '">' + LIB_MODALITE[m] + '</button>';
      }).join("") + '</div></div>';
    }
    if (menu.alternance && !(c.type === "cours" && c.cours.semaine)) {
      h += '<div class="mc-section"><h4>Semaines</h4><div class="mc-boutons">' + [["toutes", "A et B"], ["A", "Semaine A seulement"], ["B", "Semaine B seulement"]].map(function (s) {
        return '<button type="button" class="btn btn-vide" data-semaine-menu="' + s[0] + '" aria-pressed="' + (menu.semaine === s[0]) + '">' + s[1] + '</button>';
      }).join("") + '</div></div>';
    }

    // AESH disponibles, puis indisponibles grisées avec le motif
    var dejaLa = {};
    actuelles.forEach(function (a) { dejaLa[a.aeshId] = true; });
    var dispo = [], indispo = [];
    aeshTriees().forEach(function (a) {
      if (dejaLa[a.id]) return;
      var cand = candidat(a.id);
      var motifs = M.motifsIndisponibilite(a.id, cand.aff, ctxCourant, cand.remplaceId);
      var rejoint = cand.remplaceId ? etat.affectations.filter(function (x) { return x.id === cand.remplaceId; })[0] : null;
      var info = rejoint ? "rejoint le groupe de " + rejoint.eleves.map(function (id) { var x = eleveParId(id); return x ? x.nomCourt : id; }).join(", ") : "";
      (motifs.length ? indispo : dispo).push({ a: a, motifs: motifs, info: info });
    });
    function ligne(x, dispoAesh) {
      var ch = M.chargeAesh(x.a, ctxCourant);
      return '<li class="' + (dispoAesh ? "" : "indispo") + '"><span><span class="puce-aesh" style="background:' + couleurAesh(x.a.id) + (dispoAesh ? "" : ";opacity:.5") + '">' + ech(initialesAesh(x.a)) + '</span> '
        + ech(nomAesh(x.a)) + ' <span class="aide">(' + heures(ch.moy) + ' / ' + heures(ch.quotite) + ')</span>'
        + (x.info ? '<span class="mc-motif">' + ech(x.info) + '</span>' : "")
        + (x.motifs.length ? '<span class="mc-motif">' + x.motifs.map(function (m) { return ech(m.message); }).join(" · ") + '</span>' : "") + '</span>'
        + '<button type="button" class="btn ' + (dispoAesh ? "btn-plein" : "btn-danger") + '" data-affecter="' + ech(x.a.id) + '">' + (dispoAesh ? "Affecter" : "Affecter quand même") + '</button></li>';
    }
    h += '<div class="mc-section"><h4>' + (actuelles.length ? "Ajouter ou changer d'AESH" : "Affecter une AESH") + ' — ' + LIB_MODALITE[menu.modalite].toLowerCase() + '</h4>';
    if (c.type === "cours" && c.cours.etat === "exclu") h += '<p class="note alerte">Créneau exclu : une affectation ici sera signalée dans les alertes.</p>';
    h += etat.aesh.length ? '<ul class="mc-aesh">' + dispo.map(function (x) { return ligne(x, true); }).join("") + indispo.map(function (x) { return ligne(x, false); }).join("") + '</ul>'
      : '<p class="aide">Aucune AESH : importez d\'abord le fichier des AESH.</p>';
    if (actuelles.length && menu.modalite === "individuel") h += '<p class="aide">En individuel, choisir une autre AESH remplace l\'affectation actuelle.</p>';
    h += '</div>';
    $("mc-corps").innerHTML = h;

    function chaque(sel, fn) { Array.prototype.forEach.call($("mc-corps").querySelectorAll(sel), function (b) { b.addEventListener("click", fn); }); }
    chaque("[data-modalite]", function () { menu.modalite = this.dataset.modalite; rendreMenu(); });
    chaque("[data-semaine-menu]", function () { menu.semaine = this.dataset.semaineMenu; rendreMenu(); });
    chaque("[data-etat-cours]", function () { changerEtatCours(this.dataset.etatCours); });
    chaque("[data-affecter]", function () { affecter(this.dataset.affecter); });
    chaque("[data-retirer]", function () { retirer(this.dataset.retirer); });
    chaque("[data-epingler]", function () { basculerEpingle(this.dataset.epingler); });
  }

  /* =============== modifications (toute saisie manuelle épingle, §5.4) =============== */
  function enregistrerPuisRendre(ops, message) {
    return PialDB.appliquer(ops).then(recharger).then(function () {
      rendreAffectations();
      if (menu) {
        // l'élève et le cours ont pu être rechargés : on rafraîchit les références
        menu.eleve = eleveParId(menu.eleve.id) || menu.eleve;
        if (menu.cas.type === "cours") menu.cas.cours = etat.cours.filter(function (c) { return c.id === menu.cas.cours.id; })[0] || menu.cas.cours;
        rendreMenu();
      }
      if (message) ui.toast(message);
    });
  }
  function avecAlertes(aff) {
    var ctx = M.contexte({ etablissements: etat.etablissements, eleves: etat.eleves, aesh: etat.aesh, cours: etat.cours,
      affectations: etat.affectations.filter(function (a) { return a.id !== aff.id; }).concat([aff]), reglages: etat.reglages });
    aff.alertes = M.verifierAffectation(aff, ctx).map(function (v) { return v.message; });
    return aff;
  }
  function affecter(aeshId) {
    var cand = candidat(aeshId), ops = [];
    var aff;
    if (cand.remplaceId) {
      aff = JSON.parse(JSON.stringify(etat.affectations.filter(function (a) { return a.id === cand.remplaceId; })[0]));
      aff.eleves = cand.aff.eleves;
    } else {
      aff = { id: nouvelId(), annee: anneeCourante(), version: 0, aeshId: aeshId, creneau: cand.aff.creneau, modalite: menu.modalite,
        eleves: cand.aff.eleves, raisons: [] };
      if (cand.aff.periscolaire) aff.periscolaire = cand.aff.periscolaire;
    }
    aff.creneauCle = M.creneauCle(aff.creneau);
    aff.epinglee = true;
    aff.origine = "manuel";
    // en individuel, la nouvelle AESH remplace l'affectation individuelle en place
    // (sur les semaines concernées)
    var semaines = M.semainesDe(aff.creneau.semaine, etablissementParId(aff.creneau.etab));
    var remplacees = menu.modalite === "individuel" ? affsActuelles().filter(function (a) {
      return a.modalite === "individuel" && M.semainesDe(a.creneau.semaine, etablissementParId(a.creneau.etab)).some(function (s) { return semaines.indexOf(s) > -1; });
    }) : [];
    ops.push({ magasin: "affectations", supprimer: remplacees.map(function (a) { return a.id; }), enregistrer: [avecAlertes(aff)] });
    var a = aeshParId(aeshId);
    enregistrerPuisRendre(ops, nomAesh(a) + " affectée à " + menu.eleve.nomCourt + (aff.alertes.length ? " — attention : contrainte non respectée." : "."));
  }
  function retirer(affId) {
    var aff = etat.affectations.filter(function (a) { return a.id === affId; })[0];
    if (!aff) return;
    var restants = aff.eleves.filter(function (id) { return id !== menu.eleve.id; });
    var op;
    if (restants.length) {
      var b = JSON.parse(JSON.stringify(aff));
      b.eleves = restants; b.epinglee = true; b.origine = "manuel";
      op = { magasin: "affectations", enregistrer: [avecAlertes(b)] };
    } else op = { magasin: "affectations", supprimer: [affId] };
    enregistrerPuisRendre([op], "Affectation retirée.");
  }
  function basculerEpingle(affId) {
    var aff = JSON.parse(JSON.stringify(etat.affectations.filter(function (a) { return a.id === affId; })[0]));
    aff.epinglee = !aff.epinglee;
    enregistrerPuisRendre([{ magasin: "affectations", enregistrer: [aff] }], aff.epinglee ? "Affectation épinglée." : "Affectation désépinglée.");
  }
  function changerEtatCours(nouvelEtat) {
    var co = JSON.parse(JSON.stringify(menu.cas.cours));
    if (co.etat === nouvelEtat) return;
    co.etat = nouvelEtat;
    enregistrerPuisRendre([{ magasin: "cours", enregistrer: [co] }], "Créneau marqué « " + nouvelEtat + " ».");
  }

  /* =============== panneau d'alertes =============== */
  function rendreAlertes(alertes) {
    $("aff-nb-alertes").textContent = "(" + alertes.length + ")";
    $("aff-liste-alertes").innerHTML = alertes.length ? alertes.map(function (al, i) {
      var cible = al.eleveId ? eleveParId(al.eleveId) : null;
      var prefixe = "";
      if (al.type === "conflit") {
        var a = aeshParId(al.aeshId);
        prefixe = "<strong>" + ech(nomAesh(a)) + "</strong> · " + ech(al.creneau.jour + " " + al.creneau.debut) + (cible ? " · " + ech(cible.nomCourt) : "") + "<br>";
      }
      return '<li class="' + al.niveau + '" data-alerte="' + i + '" tabindex="0">' + prefixe + ech(al.message) + '</li>';
    }).join("") : '<li class="info">Aucune alerte.</li>';
    Array.prototype.forEach.call($("aff-liste-alertes").querySelectorAll("[data-alerte]"), function (li) {
      function aller() {
        var al = alertes[parseInt(li.dataset.alerte, 10)];
        if (al.creneau && al.creneau.semaine !== "toutes") semaineAffichee = al.creneau.semaine;
        if (al.eleveId && eleveParId(al.eleveId)) {
          ouvrirGrilleEleve(al.eleveId);
          if (al.creneau) {
            var cible = Array.prototype.filter.call($("ge-table").querySelectorAll("[data-case]"), function (d) {
              return d.dataset.case.indexOf(al.creneau.jour + "|" + al.creneau.debut + "|" + al.creneau.fin + "|") === 0;
            })[0];
            if (cible) { cible.scrollIntoView({ block: "center" }); cible.focus(); }
          }
        } else if (al.aeshId) {
          $("af-aesh").value = al.aeshId;
          if (eleveOuvert) $("aff-retour-ensemble").click(); else rendreAffectations();
        }
      }
      li.addEventListener("click", aller);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") aller(); });
    });
  }
  $("aff-replier-alertes").addEventListener("click", function () {
    var replie = $("aff-disposition").classList.toggle("alertes-repliees");
    this.textContent = replie ? "Déplier" : "Replier";
    this.setAttribute("aria-expanded", String(!replie));
  });

  /* =============== rendu de l'onglet =============== */
  function rendreAffectations() {
    recalculer();
    var alertes = M.alertes(ctxCourant, aujourdhui());
    rendreSynthese(alertes);
    rendreAlertes(alertes);
    if (eleveOuvert) rendreGrilleEleve(); else rendreEnsemble();
  }
  function ouvrirOnglet() { remplirFiltres(); rendreAffectations(); }

  /* =============== initialisation =============== */
  function initialiser(outils) {
    ui = outils;
    rendreEtablissements();
    rendreRegles();
    PialAffectations.surChangement = function () {
      if (!$("vue-affectations").classList.contains("masque")) ouvrirOnglet();
    };
  }
  function rendreReglages() { rendreEtablissements(); rendreRegles(); }

  return {
    etat: etat, recharger: recharger, compteurs: compteurs, contexte: contexte,
    anneeCourante: anneeCourante, aujourdhui: aujourdhui, initialiser: initialiser,
    rendreReglages: rendreReglages, nomEtablissement: nomEtablissement, heures: heures, ouvrirOnglet: ouvrirOnglet,
    surChangement: null
  };
})();
