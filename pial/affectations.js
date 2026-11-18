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
      return '<tr><td>' + ech(c.entete.replace(/_/g, " ")) + (c.obligatoire ? " *" : "") + '</td>'
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

  /* =============== initialisation =============== */
  function initialiser(outils) {
    ui = outils;
    rendreEtablissements();
    rendreRegles();
  }
  function rendreReglages() { rendreEtablissements(); rendreRegles(); }

  return {
    etat: etat, recharger: recharger, compteurs: compteurs, contexte: contexte,
    anneeCourante: anneeCourante, aujourdhui: aujourdhui, initialiser: initialiser,
    rendreReglages: rendreReglages, nomEtablissement: nomEtablissement, heures: heures,
    surChangement: null
  };
})();
