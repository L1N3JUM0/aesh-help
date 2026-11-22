"use strict";

/* =====================================================================
   PialAffectations — module « Affectations » de l'espace PIAL
   (docs/SPEC-affectations-PIAL.md).

   Ce fichier tient l'état en mémoire du module (chargé depuis IndexedDB
   via PialDB) et l'interface : import des fichiers élèves / AESH /
   emplois du temps, paramètres des établissements, onglet Affectations.
   Toutes les règles de calcul sont dans modele.js (fonctions pures), la
   proposition automatique dans moteur.js.
   Les utilitaires d'interface communs (toast, confirmation renforcée,
   téléchargement, navigation) sont fournis par app.js via initialiser().
   ===================================================================== */
var PialAffectations = (function () {

  var M = PialModele, I = PialImport, P = PialMoteur;
  var ui = null; // {toast, confirmationForte, telecharger, vue}

  function $(id) { return document.getElementById(id); }
  function txt(s) { return String(s == null ? "" : s); }
  function ech(s) { return txt(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function pluriel(n, mot, motPluriel) { return n + " " + (n > 1 ? (motPluriel || mot + "s") : mot); }
  // séparateur lu à la copie (et par les lecteurs d'écran) mais invisible :
  // entre éléments flex, un simple espace disparaît (« 44 hMutualisé »)
  function sep(t) { return '<span class="sep-copie">' + t + '</span>'; }
  // minutes -> « 2 h », « 1 h 30 »
  function texteDuree(m) { return Math.floor(m / 60) + " h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") : ""); }
  function heures(x) { return (Math.round(x * 100) / 100).toString().replace(".", ",") + " h"; }

  /* =============== état en mémoire =============== */
  var etat = {
    etablissements: [], eleves: [], aesh: [], cours: [],
    affectations: [],          // brouillon (version 0) de l'année en cours
    affectationsVersions: [],  // copies figées des versions validées (version = numéro)
    versions: [], correspondances: {}, reglages: {},
    classes: {}, classesParam: null // référentiel des classes enregistré (Réglages) : {annee: {etab: [classe]}} et sa ligne de paramètres
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
      etat.affectationsVersions = parNom.affectations.filter(function (a) { return a.version > 0; });
      etat.versions = parNom.versions;
      etat.correspondances = {};
      parNom.correspondances.forEach(function (c) { etat.correspondances[c.type] = c.colonnes; });
      var reg = parNom.parametres.filter(function (p) { return p.cle === "reglages"; })[0];
      etat.reglages = (reg && reg.valeur) || {};
      var cl = parNom.parametres.filter(function (p) { return p.cle === "classes"; })[0];
      etat.classesParam = cl || null;
      etat.classes = (cl && cl.valeur) || {};
      // {signature, nbOrdres, ms, budget, date} : nombre d'ordres de la dernière proposition (§16)
      var prop = parNom.parametres.filter(function (p) { return p.cle === "proposition"; })[0];
      etat.proposition = (prop && prop.valeur) || null;
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
  function fusionnerObjet(type, existant, nouveau, garderAppli) {
    // cours : l'état vient du fichier s'il n'est pas « normal », sinon de
    // l'état déjà choisi pour ce cours, puis de celui de sa matière (fiche élève)
    if (type === "edt") {
      var c = {};
      Object.keys(nouveau).forEach(function (k) { c[k] = nouveau[k]; });
      c.etat = M.etatCoursImporte(nouveau, existant, eleveParId(nouveau.eleveId));
      return c;
    }
    if (!existant) return nouveau;
    var o = M.fusionEleve(existant, nouveau, garderAppli, type);
    if (type === "aesh") { o.ignorerIndispos = !!existant.ignorerIndispos; o.alias = existant.alias || []; }
    // temps périscolaires non gérés à l'import : on garde ce qui est en base
    if (type === "eleves") ["recreation", "meridienne"].forEach(function (k) { if (!(k in nouveau) && k in existant) o[k] = existant[k]; });
    if (type === "eleves" && (existant.etatsPeriscolaires || nouveau.etatsPeriscolaires)) {
      o.etatsPeriscolaires = {};
      [existant.etatsPeriscolaires, nouveau.etatsPeriscolaires].forEach(function (m) {
        Object.keys(m || {}).forEach(function (k) { o.etatsPeriscolaires[k] = m[k]; });
      });
    }
    return o;
  }

  $("imp-verifier").addEventListener("click", function () {
    var imp = importEnCours;
    if (!imp) return;
    var manquants = I.champsManquants(imp.type, imp.correspondance);
    if (manquants.length) { ui.toast("Colonne(s) obligatoire(s) non choisie(s) : " + manquants.join(", ") + "."); return; }
    imp.apercu = I.apercu(imp.type, imp.lignes.slice(1), imp.correspondance, { annee: anneeCourante(), elevesConnus: elevesConnus(),
      gererPeriscolaire: !!etat.reglages.gererPeriscolaire, specialites: M.contexte({ reglages: etat.reglages }).reglages.specialites });
    // identifiants internes (§3) : une fiche existante de même clé garde le sien
    imp.apercu.valides = M.attribuerIdentifiants(imp.type, imp.apercu.valides, existantsDuType(imp.type), etat.eleves);
    var cleId = "id";
    imp.planMaj = I.planFusion(existantsDuType(imp.type), imp.apercu.valides, cleId, "maj");
    imp.planRemplacer = I.planFusion(existantsDuType(imp.type), imp.apercu.valides, cleId, "remplacer");
    // élèves : valeurs modifiées dans l'application que le fichier écraserait
    imp.conflits = [];
    imp.garderAppli = true;
    if (imp.type === "eleves" || imp.type === "aesh") {
      var parId = {};
      existantsDuType(imp.type).forEach(function (e) { parId[e.id] = e; });
      imp.planMaj.modifies.forEach(function (n) {
        var champs = M.conflitsReimport(parId[n.id], n);
        if (champs.length) imp.conflits.push({ existant: parId[n.id], nouveau: n, champs: champs });
      });
    }
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
    if (ap.periscolaireIgnore.length) {
      h += '<p class="note alerte">Colonnes Récréation et Pause méridienne ignorées : les temps périscolaires ne sont pas gérés ('
        + ap.periscolaireIgnore.length + ' ligne(s) remplie(s) : ' + ap.periscolaireIgnore.slice(0, 20).join(", ") + (ap.periscolaireIgnore.length > 20 ? "…" : "")
        + '). Pour les prendre en compte, cochez « Gérer les temps périscolaires » dans Réglages, puis importez à nouveau ce fichier.</p>';
    }
    if (imp.conflits && imp.conflits.length) {
      var LIB_CHAMP = { heuresInd: "heures individuelles", heuresMut: "heures mutualisées", debutNotif: "début de notification", finNotif: "fin de notification", besoins: "besoins",
        quotite: "quotité", email: "e-mail", etablissements: "établissements possibles", indisponibilites: "indisponibilités", formations: "spécialités" };
      var valeur = function (k, v) {
        if (k === "besoins" || k === "formations") return (v || []).length ? v.join(", ") : "aucun";
        if (k === "heuresInd" || k === "heuresMut" || k === "quotite") return heures(v || 0);
        if (k === "etablissements") return (v || []).length ? v.map(nomEtablissement).join(", ") : "tous";
        if (k === "indisponibilites") return (v || []).length ? v.map(texteIndispo).join(", ") : "aucune";
        if (k === "email") return v || "aucune";
        return v ? v.split("-").reverse().join("/") : "—";
      };
      var aeshImp = imp.type === "aesh";
      h += '<div class="note alerte"><p style="margin:0 0 6px"><strong>' + pluriel(imp.conflits.length, aeshImp ? "AESH a" : "élève a", aeshImp ? "AESH ont" : "élèves ont")
        + ' des valeurs modifiées dans l\'application que ce fichier remplacerait :</strong></p><ul class="liste-motifs">'
        + imp.conflits.map(function (cf) {
          return '<li>' + (aeshImp ? ech(nomAesh(cf.existant)) : ech(cf.existant.nomCourt) + ' (' + ech(cf.existant.classe) + ')') + ' : ' + cf.champs.map(function (k) {
            return LIB_CHAMP[k] + ' ' + ech(valeur(k, cf.existant[k])) + ' dans l\'application, ' + ech(valeur(k, cf.nouveau[k])) + ' dans le fichier';
          }).join(" ; ") + '</li>';
        }).join("") + '</ul>'
        + '<div class="choix-conflits" role="radiogroup" aria-label="Valeurs à garder">'
        + '<label class="case"><input type="radio" name="imp-conflits" value="appli" checked> Garder les valeurs de l\'application</label>'
        + '<label class="case"><input type="radio" name="imp-conflits" value="fichier"> Prendre celles du fichier</label></div>'
        + '<p class="aide" style="margin:6px 0 0">' + (aeshImp
          ? "Le choix s'applique à toutes ces AESH. Les autres colonnes sont mises à jour dans les deux cas ; les vœux et les élèves à ne pas affecter de la fiche ne sont jamais touchés par l'import."
          : "Le choix s'applique à tous ces élèves. Les autres colonnes sont mises à jour dans les deux cas ; le commentaire et les états par matière de la fiche ne sont jamais touchés par l'import.") + '</p></div>';
    }
    if (ap.exemples.length) h += '<p class="aide">Lignes d\'exemple du gabarit ignorées : ' + ap.exemples.join(", ") + '.</p>';
    if (ap.doublons.length) h += '<p class="aide">Doublons ignorés (lignes identiques à une ligne précédente) : ' + ap.doublons.map(function (d) { return d.ligne; }).join(", ") + '.</p>';
    $("imp-details").innerHTML = h;
    Array.prototype.forEach.call($("imp-details").querySelectorAll('[name="imp-conflits"]'), function (r) {
      r.addEventListener("change", function () { if (this.checked) imp.garderAppli = this.value === "appli"; });
    });
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
    var aEnregistrer = plan.ajouts.concat(plan.modifies).map(function (n) { return fusionnerObjet(type, parId[n.id], n, imp.garderAppli !== false); });
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
      viderAnnulation();
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
    $("reg-periscolaire").checked = !!r.gererPeriscolaire;
    $("reg-pause").value = r.pauseRepasMin;
    $("reg-ecart").value = r.ecartMax / 60;
    $("reg-budget").value = r.budgetOrdres;
    rendreSpecialites();
  }
  $("reg-enregistrer-regles").addEventListener("click", function () {
    var pause = parseInt($("reg-pause").value, 10);
    if (isNaN(pause) || pause < 0 || pause > 120) { ui.toast("Durée de pause invalide (0 à 120 minutes)."); return; }
    var ecart = Math.round(parseFloat(String($("reg-ecart").value).replace(",", ".")) * 60);
    if (isNaN(ecart) || ecart < 30 || ecart > 480) { ui.toast("Écart maximal invalide (de 0,5 à 8 heures)."); return; }
    var budget = Math.round(parseFloat(String($("reg-budget").value).replace(",", ".")) * 10) / 10;
    if (isNaN(budget) || budget < 0.5 || budget > 60) { ui.toast("Temps de recherche invalide (de 0,5 à 60 secondes)."); return; }
    var valeur = {};
    Object.keys(etat.reglages).forEach(function (k) { valeur[k] = etat.reglages[k]; });
    valeur.dureeReelle = $("reg-duree-reelle").checked;
    valeur.respecterIndispos = $("reg-indispos").checked;
    valeur.gererPeriscolaire = $("reg-periscolaire").checked;
    valeur.pauseRepasMin = pause;
    valeur.ecartMax = ecart;
    valeur.budgetOrdres = budget;
    delete valeur.nbOrdres;   // ancien réglage (nombre fixe), remplacé par le temps de recherche
    PialDB.appliquer([{ magasin: "parametres", enregistrer: [{ cle: "reglages", valeur: valeur }] }]).then(recharger).then(function () {
      ui.toast("Règles de calcul enregistrées.");
      if (typeof PialAffectations.surChangement === "function") PialAffectations.surChangement();
    });
  });

  /* =============== réglages : spécialités des AESH (§16) =============== */
  function blocSpecialite(s, i) {
    return '<details class="reg-spec" data-spec="' + i + '"><summary><span class="reg-spec-nom">' + ech(s.nom || "Nouvelle spécialité") + '</span>'
      + ' <span class="aide">— ' + pluriel((s.besoins || []).length, "besoin") + '</span></summary>'
      + '<div class="reg-spec-corps"><label>Nom <input type="text" data-spec-nom value="' + ech(s.nom || "") + '" maxlength="60"></label>'
      + '<div class="fe-besoins">' + I.ACCOMP.map(function (b, k) {
        return '<label class="pastille-case"><input type="checkbox" data-spec-besoin="' + k + '"' + ((s.besoins || []).indexOf(b) > -1 ? " checked" : "") + '> ' + ech(b) + '</label>';
      }).join("") + '</div><button type="button" class="btn-lien" data-retirer-spec>Supprimer cette spécialité</button></div></details>';
  }
  function rendreSpecialites(table) {
    table = table || M.contexte({ reglages: etat.reglages }).reglages.specialites || [];
    $("reg-specialites").innerHTML = table.map(blocSpecialite).join("");
  }
  $("reg-specialites").addEventListener("click", function (ev) {
    if (ev.target.hasAttribute("data-retirer-spec")) ev.target.closest(".reg-spec").remove();
  });
  $("reg-specialites").addEventListener("input", function (ev) {
    if (ev.target.hasAttribute("data-spec-nom")) ev.target.closest(".reg-spec").querySelector(".reg-spec-nom").textContent = ev.target.value || "Nouvelle spécialité";
  });
  $("reg-ajouter-specialite").addEventListener("click", function () {
    $("reg-specialites").insertAdjacentHTML("beforeend", blocSpecialite({ nom: "", besoins: [] }, Date.now()));
    var d = $("reg-specialites").lastElementChild;
    d.open = true;
    d.querySelector("[data-spec-nom]").focus();
  });
  $("reg-specialites-defaut").addEventListener("click", function () {
    rendreSpecialites(M.SPECIALITES_DEFAUT);
    ui.toast("Table par défaut affichée : enregistrez pour l'appliquer.");
  });
  $("reg-enregistrer-specialites").addEventListener("click", function () {
    var table = [], vus = {}, erreur = "";
    Array.prototype.forEach.call($("reg-specialites").querySelectorAll(".reg-spec"), function (d) {
      var nom = d.querySelector("[data-spec-nom]").value.replace(/\s+/g, " ").trim();
      if (!nom) { erreur = "Chaque spécialité doit avoir un nom."; return; }
      if (vus[M.normaliser(nom)]) { erreur = "Deux spécialités portent le nom « " + nom + " »."; return; }
      vus[M.normaliser(nom)] = true;
      table.push({ nom: nom, besoins: Array.prototype.filter.call(d.querySelectorAll("[data-spec-besoin]"), function (c) { return c.checked; })
        .map(function (c) { return I.ACCOMP[parseInt(c.dataset.specBesoin, 10)]; }) });
    });
    if (erreur) { ui.toast(erreur); return; }
    var valeur = {};
    Object.keys(etat.reglages).forEach(function (k) { valeur[k] = etat.reglages[k]; });
    valeur.specialites = table;
    PialDB.appliquer([{ magasin: "parametres", enregistrer: [{ cle: "reglages", valeur: valeur }] }]).then(recharger).then(function () {
      rendreSpecialites();
      ui.toast("Spécialités enregistrées (" + table.length + ").");
      if (typeof PialAffectations.surChangement === "function") PialAffectations.surChangement();
    });
  });

  /* =============== onglet Affectations : outils =============== */
  var semaineAffichee = "A";
  var eleveOuvert = null;     // id de l'élève dont la grille est affichée
  var aeshOuverte = null;     // id de l'AESH dont la grille est affichée
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
    function ab(a, b) { return a !== b ? ' title="Semaine A : ' + heures(a) + ' · semaine B : ' + heures(b) + '"' : ""; }
    var ecart = s.ecartTheorique;
    // blocs séparés par un vrai texte « · » : le bandeau se copie lisiblement
    var blocs = [
      '<span class="bs-chiffre">Individuel : <strong>' + heures(s.indCouvert) + '</strong> / ' + heures(s.indDemande) + '</span>',
      '<span class="bs-chiffre">Mutualisé : <strong>' + heures(s.mutCouvert) + '</strong> / ' + heures(s.mutDemande) + '</span>',
      '<span class="bs-chiffre">Capacité : <strong>' + heures(s.quotites) + '</strong> de quotités, '
        + '<span' + ab(s.affecteesA, s.affecteesB) + '>' + heures(s.affectees) + ' affectées</span>, '
        + '<span' + ab(s.libresA, s.libresB) + '>' + heures(s.libres) + ' libres</span></span>',
      '<span class="bs-chiffre" title="Heures notifiées (individuel + mutualisé) moins quotités totales. Théorique : une heure mutualisée peut couvrir plusieurs élèves, l\'écart réel est donc souvent plus faible.">'
        + 'Écart besoins − capacité : <strong class="' + (ecart > 0 ? "bs-manque" : "bs-marge") + '">' + (ecart > 0 ? "+" + heures(ecart) : (ecart < 0 ? "−" + heures(-ecart) : heures(0))) + '</strong>'
        + (ecart > 0 ? " (manque théorique)" : " (marge théorique)") + '</span>',
      '<span class="bs-chiffre"><strong>' + s.elevesSous + '</strong> élève(s) sous-couvert(s)</span>',
      '<span class="bs-chiffre"><strong>' + s.aeshDepassement + '</strong> AESH en dépassement, <strong>' + s.aeshSous + '</strong> sous-utilisée(s)</span>',
      '<span class="bs-chiffre"><strong>' + alertes.length + '</strong> alerte(s)</span>'
    ];
    $("aff-synthese").innerHTML = blocs.join('<span class="bs-sep" aria-hidden="true"> · </span>')
      + sep(" · ") + '<span class="bs-actions">'
      + '<span class="selecteur-semaine" role="group" aria-label="Semaine affichée">'
      + '<button type="button" data-semaine="A" aria-pressed="' + (semaineAffichee === "A") + '">Semaine A</button>'
      + '<button type="button" data-semaine="B" aria-pressed="' + (semaineAffichee === "B") + '">Semaine B</button></span>'
      + '<button type="button" class="btn btn-vide" id="aff-annuler"' + (pileAnnulation.length ? ' title="Annuler : ' + ech(pileAnnulation[pileAnnulation.length - 1].libelle) + ' (Ctrl+Z)"' : " disabled") + '>↶ Annuler</button>'
      + '<button type="button" class="btn btn-plein" id="aff-proposer"' + (etat.eleves.length && etat.aesh.length ? "" : " disabled")
      + ' title="Remplace les affectations non épinglées par une proposition ; les épinglées sont conservées">Proposer</button>'
      + (dernierRapport ? '<button type="button" class="btn btn-vide" id="aff-voir-rapport">Rapport</button>' : "")
      + '<button type="button" class="btn btn-vide" id="aff-desepingler"' + (nbEpinglees() ? "" : " disabled") + '>Tout désépingler</button>'
      + '<button type="button" class="btn btn-vide" id="aff-valider"' + (etat.affectations.length ? "" : " disabled") + '>Valider la version</button>'
      + '<button type="button" class="btn btn-vide" id="aff-historique">Historique' + (etat.versions.length ? " (" + etat.versions.length + ")" : "") + '</button>'
      + '</span>';
    Array.prototype.forEach.call($("aff-synthese").querySelectorAll("[data-semaine]"), function (b) {
      b.addEventListener("click", function () { semaineAffichee = this.dataset.semaine; rendreAffectations(); });
    });
    $("aff-proposer").addEventListener("click", proposer);
    $("aff-annuler").addEventListener("click", annuler);
    $("aff-valider").addEventListener("click", ouvrirValidation);
    $("aff-historique").addEventListener("click", ouvrirHistorique);
    if (dernierRapport) $("aff-voir-rapport").addEventListener("click", afficherRapport);
    $("aff-desepingler").addEventListener("click", toutDesepingler);
  }

  /* =============== proposition automatique (§5) =============== */
  var dernierRapport = null; // {rapport, ms, nbRemplacees} : en mémoire, jusqu'au rechargement
  function nbEpinglees() { return etat.affectations.filter(function (a) { return a.epinglee; }).length; }
  // données du moteur : le moteur départage par l'ordre des clés, pas des
  // identifiants internes (M.donneesParCles) ; son résultat est traduit en
  // retour par M.traduireIds(…, vue.versId)
  function donneesMoteur(affectations) {
    return M.donneesParCles({ annee: anneeCourante(), etablissements: etat.etablissements, eleves: etat.eleves, aesh: etat.aesh, cours: etat.cours,
      affectations: affectations || etat.affectations, reglages: etat.reglages });
  }
  // relance partielle : les épinglées sont gardées, les autres remplacées.
  // Le moteur essaie plusieurs ordres de départage (spec §16), autant que le
  // temps de recherche le permet (au moins P.MIN_ORDRES), un par tour, en
  // rendant la main au navigateur entre deux ordres (thread principal, pas
  // de Web Worker sous file://) ; une progression s'affiche si le calcul
  // doit dépasser 1,5 s. Le nombre d'ordres essayés est mémorisé avec la
  // signature des données : une relance sur les mêmes données rejoue ce
  // nombre, donc le même résultat, quel que soit le temps de calcul.
  function maintenant() { return (window.performance || Date).now(); }
  function secondes(ms) { var s = Math.round(ms / 100) / 10; return (s >= 10 ? String(Math.round(s)) : String(s).replace(".", ",")) + " s"; }
  function proposer() {
    var bouton = $("aff-proposer");
    bouton.disabled = true;
    bouton.textContent = "Calcul…";
    var budget = M.contexte({ reglages: etat.reglages }).reglages.budgetOrdres * 1000;
    var vue = donneesMoteur(), donnees = vue.donnees, signature = P.signatureDonnees(donnees);
    var repris = etat.proposition && etat.proposition.signature === signature && etat.proposition.nbOrdres > 0 ? etat.proposition.nbOrdres : 0;
    var calc = P.plusieursOrdres(donnees, repris || Infinity), t0 = maintenant(), visible = false;
    // part faite : ordres (nombre repris) ou temps et minimum d'ordres (budget)
    function avancement(ecoule) { return repris ? calc.fait() / repris : Math.min(1, Math.max(ecoule / budget, calc.fait() / P.MIN_ORDRES)); }
    function etape() {
      var debut = maintenant();
      do {
        calc.suivant();
        if (!repris && calc.fait() >= P.MIN_ORDRES && maintenant() - t0 >= budget) calc.arreter();
      } while (!calc.fini() && maintenant() - debut < 50);
      var ecoule = maintenant() - t0;
      if (!visible && !calc.fini() && ecoule / avancement(ecoule) > 1500) { visible = true; $("aff-progression").hidden = false; }
      if (visible) {
        $("aff-progression-texte").textContent = "Recherche du meilleur résultat : " + pluriel(calc.fait(), "ordre essayé", "ordres essayés")
          + (repris ? " sur " + repris : " en " + secondes(ecoule) + " (temps de recherche : " + secondes(budget) + ")");
        $("aff-progression-barre").value = avancement(ecoule);
      }
      if (!calc.fini()) { setTimeout(etape, 0); return; }
      $("aff-progression").hidden = true;
      var res = M.traduireIds(calc.resultat(), vue.versId), ms = maintenant() - t0;
      res.rapport.ordres.ms = ms;
      res.rapport.ordres.repris = !!repris;
      var remplacees = etat.affectations.filter(function (a) { return !a.epinglee; }).map(function (a) { return a.id; });
      var nouvelles = res.affectations.filter(function (a) { return !a.epinglee; });
      dernierRapport = { rapport: res.rapport, ms: ms, nbRemplacees: remplacees.length };
      var memo = repris ? etat.proposition
        : { signature: signature, nbOrdres: res.rapport.ordres.nb, ms: Math.round(ms), budget: budget / 1000, date: new Date().toISOString() };
      // mémoriser le nombre d'ordres avant la proposition : une relance doit le retrouver
      PialDB.appliquer([{ magasin: "parametres", enregistrer: [{ cle: "proposition", valeur: memo }] }]).then(function () {
        return enregistrerPuisRendre([{ magasin: "affectations", supprimer: remplacees, enregistrer: nouvelles }],
          pluriel(nouvelles.length, "affectation proposée", "affectations proposées") + ".", "la proposition");
      }).then(afficherRapport);
    }
    // laisse le navigateur afficher « Calcul… » avant le calcul
    setTimeout(etape, 30);
  }
  function toutDesepingler() {
    var n = nbEpinglees();
    if (!n) return;
    ui.confirmationForte(n > 1
      ? "Désépingler les " + n + " affectations épinglées ? Elles restent en place, mais la prochaine proposition pourra les remplacer."
      : "Désépingler l'affectation épinglée ? Elle reste en place, mais la prochaine proposition pourra la remplacer.", "Tout désépingler", function () {
      var affs = etat.affectations.filter(function (a) { return a.epinglee; }).map(function (a) {
        var b = JSON.parse(JSON.stringify(a)); b.epinglee = false; return b;
      });
      enregistrerPuisRendre([{ magasin: "affectations", enregistrer: affs }], pluriel(n, "affectation désépinglée", "affectations désépinglées") + ".", "« Tout désépingler »");
    });
  }

  /* =============== rapport de fin (§5.3.7) =============== */
  var LIB_PERI = { recreation: "Récréation", meridienne: "Pause méridienne" };
  function afficherRapport() {
    if (!dernierRapport) return;
    var r = dernierRapport.rapport, x = r.heures;
    function pct(a, b) { return b ? Math.round(100 * a / b) + " %" : "—"; }
    function ligneHeures(lib, v) { return '<tr><td>' + lib + '</td><td>' + heures(v.demande) + '</td><td>' + heures(v.couvert) + '</td><td>' + pct(v.couvert, v.demande) + '</td></tr>'; }
    var tot = { demande: x.individuel.demande + x.mutualise.demande, couvert: x.individuel.couvert + x.mutualise.couvert };
    var h = '<p class="aide">Calculée en ' + Math.round(dernierRapport.ms) + ' ms · ' + pluriel(r.nbProposees, "affectation proposée", "affectations proposées")
      + ' · ' + pluriel(r.nbEpinglees, "affectation épinglée conservée", "affectations épinglées conservées")
      + (dernierRapport.nbRemplacees ? ' · ' + pluriel(dernierRapport.nbRemplacees, "affectation non épinglée remplacée", "affectations non épinglées remplacées") : "")
      + (r.nbEchanges ? ' · ' + pluriel(r.nbEchanges, "créneau repris ou échangé", "créneaux repris ou échangés") + ' entre AESH pour limiter à ' + P.POIDS.maxAeshParEleve + ' le nombre d\'AESH par élève' : "")
      + (r.nbEchangesTrous ? ' · ' + pluriel(r.nbEchangesTrous, "créneau repris ou échangé", "créneaux repris ou échangés") + ' pour réduire les trous des journées' : "") + '.</p>';
    if (r.ordres) {
      var q0 = r.ordres.essais[0].qualite, q = r.qualite;
      var resume = function (x) { return heures(x.couvert) + " couvertes, " + pluriel(x.elevesPlusDe3, "élève", "élèves") + " à plus de " + P.POIDS.maxAeshParEleve + " AESH, " + pluriel(x.trous, "trou") + ", " + pluriel(x.courtes, "journée courte", "journées courtes"); };
      h += '<p class="aide"><strong>' + pluriel(r.ordres.nb, "ordre essayé", "ordres essayés") + ' en ' + secondes(r.ordres.ms) + '</strong>'
        + (r.ordres.repris ? ' (nombre repris de la proposition précédente : mêmes données et mêmes règles, donc même résultat)' : "")
        + ' · meilleur résultat parmi ces ordres de départage des AESH (ordre n° ' + (r.ordres.retenu + 1) + ' retenu) : '
        + ech(resume(q)) + (r.ordres.retenu ? ' ; avec le premier ordre : ' + ech(resume(q0)) : "") + '.</p>';
    }
    if (r.violations.length) h += '<p class="note alerte">⚠ ' + pluriel(r.violations.length, "contrainte non respectée", "contraintes non respectées") + ' par la proposition : signalez-le.</p>';
    h += '<div class="mc-section"><h4>Heures</h4><div class="tableau-conteneur"><table class="tableau"><thead><tr><th></th><th>Demandées</th><th>Couvertes</th><th>Taux</th></tr></thead><tbody>'
      + ligneHeures("Individuel", x.individuel) + ligneHeures("Mutualisé", x.mutualise)
      + '<tr><td><strong>Total notifié</strong></td><td>' + heures(tot.demande) + '</td><td><strong>' + heures(tot.couvert) + '</strong></td><td>' + pct(tot.couvert, tot.demande) + '</td></tr>'
      + (r.periscolaireGere ? ligneHeures("Périscolaire (à part)", x.periscolaire) : "")
      + '</tbody></table></div></div>';
    h += '<div class="mc-section"><h4>Élèves sous-couverts ou partiellement couverts (' + r.sousCouverts.length + ')</h4>';
    h += r.sousCouverts.length ? '<div class="tableau-conteneur"><table class="tableau"><thead><tr><th>Élève</th><th>Manque</th><th>Motif principal</th></tr></thead><tbody>'
      + r.sousCouverts.map(function (sc) {
        var manque = [sc.manqueInd ? heures(sc.manqueInd) + " ind." : "", sc.manqueMut ? heures(sc.manqueMut) + " mut." : ""].filter(Boolean).join(", ");
        return '<tr><td><button type="button" class="btn-lien" data-rapport-eleve="' + ech(sc.eleveId) + '">' + ech(sc.nomCourt) + '</button><br><span class="aide">'
          + ech(sc.classe) + ' · ' + ech(sc.etablissement) + '</span></td><td>' + manque + '</td><td>' + ech(sc.libelle) + '</td></tr>';
      }).join("") + '</tbody></table></div>' : '<p class="aide">Aucun : toutes les heures notifiées sont couvertes.</p>';
    h += '</div>';
    if (r.periscolaireGere) {
      // par élève, puis par temps (et motif) : « Récréation : lundi 09:50, mardi 09:50 — quotités épuisées »
      var parEleve = {}, ordre = [];
      r.periscolaireNonCouvert.forEach(function (p) {
        if (!parEleve[p.eleveId]) { parEleve[p.eleveId] = { p: p, groupes: {}, cles: [] }; ordre.push(p.eleveId); }
        var y = parEleve[p.eleveId], k = p.type + "|" + p.prioritaire + "|" + p.libelle;
        if (!y.groupes[k]) { y.groupes[k] = { p: p, creneaux: [] }; y.cles.push(k); }
        y.groupes[k].creneaux.push(p.jour + " " + p.debut + (p.semaines.length < 2 ? " (sem. " + p.semaines[0] + ")" : ""));
      });
      ordre.forEach(function (id) {
        var y = parEleve[id];
        y.liste = y.cles.map(function (k) {
          var g = y.groupes[k];
          return LIB_PERI[g.p.type] + (g.p.prioritaire ? " (prioritaire)" : "") + " : " + g.creneaux.join(", ") + " — " + g.p.libelle;
        });
      });
      h += '<div class="mc-section"><h4>Temps périscolaires non couverts (' + r.periscolaireNonCouvert.length + ')</h4>';
      h += ordre.length ? '<ul class="liste-motifs">' + ordre.map(function (id) {
        var y = parEleve[id];
        return '<li><button type="button" class="btn-lien" data-rapport-eleve="' + ech(id) + '">' + ech(y.p.nomCourt) + '</button> (' + ech(y.p.classe) + ') : ' + y.liste.map(ech).join(" ; ") + '</li>';
      }).join("") + '</ul>' : '<p class="aide">Aucun.</p>';
      h += '</div>';
    }
    h += '<div class="mc-section"><h4>AESH sous-utilisées (' + r.aeshSousUtilisees.length + ')</h4>';
    h += r.aeshSousUtilisees.length ? '<ul class="liste-motifs">' + r.aeshSousUtilisees.map(function (a) {
      return '<li>' + ech(a.nom) + ' : reste ' + heures(a.restantA) + (a.restantA !== a.restantB ? ' en semaine A, ' + heures(a.restantB) + ' en semaine B' : '') + ' sur ' + heures(a.quotite) + '</li>';
    }).join("") + '</ul>' : '<p class="aide">Aucune.</p>';
    h += '</div>';
    // journées des AESH : trous et journées courtes, par semaine
    var avecTrous = r.aesh.filter(function (a) { return a.trousA || a.trousB || a.courtesA || a.courtesB; });
    function ab(a, b) { return a === b ? String(a) : a + " (A) / " + b + " (B)"; }
    h += '<div class="mc-section"><h4>Journées des AESH</h4><p class="aide">Trous de plus de ' + ech(texteDuree(r.ecartMax))
      + ' entre deux accompagnements : ' + ab(r.trous.A, r.trous.B) + ' · journées de moins de ' + ech(texteDuree(r.journeeMin)) + ' de présence : '
      + ab(r.courtes.A, r.courtes.B) + '. Le détail se lit dans la grille de chaque AESH.</p>';
    h += avecTrous.length ? '<div class="tableau-conteneur"><table class="tableau"><thead><tr><th>AESH</th><th>Trous</th><th>Journées courtes</th></tr></thead><tbody>'
      + avecTrous.map(function (a) {
        return '<tr><td><button type="button" class="btn-lien" data-rapport-aesh="' + ech(a.aeshId) + '">' + ech(a.nom) + '</button></td><td>' + ab(a.trousA, a.trousB) + '</td><td>' + ab(a.courtesA, a.courtesB) + '</td></tr>';
      }).join("") + '</tbody></table></div>' : "";
    h += '</div>';
    h += '<p class="aide">Chaque affectation proposée garde ses raisons : ouvrez un créneau pour les voir. Épinglez ce que vous voulez garder, puis relancez « Proposer ».</p>';
    $("rp-corps").innerHTML = h;
    Array.prototype.forEach.call($("rp-corps").querySelectorAll("[data-rapport-eleve]"), function (b) {
      b.addEventListener("click", function () { fermerRapport(); ouvrirGrilleEleve(this.dataset.rapportEleve); });
    });
    Array.prototype.forEach.call($("rp-corps").querySelectorAll("[data-rapport-aesh]"), function (b) {
      b.addEventListener("click", function () { fermerRapport(); ouvrirGrilleAesh(this.dataset.rapportAesh); });
    });
    $("voile-rapport").hidden = false;
    $("rp-fermer").focus();
  }
  function fermerRapport() { $("voile-rapport").hidden = true; }
  $("rp-fermer").addEventListener("click", fermerRapport);
  $("voile-rapport").addEventListener("click", function (ev) { if (ev.target === this) fermerRapport(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !$("voile-rapport").hidden) fermerRapport(); });

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
    return '<div class="jauge" title="' + ech(titre || "") + '"><span class="j-lib">' + libelle + '</span>' + sep(" : ")
      + '<span class="j-barre"><span class="e-' + etatJauge + '" style="width:' + pct + '%"></span></span>'
      + '<span class="j-val">' + heures(couvert) + ' / ' + heures(cible) + '</span>' + sep(" ; ") + '</div>';
  }
  function titreAB(partie, nom) {
    return partie.A !== partie.B ? nom + " — semaine A : " + heures(partie.A) + ", semaine B : " + heures(partie.B) : nom;
  }
  function jaugesEleve(e, cv) {
    var h = "";
    if (cv.ind.notifie > 0 || cv.ind.moy > 0) h += jauge("Individuel", cv.ind.moy, cv.ind.notifie, cv.ind.etat, titreAB(cv.ind, LIB_ETAT_ELEVE[cv.ind.etat]));
    if (cv.mut.notifie > 0 || cv.mut.moy > 0) h += jauge("Mutualisé", cv.mut.moy, cv.mut.notifie, cv.mut.etat, titreAB(cv.mut, LIB_ETAT_ELEVE[cv.mut.etat]));
    if (ctxCourant.reglages.gererPeriscolaire && (cv.peri.moy > 0 || e.recreation || e.meridienne)) h += '<div class="jauge"><span class="j-lib">Périscol.</span>' + sep(" : ") + '<span class="j-barre"></span><span class="j-val">' + heures(cv.peri.moy) + '</span>' + sep(" ; ") + '</div>';
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
      return '<li data-eleve="' + ech(e.id) + '" tabindex="0"><div class="lj-tete"><span class="lj-nom">' + ech(e.nomCourt) + '</span>' + sep(" — ")
        + '<span class="lj-meta">' + ech(e.classe) + ' · ' + ech(nomEtablissement(e.etablissement)) + '</span></div>' + jaugesEleve(e, cv) + '</li>';
    }).join("") : '<li class="vide">' + (etat.eleves.length ? "Aucun élève ne correspond à ces filtres." : "Aucun élève : importez le fichier des élèves (onglet Importer).") + '</li>';
    var aesh = aeshFiltrees();
    $("aff-liste-aesh").innerHTML = aesh.length ? aesh.map(function (a) {
      var ch = M.chargeAesh(a, ctxCourant);
      var titre = LIB_ETAT_AESH[ch.etat] + (ch.A !== ch.B ? " — semaine A : " + heures(ch.A) + ", semaine B : " + heures(ch.B) : "");
      return '<li data-aesh="' + ech(a.id) + '" tabindex="0"' + ($("af-aesh").value === a.id ? ' class="actif"' : '') + '><div class="lj-tete"><span class="lj-nom">'
        + '<span class="puce-aesh" style="background:' + couleurAesh(a.id) + '">' + ech(initialesAesh(a)) + '</span> ' + ech(nomAesh(a)) + '</span>'
        + (a.ignorerIndispos ? sep(" ") + '<span class="badge-ignore" title="Indisponibilités et établissements possibles ignorés">indispos ignorées</span>' : "")
        + sep(" — ") + '<span class="lj-meta">' + ((a.etablissements || []).length ? ech(a.etablissements.map(nomEtablissement).join(", ")) : "tous établissements") + '</span></div>'
        + jauge("Charge", ch.moy, ch.quotite, ch.etat, titre) + '</li>';
    }).join("") : '<li class="vide">' + (etat.aesh.length ? "Aucune AESH ne correspond à ces filtres." : "Aucune AESH : importez le fichier des AESH.") + '</li>';
    rendreFicheAesh();
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

  /* =============== fiche de l'AESH sélectionnée (§4.4, §7.2) =============== */
  var LIB_INDISPO = { am: "matin", pm: "après-midi" };
  function texteIndispo(code) {
    var p = txt(code).split("-"), jour = { lun: "lundi", mar: "mardi", mer: "mercredi", jeu: "jeudi", ven: "vendredi", sam: "samedi" }[p[0]] || p[0];
    return jour + (p[1] ? " " + (LIB_INDISPO[p[1]] || p[1]) : "");
  }
  function rendreFicheAesh() {
    var hote = $("aff-fiche-aesh"), a = aeshParId($("af-aesh").value);
    if (!a) { hote.hidden = true; hote.innerHTML = ""; return; }
    var ch = M.chargeAesh(a, ctxCourant), global = ctxCourant.reglages.respecterIndispos;
    var nbEleves = {};
    etat.affectations.forEach(function (x) { if (x.aeshId === a.id) x.eleves.forEach(function (id) { nbEleves[id] = true; }); });
    hote.innerHTML = '<div class="fiche-aesh"><h3>' + ech(nomAesh(a)) + '</h3>'
      + '<p><button type="button" class="btn btn-vide" id="fa-grille">Emploi du temps de ' + ech(a.prenom) + ' →</button></p><dl>'
      + '<dt>Quotité</dt><dd>' + heures(ch.quotite) + ' · charge ' + (ch.A !== ch.B ? 'semaine A ' + heures(ch.A) + ', semaine B ' + heures(ch.B) : heures(ch.A)) + ' (' + LIB_ETAT_AESH[ch.etat] + ')</dd>'
      + '<dt>Élèves</dt><dd>' + Object.keys(nbEleves).length + '</dd>'
      + '<dt>Établissements</dt><dd>' + ((a.etablissements || []).length ? ech(a.etablissements.map(nomEtablissement).join(", ")) : "tous") + '</dd>'
      + '<dt>Indisponibilités</dt><dd>' + ((a.indisponibilites || []).length ? ech(a.indisponibilites.map(texteIndispo).join(", ")) : "aucune") + '</dd>'
      + ((a.formations || []).length ? '<dt>Spécialités</dt><dd>' + ech(a.formations.join(", ")) + '</dd>' : "")
      + '</dl>'
      + ((a.voeux && ((a.voeux.demiJournees || []).length || (a.voeux.plages || []).length)) ? '<dt>Vœux</dt><dd>' + ech((a.voeux.demiJournees || []).map(texteIndispo)
        .concat((a.voeux.plages || []).map(function (pl) { return (pl.jour ? pl.jour + " " : "") + pl.debut + "–" + pl.fin; })).join(", ")) + '</dd>' : "")
      + ((a.elevesExclus || []).length ? '<dt>Ne pas affecter à</dt><dd>' + ech(a.elevesExclus.map(function (id) { var e = eleveParId(id); return e ? e.nomCourt : id; }).join(", ")) + '</dd>' : "")
      + '<label class="case"><input type="checkbox" id="fa-ignorer"' + (a.ignorerIndispos ? " checked" : "") + (global ? "" : " disabled") + '> Ignorer ses indisponibilités et ses établissements possibles</label>'
      + '<p class="aide">' + (global
        ? "Pour cette AESH seulement : le moteur et le menu des créneaux pourront la placer sur ses demi-journées indisponibles et dans tous les établissements. À réserver à un arrangement ponctuel."
        : "Sans effet : le réglage global « Respecter les indisponibilités » est décoché (Réglages).") + '</p></div>';
    hote.hidden = false;
    $("fa-grille").addEventListener("click", function () { ouvrirGrilleAesh(a.id); });
    $("fa-ignorer").addEventListener("change", function () {
      var b = JSON.parse(JSON.stringify(a));
      b.ignorerIndispos = this.checked;
      enregistrerPuisRendre([{ magasin: "aesh", enregistrer: [b] }],
        nomAesh(a) + (b.ignorerIndispos ? " : indisponibilités ignorées." : " : indisponibilités de nouveau respectées."),
        (b.ignorerIndispos ? "« ignorer les indisponibilités » de " : "« respecter les indisponibilités » de ") + nomAesh(a));
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
      cases.push({ type: "periscolaire", periscolaire: p.type, etat: p.etat, jour: p.creneau.jour, debut: p.creneau.debut, fin: p.creneau.fin });
    });
    return cases;
  }
  /* =============== navigation entre les vues =============== */
  // vue affichée : vue d'ensemble (null), grille d'un élève ou d'une AESH ;
  // pileVues garde les grilles précédentes pour le bouton « Retour »
  var pileVues = [];
  function vueActuelle() {
    return eleveOuvert ? { type: "eleve", id: eleveOuvert } : (aeshOuverte ? { type: "aesh", id: aeshOuverte } : null);
  }
  function libelleVue(v) {
    if (!v) return "vue d'ensemble";
    if (v.type === "eleve") { var e = eleveParId(v.id); return e ? e.nomCourt : "élève"; }
    return nomAesh(aeshParId(v.id));
  }
  function afficherVue(v) {
    eleveOuvert = v && v.type === "eleve" ? v.id : null;
    aeshOuverte = v && v.type === "aesh" ? v.id : null;
    $("aff-ensemble").hidden = !!v;
    $("aff-grille-eleve").hidden = !eleveOuvert;
    $("aff-grille-aesh").hidden = !aeshOuverte;
    var precedente = pileVues[pileVues.length - 1] || null;
    ["aff-retour-ensemble", "aff-retour-aesh"].forEach(function (id) { $(id).textContent = "← " + (precedente ? "Retour : " : "") + libelleVue(precedente); });
    ["ge-ensemble", "ga-ensemble"].forEach(function (id) { $(id).hidden = !precedente; });
    if (!v) { pileVues = []; rendreEnsemble(); }
    else if (eleveOuvert) rendreGrilleEleve();
    else rendreGrilleAesh();
    window.scrollTo(0, 0);
  }
  function ouvrirVue(v) {
    var c = vueActuelle();
    if (c && c.type === v.type && c.id === v.id) { afficherVue(v); return; }
    if (c) { pileVues.push(c); if (pileVues.length > 30) pileVues.shift(); }
    afficherVue(v);
  }
  function retourVue() {
    // une vue précédente peut avoir disparu (élève ou AESH supprimés)
    var v = pileVues.pop() || null;
    while (v && !(v.type === "eleve" ? eleveParId(v.id) : aeshParId(v.id))) v = pileVues.pop() || null;
    afficherVue(v);
  }
  function ouvrirGrilleEleve(id) { ouvrirVue({ type: "eleve", id: id }); }
  function ouvrirGrilleAesh(id) { ouvrirVue({ type: "aesh", id: id }); }
  ["aff-retour-ensemble", "aff-retour-aesh"].forEach(function (id) { $(id).addEventListener("click", retourVue); });
  ["ge-ensemble", "ga-ensemble"].forEach(function (id) { $(id).addEventListener("click", function () { afficherVue(null); }); });

  // initiales d'une AESH : bouton qui ouvre sa grille (le reste de la case
  // ouvre le menu du créneau)
  function puceGrille(aff) { return puceAff(aff, true); }
  // glissable : dans la grille élève, les initiales se glissent sur un autre créneau
  function puceAff(aff, glissable) {
    var a = aeshParId(aff.aeshId), conflit = erreursDe(aff).length > 0;
    var titre = nomAesh(a) + (aff.modalite === "mutualise" ? " (mutualisé, " + aff.eleves.length + " élève(s))" : aff.modalite === "periscolaire" ? " (périscolaire)" : " (individuel)")
      + (aff.creneau.semaine !== "toutes" ? " — semaine " + aff.creneau.semaine : "")
      + (conflit ? " — " + erreursDe(aff).map(function (v) { return v.message; }).join(" ") : "")
      + (a ? " — cliquer pour ouvrir sa grille" + (glissable ? ", glisser pour déplacer" : "") : "");
    return '<button type="button" class="puce-aesh' + (conflit ? " conflit" : "") + '" style="background:' + couleurAesh(aff.aeshId) + '" title="' + ech(titre) + '"'
      + (a ? ' data-grille-aesh="' + ech(a.id) + '"' + (glissable ? ' data-glisser-aesh="' + ech(a.id) + '" data-aff-id="' + ech(aff.id) + '"' : "") : " disabled") + '>'
      + (aff.epinglee ? "🔒" : "") + ech(initialesAesh(a)) + (aff.modalite === "mutualise" ? "+" : "") + (conflit ? " ⚠" : "") + '</button>';
  }

  function rendreGrilleEleve() {
    var e = eleveParId(eleveOuvert);
    if (!e) { retourVue(); return; }
    var etab = etablissementParId(e.etablissement) || M.etablissementParDefaut(e.etablissement);
    var cv = M.couvertureEleve(e, ctxCourant), periGere = ctxCourant.reglages.gererPeriscolaire;
    $("ge-titre").textContent = e.nomCourt + " — " + e.classe;
    $("ge-sous-titre").textContent = nomEtablissement(e.etablissement) + " · notifié : "
      + [e.heuresInd ? heures(e.heuresInd) + " individuelles" : "", e.heuresMut ? heures(e.heuresMut) + " mutualisées" : "",
        periGere && e.recreation ? "récréations" : "", periGere && e.meridienne ? "pause méridienne" : ""].filter(Boolean).join(", ")
      + (e.finNotif ? " · fin de notification le " + e.finNotif.split("-").reverse().join("/") : "")
      + (etab.alternance ? " · semaine " + semaineAffichee + " affichée" : "");
    $("ge-jauges").innerHTML = '<span class="pastille-etat e-' + cv.etat + '">' + LIB_ETAT_ELEVE[cv.etat] + '</span>' + jaugesEleve(e, cv);
    // onglet Élèves affiché : la fiche y est (la grille est masquée)
    if (!ongletVisible("vue-eleves")) rendreFicheEleve(e);
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
            return '<div class="cellule-cours periscolaire' + (c.etat !== "normal" ? " " + c.etat : "") + '" tabindex="0" data-case="' + ech(cle) + '"><div class="cc-mat">' + LIB_PERI[c.periscolaire] + '</div>'
              + (c.etat !== "normal" ? '<div class="cc-etat">' + c.etat + '</div>' : "")
              + affs.filter(function (a) { return a.modalite === "periscolaire"; }).map(puceGrille).join("") + '</div>';
          }
          var co = c.cours;
          return '<div class="cellule-cours ' + (co.etat !== "normal" ? co.etat : "") + '" tabindex="0" data-case="' + ech(cle) + '">'
            + '<div class="cc-mat">' + ech(co.matiere) + (co.groupe ? " · " + ech(co.groupe) : "") + (co.semaine ? " (sem. " + co.semaine + ")" : "") + '</div>'
            + (co.etat !== "normal" ? '<div class="cc-etat">' + co.etat + '</div>' : "")
            + affs.filter(function (a) { return a.modalite !== "periscolaire"; }).map(puceGrille).join("") + '</div>';
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
      d.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target === this) ouvrirMenuCreneau(e, index[this.dataset.case]); });
    });
    brancherPucesAesh($("ge-table"));
    indexCases = index;
    rendrePalette(e);
  }

  /* =============== glisser-déposer (spec §16, F) =============== */
  // Pointer Events (souris, stylet, tactile), pas l'API HTML drag-and-drop.
  // Sources : initiales d'une AESH sur un créneau de la grille élève
  // (déplacer) ou palette des AESH au-dessus de la grille (affecter).
  // Pendant le glissement, chaque créneau est vert (valide), rouge (motif
  // au survol) ou gris (sans effet). Un dépôt sur un créneau rouge est
  // permis, avec une alerte, comme la saisie manuelle. Toute affectation
  // déposée est épinglée ; l'action est annulable. Le clic garde son rôle.
  var SEUIL_GLISSER = 6;          // px avant de considérer un glissement
  var indexCases = {};            // data-case -> case de la grille élève affichée
  var glisse = null, clicAAnnuler = false;

  // contexte de dépôt (même forme que le menu) pour l'AESH sur la case
  function contexteDepot(e, cas, source) {
    var etab = etablissementParId(e.etablissement), mods = modalitesPossibles(e, cas);
    var modalite = source && mods.indexOf(source.modalite) > -1 ? source.modalite : mods[0];
    var semaine = cas.type === "cours" && cas.cours.semaine ? cas.cours.semaine
      : (source && source.creneau.semaine !== "toutes" && etab && etab.alternance ? source.creneau.semaine : "toutes");
    return { eleve: e, cas: cas, modalite: modalite, semaine: semaine };
  }
  // verdict d'une case : {etat: "ok" | "non" | "neutre", motifs, m}
  function verdictDepot(e, cas, aeshId, source, ctxSans) {
    var m = contexteDepot(e, cas, source);
    var ici = affsActuelles(m);
    if (source && ici.some(function (a) { return a.id === source.id; })) return { etat: "neutre", motifs: ["créneau de départ"], m: m };
    if (ici.some(function (a) { return a.aeshId === aeshId; })) return { etat: "neutre", motifs: ["déjà affectée sur ce créneau"], m: m };
    var cand = candidat(aeshId, m);
    var v = M.violationsSimulees(aeshId, cand.aff, ctxSans, cand.remplaceId);
    return { etat: v.length ? "non" : "ok", motifs: v.map(function (x) { return x.message; }), m: m };
  }
  function debutGlisser(ev, el) {
    if (ev.button !== undefined && ev.button !== 0) return;
    var e = eleveParId(eleveOuvert);
    if (!e) return;
    var source = el.dataset.affId ? etat.affectations.filter(function (a) { return a.id === el.dataset.affId; })[0] : null;
    glisse = { el: el, pointerId: ev.pointerId, x0: ev.clientX, y0: ev.clientY, actif: false, eleve: e,
      aeshId: el.dataset.glisserAesh, source: source || null };
  }
  function activerGlisser() {
    var g = glisse, ctxSans = ctxCourant;
    if (g.source) {
      ctxSans = M.contexte({ etablissements: etat.etablissements, eleves: etat.eleves, aesh: etat.aesh, cours: etat.cours,
        affectations: etat.affectations.filter(function (a) { return a.id !== g.source.id; }), reglages: etat.reglages });
    }
    g.actif = true;
    g.verdicts = {};
    Array.prototype.forEach.call($("ge-table").querySelectorAll("[data-case]"), function (d) {
      var cas = indexCases[d.dataset.case];
      if (!cas) return;
      var v = verdictDepot(g.eleve, cas, g.aeshId, g.source, ctxSans);
      g.verdicts[d.dataset.case] = v;
      d.classList.add("depot-" + v.etat);
    });
    try { g.el.setPointerCapture(g.pointerId); } catch (x) { /* ancien navigateur */ }
    var a = aeshParId(g.aeshId);
    g.fantome = document.createElement("div");
    g.fantome.className = "fantome-glisser";
    g.fantome.innerHTML = '<span class="puce-aesh" style="background:' + couleurAesh(g.aeshId) + '">' + ech(initialesAesh(a)) + '</span> ' + ech(nomAesh(a));
    g.bulle = document.createElement("div");
    g.bulle.className = "bulle-glisser";
    g.bulle.hidden = true;
    document.body.appendChild(g.fantome);
    document.body.appendChild(g.bulle);
    document.body.classList.add("glisser-en-cours");
  }
  function caseSous(g, x, y) {
    var el = document.elementFromPoint(x, y);
    var d = el && el.closest ? el.closest("#ge-table [data-case]") : null;
    return d && g.verdicts[d.dataset.case] ? d : null;
  }
  function deplacerGlisser(ev) {
    var g = glisse;
    if (!g || ev.pointerId !== g.pointerId) return;
    if (!g.actif) {
      if (Math.abs(ev.clientX - g.x0) + Math.abs(ev.clientY - g.y0) < SEUIL_GLISSER) return;
      activerGlisser();
    }
    ev.preventDefault();
    g.fantome.style.left = (ev.clientX + 12) + "px";
    g.fantome.style.top = (ev.clientY + 12) + "px";
    var d = caseSous(g, ev.clientX, ev.clientY);
    if (g.survol && g.survol !== d) g.survol.classList.remove("depot-survol");
    g.survol = d;
    if (d) {
      d.classList.add("depot-survol");
      var v = g.verdicts[d.dataset.case], a = aeshParId(g.aeshId);
      g.bulle.className = "bulle-glisser " + v.etat;
      g.bulle.textContent = v.etat === "ok" ? (g.source ? "Déplacer " : "Affecter ") + nomAesh(a) + " ici"
        : (v.etat === "non" ? "⚠ " + v.motifs.join(" ") + " Dépôt possible, signalé dans les alertes." : v.motifs.join(" "));
      g.bulle.style.left = (ev.clientX + 14) + "px";
      g.bulle.style.top = (ev.clientY + 40) + "px";
      g.bulle.hidden = false;
    } else g.bulle.hidden = true;
    // défilement automatique près des bords de la fenêtre
    if (ev.clientY < 40) window.scrollBy(0, -12);
    else if (ev.clientY > window.innerHeight - 40) window.scrollBy(0, 12);
  }
  function finGlisser(ev, annule) {
    var g = glisse;
    if (!g || (ev && ev.pointerId !== undefined && ev.pointerId !== g.pointerId)) return;
    glisse = null;
    if (!g.actif) return;   // simple clic : il garde son rôle
    clicAAnnuler = true;    // le clic qui suit le relâchement ne doit rien ouvrir
    setTimeout(function () { clicAAnnuler = false; }, 0);
    var d = annule ? null : caseSous(g, ev.clientX, ev.clientY);
    Array.prototype.forEach.call(document.querySelectorAll(".depot-ok, .depot-non, .depot-neutre"), function (x) {
      x.classList.remove("depot-ok", "depot-non", "depot-neutre", "depot-survol");
    });
    g.fantome.remove(); g.bulle.remove();
    document.body.classList.remove("glisser-en-cours");
    if (!d) return;
    var v = g.verdicts[d.dataset.case];
    if (v.etat === "neutre") return;
    deposer(g, v);
  }
  function deposer(g, v) {
    var a = aeshParId(g.aeshId), e = g.eleve, ops = [], sans = [];
    if (g.source) {
      // retire l'élève de son créneau de départ
      var restants = g.source.eleves.filter(function (id) { return id !== e.id; });
      if (restants.length) {
        var b = JSON.parse(JSON.stringify(g.source));
        b.eleves = restants; b.epinglee = true; b.origine = "manuel";
        ops.push({ magasin: "affectations", enregistrer: [avecAlertes(b)] });
      } else { ops.push({ magasin: "affectations", supprimer: [g.source.id] }); sans.push(g.source.id); }
    }
    var r = operationsAffecter(g.aeshId, v.m, sans);
    ops = ops.concat(r.ops);
    var ou = v.m.cas.jour + " " + v.m.cas.debut;
    enregistrerPuisRendre(ops, nomAesh(a) + (g.source ? " déplacée sur " : " affectée sur ") + ou + " pour " + e.nomCourt
      + (v.etat === "non" ? " — attention : " + v.motifs.join(" ") : " (épinglée)."),
      (g.source ? "le déplacement de " : "l'affectation de ") + nomAesh(a) + " (" + e.nomCourt + ", " + ou + ")");
  }
  document.addEventListener("pointerdown", function (ev) {
    var el = ev.target.closest && ev.target.closest("[data-glisser-aesh]");
    if (el && !glisse) debutGlisser(ev, el);
  });
  document.addEventListener("pointermove", deplacerGlisser, { passive: false });
  document.addEventListener("pointerup", function (ev) { finGlisser(ev, false); });
  document.addEventListener("pointercancel", function (ev) { finGlisser(ev, true); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && glisse) finGlisser({}, true); });
  // après un glissement, le clic ne doit ni ouvrir la grille de l'AESH ni le menu
  document.addEventListener("click", function (ev) { if (clicAAnnuler) { ev.stopPropagation(); ev.preventDefault(); clicAAnnuler = false; } }, true);
  // palette des AESH au-dessus de la grille élève : celles qui
  // interviennent dans l'établissement de l'élève d'abord
  function rendrePalette(e) {
    var ici = [], ailleurs = [];
    aeshTriees().forEach(function (a) {
      ((a.etablissements || []).length && a.etablissements.indexOf(e.etablissement) < 0 ? ailleurs : ici).push(a);
    });
    function puce(a, loin) {
      var ch = M.chargeAesh(a, ctxCourant), reste = Math.max(0, ch.quotite - Math.max(ch.A, ch.B));
      return '<span class="palette-aesh' + (loin ? " loin" : "") + '" data-glisser-aesh="' + ech(a.id) + '" title="Glisser sur un créneau pour affecter ' + ech(nomAesh(a))
        + (loin ? " (n'intervient pas dans cet établissement)" : "") + '"><span class="puce-aesh" style="background:' + couleurAesh(a.id) + '">' + ech(initialesAesh(a)) + '</span>'
        + ech(a.prenom + " " + txt(a.nom).charAt(0) + ".") + ' <span class="aide">' + heures(reste) + '</span></span>';
    }
    $("ge-palette").innerHTML = etat.aesh.length ? '<span class="aide">Glisser une AESH sur un créneau :</span> ' + ici.map(function (a) { return puce(a, false); }).join("")
      + (ailleurs.length ? '<span class="palette-sep">autres établissements :</span>' + ailleurs.map(function (a) { return puce(a, true); }).join("") : "") : "";
  }

  /* =============== fiches : enregistrement automatique =============== */
  // Une fiche (élève ou AESH) s'enregistre seule : au changement d'une case
  // ou d'une liste, à la sortie d'un champ, ou après une pause de frappe.
  // Chaque modification s'annule avec « ↶ Annuler » (une frappe continue dans
  // un même champ compte pour une seule action). Une saisie pas encore
  // enregistrée (frappe en cours, valeur invalide) survit à tout redessin de
  // la fiche : le rendu reprend les champs changés depuis le dernier
  // enregistrement, même après un passage par un autre élève ou une autre AESH.
  var DELAI_FRAPPE = 800;
  function ficheAuto(o) {
    return { o: o, id: null, base: null, brouillons: {}, erreurs: {}, heures: {}, minuteur: null, champ: "", file: Promise.resolve(), enCours: 0 };
  }
  var autoEleve = ficheAuto({ hote: "ge-fiche", statut: "fe-statut", magasin: "eleves", nom: "fiche-eleve",
    trouver: function (id) { return eleveParId(id); }, lire: function (h) { return lireFicheEleve(h); },
    appliquer: function (e, s) { return appliquerFicheEleve(e, s); }, libelle: function (e) { return "la fiche de " + e.nomCourt; } });
  var autoAesh = ficheAuto({ hote: "ga-fiche", statut: "fa-statut", magasin: "aesh", nom: "fiche-aesh",
    trouver: function (id) { return aeshParId(id); }, lire: function (h) { return lireFicheAesh(h); },
    appliquer: function (a, s) { return appliquerFicheAesh(a, s); }, libelle: function (a) { return "la fiche de " + nomAesh(a); },
    // listes : valeur saisie (DOM) et valeur enregistrée (données), même forme
    listes: { plages: plagesSaisies, exclus: exclusSaisis },
    listesDonnees: function (a) {
      return { plages: JSON.stringify(((a.voeux || {}).plages || []).map(function (p) { return [p.jour || "", p.debut || "", p.fin || ""]; })),
        exclus: JSON.stringify(a.elevesExclus || []) };
    } });
  function valeursChamps(f, hote) {
    var v = {};
    Array.prototype.forEach.call(hote.querySelectorAll("[data-champ]"), function (c) { v[c.getAttribute("data-champ")] = c.type === "checkbox" ? (c.checked ? "1" : "") : c.value; });
    Object.keys(f.o.listes || {}).forEach(function (k) { v[k] = f.o.listes[k](hote); });
    return v;
  }
  function fichePresente(f) { var h = $(f.o.hote); return f.id && h && h.querySelector("[data-champ]") ? h : null; }
  // champs changés depuis le dernier enregistrement (ou le dernier rendu)
  function noterBrouillon(f) {
    var hote = fichePresente(f);
    if (!hote || !f.base) return;
    var v = valeursChamps(f, hote), br = {};
    Object.keys(v).forEach(function (k) { if (v[k] !== f.base[k]) br[k] = v[k]; });
    if (Object.keys(br).length) f.brouillons[f.id] = br; else delete f.brouillons[f.id];
  }
  // appelé juste avant de remplacer le contenu de la fiche
  function avantRendu(f, id) {
    var hote = fichePresente(f), r = { focus: null };
    if (hote && f.id !== id && f.minuteur) lancerAuto(f);   // on quitte la fiche : enregistrer la frappe en attente
    noterBrouillon(f);
    var actif = document.activeElement;
    if (hote && f.id === id && actif && hote.contains(actif) && actif !== hote) {
      r.focus = actif.getAttribute("data-champ") ? '[data-champ="' + actif.getAttribute("data-champ").replace(/"/g, '\\"') + '"]' : actif.id ? "#" + actif.id : null;
      try { r.debut = actif.selectionStart; r.fin = actif.selectionEnd; } catch (x) { /* case à cocher, date */ }
      var ligne = actif.closest && actif.closest(".fa-plage");
      if (ligne && !r.focus) {
        r.ligne = Array.prototype.indexOf.call(ligne.parentNode.children, ligne);
        r.focus = ["[data-plage-jour]", "[data-plage-debut]", "[data-plage-fin]"].filter(function (q) { return actif.matches(q); })[0] || null;
      }
    }
    r.brouillon = f.brouillons[id] || {};
    return r;
  }
  // appelé juste après : base = valeurs enregistrées, puis brouillon, focus, écouteurs
  function apresRendu(f, ent, r) {
    var hote = $(f.o.hote), br = r.brouillon;
    f.id = ent.id;
    f.base = valeursChamps(f, hote);
    if (f.o.listesDonnees) { var ld = f.o.listesDonnees(ent); Object.keys(ld).forEach(function (k) { f.base[k] = ld[k]; }); }
    Object.keys(br).forEach(function (k) {
      if ((f.o.listes || {})[k]) return;   // déjà repris à la construction
      var c = hote.querySelector('[data-champ="' + k.replace(/"/g, '\\"') + '"]');
      if (!c) return;
      if (c.type === "checkbox") c.checked = br[k] === "1"; else c.value = br[k];
    });
    if (r.focus) {
      var lieu = r.ligne !== undefined ? hote.querySelectorAll(".fa-plage")[r.ligne] : hote, el = lieu && lieu.querySelector(r.focus);
      if (el) {
        el.focus({ preventScroll: true });
        try { if (r.debut != null) el.setSelectionRange(r.debut, r.fin); } catch (x) { /* sans sélection */ }
      }
    }
    afficherStatut(f);
    var details = hote.firstElementChild;
    function cle(t) { return t.getAttribute("data-champ") || (t.closest(".fa-plage") ? "plages" : ""); }
    details.addEventListener("input", function (ev) {
      var t = ev.target;
      if (t.hasAttribute("data-sans-auto") || !/^(text|textarea)$/.test(t.type)) return;
      planifierAuto(f, cle(t), DELAI_FRAPPE);
    });
    details.addEventListener("change", function (ev) {
      if (ev.target.hasAttribute("data-sans-auto") || !cle(ev.target)) return;
      planifierAuto(f, cle(ev.target), 0);
    });
    if (Object.keys(br).length && !f.erreurs[ent.id]) planifierAuto(f, "", DELAI_FRAPPE);
  }
  function afficherStatut(f) {
    var el = $(f.o.statut);
    if (!el || !f.id) return;
    var err = f.erreurs[f.id];
    el.classList.toggle("erreur", !!err);
    el.textContent = err ? "Non enregistré : " + err + " Votre saisie est gardée ; corrigez-la pour l'enregistrer."
      : f.heures[f.id] ? "Enregistré automatiquement à " + f.heures[f.id] + ". « ↶ Annuler » revient en arrière."
      : "Chaque modification est enregistrée automatiquement ; « ↶ Annuler » revient en arrière.";
  }
  function planifierAuto(f, champ, delai) {
    if (f.minuteur) clearTimeout(f.minuteur);
    if (champ) f.champ = champ;
    f.minuteur = setTimeout(function () { lancerAuto(f); }, delai);
  }
  // lit la fiche tout de suite ; applique et écrit à la suite des écritures précédentes
  function lancerAuto(f) {
    if (f.minuteur) { clearTimeout(f.minuteur); f.minuteur = null; }
    var hote = fichePresente(f);
    if (!hote) return;
    var id = f.id, champ = f.champ || "fiche", saisie = f.o.lire(hote), valeurs = valeursChamps(f, hote);
    f.champ = "";
    f.enCours++;
    function fin() { f.enCours--; }
    f.file = f.file.then(function () {
      var ent = f.o.trouver(id);
      if (!ent) return;
      var r = f.o.appliquer(ent, saisie);
      if (r.erreur) { f.erreurs[id] = r.erreur; afficherStatut(f); return; }
      delete f.erreurs[id];
      // ce qui vient d'être lu est désormais la référence : seuls les changements ultérieurs restent en brouillon
      if (f.id === id) f.base = valeurs;
      var br = f.brouillons[id];
      if (br) { Object.keys(br).forEach(function (k) { if (br[k] === valeurs[k]) delete br[k]; }); if (!Object.keys(br).length) delete f.brouillons[id]; }
      if (!r.b) { afficherStatut(f); return; }
      var d = new Date();
      f.heures[id] = d.getHours() + " h " + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
      return enregistrerPuisRendre([{ magasin: f.o.magasin, enregistrer: [r.b] }], "", f.o.libelle(ent), f.o.nom + "|" + id + "|" + champ);
    }).then(fin, function (err) {
      fin();
      f.erreurs[id] = "l'écriture a échoué (" + ((err && err.message) || err) + ").";
      afficherStatut(f);
      ui.toast("Fiche non enregistrée : l'écriture a échoué.");
    });
  }
  function saisieEnAttente() {
    return [autoEleve, autoAesh].some(function (f) {
      noterBrouillon(f);
      return f.minuteur || f.enCours > 0 || Object.keys(f.brouillons).length || Object.keys(f.erreurs).length;
    });
  }
  // onglet masqué ou fermé : écrire la frappe en attente sans attendre la pause
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") [autoEleve, autoAesh].forEach(function (f) { if (f.minuteur) lancerAuto(f); });
  });
  window.addEventListener("beforeunload", function (ev) {
    [autoEleve, autoAesh].forEach(function (f) { if (f.minuteur) lancerAuto(f); });
    if (saisieEnAttente()) { ev.preventDefault(); ev.returnValue = ""; }
  });

  /* =============== fiche de l'élève (spec §16) =============== */
  // Notification, besoins, état par matière et commentaire, modifiables
  // avant de lancer « Proposer ». Le commentaire reste dans l'espace PIAL :
  // il n'est jamais exporté vers les AESH.
  var ficheEleveOuverte = false;
  var LIB_ETATS = { prioritaire: "Prioritaire", normal: "Normal", exclu: "Exclu" };
  function nombreSaisi(v) { var x = parseFloat(String(v).replace(",", ".")); return isNaN(x) ? NaN : Math.round(x * 100) / 100; }
  // la fiche (identifiants fixes : une seule à la fois dans la page) passe
  // d'un hôte à l'autre (grille de l'élève, onglet Élèves) : la frappe en
  // attente est enregistrée, le brouillon gardé, l'ancien hôte vidé
  function hebergerFiche(f, hoteId) {
    if (f.o.hote === hoteId) return;
    if (f.minuteur) lancerAuto(f);
    noterBrouillon(f);
    var ancien = $(f.o.hote);
    if (ancien) ancien.innerHTML = "";
    f.o.hote = hoteId; f.id = null; f.base = null;
  }
  function ongletVisible(id) { var v = $(id); return !!v && !v.classList.contains("masque"); }
  // opts : {hote (défaut : grille de l'élève), ouverte (fiche dépliée)}
  function rendreFicheEleve(e, opts) {
    opts = opts || {};
    hebergerFiche(autoEleve, opts.hote || "ge-fiche");
    var hote = $(autoEleve.o.hote), m = e.modifiesAppli || {};
    function marque(k) { return m[k] ? ' <span class="fe-modifie" title="Modifié dans l\'application : protégé au prochain import (vous choisirez quelle valeur garder)">modifié</span>' : ""; }
    var matieres = M.matieresEleve(e, etat.cours);
    var h = '<details class="fiche-eleve" id="fe-details"' + (ficheEleveOuverte || opts.ouverte ? " open" : "") + '><summary>Fiche de l\'élève'
      + '<span class="aide"> — notification, besoins, état par matière, commentaire' + (e.commentaire ? " · commentaire saisi" : "") + '</span></summary>'
      + '<div class="fe-corps"><div class="fe-colonne"><h4>Notification</h4><div class="fe-champs">'
      + '<label>Heures individuelles' + marque("heuresInd") + '<input type="text" inputmode="decimal" id="fe-ind" data-champ="ind" value="' + ech(String(e.heuresInd || 0).replace(".", ",")) + '"></label>'
      + '<label>Heures mutualisées' + marque("heuresMut") + '<input type="text" inputmode="decimal" id="fe-mut" data-champ="mut" value="' + ech(String(e.heuresMut || 0).replace(".", ",")) + '"></label>'
      + '<label>Début' + marque("debutNotif") + '<input type="date" id="fe-debut" data-champ="debut" value="' + ech(e.debutNotif || "") + '"></label>'
      + '<label>Fin' + marque("finNotif") + '<input type="date" id="fe-fin" data-champ="fin" value="' + ech(e.finNotif || "") + '"></label></div>'
      + '<h4>Besoins' + marque("besoins") + '</h4><div class="fe-besoins">'
      + I.ACCOMP.map(function (b, i) {
        return '<label class="pastille-case"><input type="checkbox" data-besoin="' + i + '" data-champ="besoin-' + i + '"' + ((e.besoins || []).indexOf(b) > -1 ? " checked" : "") + '> ' + ech(b) + '</label>';
      }).join("") + '</div>'
      + '<h4>Commentaire</h4><textarea id="fe-commentaire" data-champ="commentaire" rows="3" maxlength="1000" placeholder="Organisation, informations pratiques utiles à l\'affectation…">' + ech(e.commentaire || "") + '</textarea>'
      + '<p class="aide fe-rappel">Pas d\'information médicale (diagnostic, traitement, pathologie) : décrivez des besoins fonctionnels. Ce commentaire reste dans l\'espace PIAL ; il n\'est jamais transmis aux AESH.</p>'
      + '<p class="fe-statut" id="fe-statut" aria-live="polite"></p>'
      + (Object.keys(m).length ? '<p class="aide">Les valeurs marquées « modifié » sont protégées : au prochain import des élèves, l\'aperçu vous demandera de garder celles de l\'application ou de prendre celles du fichier.</p>' : "")
      + '</div><div class="fe-colonne"><h4>État par matière</h4>'
      + (matieres.length ? '<p class="aide">S\'applique à tous les créneaux de la matière (et aux cours importés plus tard). Un créneau peut ensuite être réglé seul dans la grille.</p>'
        + '<table class="tableau fe-matieres"><tbody>' + matieres.map(function (x) {
          var detail = x.uniforme ? "" : '<div class="aide">réglé créneau par créneau : ' + ["prioritaire", "normal", "exclu"].filter(function (s) { return x.etats[s]; })
            .map(function (s) { return x.etats[s] + " " + s + (x.etats[s] > 1 ? "s" : ""); }).join(", ") + '</div>';
          return '<tr><td><strong>' + ech(x.libelle) + '</strong> <span class="aide">(' + pluriel(x.nb, "créneau") + ')</span>' + detail + '</td><td class="fe-etats">'
            + ["prioritaire", "normal", "exclu"].map(function (s) {
              var actif = x.uniforme === s;
              return '<button type="button" class="btn-etat e-' + s + '" data-matiere="' + ech(x.cle) + '" data-etat-matiere="' + s + '" aria-pressed="' + actif + '">' + LIB_ETATS[s] + '</button>';
            }).join("") + '</td></tr>';
        }).join("") + '</tbody></table>' : '<p class="aide">Aucun cours importé pour cet élève.</p>')
      + '</div></div></details>';
    var av = avantRendu(autoEleve, e.id);
    hote.innerHTML = h;
    if (!opts.ouverte) $("fe-details").addEventListener("toggle", function () { ficheEleveOuverte = this.open; });
    apresRendu(autoEleve, e, av);
    Array.prototype.forEach.call(hote.querySelectorAll("[data-etat-matiere]"), function (b) {
      b.addEventListener("click", function () { changerEtatMatiere(e, this.dataset.matiere, this.dataset.etatMatiere); });
    });
  }
  // saisie lue dans la fiche (synchrone), appliquée ensuite à l'élève à jour
  function lireFicheEleve(hote) {
    return {
      ind: $("fe-ind").value, mut: $("fe-mut").value, debut: $("fe-debut").value, fin: $("fe-fin").value,
      besoins: Array.prototype.filter.call(hote.querySelectorAll("[data-besoin]"), function (c) { return c.checked; })
        .map(function (c) { return I.ACCOMP[parseInt(c.dataset.besoin, 10)]; }),
      commentaire: $("fe-commentaire").value
    };
  }
  // { erreur } ou { b } (fiche modifiée) ou {} (aucune modification)
  function appliquerFicheEleve(e, s) {
    var ind = nombreSaisi(s.ind), mut = nombreSaisi(s.mut);
    if (isNaN(ind) || ind < 0 || ind > 40 || isNaN(mut) || mut < 0 || mut > 40) return { erreur: "heures notifiées invalides (de 0 à 40)." };
    if (!(ind > 0) && !(mut > 0)) return { erreur: "indiquez au moins une heure notifiée, individuelle ou mutualisée." };
    if (s.debut && s.fin && s.fin < s.debut) return { erreur: "la fin de notification précède son début." };
    var b = JSON.parse(JSON.stringify(e)), nouveau = { heuresInd: ind, heuresMut: mut, debutNotif: s.debut, finNotif: s.fin, besoins: s.besoins };
    b.modifiesAppli = b.modifiesAppli || {};
    var change = false;
    M.CHAMPS_NOTIFICATION.forEach(function (k) {
      var avant = k === "heuresInd" || k === "heuresMut" ? (e[k] || 0) : (k === "besoins" ? (e[k] || []) : (e[k] || ""));
      if (JSON.stringify(avant) !== JSON.stringify(nouveau[k])) { b[k] = nouveau[k]; b.modifiesAppli[k] = true; change = true; }
    });
    if (!Object.keys(b.modifiesAppli).length) delete b.modifiesAppli;
    var commentaire = s.commentaire.replace(/\s+$/, "");
    if (commentaire !== (e.commentaire || "")) { if (commentaire) b.commentaire = commentaire; else delete b.commentaire; change = true; }
    return change ? { b: b } : {};
  }
  function changerEtatMatiere(e, cle, nouvelEtat) {
    var b = JSON.parse(JSON.stringify(e));
    b.etatsMatieres = b.etatsMatieres || {};
    if (nouvelEtat === "normal") delete b.etatsMatieres[cle]; else b.etatsMatieres[cle] = nouvelEtat;
    if (!Object.keys(b.etatsMatieres).length) delete b.etatsMatieres;
    var cours = etat.cours.filter(function (c) { return c.eleveId === e.id && M.cleMatiere(c.matiere) === cle && c.etat !== nouvelEtat; })
      .map(function (c) { var x = JSON.parse(JSON.stringify(c)); x.etat = nouvelEtat; return x; });
    var libelle = (M.matieresEleve(e, etat.cours).filter(function (x) { return x.cle === cle; })[0] || { libelle: cle }).libelle;
    enregistrerPuisRendre([{ magasin: "eleves", enregistrer: [b] }, { magasin: "cours", enregistrer: cours }],
      libelle + " : " + LIB_ETATS[nouvelEtat].toLowerCase() + " (" + pluriel(cours.length, "créneau modifié", "créneaux modifiés") + ").",
      "l'état de la matière " + libelle + " pour " + e.nomCourt);
  }

  /* =============== fiche de l'AESH (spec §16) =============== */
  // Quotité, établissements, indisponibilités (contrainte dure, débrayable),
  // vœux (pénalités), élèves à ne pas affecter (exclusion dure, sans motif)
  // et spécialités. Les champs aussi présents dans le fichier des AESH sont
  // marqués « modifié » et protégés au réimport, comme pour les élèves.
  var ficheAeshOuverte = false;
  var ABREV = { lundi: "lun", mardi: "mar", mercredi: "mer", jeudi: "jeu", vendredi: "ven", samedi: "sam" };
  function joursClasse() {
    var vus = {};
    etat.etablissements.forEach(function (e) { (e.joursOuvres && e.joursOuvres.length ? e.joursOuvres : M.JOURS.slice(0, 5)).forEach(function (j) { vus[j] = true; }); });
    var j = M.JOURS.filter(function (x) { return vus[x]; });
    return j.length ? j : M.JOURS.slice(0, 5);
  }
  // grille jours × (matin, après-midi) ; codes « mer » (journée), « ven-pm »
  function grilleDemiJournees(nom, codes) {
    var coche = {};
    (codes || []).forEach(function (c) {
      var p = M.normaliser(c).split("-"), j = (M.jourNormalise(p[0]) || "").slice(0, 3);
      if (!p[1] || p[1] === "am") coche[j + "-am"] = true;
      if (!p[1] || p[1] === "pm") coche[j + "-pm"] = true;
    });
    return '<table class="fa-demi"><thead><tr><th></th>' + joursClasse().map(function (j) { return '<th>' + j.slice(0, 3) + '.</th>'; }).join("") + '</tr></thead><tbody>'
      + [["am", "Matin"], ["pm", "Après-midi"]].map(function (d) {
        return '<tr><th>' + d[1] + '</th>' + joursClasse().map(function (j) {
          var k = ABREV[j] + "-" + d[0];
          return '<td><input type="checkbox" data-' + nom + '="' + k + '" data-champ="' + nom + '-' + k + '" aria-label="' + j + ' ' + d[1].toLowerCase() + '"' + (coche[k] ? " checked" : "") + '></td>';
        }).join("") + '</tr>';
      }).join("") + '</tbody></table>';
  }
  function lireDemiJournees(nom) {
    var coche = {};
    Array.prototype.forEach.call($(autoAesh.o.hote).querySelectorAll("[data-" + nom + "]"), function (c) { if (c.checked) coche[c.getAttribute("data-" + nom)] = true; });
    var out = [];
    joursClasse().forEach(function (j) {
      var a = coche[ABREV[j] + "-am"], p = coche[ABREV[j] + "-pm"];
      if (a && p) out.push(ABREV[j]); else if (a) out.push(ABREV[j] + "-am"); else if (p) out.push(ABREV[j] + "-pm");
    });
    return out;
  }
  function lignePlage(pl) {
    pl = pl || { jour: "", debut: "", fin: "" };
    return '<div class="fa-plage"><select data-plage-jour aria-label="Jour"><option value="">tous les jours</option>'
      + joursClasse().map(function (j) { return '<option value="' + j + '"' + (pl.jour === j ? " selected" : "") + '>' + j + '</option>'; }).join("") + '</select>'
      + ' de <input type="text" data-plage-debut placeholder="hh:mm" inputmode="numeric" value="' + ech(pl.debut) + '" aria-label="Début">'
      + ' à <input type="text" data-plage-fin placeholder="hh:mm" inputmode="numeric" value="' + ech(pl.fin) + '" aria-label="Fin">'
      + ' <button type="button" class="btn-lien" data-retirer-plage>retirer</button></div>';
  }
  function puceExclu(e) {
    return '<span class="fa-exclu" data-exclu="' + ech(e.id) + '">' + ech(e.nomCourt) + ' (' + ech(e.classe) + ')'
      + ' <button type="button" class="btn-lien" data-retirer-exclu aria-label="Retirer ' + ech(e.nomCourt) + '">×</button></span>';
  }
  // opts : {hote (défaut : grille de l'AESH), ouverte (fiche dépliée)}
  function rendreFicheAeshComplete(a, opts) {
    opts = opts || {};
    hebergerFiche(autoAesh, opts.hote || "ga-fiche");
    var hote = $(autoAesh.o.hote), m = a.modifiesAppli || {}, table = ctxCourant.reglages.specialites || [], v = a.voeux || {};
    // listes en cours de saisie (plages, élèves exclus) reprises dès la construction
    var av = avantRendu(autoAesh, a.id), br = av.brouillon;
    var plagesVues = br.plages !== undefined ? JSON.parse(br.plages).map(function (p) { return { jour: p[0], debut: p[1], fin: p[2] }; }) : (v.plages || []);
    var exclusIds = br.exclus !== undefined ? JSON.parse(br.exclus) : (a.elevesExclus || []);
    function marque(k) { return m[k] ? ' <span class="fe-modifie" title="Modifié dans l\'application : protégé au prochain import (vous choisirez quelle valeur garder)">modifié</span>' : ""; }
    var inconnues = M.specialitesInconnues(a, table);
    var exclus = exclusIds.map(eleveParId).filter(Boolean);
    var autres = etat.eleves.filter(function (e) { return exclusIds.indexOf(e.id) < 0; })
      .sort(function (p, q) { return p.nomCourt.localeCompare(q.nomCourt, "fr") || txt(p.classe).localeCompare(txt(q.classe), "fr"); });
    var global = ctxCourant.reglages.respecterIndispos;
    var h = '<details class="fiche-eleve" id="fa-details"' + (ficheAeshOuverte || opts.ouverte ? " open" : "") + '><summary>Fiche de l\'AESH'
      + '<span class="aide"> — quotité, e-mail, établissements, indisponibilités, vœux, élèves à ne pas affecter, spécialités</span></summary>'
      + '<div class="fe-corps"><div class="fe-colonne"><h4>Paramètres</h4><div class="fe-champs">'
      + '<label>Quotité hebdomadaire (h)' + marque("quotite") + '<input type="text" inputmode="decimal" id="fa-quotite" data-champ="quotite" value="' + ech(String(a.quotite || 0).replace(".", ",")) + '"></label>'
      + '<label>E-mail' + marque("email") + '<input type="text" inputmode="email" autocomplete="off" id="fa-email" data-champ="email" value="' + ech(a.email || "") + '"></label></div>'
      + '<h4>Établissements possibles' + marque("etablissements") + '</h4><div class="fe-besoins">'
      + etat.etablissements.slice().sort(function (p, q) { return p.nom.localeCompare(q.nom, "fr"); }).map(function (e) {
        return '<label class="pastille-case"><input type="checkbox" data-fa-etab="' + ech(e.id) + '" data-champ="etab-' + ech(e.id) + '"' + ((a.etablissements || []).indexOf(e.id) > -1 ? " checked" : "") + '> ' + ech(e.nom) + '</label>';
      }).join("") + '</div><p class="aide">Aucun coché = tous les établissements.</p>'
      + '<h4>Indisponibilités' + marque("indisponibilites") + '</h4>' + grilleDemiJournees("fa-indispo", a.indisponibilites)
      + '<label class="case"><input type="checkbox" id="fa-ignorer2" data-champ="ignorer"' + (a.ignorerIndispos ? " checked" : "") + (global ? "" : " disabled") + '> Ignorer ses indisponibilités et ses établissements possibles</label>'
      + '<p class="aide">' + (global ? "Contrainte dure : le moteur ne place jamais l'AESH sur une demi-journée indisponible, sauf si cette case est cochée (arrangement ponctuel)."
        : "Sans effet : le réglage global « Respecter les indisponibilités » est décoché (Réglages).") + '</p>'
      + '<h4>Spécialités' + marque("formations") + '</h4><div class="fe-besoins">'
      + table.map(function (s) {
        var c = (a.formations || []).some(function (f) { return M.normaliser(f) === M.normaliser(s.nom); });
        return '<label class="pastille-case" title="' + ech(s.besoins.join(" · ")) + '"><input type="checkbox" data-fa-spec="' + ech(s.nom) + '" data-champ="spec-' + ech(s.nom) + '"' + (c ? " checked" : "") + '> ' + ech(s.nom) + '</label>';
      }).join("")
      + inconnues.map(function (f) {
        return '<label class="pastille-case hors-table" title="Hors de la table de Réglages : sans effet sur la proposition"><input type="checkbox" data-fa-spec="' + ech(f) + '" data-champ="spec-' + ech(f) + '" checked> ' + ech(f) + ' (hors table)</label>';
      }).join("") + '</div><p class="aide">Chaque spécialité couvre des besoins fonctionnels (table modifiable dans Réglages, survol pour la voir). Le moteur ajoute jusqu\'à +' + P.POIDS.formation + ' selon la part des besoins de l\'élève couverts.</p>'
      + '</div><div class="fe-colonne"><h4>Vœux (évités si possible, pas des contraintes)</h4>'
      + '<p class="aide">Journées ou demi-journées à éviter :</p>' + grilleDemiJournees("fa-voeu", v.demiJournees)
      + '<p class="aide">Plages horaires à éviter :</p><div id="fa-plages">' + plagesVues.map(lignePlage).join("") + '</div>'
      + '<button type="button" class="btn-lien" id="fa-ajouter-plage">+ Ajouter une plage</button>'
      + '<p class="aide">Chaque vœu touché coûte ' + (-P.POIDS.voeu) + ' points au score de l\'AESH sur ce créneau.</p>'
      + '<h4>Élèves à ne pas affecter à cette AESH</h4><div class="fe-besoins" id="fa-exclus">' + exclus.map(puceExclu).join("") + '</div>'
      + '<div class="fa-ajout-exclu"><select id="fa-choix-exclu" data-sans-auto aria-label="Élève à exclure"><option value="">Choisir un élève…</option>'
      + autres.map(function (e) { return '<option value="' + ech(e.id) + '">' + ech(e.nomCourt) + ' (' + ech(e.classe) + ', ' + ech(nomEtablissement(e.etablissement)) + ')</option>'; }).join("")
      + '</select> <button type="button" class="btn btn-vide" id="fa-ajouter-exclu">Ajouter</button></div>'
      + '<p class="aide">Exclusion dure, sans motif à indiquer : ni le moteur ni le menu ne proposeront cette AESH à ces élèves ; une saisie manuelle reste possible, signalée dans les alertes.</p>'
      + '<p class="fe-statut" id="fa-statut" aria-live="polite"></p>'
      + '</div></div></details>';
    hote.innerHTML = h;
    if (!opts.ouverte) $("fa-details").addEventListener("toggle", function () { ficheAeshOuverte = this.open; });
    $("fa-ajouter-plage").addEventListener("click", function () {
      $("fa-plages").insertAdjacentHTML("beforeend", lignePlage());
      $("fa-plages").lastChild.querySelector("[data-plage-debut]").focus();
    });
    $("fa-plages").addEventListener("click", function (ev) {
      if (!ev.target.hasAttribute("data-retirer-plage")) return;
      ev.target.parentNode.remove();
      planifierAuto(autoAesh, "plages", 0);
    });
    $("fa-exclus").addEventListener("click", function (ev) {
      if (!ev.target.hasAttribute("data-retirer-exclu")) return;
      var puce = ev.target.parentNode, e = eleveParId(puce.dataset.exclu);
      puce.remove();
      planifierAuto(autoAesh, "exclus", 0);
      if (e) $("fa-choix-exclu").insertAdjacentHTML("beforeend", '<option value="' + ech(e.id) + '">' + ech(e.nomCourt) + ' (' + ech(e.classe) + ')</option>');
    });
    $("fa-ajouter-exclu").addEventListener("click", function () {
      var sel = $("fa-choix-exclu"), e = eleveParId(sel.value);
      if (!e) return;
      $("fa-exclus").insertAdjacentHTML("beforeend", puceExclu(e));
      sel.remove(sel.selectedIndex);
      sel.value = "";
      planifierAuto(autoAesh, "exclus", 0);
    });
    apresRendu(autoAesh, a, av);
  }
  // listes de la fiche AESH sous une forme comparable (brouillon, enregistrement)
  function plagesSaisies(hote) {
    return JSON.stringify(Array.prototype.map.call(hote.querySelectorAll(".fa-plage"), function (l) {
      return [l.querySelector("[data-plage-jour]").value, l.querySelector("[data-plage-debut]").value, l.querySelector("[data-plage-fin]").value];
    }));
  }
  function exclusSaisis(hote) { return JSON.stringify(Array.prototype.map.call(hote.querySelectorAll("[data-exclu]"), function (x) { return x.dataset.exclu; })); }
  function lireFicheAesh(hote) {
    return {
      quotite: $("fa-quotite").value,
      email: $("fa-email").value,
      plages: JSON.parse(plagesSaisies(hote)),
      etablissements: Array.prototype.filter.call(hote.querySelectorAll("[data-fa-etab]"), function (c) { return c.checked; }).map(function (c) { return c.dataset.faEtab; }),
      indisponibilites: lireDemiJournees("fa-indispo"),
      formations: Array.prototype.filter.call(hote.querySelectorAll("[data-fa-spec]"), function (c) { return c.checked; }).map(function (c) { return c.dataset.faSpec; }),
      ignorer: $("fa-ignorer2").checked,
      voeux: lireDemiJournees("fa-voeu"),
      exclus: JSON.parse(exclusSaisis(hote))
    };
  }
  function appliquerFicheAesh(a, s) {
    var q = nombreSaisi(s.quotite);
    if (isNaN(q) || !(q > 0) || q > 45) return { erreur: "quotité invalide (de 0,5 à 45 heures)." };
    var email = txt(s.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { erreur: "adresse e-mail invalide." };
    var plages = [], erreur = "";
    s.plages.forEach(function (p) {
      var d = M.heureNormalisee(p[1]), f = M.heureNormalisee(p[2]);
      if (!String(p[1]).trim() && !String(p[2]).trim()) return;
      if (!d || !f || M.minutes(f) <= M.minutes(d)) { erreur = "plage horaire incomplète ou invalide (heures hh:mm, fin après le début)."; return; }
      plages.push({ jour: p[0], debut: d, fin: f });
    });
    if (erreur) return { erreur: erreur };
    var b = JSON.parse(JSON.stringify(a));
    var nouveau = { quotite: q, email: email, etablissements: s.etablissements, indisponibilites: s.indisponibilites, formations: s.formations };
    b.modifiesAppli = b.modifiesAppli || {};
    M.CHAMPS_FICHE_AESH.forEach(function (k) {
      var avant = k === "quotite" ? (a.quotite || 0) : (k === "email" ? (a.email || "") : (a[k] || []));
      if (JSON.stringify(avant) !== JSON.stringify(nouveau[k])) { b[k] = nouveau[k]; b.modifiesAppli[k] = true; }
    });
    if (!Object.keys(b.modifiesAppli).length) delete b.modifiesAppli;
    b.etablissementsNoms = (b.etablissements || []).map(nomEtablissement);
    b.ignorerIndispos = s.ignorer;
    var voeux = { demiJournees: s.voeux, plages: plages };
    if (voeux.demiJournees.length || voeux.plages.length) b.voeux = voeux; else delete b.voeux;
    if (s.exclus.length) b.elevesExclus = s.exclus; else delete b.elevesExclus;
    return JSON.stringify(b) === JSON.stringify(a) ? {} : { b: b };
  }

  /* =============== grille AESH (§7.1, vue 3) =============== */
  // Semaine de l'AESH à l'échelle du temps : les trous et les changements
  // d'établissement se voient d'un coup d'œil. Fond blanc = libre, hachures
  // grises = indisponibilité, cadre pointillé rouge = trou de plus de
  // l'écart maximal. Les vœux (fiche AESH, étape D) s'ajouteront ici.
  var COULEURS_ETAB = ["#3A6FB0", "#2F6B4F", "#9A6B12", "#8A4FB0", "#B0473C", "#2A7F8F", "#5A5FC8", "#7B5B3A"];
  function couleurEtab(id) {
    var ids = etat.etablissements.slice().sort(function (a, b) { return txt(a.nom).localeCompare(txt(b.nom), "fr"); }).map(function (e) { return e.id; });
    var i = ids.indexOf(id);
    return COULEURS_ETAB[(i < 0 ? 0 : i) % COULEURS_ETAB.length];
  }
  function semainesAff(aff) { return M.semainesDe(aff.creneau.semaine, etablissementParId(aff.creneau.etab)); }
  function affsAeshSemaine(a, semaine) {
    return (ctxCourant._affParAesh[a.id] || []).filter(function (x) { return semainesAff(x).indexOf(semaine) > -1; })
      .sort(function (p, q) { return M.minutes(p.creneau.debut) - M.minutes(q.creneau.debut) || M.minutes(p.creneau.fin) - M.minutes(q.creneau.fin); });
  }
  // jours affichés : jours de classe des établissements possibles, et tout
  // jour où l'AESH a un créneau
  function joursAesh(a, affs) {
    var vus = {};
    var ids = (a.etablissements || []).length ? a.etablissements : etat.etablissements.map(function (e) { return e.id; });
    ids.forEach(function (id) {
      var e = etablissementParId(id);
      (e && e.joursOuvres && e.joursOuvres.length ? e.joursOuvres : M.JOURS.slice(0, 5)).forEach(function (j) { vus[j] = true; });
    });
    affs.forEach(function (x) { vus[x.creneau.jour] = true; });
    var jours = M.JOURS.filter(function (j) { return vus[j]; });
    return jours.length ? jours : M.JOURS.slice(0, 5);
  }
  function bornesGrille(affs) {
    var t0 = 8 * 60, t1 = 17 * 60;
    affs.forEach(function (x) {
      t0 = Math.min(t0, Math.floor(M.minutes(x.creneau.debut) / 60) * 60);
      t1 = Math.max(t1, Math.ceil(M.minutes(x.creneau.fin) / 60) * 60);
    });
    return { t0: t0, t1: t1 };
  }
  // HTML de la grille d'une AESH pour une semaine. opts.impression : sans
  // boutons ; opts.hauteurMax : hauteur maximale de la zone horaire (px).
  function grilleAeshHtml(a, semaine, opts) {
    opts = opts || {};
    var imp = !!opts.impression, r = ctxCourant.reglages;
    var affs = affsAeshSemaine(a, semaine), jours = joursAesh(a, affs), b = bornesGrille(affs);
    var k = Math.min(1.1, opts.hauteurMax ? opts.hauteurMax / (b.t1 - b.t0) : 1.1);
    var H = Math.round((b.t1 - b.t0) * k);
    function y(m) { return ((m - b.t0) * k).toFixed(1); }
    function haut(d, f) { return Math.max(2, (f - d) * k).toFixed(1); }
    var mesure = M.journeesAesh(a, ctxCourant)[semaine];
    var h = '<div class="ga-grille" style="grid-template-columns:46px repeat(' + jours.length + ',minmax(' + (imp ? 80 : 118) + 'px,1fr))">';
    h += '<div class="ga-coin"></div>' + jours.map(function (j) {
      var m = mesure.jours[j];
      var info = m ? texteDuree(m.presence) + " de présence" + (m.trous ? ' · <span class="ga-alerte">' + pluriel(m.trous, "trou") + '</span>' : "")
        + (m.courte ? ' · <span class="ga-alerte">journée courte</span>' : "") : "libre";
      return '<div class="ga-tete"><strong>' + j + '</strong><span>' + info + '</span></div>';
    }).join("");
    // axe des heures
    h += '<div class="ga-axe" style="height:' + H + 'px">';
    for (var t = b.t0; t <= b.t1; t += 60) h += '<span style="top:' + y(t) + 'px">' + M.hhmm(t) + '</span>';
    h += '</div>';
    var ignorees = !r.respecterIndispos || a.ignorerIndispos;
    jours.forEach(function (j) {
      h += '<div class="ga-jour" style="height:' + H + 'px">';
      for (var t2 = b.t0 + 60; t2 < b.t1; t2 += 60) h += '<div class="ga-ligne" style="top:' + y(t2) + 'px"></div>';
      // indisponibilités (journée, matin ou après-midi)
      (a.indisponibilites || []).forEach(function (code) {
        var p = M.normaliser(code).split("-");
        if (M.jourNormalise(p[0]) !== j) return;
        var d = p[1] === "pm" ? 12 * 60 : b.t0, f = p[1] === "am" ? 12 * 60 : b.t1;
        h += '<div class="ga-indispo' + (ignorees ? " ignoree" : "") + '" style="top:' + y(d) + 'px;height:' + haut(d, f) + 'px" title="Indisponible : '
          + ech(texteIndispo(code)) + (ignorees ? " (ignorée)" : "") + '"><span>Indisponible' + (ignorees ? " (ignorée)" : "") + '</span></div>';
      });
      // vœux : demi-journées et plages à éviter (hachures orangées)
      var v = a.voeux || {};
      (v.demiJournees || []).forEach(function (code) {
        var p = M.normaliser(code).split("-");
        if (M.jourNormalise(p[0]) !== j) return;
        var d = p[1] === "pm" ? 12 * 60 : b.t0, f = p[1] === "am" ? 12 * 60 : b.t1;
        h += '<div class="ga-voeu" style="top:' + y(d) + 'px;height:' + haut(d, f) + 'px" title="Vœu : éviter ' + ech(texteIndispo(code)) + '"><span>vœu</span></div>';
      });
      (v.plages || []).forEach(function (pl) {
        if (pl.jour && pl.jour !== j) return;
        var d = Math.max(b.t0, M.minutes(pl.debut)), f = Math.min(b.t1, M.minutes(pl.fin));
        if (f <= d) return;
        h += '<div class="ga-voeu" style="top:' + y(d) + 'px;height:' + haut(d, f) + 'px" title="Vœu : éviter ' + ech(pl.debut + "–" + pl.fin) + '"><span>vœu</span></div>';
      });
      var duJour = affs.filter(function (x) { return x.creneau.jour === j; });
      // trous : écarts de plus de ecartMax entre deux périodes de présence
      var blocs = [];
      duJour.forEach(function (x) {
        var d = M.minutes(x.creneau.debut), f = M.minutes(x.creneau.fin), der = blocs[blocs.length - 1];
        if (der && d <= der[1]) der[1] = Math.max(der[1], f); else blocs.push([d, f]);
      });
      for (var i = 1; i < blocs.length; i++) {
        var e0 = blocs[i - 1][1], e1 = blocs[i][0];
        if (e1 - e0 > r.ecartMax) h += '<div class="ga-trou" style="top:' + y(e0) + 'px;height:' + haut(e0, e1) + 'px"><span>trou de ' + texteDuree(e1 - e0) + '</span></div>';
      }
      // créneaux ; deux créneaux qui se chevauchent (conflit) côte à côte
      var finsVoies = [], precedent = null;
      duJour.forEach(function (x) {
        var d = M.minutes(x.creneau.debut), f = M.minutes(x.creneau.fin);
        var voie = 0;
        while (finsVoies[voie] !== undefined && finsVoies[voie] > d) voie++;
        finsVoies[voie] = f;
        x._voie = voie;
      });
      var nbVoies = Math.max(1, finsVoies.length);
      duJour.forEach(function (x) {
        var d = M.minutes(x.creneau.debut), f = M.minutes(x.creneau.fin), hauteur = (f - d) * k;
        var conflit = erreursDe(x), chg = precedent && precedent.creneau.etab !== x.creneau.etab;
        precedent = x;
        var eleves = x.eleves.map(eleveParId).filter(Boolean);
        var classes = [];
        eleves.forEach(function (e) { if (classes.indexOf(e.classe) < 0) classes.push(e.classe); });
        var noms = eleves.map(function (e) {
          return imp ? '<span class="ga-eleve">' + ech(e.nomCourt) + '</span>'
            : '<button type="button" class="ga-eleve" data-grille-eleve="' + ech(e.id) + '" title="Ouvrir la grille de ' + ech(e.nomCourt) + '">' + ech(e.nomCourt) + '</button>';
        }).join(", ") || "élève supprimé";
        var nature = x.modalite === "periscolaire" ? LIB_PERI[x.periscolaire] : (x.modalite === "mutualise" ? "mutualisé" : "");
        var titre = x.creneau.debut + "–" + x.creneau.fin + " · " + eleves.map(function (e) { return e.nomCourt + " (" + e.classe + ")"; }).join(", ")
          + " · " + nomEtablissement(x.creneau.etab) + (nature ? " · " + nature : "") + (x.creneau.semaine !== "toutes" ? " · semaine " + x.creneau.semaine + " seulement" : "")
          + (x.epinglee ? " · épinglée" : "") + (conflit.length ? " — ⚠ " + conflit.map(function (v) { return v.message; }).join(" ") : "");
        var largeur = 100 / nbVoies;
        h += '<div class="ga-bloc' + (hauteur < 30 ? " court" : "") + (chg ? " chg" : "") + (conflit.length ? " conflit" : "") + (x.modalite === "periscolaire" ? " peri" : "")
          + '" style="top:' + y(d) + 'px;height:' + haut(d, f) + 'px;left:calc(' + (x._voie * largeur) + '% + 3px);width:calc(' + largeur + '% - 6px);border-left-color:' + couleurEtab(x.creneau.etab) + '"'
          + (imp ? "" : ' data-aff="' + ech(x.id) + '" tabindex="0"') + ' title="' + ech(titre) + '">'
          + '<div class="ga-l1">' + (chg ? '<span class="ga-chg" title="Changement d\'établissement">↪</span> ' : "") + (x.epinglee ? "🔒" : "") + (conflit.length ? "⚠ " : "")
          + '<span class="ga-h">' + x.creneau.debut + '</span> ' + noms + '</div>'
          + (hauteur >= 30 ? '<div class="ga-l2">' + ech(classes.join(", ")) + (nature ? " · " + ech(nature) : "") + (x.creneau.semaine !== "toutes" ? " · sem. " + x.creneau.semaine : "")
            + '</div><div class="ga-l3">' + ech(nomEtablissement(x.creneau.etab)) + '</div>' : "")
          + '</div>';
      });
      duJour.forEach(function (x) { delete x._voie; });
      h += '</div>';
    });
    return h + '</div>';
  }
  function legendeGrilleAesh() {
    return '<div class="ga-legende"><span><i class="lg-libre"></i>libre</span><span><i class="lg-indispo"></i>indisponible</span><span><i class="lg-voeu"></i>vœu (à éviter)</span>'
      + '<span><i class="lg-trou"></i>trou de plus de ' + ech(texteDuree(ctxCourant.reglages.ecartMax)) + '</span>'
      + '<span>↪ changement d\'établissement</span><span>bord coloré = établissement</span><span>🔒 épinglée · ⚠ contrainte non respectée</span></div>';
  }
  function resumeAesh(a) {
    var ch = M.chargeAesh(a, ctxCourant), j = M.journeesAesh(a, ctxCourant), r = ctxCourant.reglages;
    function ab(x, y2, f) { return x === y2 ? f(x) : f(x) + " (A) / " + f(y2) + " (B)"; }
    return {
      quotite: heures(ch.quotite), charge: ab(ch.A, ch.B, heures), etat: LIB_ETAT_AESH[ch.etat],
      reste: ab(Math.max(0, ch.quotite - ch.A), Math.max(0, ch.quotite - ch.B), heures),
      etabs: (a.etablissements || []).length ? a.etablissements.map(nomEtablissement).join(", ") : "tous",
      indispos: (a.indisponibilites || []).length ? a.indisponibilites.map(texteIndispo).join(", ")
        + (!r.respecterIndispos || a.ignorerIndispos ? " (ignorées)" : "") : "aucune",
      trous: ab(j.A.trous, j.B.trous, String), courtes: ab(j.A.courtes, j.B.courtes, String)
    };
  }
  function rendreGrilleAesh() {
    var a = aeshParId(aeshOuverte);
    if (!a) { retourVue(); return; }
    var s = resumeAesh(a), affs = ctxCourant._affParAesh[a.id] || [];
    var alternance = affs.some(function (x) { return semainesAff(x).length === 1; })
      || etat.etablissements.some(function (e) { return e.alternance && (!(a.etablissements || []).length || a.etablissements.indexOf(e.id) > -1); });
    $("ga-titre").innerHTML = '<span class="puce-aesh" style="background:' + couleurAesh(a.id) + '">' + ech(initialesAesh(a)) + '</span> ' + ech(nomAesh(a));
    $("ga-sous-titre").textContent = "Quotité " + s.quotite + " · charge " + s.charge + " (" + s.etat + ") · heures restantes : " + s.reste
      + (alternance ? " · semaine " + semaineAffichee + " affichée" : "");
    var eleves = {};
    affs.forEach(function (x) { x.eleves.forEach(function (id) { var e = eleveParId(id); if (e) eleves[id] = e; }); });
    var liste = Object.keys(eleves).map(function (id) { return eleves[id]; }).sort(function (p, q) { return p.nomCourt.localeCompare(q.nomCourt, "fr"); });
    $("ga-resume").innerHTML = '<dl class="ga-infos"><dt>Établissements possibles</dt><dd>' + ech(s.etabs) + '</dd>'
      + '<dt>Indisponibilités</dt><dd>' + ech(s.indispos) + '</dd>'
      + '<dt>Journées</dt><dd>' + s.trous + ' trou(s) de plus de ' + ech(texteDuree(ctxCourant.reglages.ecartMax)) + ' · ' + s.courtes + ' journée(s) de moins de ' + ech(texteDuree(ctxCourant.reglages.journeeMin)) + '</dd>'
      + '<dt>Élèves (' + liste.length + ')</dt><dd>' + (liste.length ? liste.map(function (e) {
        return '<button type="button" class="btn-lien" data-grille-eleve="' + ech(e.id) + '">' + ech(e.nomCourt) + '</button> <span class="aide">(' + ech(e.classe) + ')</span>';
      }).join(", ") : "aucun") + '</dd></dl>';
    // onglet AESH affiché : la fiche y est (la grille est masquée)
    if (!ongletVisible("vue-aesh")) rendreFicheAeshComplete(a);
    $("ga-grille").innerHTML = '<div class="tableau-conteneur">' + grilleAeshHtml(a, semaineAffichee) + '</div>' + legendeGrilleAesh();
    Array.prototype.forEach.call($("aff-grille-aesh").querySelectorAll("[data-grille-eleve]"), function (bt) {
      bt.addEventListener("click", function (ev) { ev.stopPropagation(); ouvrirGrilleEleve(this.dataset.grilleEleve); });
      bt.addEventListener("keydown", function (ev) { ev.stopPropagation(); });
    });
    Array.prototype.forEach.call($("ga-grille").querySelectorAll("[data-aff]"), function (d) {
      function ouvrir() { ouvrirMenuDepuisAffectation(d.dataset.aff); }
      d.addEventListener("click", ouvrir);
      d.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target === d) ouvrir(); });
    });
  }
  // menu du créneau, ouvert depuis la grille d'une AESH : sur le premier
  // élève de l'affectation (le menu montre le groupe)
  function ouvrirMenuDepuisAffectation(affId) {
    var x = etat.affectations.filter(function (y) { return y.id === affId; })[0];
    if (!x) return;
    var e = x.eleves.map(eleveParId).filter(Boolean)[0];
    if (!e) { ui.toast("Aucun élève connu sur ce créneau."); return; }
    var cas = casesEleve(e).filter(function (c) {
      return c.jour === x.creneau.jour && c.debut === x.creneau.debut && c.fin === x.creneau.fin && (c.type === "periscolaire") === (x.modalite === "periscolaire");
    })[0];
    if (!cas) { ui.toast("Ce créneau n'est plus dans l'emploi du temps de " + e.nomCourt + " : retirez l'affectation depuis sa grille."); return; }
    ouvrirMenuCreneau(e, cas);
  }
  function brancherPucesAesh(hote) {
    Array.prototype.forEach.call(hote.querySelectorAll("[data-grille-aesh]"), function (bt) {
      bt.addEventListener("click", function (ev) { ev.stopPropagation(); ouvrirGrilleAesh(this.dataset.grilleAesh); });
      bt.addEventListener("keydown", function (ev) { ev.stopPropagation(); });
    });
  }
  $("ga-ouvrir-fiche").addEventListener("click", function () { $("af-aesh").value = aeshOuverte; afficherVue(null); remplirFiltres(); rendreAffectations(); });

  /* =============== impression des grilles AESH (A4 paysage) =============== */
  function cleSemaine(a, s) { return affsAeshSemaine(a, s).map(function (x) { return x.creneauCle + "|" + x.eleves.join(","); }).join(";"); }
  function pageImpressionAesh(a, semaine, libelleSemaine) {
    var s = resumeAesh(a);
    return '<section class="impression-edt"><header><div><h1>' + ech(nomAesh(a)) + '</h1><p>' + ech(libelleSemaine) + ' · quotité ' + s.quotite + ' · charge ' + ech(s.charge)
      + ' · établissements : ' + ech(s.etabs) + '</p></div><div class="ie-date">Édité le ' + ech(aujourdhui().split("-").reverse().join("/")) + '</div></header>'
      + grilleAeshHtml(a, semaine, { impression: true, hauteurMax: 540 }) + legendeGrilleAesh() + '</section>';
  }
  function imprimerGrillesAesh(liste) {
    if (!liste.length) { ui.toast("Aucune AESH à imprimer."); return; }
    var pages = [];
    liste.forEach(function (a) {
      if (cleSemaine(a, "A") === cleSemaine(a, "B")) pages.push(pageImpressionAesh(a, "A", "Semaines A et B"));
      else { pages.push(pageImpressionAesh(a, "A", "Semaine A")); pages.push(pageImpressionAesh(a, "B", "Semaine B")); }
    });
    $("impression").innerHTML = pages.join("");
    window.print();
  }
  $("ga-imprimer").addEventListener("click", function () { var a = aeshParId(aeshOuverte); if (a) imprimerGrillesAesh([a]); });
  $("ga-imprimer-toutes").addEventListener("click", function () { imprimerGrillesAesh(aeshTriees()); });

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

  // m : contexte d'un créneau {eleve, cas, modalite, semaine} — le menu
  // ouvert (par défaut) ou un dépôt du glisser-déposer
  function creneauMenu(m) {
    m = m || menu;
    var c = m.cas;
    return { etab: m.eleve.etablissement, jour: c.jour, debut: c.debut, fin: c.fin, semaine: m.semaine };
  }
  // affectations de l'élève sur ce créneau, toutes semaines confondues
  function affsActuelles(m) {
    m = m || menu;
    var c = m.cas;
    return affsEleveCreneau(m.eleve.id, m.eleve.etablissement, c.jour, c.debut, c.fin, null).filter(function (a) {
      return m.cas.type === "periscolaire" ? a.modalite === "periscolaire" : a.modalite !== "periscolaire";
    });
  }
  // affectation qu'une AESH a déjà sur ce créneau et que l'élève peut rejoindre :
  // mutualisé = même classe, même cours, même groupe (§2.4) ; périscolaire =
  // même temps périscolaire. Sinon l'AESH est simplement « déjà occupée ».
  function affARejoindre(aeshId, m) {
    m = m || menu;
    if (m.modalite === "individuel") return null;
    var cr = creneauMenu(m);
    return etat.affectations.filter(function (a) {
      if (!(a.aeshId === aeshId && a.modalite === m.modalite && a.creneau.etab === cr.etab && a.creneau.jour === cr.jour
        && a.creneau.debut === cr.debut && a.creneau.fin === cr.fin && a.creneau.semaine === cr.semaine
        && a.eleves.indexOf(m.eleve.id) < 0)) return false;
      if (a.modalite === "periscolaire") return a.periscolaire === m.cas.periscolaire;
      return a.eleves.every(function (id) {
        return M.coursSurCreneau(id, a.creneau, ctxCourant).some(function (co) { return M.memeCours(co, m.cas.cours); });
      });
    })[0] || null;
  }
  function candidat(aeshId, m) {
    m = m || menu;
    var rejoindre = affARejoindre(aeshId, m);
    return {
      remplaceId: rejoindre ? rejoindre.id : null,
      aff: {
        creneau: rejoindre ? rejoindre.creneau : creneauMenu(m), modalite: m.modalite,
        periscolaire: m.cas.type === "periscolaire" ? m.cas.periscolaire : undefined,
        eleves: (rejoindre ? rejoindre.eleves : []).concat([m.eleve.id])
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
        + (a.origine === "moteur" && (a.raisons || []).length ? '<div class="mc-info">Proposée par le moteur : ' + a.raisons.map(ech).join(" · ") + '</div>' : "")
        + v.map(function (x) { return '<div class="' + (x.niveau === "erreur" ? "mc-alerte" : "mc-info") + '">' + (x.niveau === "erreur" ? "⚠ " : "ℹ ") + ech(x.message) + '</div>'; }).join("")
        + '<div class="actions" style="margin-top:6px">'
        + '<button type="button" class="btn btn-vide" data-epingler="' + ech(a.id) + '">' + (a.epinglee ? "Désépingler" : "Épingler") + '</button>'
        + '<button type="button" class="btn btn-danger" data-retirer="' + ech(a.id) + '">Retirer' + (autres.length ? " cet élève" : "") + '</button></div></div>';
    }).join("") : '<p class="aide">Aucune AESH sur ce créneau.</p>';
    h += '</div>';

    // état du cours
    var etatCase = c.type === "cours" ? c.cours.etat : M.etatPeriscolaire(e, c.periscolaire, c);
    h += '<div class="mc-section"><h4>État du créneau</h4><div class="mc-boutons">'
      + ["prioritaire", "normal", "exclu"].map(function (s) {
        return '<button type="button" class="btn btn-vide" data-etat-cours="' + s + '" aria-pressed="' + (etatCase === s) + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</button>';
      }).join("") + '</div>'
      + (c.type === "periscolaire" ? '<p class="aide">Pour ce créneau seulement (' + c.jour + ' ' + c.debut + '). Un créneau prioritaire est traité avec les cours prioritaires ; « normal » est traité en dernier.</p>' : "")
      + '</div>';

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
    var dispo = [], indispo = [], vue = null;
    aeshTriees().forEach(function (a) {
      if (dejaLa[a.id]) return;
      var cand = candidat(a.id);
      var motifs = M.motifsIndisponibilite(a.id, cand.aff, ctxCourant, cand.remplaceId);
      var rejoint = cand.remplaceId ? etat.affectations.filter(function (x) { return x.id === cand.remplaceId; })[0] : null;
      var info = rejoint ? "rejoint le groupe de " + rejoint.eleves.map(function (id) { var x = eleveParId(id); return x ? x.nomCourt : id; }).join(", ") : "";
      var x = { a: a, motifs: motifs, info: info };
      if (!motifs.length) {
        // score et raisons du moteur (§5.3.5), pour trier les disponibles
        if (!vue) vue = donneesMoteur();
        var ev = M.traduireIds(P.classerAesh(vue.donnees, M.traduireIds(cand.aff, vue.versCle), M.traduireIds(cand.remplaceId, vue.versCle), vue.versCle[a.id])[0], vue.versId);
        if (ev && ev.possible) { x.score = ev.score; x.raisons = ev.raisons; }
      }
      (motifs.length ? indispo : dispo).push(x);
    });
    dispo.sort(function (p, q) { return ((q.score == null ? -1e9 : q.score) - (p.score == null ? -1e9 : p.score)) || nomAesh(p.a).localeCompare(nomAesh(q.a), "fr"); });
    function ligne(x, dispoAesh) {
      var ch = M.chargeAesh(x.a, ctxCourant);
      return '<li class="' + (dispoAesh ? "" : "indispo") + '"><span><span class="puce-aesh" style="background:' + couleurAesh(x.a.id) + (dispoAesh ? "" : ";opacity:.5") + '">' + ech(initialesAesh(x.a)) + '</span> '
        + ech(nomAesh(x.a)) + ' <span class="aide">(' + heures(ch.moy) + ' / ' + heures(ch.quotite) + ')</span>'
        + (x.score != null ? ' <span class="mc-score" title="Score du moteur">' + Math.round(x.score) + '</span>' : "")
        + (x.info ? '<span class="mc-motif">' + ech(x.info) + '</span>' : "")
        + (x.raisons && x.raisons.length ? '<span class="mc-motif">' + x.raisons.map(ech).join(" · ") + '</span>' : "")
        + (x.motifs.length ? '<span class="mc-motif">' + x.motifs.map(function (m) { return ech(m.message); }).join(" · ") + '</span>' : "") + '</span>'
        + '<button type="button" class="btn ' + (dispoAesh ? "btn-plein" : "btn-danger") + '" data-affecter="' + ech(x.a.id) + '">' + (dispoAesh ? "Affecter" : "Affecter quand même") + '</button></li>';
    }
    h += '<div class="mc-section"><h4>' + (actuelles.length ? "Ajouter ou changer d'AESH" : "Affecter une AESH") + ' — ' + LIB_MODALITE[menu.modalite].toLowerCase() + '</h4>';
    if (etatCase === "exclu") h += '<p class="note alerte">Créneau exclu : une affectation ici sera signalée dans les alertes.</p>';
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

  /* =============== versions : validation (§6) =============== */
  function dateFr(iso) { return iso ? iso.slice(0, 10).split("-").reverse().join("/") : ""; }
  function nbConflits() {
    return M.alertes(ctxCourant, aujourdhui()).filter(function (a) { return a.type === "conflit" && a.niveau === "erreur"; }).length;
  }
  function ouvrirValidation() {
    if (!etat.affectations.length) { ui.toast("Le brouillon est vide : rien à valider."); return; }
    var s = M.synthese(ctxCourant), n = nbConflits();
    $("vv-resume").innerHTML = '<p class="aide">Version n° ' + (numeroSuivant()) + ' : ' + pluriel(etat.affectations.length, "affectation") + ' · individuel '
      + heures(s.indCouvert) + ' / ' + heures(s.indDemande) + ' · mutualisé ' + heures(s.mutCouvert) + ' / ' + heures(s.mutDemande) + '.</p>'
      + (n ? '<p class="note alerte">' + pluriel(n, "conflit reste", "conflits restent") + ' dans le brouillon (panneau d\'alertes). La validation reste possible.</p>' : "");
    $("vv-date").value = aujourdhui();
    $("vv-commentaire").value = "";
    $("voile-valider").hidden = false;
    $("vv-date").focus();
  }
  function numeroSuivant() { return etat.versions.reduce(function (m, v) { return Math.max(m, v.numero || 0); }, 0) + 1; }
  $("vv-annuler").addEventListener("click", function () { $("voile-valider").hidden = true; });
  $("vv-confirmer").addEventListener("click", function () {
    var date = $("vv-date").value, commentaire = $("vv-commentaire").value.trim(), n = nbConflits();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { ui.toast("Indiquez la date d'effet."); return; }
    $("voile-valider").hidden = true;
    if (n) ui.confirmationForte(pluriel(n, "conflit reste", "conflits restent") + " dans le brouillon. Valider la version quand même ?", "Valider quand même", function () { valider(date, commentaire, n); });
    else valider(date, commentaire, 0);
  });
  // la version garde les libellés (noms courts, classes, AESH) pour rester
  // lisible si un élève ou une AESH est supprimé ensuite ; non annulable
  function valider(date, commentaire, conflits) {
    var numero = numeroSuivant(), s = M.synthese(ctxCourant);
    var libelles = { eleves: {}, aesh: {} };
    etat.eleves.forEach(function (e) { libelles.eleves[e.id] = { nomCourt: e.nomCourt, classe: e.classe, etablissement: nomEtablissement(e.etablissement) }; });
    etat.aesh.forEach(function (a) { libelles.aesh[a.id] = nomAesh(a); });
    var v = { numero: numero, annee: anneeCourante(), dateEffet: date, commentaire: commentaire, valideeLe: new Date().toISOString(),
      compteurs: { affectations: etat.affectations.length, eleves: etat.eleves.length, aesh: etat.aesh.length, conflits: conflits,
        indCouvert: s.indCouvert, indDemande: s.indDemande, mutCouvert: s.mutCouvert, mutDemande: s.mutDemande, elevesSous: s.elevesSous },
      libelles: libelles };
    // nombre d'ordres de départage de la proposition d'origine (§16), pour la rejouer
    if (etat.proposition) v.proposition = { nbOrdres: etat.proposition.nbOrdres, ms: etat.proposition.ms, budget: etat.proposition.budget, date: etat.proposition.date };
    var copies = etat.affectations.map(function (a) {
      var c = JSON.parse(JSON.stringify(a));
      c.id = "v" + numero + "|" + a.id; c.version = numero;
      return c;
    });
    PialDB.appliquer([{ magasin: "versions", enregistrer: [v] }, { magasin: "affectations", enregistrer: copies }]).then(recharger).then(function () {
      rendreAffectations();
      ui.toast("Version n° " + numero + " validée, date d'effet le " + dateFr(date) + ".");
    });
  }

  /* =============== versions : historique, comparatif, restauration (§6) =============== */
  function versionParNumero(n) { return etat.versions.filter(function (v) { return v.numero === n; })[0]; }
  function affsDeVersion(cle) {
    if (cle === "brouillon") return etat.affectations;
    var n = +cle;
    return etat.affectationsVersions.filter(function (a) { return a.version === n; });
  }
  // libellés : ceux des versions comparées, puis les données actuelles
  function libellesPour(cles) {
    var l = { eleves: {}, aesh: {} };
    etat.eleves.forEach(function (e) { l.eleves[e.id] = { nomCourt: e.nomCourt, classe: e.classe, etablissement: nomEtablissement(e.etablissement) }; });
    etat.aesh.forEach(function (a) { l.aesh[a.id] = nomAesh(a); });
    cles.forEach(function (c) {
      var v = c !== "brouillon" && versionParNumero(+c);
      if (!v || !v.libelles) return;
      ["eleves", "aesh"].forEach(function (k) { Object.keys(v.libelles[k] || {}).forEach(function (id) { if (!l[k][id]) l[k][id] = v.libelles[k][id]; }); });
    });
    return l;
  }
  function ouvrirHistorique() { rendreHistorique(); $("vh-detail").innerHTML = ""; $("voile-versions").hidden = false; $("vh-fermer").focus(); }
  function fermerHistorique() { $("voile-versions").hidden = true; }
  $("vh-fermer").addEventListener("click", fermerHistorique);
  $("voile-versions").addEventListener("click", function (ev) { if (ev.target === this) fermerHistorique(); });
  $("voile-valider").addEventListener("click", function (ev) { if (ev.target === this) this.hidden = true; });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (!$("voile-versions").hidden) fermerHistorique();
    if (!$("voile-valider").hidden) $("voile-valider").hidden = true;
  });
  function rendreHistorique() {
    var vs = etat.versions.slice().sort(function (a, b) { return b.numero - a.numero; });
    if (!vs.length) { $("vh-corps").innerHTML = '<p class="aide">Aucune version validée. « Valider la version » fige le brouillon actuel, avec une date d\'effet.</p>'; return; }
    var options = '<option value="brouillon">Brouillon actuel</option>' + vs.map(function (v) { return '<option value="' + v.numero + '">Version n° ' + v.numero + ' (' + dateFr(v.dateEffet) + ')</option>'; }).join("");
    $("vh-corps").innerHTML = '<div class="tableau-conteneur"><table class="tableau"><thead><tr><th>N°</th><th>Date d\'effet</th><th>Commentaire</th><th>Affectations</th><th></th></tr></thead><tbody>'
      + vs.map(function (v) {
        var c = v.compteurs || {};
        return '<tr><td>' + v.numero + '</td><td>' + dateFr(v.dateEffet) + '<br><span class="aide">validée le ' + dateFr(v.valideeLe) + ' · ' + ech(v.annee) + '</span></td>'
          + '<td>' + ech(v.commentaire || "—") + '</td><td>' + (c.affectations || 0) + (c.conflits ? '<br><span class="aide">' + pluriel(c.conflits, "conflit") + '</span>' : "") + '</td>'
          + '<td><div class="mc-boutons"><button type="button" class="btn btn-vide" data-vh-voir="' + v.numero + '">Consulter</button>'
          + '<button type="button" class="btn btn-vide" data-vh-comparer="' + v.numero + '">Comparer au brouillon</button>'
          + (v.annee === anneeCourante() ? '<button type="button" class="btn btn-vide" data-vh-restaurer="' + v.numero + '">Restaurer</button>' : "") + '</div></td></tr>';
      }).join("") + '</tbody></table></div>'
      + '<div class="ligne-filtres" style="margin-top:12px"><div class="champ"><label for="vh-a">Comparer</label><select id="vh-a">' + options + '</select></div>'
      + '<div class="champ"><label for="vh-b">avec</label><select id="vh-b">' + options + '</select></div>'
      + '<div class="champ" style="flex:none"><button type="button" class="btn btn-plein" id="vh-comparer">Comparer</button></div></div>';
    $("vh-a").value = String(vs[0].numero);
    $("vh-b").value = "brouillon";
    function chaque(sel, fn) { Array.prototype.forEach.call($("vh-corps").querySelectorAll(sel), function (b) { b.addEventListener("click", fn); }); }
    chaque("[data-vh-voir]", function () { consulterVersion(+this.dataset.vhVoir); });
    chaque("[data-vh-comparer]", function () { comparer(this.dataset.vhComparer, "brouillon"); });
    chaque("[data-vh-restaurer]", function () { restaurerVersion(+this.dataset.vhRestaurer); });
    $("vh-comparer").addEventListener("click", function () { comparer($("vh-a").value, $("vh-b").value); });
  }
  function texteCreneau(l) {
    return l.jour + " " + l.debut + "–" + l.fin + (l.periscolaire ? " (" + LIB_PERI[l.periscolaire].toLowerCase() + ")" : "")
      + (l.semaines.length < 2 ? " · semaine " + l.semaines[0] : "");
  }
  function nomEleveLib(lib, id) { var e = lib.eleves[id]; return e ? e.nomCourt + " (" + e.classe + ")" : id; }
  function consulterVersion(numero) {
    var v = versionParNumero(numero), lib = libellesPour([String(numero)]), affs = affsDeVersion(String(numero));
    var lignes = [];
    affs.forEach(function (a) {
      a.eleves.forEach(function (id) { lignes.push({ eleve: nomEleveLib(lib, id), a: a }); });
    });
    lignes.sort(function (p, q) {
      return p.eleve.localeCompare(q.eleve, "fr") || (M.JOURS.indexOf(p.a.creneau.jour) - M.JOURS.indexOf(q.a.creneau.jour)) || p.a.creneau.debut.localeCompare(q.a.creneau.debut);
    });
    $("vh-detail").innerHTML = '<div class="mc-section"><h4>Version n° ' + numero + ' — date d\'effet ' + dateFr(v.dateEffet) + ' (lecture seule)</h4>'
      + (v.commentaire ? '<p class="aide">' + ech(v.commentaire) + '</p>' : "")
      + '<div class="tableau-conteneur"><table class="tableau"><thead><tr><th>Élève</th><th>Créneau</th><th>AESH</th><th>Modalité</th></tr></thead><tbody>'
      + lignes.map(function (l) {
        var c = l.a.creneau;
        return '<tr><td>' + ech(l.eleve) + '</td><td>' + ech(c.jour + " " + c.debut + "–" + c.fin + (c.semaine !== "toutes" ? " · semaine " + c.semaine : "")) + '</td><td>'
          + ech(lib.aesh[l.a.aeshId] || l.a.aeshId) + '</td><td>' + LIB_MODALITE[l.a.modalite] + (l.a.epinglee ? " 🔒" : "") + '</td></tr>';
      }).join("") + '</tbody></table></div></div>';
    $("vh-detail").scrollIntoView({ block: "start" });
  }
  function comparer(cleA, cleB) {
    if (cleA === cleB) { ui.toast("Choisissez deux versions différentes."); return; }
    var lib = libellesPour([cleA, cleB]);
    var c = M.comparerAffectations(affsDeVersion(cleA), affsDeVersion(cleB), etat.etablissements);
    function aesh(x) { return x ? x.aeshIds.map(function (id) { return lib.aesh[id] || id; }).join(", ") + " (" + LIB_MODALITE[x.modalite].toLowerCase() + ")" : ""; }
    var TYPE = { ajout: "Ajout", retrait: "Retrait", changement: "Changement" };
    $("vh-detail").innerHTML = '<div class="mc-section"><h4>' + (cleA === "brouillon" ? "Du brouillon" : "De la version n° " + cleA) + (cleB === "brouillon" ? " au brouillon" : " à la version n° " + cleB) + '</h4>'
      + '<p class="aide">' + [pluriel(c.resume.ajout, "créneau ajouté", "créneaux ajoutés"), pluriel(c.resume.retrait, "créneau retiré", "créneaux retirés"),
        pluriel(c.resume.changement, "créneau changé", "créneaux changés")].join(" · ") + ' (par élève, créneau et semaine).</p>'
      + (c.lignes.length ? '<div class="tableau-conteneur"><table class="tableau"><thead><tr><th>Élève</th><th>Créneau</th><th>Changement</th></tr></thead><tbody>'
        + c.lignes.map(function (l) {
          var t = l.type === "ajout" ? '<span class="cmp-ajout">+ ' + ech(aesh(l.apres)) + '</span>'
            : l.type === "retrait" ? '<span class="cmp-retrait">− ' + ech(aesh(l.avant)) + '</span>'
            : ech(aesh(l.avant)) + ' → ' + ech(aesh(l.apres));
          return '<tr><td>' + ech(nomEleveLib(lib, l.eleveId)) + '</td><td>' + ech(texteCreneau(l)) + '</td><td>' + TYPE[l.type] + ' : ' + t + '</td></tr>';
        }).join("") + '</tbody></table></div>' : '<p class="aide">Aucune différence.</p>')
      + '</div>';
    $("vh-detail").scrollIntoView({ block: "start" });
  }
  // la version redevient le brouillon (annulable) ; les affectations dont
  // l'AESH ou tous les élèves ont disparu depuis sont écartées
  function restaurerVersion(numero) {
    var affs = affsDeVersion(String(numero)), eleves = {}, aeshs = {}, ecartees = 0;
    etat.eleves.forEach(function (e) { eleves[e.id] = true; });
    etat.aesh.forEach(function (a) { aeshs[a.id] = true; });
    var restaurees = [];
    affs.forEach(function (a) {
      var c = JSON.parse(JSON.stringify(a));
      c.id = a.id.replace(/^v\d+\|/, ""); c.version = 0;
      c.eleves = c.eleves.filter(function (id) { return eleves[id]; });
      if (!aeshs[c.aeshId] || !c.eleves.length) { ecartees++; return; }
      restaurees.push(c);
    });
    ui.confirmationForte("Restaurer la version n° " + numero + " comme brouillon ? Le brouillon actuel (" + pluriel(etat.affectations.length, "affectation")
      + ") sera remplacé ; « Annuler » le rétablit." + (ecartees ? " " + pluriel(ecartees, "affectation sera écartée", "affectations seront écartées") + " : élève ou AESH supprimé depuis." : ""),
      "Restaurer", function () {
        fermerHistorique();
        dernierRapport = null;
        enregistrerPuisRendre([{ magasin: "affectations", supprimer: etat.affectations.map(function (a) { return a.id; }), enregistrer: restaurees }],
          "Version n° " + numero + " restaurée comme brouillon.", "la restauration de la version n° " + numero);
      });
  }

  /* =============== annulation (§6) =============== */
  // pile en mémoire des 20 dernières actions : opérations inverses calculées
  // avant d'écrire. Perdue au rechargement ; vidée par un import ou une
  // restauration de sauvegarde, qui changent les données sous-jacentes.
  var pileAnnulation = [], MAX_ANNULATION = 20;
  function viderAnnulation() {
    pileAnnulation = [];
    // les données ont changé sous les fiches : un brouillon ne s'y appliquerait plus
    [autoEleve, autoAesh].forEach(function (f) {
      if (f.minuteur) clearTimeout(f.minuteur);
      f.minuteur = null; f.id = null; f.base = null; f.brouillons = {}; f.erreurs = {}; f.heures = {};
    });
  }
  function annuler() {
    var action = pileAnnulation.pop();
    if (!action) { ui.toast("Rien à annuler."); return; }
    if (action.libelle === "la proposition") dernierRapport = null;   // le rapport ne décrit plus le brouillon
    enregistrerPuisRendre(action.ops, "Annulé : " + action.libelle + ".");
  }
  document.addEventListener("keydown", function (ev) {
    if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || (ev.key !== "z" && ev.key !== "Z")) return;
    if (!["vue-affectations", "vue-eleves", "vue-aesh"].some(ongletVisible) || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) return;
    ev.preventDefault();
    annuler();
  });

  /* =============== modifications (toute saisie manuelle épingle, §5.4) =============== */
  // libelleAnnulation : l'action est annulable (§6), sous ce nom.
  // cleFusion : si l'action au sommet de la pile porte la même clé (frappe
  // continue dans un même champ de fiche), elle couvre déjà celle-ci : on
  // garde ses opérations inverses, qui ramènent à l'état d'avant la frappe.
  function enregistrerPuisRendre(ops, message, libelleAnnulation, cleFusion) {
    var haut = pileAnnulation[pileAnnulation.length - 1];
    if (libelleAnnulation && !(cleFusion && haut && haut.fusion === cleFusion)) {
      pileAnnulation.push({ libelle: libelleAnnulation, fusion: cleFusion || "", ops: M.operationsInverses(ops, { affectations: etat.affectations, cours: etat.cours, eleves: etat.eleves, aesh: etat.aesh, parametres: etat.classesParam ? [etat.classesParam] : [] }) });
      if (pileAnnulation.length > MAX_ANNULATION) pileAnnulation.shift();
    }
    return PialDB.appliquer(ops).then(recharger).then(function () {
      rendreAffectations();
      notifierRendu();
      if (menu) {
        // l'élève et le cours ont pu être rechargés : on rafraîchit les références
        menu.eleve = eleveParId(menu.eleve.id) || menu.eleve;
        if (menu.cas.type === "cours") menu.cas.cours = etat.cours.filter(function (c) { return c.id === menu.cas.cours.id; })[0] || menu.cas.cours;
        rendreMenu();
      }
      if (message) ui.toast(message);
    });
  }
  // sansIds : affectations qui vont disparaître dans la même action
  function avecAlertes(aff, sansIds) {
    var ctx = M.contexte({ etablissements: etat.etablissements, eleves: etat.eleves, aesh: etat.aesh, cours: etat.cours,
      affectations: etat.affectations.filter(function (a) { return a.id !== aff.id && (sansIds || []).indexOf(a.id) < 0; }).concat([aff]), reglages: etat.reglages });
    aff.alertes = M.verifierAffectation(aff, ctx).map(function (v) { return v.message; });
    return aff;
  }
  function affecter(aeshId) {
    var r = operationsAffecter(aeshId, menu), a = aeshParId(aeshId);
    enregistrerPuisRendre(r.ops, nomAesh(a) + " affectée à " + menu.eleve.nomCourt + (r.aff.alertes.length ? " — attention : contrainte non respectée." : "."),
      "l'affectation de " + nomAesh(a) + " à " + menu.eleve.nomCourt);
  }
  // opérations pour affecter une AESH sur le créneau m (épinglée, alertes
  // calculées sans les affectations sansIds qui disparaissent en même temps)
  function operationsAffecter(aeshId, m, sansIds) {
    var cand = candidat(aeshId, m), ops = [];
    var aff;
    if (cand.remplaceId) {
      aff = JSON.parse(JSON.stringify(etat.affectations.filter(function (a) { return a.id === cand.remplaceId; })[0]));
      aff.eleves = cand.aff.eleves;
    } else {
      aff = { id: nouvelId(), annee: anneeCourante(), version: 0, aeshId: aeshId, creneau: cand.aff.creneau, modalite: m.modalite,
        eleves: cand.aff.eleves, raisons: [] };
      if (cand.aff.periscolaire) aff.periscolaire = cand.aff.periscolaire;
    }
    aff.creneauCle = M.creneauCle(aff.creneau);
    aff.epinglee = true;
    aff.origine = "manuel";
    // en individuel, la nouvelle AESH remplace l'affectation individuelle en place
    // (sur les semaines concernées)
    var semaines = M.semainesDe(aff.creneau.semaine, etablissementParId(aff.creneau.etab));
    var remplacees = m.modalite === "individuel" ? affsActuelles(m).filter(function (a) {
      return a.modalite === "individuel" && (sansIds || []).indexOf(a.id) < 0
        && M.semainesDe(a.creneau.semaine, etablissementParId(a.creneau.etab)).some(function (s) { return semaines.indexOf(s) > -1; });
    }) : [];
    var sans = (sansIds || []).concat(remplacees.map(function (a) { return a.id; }));
    ops.push({ magasin: "affectations", supprimer: remplacees.map(function (a) { return a.id; }), enregistrer: [avecAlertes(aff, sans)] });
    return { ops: ops, aff: aff };
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
    enregistrerPuisRendre([op], "Affectation retirée.", "le retrait de " + nomAesh(aeshParId(aff.aeshId)) + " (" + menu.eleve.nomCourt + ")");
  }
  function basculerEpingle(affId) {
    var aff = JSON.parse(JSON.stringify(etat.affectations.filter(function (a) { return a.id === affId; })[0]));
    aff.epinglee = !aff.epinglee;
    enregistrerPuisRendre([{ magasin: "affectations", enregistrer: [aff] }], aff.epinglee ? "Affectation épinglée." : "Affectation désépinglée.",
      aff.epinglee ? "l'épinglage" : "le désépinglage");
  }
  function changerEtatCours(nouvelEtat) {
    if (menu.cas.type === "periscolaire") { changerEtatPeriscolaire(nouvelEtat); return; }
    var co = JSON.parse(JSON.stringify(menu.cas.cours));
    if (co.etat === nouvelEtat) return;
    co.etat = nouvelEtat;
    enregistrerPuisRendre([{ magasin: "cours", enregistrer: [co] }], "Créneau marqué « " + nouvelEtat + " ».", "le changement d'état du créneau");
  }

  // état posé sur ce créneau précis (clé type|jour|debut, spec §5.2)
  function changerEtatPeriscolaire(nouvelEtat) {
    var c = menu.cas, e = JSON.parse(JSON.stringify(menu.eleve));
    if (M.etatPeriscolaire(e, c.periscolaire, c) === nouvelEtat) return;
    e.etatsPeriscolaires = e.etatsPeriscolaires || {};
    e.etatsPeriscolaires[M.cleEtatPeriscolaire(c.periscolaire, c)] = nouvelEtat;
    enregistrerPuisRendre([{ magasin: "eleves", enregistrer: [e] }], "Créneau marqué « " + nouvelEtat + " ».", "le changement d'état du créneau");
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
        } else if (al.aeshId && aeshParId(al.aeshId)) {
          ouvrirGrilleAesh(al.aeshId);
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
    if (eleveOuvert) rendreGrilleEleve(); else if (aeshOuverte) rendreGrilleAesh(); else rendreEnsemble();
  }
  function ouvrirOnglet() { remplirFiltres(); rendreAffectations(); }
  // onglets Élèves et AESH (pial/profils.js) : redessinés après chaque écriture
  var abonnesRendu = [];
  function notifierRendu() { abonnesRendu.forEach(function (fn) { fn(); }); }

  /* =============== initialisation =============== */
  function initialiser(outils) {
    ui = outils;
    rendreEtablissements();
    rendreRegles();
    PialAffectations.surChangement = function () {
      if (!$("vue-affectations").classList.contains("masque")) ouvrirOnglet();
      notifierRendu();
    };
  }
  /* interface pour les onglets Élèves et AESH (pial/profils.js) : mêmes
     données, même fiche, même pile d'annulation */
  var interne = {
    etat: etat, ech: ech, txt: txt, heures: heures, pluriel: pluriel, sep: sep,
    anneeCourante: anneeCourante, aujourdhui: aujourdhui,
    nomEtablissement: nomEtablissement, etablissementParId: etablissementParId, eleveParId: eleveParId, aeshParId: aeshParId,
    nomAesh: nomAesh, initialesAesh: initialesAesh, couleurAesh: couleurAesh, aeshTriees: aeshTriees,
    jauge: jauge, jaugesEleve: jaugesEleve, titreAB: titreAB, LIB_ETAT_ELEVE: LIB_ETAT_ELEVE, LIB_ETAT_AESH: LIB_ETAT_AESH,
    contexte: function () { if (!ctxCourant) recalculer(); return ctxCourant; },
    rendreFicheEleve: rendreFicheEleve, rendreFicheAesh: rendreFicheAeshComplete, texteIndispo: texteIndispo,
    enregistrerPuisRendre: enregistrerPuisRendre, annuler: annuler,
    libelleAnnulation: function () { return pileAnnulation.length ? pileAnnulation[pileAnnulation.length - 1].libelle : ""; },
    surRendu: function (fn) { abonnesRendu.push(fn); },
    ui: function () { return ui; },
    // ouvre la grille dans l'onglet Affectations
    voirGrilleEleve: function (id) { ui.vue("vue-affectations"); remplirFiltres(); ouvrirGrilleEleve(id); },
    voirGrilleAesh: function (id) { ui.vue("vue-affectations"); remplirFiltres(); ouvrirGrilleAesh(id); }
  };
  function rendreReglages() { rendreEtablissements(); rendreRegles(); }

  return {
    etat: etat, recharger: recharger, compteurs: compteurs, contexte: contexte,
    anneeCourante: anneeCourante, aujourdhui: aujourdhui, initialiser: initialiser,
    rendreReglages: rendreReglages, nomEtablissement: nomEtablissement, heures: heures, ouvrirOnglet: ouvrirOnglet, viderAnnulation: viderAnnulation,
    surChangement: null, interne: interne
  };
})();
