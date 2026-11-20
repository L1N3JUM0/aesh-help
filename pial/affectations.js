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
      etat.affectationsVersions = parNom.affectations.filter(function (a) { return a.version > 0; });
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
    var o = type === "eleves" ? M.fusionEleve(existant, nouveau, garderAppli) : {};
    if (type !== "eleves") Object.keys(nouveau).forEach(function (k) { o[k] = nouveau[k]; });
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
      gererPeriscolaire: !!etat.reglages.gererPeriscolaire });
    var cleId = "id";
    imp.planMaj = I.planFusion(existantsDuType(imp.type), imp.apercu.valides, cleId, "maj");
    imp.planRemplacer = I.planFusion(existantsDuType(imp.type), imp.apercu.valides, cleId, "remplacer");
    // élèves : valeurs modifiées dans l'application que le fichier écraserait
    imp.conflits = [];
    imp.garderAppli = true;
    if (imp.type === "eleves") {
      var parId = {};
      etat.eleves.forEach(function (e) { parId[e.id] = e; });
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
      var LIB_CHAMP = { heuresInd: "heures individuelles", heuresMut: "heures mutualisées", debutNotif: "début de notification", finNotif: "fin de notification", besoins: "besoins" };
      var valeur = function (k, v) {
        if (k === "besoins") return (v || []).length ? v.join(", ") : "aucun";
        if (k === "heuresInd" || k === "heuresMut") return heures(v || 0);
        return v ? v.split("-").reverse().join("/") : "—";
      };
      h += '<div class="note alerte"><p style="margin:0 0 6px"><strong>' + pluriel(imp.conflits.length, "élève a", "élèves ont")
        + ' des valeurs modifiées dans l\'application que ce fichier remplacerait :</strong></p><ul class="liste-motifs">'
        + imp.conflits.map(function (cf) {
          return '<li>' + ech(cf.existant.nomCourt) + ' (' + ech(cf.existant.classe) + ') : ' + cf.champs.map(function (k) {
            return LIB_CHAMP[k] + ' ' + ech(valeur(k, cf.existant[k])) + ' dans l\'application, ' + ech(valeur(k, cf.nouveau[k])) + ' dans le fichier';
          }).join(" ; ") + '</li>';
        }).join("") + '</ul>'
        + '<div class="choix-conflits" role="radiogroup" aria-label="Valeurs à garder">'
        + '<label class="case"><input type="radio" name="imp-conflits" value="appli" checked> Garder les valeurs de l\'application</label>'
        + '<label class="case"><input type="radio" name="imp-conflits" value="fichier"> Prendre celles du fichier</label></div>'
        + '<p class="aide" style="margin:6px 0 0">Le choix s\'applique à tous ces élèves. Les autres colonnes sont mises à jour dans les deux cas ; le commentaire et les états par matière de la fiche ne sont jamais touchés par l\'import.</p></div>';
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
    $("reg-ordres").value = r.nbOrdres;
  }
  $("reg-enregistrer-regles").addEventListener("click", function () {
    var pause = parseInt($("reg-pause").value, 10);
    if (isNaN(pause) || pause < 0 || pause > 120) { ui.toast("Durée de pause invalide (0 à 120 minutes)."); return; }
    var ecart = Math.round(parseFloat(String($("reg-ecart").value).replace(",", ".")) * 60);
    if (isNaN(ecart) || ecart < 30 || ecart > 480) { ui.toast("Écart maximal invalide (de 0,5 à 8 heures)."); return; }
    var ordres = parseInt($("reg-ordres").value, 10);
    if (isNaN(ordres) || ordres < 1 || ordres > 50) { ui.toast("Nombre d'ordres invalide (de 1 à 50)."); return; }
    var valeur = {};
    Object.keys(etat.reglages).forEach(function (k) { valeur[k] = etat.reglages[k]; });
    valeur.dureeReelle = $("reg-duree-reelle").checked;
    valeur.respecterIndispos = $("reg-indispos").checked;
    valeur.gererPeriscolaire = $("reg-periscolaire").checked;
    valeur.pauseRepasMin = pause;
    valeur.ecartMax = ecart;
    valeur.nbOrdres = ordres;
    PialDB.appliquer([{ magasin: "parametres", enregistrer: [{ cle: "reglages", valeur: valeur }] }]).then(recharger).then(function () {
      ui.toast("Règles de calcul enregistrées.");
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
  function donneesMoteur(affectations) {
    return { annee: anneeCourante(), etablissements: etat.etablissements, eleves: etat.eleves, aesh: etat.aesh, cours: etat.cours,
      affectations: affectations || etat.affectations, reglages: etat.reglages };
  }
  // relance partielle : les épinglées sont gardées, les autres remplacées.
  // Le moteur essaie plusieurs ordres de départage (spec §16), un par tour,
  // en rendant la main au navigateur entre deux ordres (thread principal,
  // pas de Web Worker sous file://) ; une progression s'affiche si le
  // calcul doit dépasser 1,5 s.
  function maintenant() { return (window.performance || Date).now(); }
  function proposer() {
    var bouton = $("aff-proposer");
    bouton.disabled = true;
    bouton.textContent = "Calcul…";
    var n = M.contexte({ reglages: etat.reglages }).reglages.nbOrdres;
    var calc = P.plusieursOrdres(donneesMoteur(), n), t0 = maintenant(), visible = false;
    function etape() {
      var debut = maintenant();
      do { calc.suivant(); } while (!calc.fini() && maintenant() - debut < 50);
      var ecoule = maintenant() - t0;
      if (!visible && !calc.fini() && ecoule / calc.fait() * calc.total > 1500) { visible = true; $("aff-progression").hidden = false; }
      if (visible) {
        $("aff-progression-texte").textContent = "Recherche du meilleur résultat : " + calc.fait() + " ordre" + (calc.fait() > 1 ? "s" : "") + " essayé" + (calc.fait() > 1 ? "s" : "") + " sur " + calc.total;
        $("aff-progression-barre").value = calc.fait() / calc.total;
      }
      if (!calc.fini()) { setTimeout(etape, 0); return; }
      $("aff-progression").hidden = true;
      var res = calc.resultat(), ms = maintenant() - t0;
      var remplacees = etat.affectations.filter(function (a) { return !a.epinglee; }).map(function (a) { return a.id; });
      var nouvelles = res.affectations.filter(function (a) { return !a.epinglee; });
      dernierRapport = { rapport: res.rapport, ms: ms, nbRemplacees: remplacees.length };
      enregistrerPuisRendre([{ magasin: "affectations", supprimer: remplacees, enregistrer: nouvelles }],
        pluriel(nouvelles.length, "affectation proposée", "affectations proposées") + ".", "la proposition").then(afficherRapport);
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
    if (r.ordres && r.ordres.nb > 1) {
      var q0 = r.ordres.essais[0].qualite, q = r.qualite;
      var resume = function (x) { return heures(x.couvert) + " couvertes, " + pluriel(x.elevesPlusDe3, "élève", "élèves") + " à plus de " + P.POIDS.maxAeshParEleve + " AESH, " + pluriel(x.trous, "trou") + ", " + pluriel(x.courtes, "journée courte", "journées courtes"); };
      h += '<p class="aide">Meilleur résultat parmi ' + r.ordres.nb + ' ordres de départage des AESH (ordre n° ' + (r.ordres.retenu + 1) + ' retenu) : '
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
      + ((a.formations || []).length ? '<dt>Formations</dt><dd>' + ech(a.formations.join(", ")) + '</dd>' : "")
      + '</dl>'
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
  function puceAff(aff) {
    var a = aeshParId(aff.aeshId), conflit = erreursDe(aff).length > 0;
    var titre = nomAesh(a) + (aff.modalite === "mutualise" ? " (mutualisé, " + aff.eleves.length + " élève(s))" : aff.modalite === "periscolaire" ? " (périscolaire)" : " (individuel)")
      + (aff.creneau.semaine !== "toutes" ? " — semaine " + aff.creneau.semaine : "")
      + (conflit ? " — " + erreursDe(aff).map(function (v) { return v.message; }).join(" ") : "")
      + (a ? " — cliquer pour ouvrir sa grille" : "");
    return '<button type="button" class="puce-aesh' + (conflit ? " conflit" : "") + '" style="background:' + couleurAesh(aff.aeshId) + '" title="' + ech(titre) + '"'
      + (a ? ' data-grille-aesh="' + ech(a.id) + '"' : " disabled") + '>'
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
    rendreFicheEleve(e);
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
      d.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target === this) ouvrirMenuCreneau(e, index[this.dataset.case]); });
    });
    brancherPucesAesh($("ge-table"));
  }

  /* =============== fiche de l'élève (spec §16) =============== */
  // Notification, besoins, état par matière et commentaire, modifiables
  // avant de lancer « Proposer ». Le commentaire reste dans l'espace PIAL :
  // il n'est jamais exporté vers les AESH.
  var ficheEleveOuverte = false;
  var LIB_ETATS = { prioritaire: "Prioritaire", normal: "Normal", exclu: "Exclu" };
  function nombreSaisi(v) { var x = parseFloat(String(v).replace(",", ".")); return isNaN(x) ? NaN : Math.round(x * 100) / 100; }
  function rendreFicheEleve(e) {
    var hote = $("ge-fiche"), m = e.modifiesAppli || {};
    function marque(k) { return m[k] ? ' <span class="fe-modifie" title="Modifié dans l\'application : protégé au prochain import (vous choisirez quelle valeur garder)">modifié</span>' : ""; }
    var matieres = M.matieresEleve(e, etat.cours);
    var h = '<details class="fiche-eleve" id="fe-details"' + (ficheEleveOuverte ? " open" : "") + '><summary>Fiche de l\'élève'
      + '<span class="aide"> — notification, besoins, état par matière, commentaire' + (e.commentaire ? " · commentaire saisi" : "") + '</span></summary>'
      + '<div class="fe-corps"><div class="fe-colonne"><h4>Notification</h4><div class="fe-champs">'
      + '<label>Heures individuelles' + marque("heuresInd") + '<input type="text" inputmode="decimal" id="fe-ind" value="' + ech(String(e.heuresInd || 0).replace(".", ",")) + '"></label>'
      + '<label>Heures mutualisées' + marque("heuresMut") + '<input type="text" inputmode="decimal" id="fe-mut" value="' + ech(String(e.heuresMut || 0).replace(".", ",")) + '"></label>'
      + '<label>Début' + marque("debutNotif") + '<input type="date" id="fe-debut" value="' + ech(e.debutNotif || "") + '"></label>'
      + '<label>Fin' + marque("finNotif") + '<input type="date" id="fe-fin" value="' + ech(e.finNotif || "") + '"></label></div>'
      + '<h4>Besoins' + marque("besoins") + '</h4><div class="fe-besoins">'
      + I.ACCOMP.map(function (b, i) {
        return '<label class="pastille-case"><input type="checkbox" data-besoin="' + i + '"' + ((e.besoins || []).indexOf(b) > -1 ? " checked" : "") + '> ' + ech(b) + '</label>';
      }).join("") + '</div>'
      + '<h4>Commentaire</h4><textarea id="fe-commentaire" rows="3" maxlength="1000" placeholder="Organisation, informations pratiques utiles à l\'affectation…">' + ech(e.commentaire || "") + '</textarea>'
      + '<p class="aide fe-rappel">Pas d\'information médicale (diagnostic, traitement, pathologie) : décrivez des besoins fonctionnels. Ce commentaire reste dans l\'espace PIAL ; il n\'est jamais transmis aux AESH.</p>'
      + '<div class="actions"><button type="button" class="btn btn-plein" id="fe-enregistrer">Enregistrer la fiche</button></div>'
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
    hote.innerHTML = h;
    $("fe-details").addEventListener("toggle", function () { ficheEleveOuverte = this.open; });
    $("fe-enregistrer").addEventListener("click", function () { enregistrerFicheEleve(e); });
    Array.prototype.forEach.call(hote.querySelectorAll("[data-etat-matiere]"), function (b) {
      b.addEventListener("click", function () { changerEtatMatiere(e, this.dataset.matiere, this.dataset.etatMatiere); });
    });
  }
  function enregistrerFicheEleve(e) {
    var ind = nombreSaisi($("fe-ind").value), mut = nombreSaisi($("fe-mut").value);
    if (isNaN(ind) || ind < 0 || ind > 40 || isNaN(mut) || mut < 0 || mut > 40) { ui.toast("Heures notifiées invalides (de 0 à 40)."); return; }
    if (!(ind > 0) && !(mut > 0)) { ui.toast("Indiquez au moins une heure notifiée, individuelle ou mutualisée."); return; }
    var debut = $("fe-debut").value, fin = $("fe-fin").value;
    if (debut && fin && fin < debut) { ui.toast("La fin de notification précède son début."); return; }
    var besoins = Array.prototype.filter.call($("ge-fiche").querySelectorAll("[data-besoin]"), function (c) { return c.checked; })
      .map(function (c) { return I.ACCOMP[parseInt(c.dataset.besoin, 10)]; });
    var b = JSON.parse(JSON.stringify(e)), nouveau = { heuresInd: ind, heuresMut: mut, debutNotif: debut, finNotif: fin, besoins: besoins };
    b.modifiesAppli = b.modifiesAppli || {};
    var change = false;
    M.CHAMPS_NOTIFICATION.forEach(function (k) {
      var avant = k === "heuresInd" || k === "heuresMut" ? (e[k] || 0) : (k === "besoins" ? (e[k] || []) : (e[k] || ""));
      if (JSON.stringify(avant) !== JSON.stringify(nouveau[k])) { b[k] = nouveau[k]; b.modifiesAppli[k] = true; change = true; }
    });
    if (!Object.keys(b.modifiesAppli).length) delete b.modifiesAppli;
    var commentaire = $("fe-commentaire").value.replace(/\s+$/, "");
    if (commentaire !== (e.commentaire || "")) { if (commentaire) b.commentaire = commentaire; else delete b.commentaire; change = true; }
    if (!change) { ui.toast("Aucune modification."); return; }
    enregistrerPuisRendre([{ magasin: "eleves", enregistrer: [b] }], "Fiche de " + e.nomCourt + " enregistrée.", "la fiche de " + e.nomCourt);
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
    return '<div class="ga-legende"><span><i class="lg-libre"></i>libre</span><span><i class="lg-indispo"></i>indisponible</span>'
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
    var dispo = [], indispo = [];
    aeshTriees().forEach(function (a) {
      if (dejaLa[a.id]) return;
      var cand = candidat(a.id);
      var motifs = M.motifsIndisponibilite(a.id, cand.aff, ctxCourant, cand.remplaceId);
      var rejoint = cand.remplaceId ? etat.affectations.filter(function (x) { return x.id === cand.remplaceId; })[0] : null;
      var info = rejoint ? "rejoint le groupe de " + rejoint.eleves.map(function (id) { var x = eleveParId(id); return x ? x.nomCourt : id; }).join(", ") : "";
      var x = { a: a, motifs: motifs, info: info };
      if (!motifs.length) {
        // score et raisons du moteur (§5.3.5), pour trier les disponibles
        var ev = P.classerAesh(donneesMoteur(), cand.aff, cand.remplaceId, a.id)[0];
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
  function viderAnnulation() { pileAnnulation = []; }
  function annuler() {
    var action = pileAnnulation.pop();
    if (!action) { ui.toast("Rien à annuler."); return; }
    if (action.libelle === "la proposition") dernierRapport = null;   // le rapport ne décrit plus le brouillon
    enregistrerPuisRendre(action.ops, "Annulé : " + action.libelle + ".");
  }
  document.addEventListener("keydown", function (ev) {
    if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || (ev.key !== "z" && ev.key !== "Z")) return;
    if ($("vue-affectations").classList.contains("masque") || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) return;
    ev.preventDefault();
    annuler();
  });

  /* =============== modifications (toute saisie manuelle épingle, §5.4) =============== */
  // libelleAnnulation : l'action est annulable (§6), sous ce nom
  function enregistrerPuisRendre(ops, message, libelleAnnulation) {
    if (libelleAnnulation) {
      pileAnnulation.push({ libelle: libelleAnnulation, ops: M.operationsInverses(ops, { affectations: etat.affectations, cours: etat.cours, eleves: etat.eleves, aesh: etat.aesh }) });
      if (pileAnnulation.length > MAX_ANNULATION) pileAnnulation.shift();
    }
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
    enregistrerPuisRendre(ops, nomAesh(a) + " affectée à " + menu.eleve.nomCourt + (aff.alertes.length ? " — attention : contrainte non respectée." : "."),
      "l'affectation de " + nomAesh(a) + " à " + menu.eleve.nomCourt);
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
    rendreReglages: rendreReglages, nomEtablissement: nomEtablissement, heures: heures, ouvrirOnglet: ouvrirOnglet, viderAnnulation: viderAnnulation,
    surChangement: null
  };
})();
