(function () {
"use strict";

/* =============== utilitaires =============== */
function $(id) { return document.getElementById(id); }
function txt(s) { return String(s == null ? "" : s); }
function ech(s) { return txt(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function jour(iso) { if (!iso) return ""; var p = iso.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
function isoJour(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function anneeScolaireDebut(iso) {
  var d = iso ? new Date(iso + "T00:00:00") : new Date();
  if (isNaN(d)) d = new Date();
  var y = d.getFullYear(), m = d.getMonth() + 1;
  return (m >= 8) ? y : y - 1;
}
function jourHeure(iso) {
  if (!iso) return "";
  var d = new Date(iso); if (isNaN(d)) return "";
  return jour(isoJour(d)) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function toast(m) {
  var t = $("toast"); t.textContent = m; t.classList.add("on");
  clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("on"); }, 2600);
}
function telecharger(nom, contenu, type) {
  var b = new Blob([contenu], { type: (type || "text/plain") + ";charset=utf-8" });
  var u = URL.createObjectURL(b), a = document.createElement("a");
  a.href = u; a.download = nom; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1200);
}
function lireFichierTexte(fichier) {
  return new Promise(function (resolve, reject) {
    var lecteur = new FileReader();
    lecteur.onload = function () { resolve(lecteur.result); };
    lecteur.onerror = function () { reject(lecteur.error); };
    lecteur.readAsText(fichier);
  });
}

/* boîte de confirmation générique (mêmes principes que côté AESH : jamais
   de suppression/purge/restauration sans passer par une confirmation
   explicite, avec un libellé de bouton non ambigu). */
function confirmationForte(message, libelleBouton, cb) {
  var voile = $("voile-confirmation"), btnOk = $("modale-confirmer"), btnAnnuler = $("modale-annuler");
  $("modale-message").textContent = message;
  btnOk.textContent = libelleBouton || "Confirmer";
  voile.hidden = false;
  function nettoyer() {
    voile.hidden = true;
    btnOk.removeEventListener("click", surConfirmer);
    btnAnnuler.removeEventListener("click", surAnnuler);
  }
  function surConfirmer() { nettoyer(); cb(); }
  function surAnnuler() { nettoyer(); }
  btnOk.addEventListener("click", surConfirmer);
  btnAnnuler.addEventListener("click", surAnnuler);
}

/* =============== état en mémoire =============== */
var cache = [];        // tous les rapports (rechargés après chaque import/purge/restauration)
var importsCache = []; // historique des imports
var selectionRapports = {}; // id de rapport -> true
var triChamp = "debut", triSens = "desc";
var rapportDetailCourant = null;
var eleveCourantId = null, rapportsEleveCourant = [];

function rafraichirCache() { return PialDB.tousLesRapports().then(function (r) { cache = r; return cache; }); }
function rafraichirImports() { return PialDB.tousLesImports().then(function (r) { importsCache = r; return importsCache; }); }

/* =============== navigation =============== */
var VUES = ["vue-import", "vue-rapports", "vue-detail-rapport", "vue-fiche-eleve", "vue-indicateurs", "vue-stats", "vue-reglages"];
function vue(nom) {
  VUES.forEach(function (v) { $(v).classList.toggle("masque", v !== nom); });
  Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
    b.setAttribute("aria-current", b.dataset.vue === nom ? "true" : "false");
  });
  window.scrollTo(0, 0);
}
Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
  b.addEventListener("click", function () {
    vue(this.dataset.vue);
    if (this.dataset.vue === "vue-reglages") rendreStockage();
    if (this.dataset.vue === "vue-indicateurs") rendreIndicateurs();
    if (this.dataset.vue === "vue-stats") { initialiserFiltresStats(); rendreStats(); }
  });
});

/* =============== rendu d'un rapport (aperçu écran + impression) =============
   Reproduit à l'identique la structure/CSS de l'app AESH (index.html
   racine) pour garantir une mise en page A4 strictement identique. */
var INVEST_GROUPES = [
  { id: "engagement", titre: "Engagement dans le travail" },
  { id: "autonomie", titre: "Autonomie" },
  { id: "participation", titre: "Participation" },
  { id: "attention", titre: "Attention et organisation" },
  { id: "cadre", titre: "Cadre et relations" }
];
function texteModalite(r) {
  var n = r.copartage || 1;
  return r.modalite === "Mutualisé"
    ? "Mutualisé (partagé avec " + n + " autre" + (n > 1 ? "s" : "") + " élève" + (n > 1 ? "s" : "") + ")"
    : "Individuel";
}
function investLignes(r) {
  if (!r.invest) return [];
  var lignes = [];
  if (r.invest.tendance) lignes.push({ titre: null, valeur: r.invest.tendance });
  INVEST_GROUPES.forEach(function (g) {
    var arr = (r.invest.items && r.invest.items[g.id]) || [];
    if (arr.length) lignes.push({ titre: g.titre, valeur: arr.join(", ") });
  });
  return lignes;
}
function htmlRapport(r) {
  var h = "";
  h += '<div class="titre">Rapport d\'accompagnement</div>';
  h += '<table class="imp-table"><thead><tr><td>';
  h += '<div class="imp-bandeau">'
    + '<span class="imp-titre">Rapport d\'accompagnement AESH</span>'
    + '<span class="imp-periode">' + ech(r.periodeTexte) + '</span>'
    + '</div>';
  h += '</td></tr></thead><tbody><tr><td>';
  h += '<div class="imp-sousligne">'
    + [r.etablissement ? ech(r.etablissement) : "", "Année scolaire " + anneeScolaireDebut(r.debut || r.creeJour) + "-" + (anneeScolaireDebut(r.debut || r.creeJour) + 1)]
      .filter(function (s) { return s; }).join(" · ")
    + '</div>';
  h += '<dl class="bloc-identite">';
  h += '<dt class="ci-eleve">Élève</dt><dd class="ci-eleve">' + ech(r.eleveNom) + '</dd>';
  h += '<dt class="ci-classe">Classe</dt><dd class="ci-classe">' + (r.classe ? ech(r.classe) : "—") + '</dd>';
  h += '<dt class="ci-modalite">Modalité</dt><dd class="ci-modalite">' + texteModalite(r) + '</dd>';
  h += '<dt class="ci-quotite">Quotité</dt><dd class="ci-quotite">' + (r.heures ? ech(r.heures) : "—") + '</dd>';
  h += '<dt class="ci-aesh">AESH</dt><dd class="ci-aesh">' + (r.aesh ? ech(r.aesh) : "—") + '</dd>';
  h += '<dt class="ci-etab">Établissement</dt><dd class="ci-etab">' + (r.etablissement ? ech(r.etablissement) : "—") + '</dd>';
  h += '<dt class="ci-periode">Période</dt><dd class="ci-periode">' + ech(r.periode) + ' du ' + jour(r.debut) + ' au ' + jour(r.fin) + '</dd>';
  h += '<dt class="ci-etabli">Établi le</dt><dd class="ci-etabli">' + jour(r.creeJour) + '</dd>';
  h += '</dl>';
  h += '<section><h3>Qualité de la relation</h3><p>' + ech(r.relation) + '</p></section>';
  var investH = investLignes(r);
  if (investH.length) {
    h += '<section><h3>Investissement de l\'élève</h3>';
    investH.forEach(function (l) {
      h += l.titre ? '<p><strong>' + ech(l.titre) + '</strong> : ' + ech(l.valeur) + '</p>' : '<p>' + ech(l.valeur) + '</p>';
    });
    h += '</section>';
  }
  if (r.accomp && r.accomp.length) {
    h += '<section><h3>Type d\'accompagnement</h3><ul>';
    r.accomp.forEach(function (a) { h += '<li>' + ech(a) + '</li>'; });
    h += '</ul></section>';
  }
  if (r.matieres && r.matieres.length) h += '<section><h3>Matières concernées</h3><p>' + r.matieres.map(ech).join(", ") + '</p></section>';
  if (r.commentaire) h += '<section class="rapport-commentaire"><h3>Commentaire</h3><p>' + ech(r.commentaire) + '</p></section>';
  h += '</td></tr></tbody></table>';
  return h;
}
function htmlPiedSignature(r) {
  return '<div class="pied-signature">'
    + '<div class="imp-rappel-signature">' + ech(r.eleveNom) + (r.classe ? " — " + ech(r.classe) : "") + " — " + ech(r.periodeTexte) + '</div>'
    + '<div class="signature">'
    + '<div class="bloc-visa"><div class="entete-visa">L\'AESH</div><div>Rapport rédigé par : ' + (r.aesh ? ech(r.aesh) : "…") + '</div><div class="zone-signature"></div><div>Date et signature</div></div>'
    + '<div class="bloc-visa"><div class="entete-visa">Visa du coordonnateur PIAL</div><div class="zone-signature"></div><div>Date et signature</div></div>'
    + '</div></div>';
}
function htmlFeuilleRapport(r) {
  return '<div class="feuille-rapport"><div class="rapport">' + htmlRapport(r) + '</div>' + htmlPiedSignature(r) + '</div>';
}
function imprimerRapports(liste) {
  if (!liste.length) return;
  $("impression").innerHTML = liste.map(htmlFeuilleRapport).join("");
  window.print();
}

/* =============== import (glisser-déposer) =============== */
var zoneDepot = $("zone-depot");
["dragenter", "dragover"].forEach(function (nomEvt) {
  zoneDepot.addEventListener(nomEvt, function (e) { e.preventDefault(); zoneDepot.classList.add("survol"); });
});
["dragleave", "drop"].forEach(function (nomEvt) {
  zoneDepot.addEventListener(nomEvt, function (e) { e.preventDefault(); zoneDepot.classList.remove("survol"); });
});
zoneDepot.addEventListener("drop", function (e) {
  var fichiers = e.dataTransfer.files;
  if (fichiers && fichiers.length) traiterFichiers(fichiers);
});
$("btn-parcourir").addEventListener("click", function () { $("entree-fichier").click(); });
$("entree-fichier").addEventListener("change", function () {
  if (this.files.length) traiterFichiers(this.files);
  this.value = "";
});

function traiterFichiers(listeFichiers) {
  var fichiers = Array.prototype.slice.call(listeFichiers);
  var resultats = [];
  var chaine = fichiers.reduce(function (p, fichier) {
    return p.then(function () { return importerUnFichier(fichier).then(function (r) { resultats.push(r); }); });
  }, Promise.resolve());
  chaine.then(function () {
    afficherBilanImport(resultats);
    return Promise.all([rafraichirCache(), rafraichirImports()]);
  }).then(function () {
    initialiserFiltres(); initialiserPurge(); rendreRapports(); rendreImports(); rendreIndicateurs();
    initialiserFiltresStats(); rendreStats();
  });
}
function importerUnFichier(fichier) {
  return lireFichierTexte(fichier).then(function (texte) {
    var enveloppe;
    try { enveloppe = JSON.parse(texte); }
    catch (e) { return { nom: fichier.name, erreur: "Fichier JSON invalide." }; }
    if (!enveloppe || enveloppe.format !== "suivi-aesh/1") {
      return { nom: fichier.name, erreur: "Ce fichier n'est pas une transmission reconnue (format attendu : suivi-aesh/1)." };
    }
    return PialDB.importerFichier(enveloppe, fichier.name).then(function (compte) {
      return { nom: fichier.name, compte: compte };
    }).catch(function () {
      return { nom: fichier.name, erreur: "Échec de l'import de ce fichier." };
    });
  });
}
function afficherBilanImport(resultats) {
  var hote = $("bilan-import");
  hote.innerHTML = resultats.map(function (r) {
    if (r.erreur) return '<p class="note alerte"><strong>' + ech(r.nom) + '</strong> : ' + ech(r.erreur) + '</p>';
    var c = r.compte;
    return '<p class="note ok"><strong>' + ech(r.nom) + '</strong> — ' + c.ajoutes + ' ajouté' + (c.ajoutes > 1 ? "s" : "")
      + ', ' + c.connus + ' déjà connu' + (c.connus > 1 ? "s" : "") + ', ' + c.ignores + ' ignoré' + (c.ignores > 1 ? "s" : "") + '.</p>';
  }).join("");
  var totalAjoutes = resultats.reduce(function (s, r) { return s + (r.compte ? r.compte.ajoutes : 0); }, 0);
  toast(resultats.length + " fichier" + (resultats.length > 1 ? "s" : "") + " traité" + (resultats.length > 1 ? "s" : "") + " · " + totalAjoutes + " rapport(s) ajouté(s).");
}
function rendreImports() {
  var corps = $("corps-imports");
  var liste = importsCache.slice().sort(function (a, b) { return (b.importeLe || "").localeCompare(a.importeLe || ""); });
  corps.innerHTML = "";
  $("imports-vide").hidden = !!liste.length;
  liste.forEach(function (imp) {
    var tr = document.createElement("tr");
    var periodeTxt = imp.periode ? (jour(imp.periode.debut) + " – " + jour(imp.periode.fin)) : "—";
    tr.innerHTML =
      '<td>' + jourHeure(imp.importeLe) + '</td>' +
      '<td>' + ech(imp.nomFichier) + '</td>' +
      '<td>' + ech(imp.aesh) + '</td>' +
      '<td>' + ech(imp.etablissement) + '</td>' +
      '<td>' + periodeTxt + '</td>' +
      '<td class="numerique">' + imp.nbAjoutes + '</td>' +
      '<td class="numerique">' + imp.nbConnus + '</td>' +
      '<td class="numerique">' + imp.nbIgnores + '</td>';
    corps.appendChild(tr);
  });
}

/* =============== filtres =============== */
function valeursDistinctes(champ) {
  var vus = {}, out = [];
  cache.forEach(function (r) { var v = txt(r[champ]).trim(); if (v && !vus[v]) { vus[v] = true; out.push(v); } });
  out.sort(function (a, b) { return a.localeCompare(b, "fr"); });
  return out;
}
function remplirSelect(id, valeurs, libelleTous) {
  var sel = $(id), val = sel.value;
  sel.innerHTML = '<option value="">' + libelleTous + '</option>' + valeurs.map(function (v) {
    return '<option value="' + ech(v) + '">' + ech(v) + '</option>';
  }).join("");
  if (valeurs.indexOf(val) > -1) sel.value = val;
}
function remplirSelectEleves() {
  var vus = {}, out = [];
  cache.forEach(function (r) { if (!vus[r.eleveId]) { vus[r.eleveId] = true; out.push({ id: r.eleveId, nom: r.eleveNom }); } });
  out.sort(function (a, b) { return txt(a.nom).localeCompare(txt(b.nom), "fr"); });
  var sel = $("f-eleve"), val = sel.value;
  sel.innerHTML = '<option value="">Tous les élèves</option>' + out.map(function (e) {
    return '<option value="' + ech(e.id) + '">' + ech(e.nom) + '</option>';
  }).join("");
  if (out.some(function (e) { return e.id === val; })) sel.value = val;
}
function initialiserFiltres() {
  remplirSelect("f-aesh", valeursDistinctes("aesh"), "Toutes les AESH");
  remplirSelect("f-classe", valeursDistinctes("classe"), "Toutes les classes");
  remplirSelectEleves();
  remplirSelect("f-modalite", ["Individuel", "Mutualisé"], "Toutes les modalités");
  remplirSelect("f-relation", ["Fluide", "En construction", "Difficile"], "Toutes les relations");
}
["f-aesh", "f-eleve", "f-classe", "f-modalite", "f-relation", "f-debut", "f-fin"].forEach(function (id) {
  $(id).addEventListener("change", rendreRapports);
});
$("f-reinitialiser").addEventListener("click", function () {
  ["f-aesh", "f-eleve", "f-classe", "f-modalite", "f-relation"].forEach(function (id) { $(id).value = ""; });
  $("f-debut").value = ""; $("f-fin").value = "";
  selectionRapports = {};
  rendreRapports();
});

function rapportsFiltres() {
  var aesh = $("f-aesh").value, eleve = $("f-eleve").value, classe = $("f-classe").value,
    modalite = $("f-modalite").value, relation = $("f-relation").value,
    debut = $("f-debut").value, fin = $("f-fin").value;
  return cache.filter(function (r) {
    if (aesh && r.aesh !== aesh) return false;
    if (eleve && r.eleveId !== eleve) return false;
    if (classe && r.classe !== classe) return false;
    if (modalite && r.modalite !== modalite) return false;
    if (relation && r.relation !== relation) return false;
    if (debut && r.fin && r.fin < debut) return false;
    if (fin && r.debut && r.debut > fin) return false;
    return true;
  });
}
function trier(liste) {
  var champ = triChamp, sens = triSens;
  return liste.slice().sort(function (a, b) {
    var va, vb;
    if (champ === "tendance") { va = (a.invest && a.invest.tendance) || ""; vb = (b.invest && b.invest.tendance) || ""; }
    else { va = txt(a[champ]); vb = txt(b[champ]); }
    var cmp = va.localeCompare(vb, "fr");
    return sens === "asc" ? cmp : -cmp;
  });
}
Array.prototype.forEach.call(document.querySelectorAll("#tableau-rapports th[data-tri]"), function (th) {
  th.addEventListener("click", function () {
    var champ = this.dataset.tri;
    if (triChamp === champ) triSens = (triSens === "asc" ? "desc" : "asc");
    else { triChamp = champ; triSens = "asc"; }
    Array.prototype.forEach.call(document.querySelectorAll("#tableau-rapports th[data-tri]"), function (t) {
      t.classList.toggle("tri-actif", t === th);
    });
    rendreRapports();
  });
  if (th.dataset.tri === triChamp) th.classList.add("tri-actif");
});

/* =============== liste des rapports =============== */
function badgeRelation(rel) {
  var cls = rel === "Fluide" ? "badge-fluide" : (rel === "Difficile" ? "badge-difficile" : "badge-construction");
  return '<span class="badge ' + cls + '">' + ech(rel || "—") + '</span>';
}
function majBoutonImprimerSelection() {
  var n = Object.keys(selectionRapports).length;
  $("btn-imprimer-selection").disabled = (n === 0);
  $("btn-imprimer-selection").textContent = n ? "Imprimer la sélection (" + n + ")" : "Imprimer la sélection";
}
function rendreRapports() {
  var liste = trier(rapportsFiltres());
  $("resume-rapports").textContent = liste.length + " rapport" + (liste.length > 1 ? "s" : "") + " affiché" + (liste.length > 1 ? "s" : "") + ".";
  var corps = $("corps-rapports");
  corps.innerHTML = "";
  $("rapports-vide").hidden = !!liste.length;
  liste.forEach(function (r) {
    var tr = document.createElement("tr");
    var coche = !!selectionRapports[r.id];
    tr.innerHTML =
      '<td><input type="checkbox" class="case-ligne" data-id="' + ech(r.id) + '"' + (coche ? " checked" : "") + '></td>' +
      '<td class="col-lien" data-eleve="' + ech(r.eleveId) + '">' + ech(r.eleveNom) + '</td>' +
      '<td>' + ech(r.classe) + '</td>' +
      '<td>' + ech(r.aesh) + '</td>' +
      '<td>' + ech(r.periodeTexte || (jour(r.debut) + " – " + jour(r.fin))) + '</td>' +
      '<td>' + ech(r.modalite) + '</td>' +
      '<td>' + badgeRelation(r.relation) + '</td>' +
      '<td>' + ech((r.invest && r.invest.tendance) || "—") + '</td>' +
      '<td><button type="button" class="btn-lien" data-voir="' + ech(r.id) + '">Voir</button></td>';
    corps.appendChild(tr);
  });
  Array.prototype.forEach.call(corps.querySelectorAll(".case-ligne"), function (c) {
    c.addEventListener("change", function () {
      if (this.checked) selectionRapports[this.dataset.id] = true; else delete selectionRapports[this.dataset.id];
      majBoutonImprimerSelection();
    });
  });
  Array.prototype.forEach.call(corps.querySelectorAll("[data-eleve]"), function (td) {
    td.addEventListener("click", function () { ouvrirFicheEleve(this.dataset.eleve); });
  });
  Array.prototype.forEach.call(corps.querySelectorAll("[data-voir]"), function (b) {
    b.addEventListener("click", function () { ouvrirDetailRapport(this.dataset.voir); });
  });
  majBoutonImprimerSelection();
}
$("case-tout").addEventListener("change", function () {
  var coche = this.checked;
  trier(rapportsFiltres()).forEach(function (r) { if (coche) selectionRapports[r.id] = true; else delete selectionRapports[r.id]; });
  rendreRapports();
});
$("btn-imprimer-selection").addEventListener("click", function () {
  var liste = trier(cache.filter(function (r) { return selectionRapports[r.id]; }));
  imprimerRapports(liste);
});

/* ---------- export CSV ---------- */
function celluleCSV(v) {
  v = txt(v);
  if (/[";\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function construireCSV(liste) {
  var entetes = ["AESH", "Établissement", "Élève", "Classe", "Période", "Du", "Au", "Modalité", "Relation",
    "Tendance investissement", "Types d'accompagnement", "Matières", "Commentaire", "Établi le"];
  var lignes = [entetes.join(";")];
  liste.forEach(function (r) {
    lignes.push([
      celluleCSV(r.aesh), celluleCSV(r.etablissement), celluleCSV(r.eleveNom), celluleCSV(r.classe),
      celluleCSV(r.periode), celluleCSV(jour(r.debut)), celluleCSV(jour(r.fin)),
      celluleCSV(r.modalite), celluleCSV(r.relation), celluleCSV((r.invest && r.invest.tendance) || ""),
      celluleCSV((r.accomp || []).join(", ")), celluleCSV((r.matieres || []).join(", ")),
      celluleCSV(r.commentaire), celluleCSV(jour(r.creeJour))
    ].join(";"));
  });
  return "﻿" + lignes.join("\r\n");
}
$("btn-export-csv").addEventListener("click", function () {
  var n = Object.keys(selectionRapports).length;
  var liste = n ? trier(cache.filter(function (r) { return selectionRapports[r.id]; })) : trier(rapportsFiltres());
  if (!liste.length) { toast("Aucun rapport à exporter."); return; }
  telecharger("rapports_pial_" + isoJour(new Date()) + ".csv", construireCSV(liste), "text/csv");
  toast("Export CSV téléchargé (" + liste.length + " rapport(s)).");
});

/* =============== détail d'un rapport =============== */
function ouvrirDetailRapport(id) {
  var r = cache.filter(function (x) { return x.id === id; })[0];
  if (!r) return;
  rapportDetailCourant = r;
  $("zone-detail-rapport").innerHTML = htmlFeuilleRapport(r);
  vue("vue-detail-rapport");
}
$("retour-detail").addEventListener("click", function () { vue("vue-rapports"); });
$("btn-imprimer-detail").addEventListener("click", function () {
  if (rapportDetailCourant) imprimerRapports([rapportDetailCourant]);
});

/* =============== fiche élève agrégée =============== */
function ouvrirFicheEleve(eleveId) {
  eleveCourantId = eleveId;
  PialDB.rapportsDeEleve(eleveId).then(function (rapports) {
    rapportsEleveCourant = rapports;
    if (!rapports.length) { toast("Aucun rapport pour cet élève."); return; }
    var dernier = rapports[rapports.length - 1];
    $("fiche-titre").textContent = dernier.eleveNom;
    $("fiche-sous-titre").textContent = (dernier.classe ? dernier.classe + " · " : "")
      + rapports.length + " rapport" + (rapports.length > 1 ? "s" : "") + " enregistré" + (rapports.length > 1 ? "s" : "");
    var hote = $("fiche-timeline");
    hote.innerHTML = "";
    rapports.slice().reverse().forEach(function (r) {
      var li = document.createElement("li");
      li.className = "timeline-item";
      var invest = (r.invest && r.invest.tendance) || "";
      li.innerHTML =
        '<div class="t-titre">' + ech(r.periodeTexte || (jour(r.debut) + " – " + jour(r.fin))) + '</div>' +
        '<div class="t-meta">' + ech(r.aesh) + ' · ' + ech(r.modalite) + ' · établi le ' + jour(r.creeJour) + '</div>' +
        '<div class="t-corps">' +
        '<p>' + badgeRelation(r.relation) + (invest ? ' · investissement : ' + ech(invest) : '') + '</p>' +
        (r.accomp && r.accomp.length ? '<p>' + r.accomp.map(ech).join(", ") + '</p>' : '') +
        (r.commentaire ? '<p>' + ech(r.commentaire) + '</p>' : '') +
        '</div>';
      hote.appendChild(li);
    });
    vue("vue-fiche-eleve");
  });
}
$("retour-fiche").addEventListener("click", function () { vue("vue-rapports"); });
$("btn-imprimer-fiche").addEventListener("click", function () { imprimerRapports(rapportsEleveCourant); });

/* =============== indicateurs =============== */
function grouperParEleve() {
  var groupes = {};
  cache.forEach(function (r) {
    if (!groupes[r.eleveId]) groupes[r.eleveId] = [];
    groupes[r.eleveId].push(r);
  });
  Object.keys(groupes).forEach(function (id) {
    groupes[id].sort(function (a, b) { return (a.creeJour || "").localeCompare(b.creeJour || ""); });
  });
  return groupes;
}
function rendreListeAttention() {
  var groupes = grouperParEleve();
  var aujourdhui = new Date();
  var SIX_SEMAINES_MS = 42 * 24 * 3600 * 1000;
  var signales = [];
  Object.keys(groupes).forEach(function (eid) {
    var rapports = groupes[eid];
    var dernier = rapports[rapports.length - 1];
    var motifs = [];
    if (dernier.relation === "Difficile") motifs.push("Relation difficile");
    if (rapports.length >= 2) {
      var avantDernier = rapports[rapports.length - 2];
      var tendDernier = (dernier.invest && dernier.invest.tendance) || "";
      var tendAvant = (avantDernier.invest && avantDernier.invest.tendance) || "";
      if (tendDernier === "En recul" && tendAvant === "En recul") motifs.push("En recul depuis 2 périodes");
    }
    var dRef = dernier.creeJour ? new Date(dernier.creeJour + "T00:00:00") : null;
    if (dRef && !isNaN(dRef) && (aujourdhui - dRef) > SIX_SEMAINES_MS) motifs.push("Sans rapport depuis plus de 6 semaines");
    if (motifs.length) {
      signales.push({ eleveId: eid, eleveNom: dernier.eleveNom, classe: dernier.classe, aesh: dernier.aesh, motifs: motifs, dernierRapport: dernier });
    }
  });
  signales.sort(function (a, b) { return txt(a.eleveNom).localeCompare(txt(b.eleveNom), "fr"); });
  var corps = $("corps-attention");
  corps.innerHTML = "";
  $("attention-vide").hidden = !!signales.length;
  signales.forEach(function (s) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="col-lien" data-eleve="' + ech(s.eleveId) + '">' + ech(s.eleveNom) + '</td>' +
      '<td>' + ech(s.classe) + '</td>' +
      '<td>' + ech(s.aesh) + '</td>' +
      '<td>' + s.motifs.map(ech).join(" · ") + '</td>' +
      '<td>' + jour(s.dernierRapport.creeJour) + '</td>';
    corps.appendChild(tr);
  });
  Array.prototype.forEach.call(corps.querySelectorAll("[data-eleve]"), function (td) {
    td.addEventListener("click", function () { ouvrirFicheEleve(this.dataset.eleve); });
  });
}
function rendreIndicateurs() {
  var nInd = 0, nMut = 0;
  cache.forEach(function (r) { if (r.modalite === "Mutualisé") nMut++; else nInd++; });
  var total = nInd + nMut;
  var hoteRep = $("ind-repartition");
  if (!total) {
    hoteRep.innerHTML = '<p class="vide">Aucune donnée.</p>';
  } else {
    var pInd = Math.round(nInd / total * 100), pMut = 100 - pInd;
    hoteRep.innerHTML =
      '<div class="barre-repartition">' +
      (pInd ? '<span class="individuel" style="width:' + pInd + '%">' + pInd + '%</span>' : '') +
      (pMut ? '<span class="mutualise" style="width:' + pMut + '%">' + pMut + '%</span>' : '') +
      '</div>' +
      '<p class="chapeau" style="margin:0">Individuel : ' + nInd + ' · Mutualisé : ' + nMut + '</p>';
  }

  var comptes = {};
  cache.forEach(function (r) { (r.accomp || []).forEach(function (a) { comptes[a] = (comptes[a] || 0) + 1; }); });
  var classement = Object.keys(comptes).map(function (k) { return { libelle: k, n: comptes[k] }; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
  var maxN = classement.length ? classement[0].n : 0;
  $("ind-accompagnement").innerHTML = classement.length ? classement.map(function (c) {
    var pct = maxN ? Math.round(c.n / maxN * 100) : 0;
    return '<li><div class="lc-tete"><span>' + ech(c.libelle) + '</span><span>' + c.n + '</span></div>' +
      '<div class="lc-barre"><span style="width:' + pct + '%"></span></div></li>';
  }).join("") : '<li class="vide">Aucune donnée.</li>';

  rendreListeAttention();
}

/* =============== statistiques =============== */
/* Graphiques 100% construits en SVG (voir graphiques.js), aucune
   bibliothèque de graphiques, aucune requête réseau. */

function niveauClasse(classe) {
  var c = txt(classe).trim();
  // motif attendu : un chiffre de collège (3 à 6) en tête, ex. "6D" → "6e",
  // "4D" → "4e". Tout ce qui ne correspond pas est regroupé dans "Autre"
  // plutôt que de fausser le graphique ou de planter.
  var m = c.match(/^([3-6])(?:[^0-9]|$)/);
  return m ? (m[1] + "e") : "Autre";
}
var ORDRE_NIVEAUX = ["6e", "5e", "4e", "3e", "Autre"];

function cleMois(iso) { return iso.slice(0, 7); } // "YYYY-MM"
var LIBELLES_MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function libelleMois(cle) {
  var p = cle.split("-");
  return LIBELLES_MOIS[parseInt(p[1], 10) - 1] + " " + p[0].slice(2);
}
function moisDeLaPeriode(debut, fin) {
  var liste = [];
  var d = new Date(debut + "T00:00:00"); d.setDate(1);
  var f = new Date(fin + "T00:00:00");
  var garde = 0;
  while (d <= f && garde < 60) {
    liste.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    d.setMonth(d.getMonth() + 1);
    garde++;
  }
  return liste;
}

function initialiserFiltresStats() {
  var annees = anneesScolairesPresentes();
  var selAnnee = $("s-periode-annee"), val = selAnnee.value;
  selAnnee.innerHTML = annees.map(function (a) { return '<option value="' + a + '">' + a + '-' + (a + 1) + '</option>'; }).join("");
  if (annees.indexOf(parseInt(val, 10)) > -1) selAnnee.value = val;
  else if (annees.length) selAnnee.value = String(annees[annees.length - 1]);
  remplirSelect("s-classe", valeursDistinctes("classe"), "Toutes les classes");
  remplirSelect("s-aesh", valeursDistinctes("aesh"), "Toutes les AESH");
}

function majVisibiliteBlocsPeriode() {
  var type = $("s-periode-type").value;
  Array.prototype.forEach.call(document.querySelectorAll(".bloc-periode-annee"), function (el) { el.hidden = (type === "dates"); });
  Array.prototype.forEach.call(document.querySelectorAll(".bloc-periode-trimestre"), function (el) { el.hidden = (type !== "trimestre"); });
  Array.prototype.forEach.call(document.querySelectorAll(".bloc-periode-dates"), function (el) { el.hidden = (type !== "dates"); });
}

// renvoie {debut, fin, texte} en ISO ; debut/fin sont null si la période
// n'est pas (encore) déterminable (aucune année scolaire connue, ou dates
// libres non renseignées) — jamais une plage par défaut hasardeuse.
function calculerPeriodeStats() {
  var type = $("s-periode-type").value;
  if (type === "dates") {
    var d = $("s-debut").value, f = $("s-fin").value;
    return { debut: d || null, fin: f || null, texte: (d && f) ? (jour(d) + " – " + jour(f)) : "Choisissez une période." };
  }
  var an = parseInt($("s-periode-annee").value, 10);
  if (!an) return { debut: null, fin: null, texte: "Aucune période disponible." };
  if (type === "trimestre") {
    var tri = $("s-periode-trimestre").value;
    var plages = {
      "1": [an + "-09-01", an + "-12-31"],
      "2": [(an + 1) + "-01-01", (an + 1) + "-03-31"],
      "3": [(an + 1) + "-04-01", (an + 1) + "-08-31"]
    };
    var p = plages[tri] || plages["1"];
    var libTri = tri === "2" ? "2e" : (tri === "3" ? "3e" : "1er");
    return { debut: p[0], fin: p[1], texte: libTri + " trimestre " + an + "-" + (an + 1) };
  }
  return { debut: an + "-09-01", fin: (an + 1) + "-08-31", texte: "Année scolaire " + an + "-" + (an + 1) };
}

function rapportsStats(periode) {
  if (!periode.debut || !periode.fin) return [];
  var classe = $("s-classe").value, aesh = $("s-aesh").value;
  return cache.filter(function (r) {
    if (!r.creeJour || r.creeJour < periode.debut || r.creeJour > periode.fin) return false;
    if (classe && r.classe !== classe) return false;
    if (aesh && r.aesh !== aesh) return false;
    return true;
  });
}

function majResumeStats(liste, periode) {
  var hote = $("s-resume");
  if (!periode.debut || !periode.fin) { hote.className = "note alerte"; hote.textContent = periode.texte; return; }
  var eleves = {};
  liste.forEach(function (r) { if (r.eleveId) eleves[r.eleveId] = true; });
  hote.className = liste.length ? "note" : "note alerte";
  hote.textContent = periode.texte + " · " + liste.length + " rapport" + (liste.length > 1 ? "s" : "")
    + " · " + Object.keys(eleves).length + " élève" + (Object.keys(eleves).length > 1 ? "s" : "") + " concerné" + (Object.keys(eleves).length > 1 ? "s" : "");
}

function rendreChiffresCles(liste) {
  var eleves = {}, aeshSet = {};
  liste.forEach(function (r) { if (r.eleveId) eleves[r.eleveId] = true; if (r.aesh) aeshSet[r.aesh] = true; });
  $("s-cles").innerHTML =
    '<div class="carte-chiffre"><div class="cc-valeur">' + Object.keys(eleves).length + '</div><div class="cc-label">élève(s) suivi(s)</div></div>'
    + '<div class="carte-chiffre"><div class="cc-valeur">' + liste.length + '</div><div class="cc-label">rapport(s)</div></div>'
    + '<div class="carte-chiffre"><div class="cc-valeur">' + Object.keys(aeshSet).length + '</div><div class="cc-label">AESH ayant transmis</div></div>';
}
function rendreModalite(liste, texteVide) {
  var nInd = 0, nMut = 0;
  liste.forEach(function (r) { if (r.modalite === "Mutualisé") nMut++; else nInd++; });
  $("s-modalite").innerHTML = PialGraphiques.camembert(
    [{ libelle: "Individuel", valeur: nInd }, { libelle: "Mutualisé", valeur: nMut }],
    { texteVide: texteVide }
  );
}
function rendreNiveaux(liste, texteVide) {
  var comptes = {};
  liste.forEach(function (r) { var n = niveauClasse(r.classe); comptes[n] = (comptes[n] || 0) + 1; });
  var data = ORDRE_NIVEAUX.filter(function (n) { return comptes[n]; }).map(function (n) { return { libelle: n, valeur: comptes[n] }; });
  $("s-niveaux").innerHTML = PialGraphiques.barresVerticales(data, { texteVide: texteVide });
}
function rendreVolumeAesh(liste, texteVide) {
  var comptes = {};
  liste.forEach(function (r) { var a = txt(r.aesh).trim() || "Non renseigné"; comptes[a] = (comptes[a] || 0) + 1; });
  var data = Object.keys(comptes).map(function (k) { return { libelle: k, valeur: comptes[k] }; });
  $("s-volume-aesh").innerHTML = PialGraphiques.barresHorizontales(data, { texteVide: texteVide, largeur: 560 });
}
function rendreRapportsParMois(liste, mois, texteVide) {
  var comptes = {}; mois.forEach(function (m) { comptes[m] = 0; });
  liste.forEach(function (r) { if (r.creeJour) { var m = cleMois(r.creeJour); if (comptes[m] != null) comptes[m]++; } });
  var data = mois.map(function (m) { return { libelle: libelleMois(m), valeur: comptes[m] }; });
  $("s-mois").innerHTML = PialGraphiques.barresVerticales(data, { texteVide: texteVide, largeur: 600 });
}
var RELATIONS_STATS = ["Fluide", "En construction", "Difficile"];
function rendreRelation(liste, mois, texteVide) {
  var comptes = { "Fluide": 0, "En construction": 0, "Difficile": 0 };
  liste.forEach(function (r) { if (comptes[r.relation] != null) comptes[r.relation]++; });
  $("s-relation-camembert").innerHTML = PialGraphiques.camembert(
    RELATIONS_STATS.map(function (k) { return { libelle: k, valeur: comptes[k] }; }), { texteVide: texteVide }
  );
  var series = RELATIONS_STATS.map(function (k) {
    return {
      libelle: k, valeurs: mois.map(function (m) {
        return liste.filter(function (r) { return r.creeJour && cleMois(r.creeJour) === m && r.relation === k; }).length;
      })
    };
  });
  $("s-relation-evolution").innerHTML = PialGraphiques.barresEmpileesMensuelles(mois.map(libelleMois), series, { texteVide: texteVide, largeur: 620 });
}
var TENDANCES_STATS = ["En progrès", "Stable", "En recul"];
function rendreInvestissement(liste, mois, texteVide) {
  // le champ invest (ou sa tendance) est absent de certains rapports :
  // ils sont exclus du calcul plutôt que comptés dans une valeur par
  // défaut, et le nombre d'exclus est affiché sous chaque graphique.
  var avecTendance = liste.filter(function (r) { return r.invest && r.invest.tendance; });
  var exclus = liste.length - avecTendance.length;
  var texteExclus = exclus > 0
    ? exclus + " rapport" + (exclus > 1 ? "s" : "") + " sans tendance d'investissement renseignée, exclu" + (exclus > 1 ? "s" : "") + " de ce calcul."
    : "";

  var comptes = { "En progrès": 0, "Stable": 0, "En recul": 0 };
  avecTendance.forEach(function (r) { var t = r.invest.tendance; if (comptes[t] != null) comptes[t]++; });
  $("s-invest-camembert").innerHTML = PialGraphiques.camembert(
    TENDANCES_STATS.map(function (k) { return { libelle: k, valeur: comptes[k] }; }), { texteVide: texteVide }
  );
  $("s-invest-camembert-note").textContent = texteExclus;

  var series = TENDANCES_STATS.map(function (k) {
    return {
      libelle: k, valeurs: mois.map(function (m) {
        return avecTendance.filter(function (r) { return r.creeJour && cleMois(r.creeJour) === m && r.invest.tendance === k; }).length;
      })
    };
  });
  $("s-invest-evolution").innerHTML = PialGraphiques.barresEmpileesMensuelles(mois.map(libelleMois), series, { texteVide: texteVide, largeur: 620 });
  $("s-invest-evolution-note").textContent = texteExclus;
}

function rendreStats() {
  majVisibiliteBlocsPeriode();
  var periode = calculerPeriodeStats();
  var liste = rapportsStats(periode);
  var texteVide = (periode.debut && periode.fin) ? "Aucune donnée sur la période." : periode.texte;
  var mois = (periode.debut && periode.fin) ? moisDeLaPeriode(periode.debut, periode.fin) : [];

  majResumeStats(liste, periode);
  rendreChiffresCles(liste);
  rendreModalite(liste, texteVide);
  rendreNiveaux(liste, texteVide);
  rendreVolumeAesh(liste, texteVide);
  rendreRapportsParMois(liste, mois, texteVide);
  rendreRelation(liste, mois, texteVide);
  rendreInvestissement(liste, mois, texteVide);
}
["s-periode-type", "s-periode-annee", "s-periode-trimestre", "s-debut", "s-fin", "s-classe", "s-aesh"].forEach(function (id) {
  $(id).addEventListener("change", rendreStats);
});

/* ---------- impression de la sélection ---------- */
function etablissementPourImpression(liste) {
  var vus = {};
  liste.forEach(function (r) { if (r.etablissement) vus[r.etablissement] = (vus[r.etablissement] || 0) + 1; });
  var noms = Object.keys(vus);
  if (!noms.length) return "Établissement non renseigné";
  noms.sort(function (a, b) { return vus[b] - vus[a]; });
  return noms.join(", ");
}
function imprimerStats() {
  var blocs = [
    { chk: "chk-cles", titre: "Chiffres clés", html: $("s-cles").innerHTML },
    { chk: "chk-modalite", titre: "Individuel / mutualisé", html: $("s-modalite").innerHTML },
    { chk: "chk-niveaux", titre: "Répartition par niveau de classe", html: $("s-niveaux").innerHTML },
    { chk: "chk-volume", titre: "Volume d'activité par AESH", html: $("s-volume-aesh").innerHTML + '<p class="note-sous-graphique">Indicateur de volume, à ne pas interpréter comme une évaluation individuelle.</p>' },
    { chk: "chk-mois", titre: "Rapports transmis par mois", html: $("s-mois").innerHTML },
    { chk: "chk-relation-pie", titre: "Qualité de la relation", html: $("s-relation-camembert").innerHTML },
    { chk: "chk-relation-evol", titre: "Qualité de la relation — évolution mensuelle", html: $("s-relation-evolution").innerHTML },
    { chk: "chk-invest-pie", titre: "Tendance d'investissement", html: $("s-invest-camembert").innerHTML + ($("s-invest-camembert-note").textContent ? '<p class="note-sous-graphique">' + ech($("s-invest-camembert-note").textContent) + '</p>' : "") },
    { chk: "chk-invest-evol", titre: "Investissement — évolution mensuelle", html: $("s-invest-evolution").innerHTML + ($("s-invest-evolution-note").textContent ? '<p class="note-sous-graphique">' + ech($("s-invest-evolution-note").textContent) + '</p>' : "") }
  ];
  var choisis = blocs.filter(function (b) { return $(b.chk).checked; });
  if (!choisis.length) { toast("Cochez au moins un graphique à imprimer."); return; }
  var periode = calculerPeriodeStats();
  var liste = rapportsStats(periode);
  var entete = '<div class="entete-impression-stats">'
    + '<div class="ei-etab">' + ech(etablissementPourImpression(liste)) + '</div>'
    + '<div class="ei-periode">Période : ' + ech(periode.texte) + '</div>'
    + '<div class="ei-date">Édité le ' + jour(isoJour(new Date())) + '</div>'
    + '</div>';
  var corps = choisis.map(function (b) { return '<div class="bloc-impression-stat"><h3>' + ech(b.titre) + '</h3>' + b.html + '</div>'; }).join("");
  $("impression").innerHTML = '<div class="impression-stats">' + entete + corps + '</div>';
  window.print();
}
$("btn-imprimer-stats").addEventListener("click", imprimerStats);

/* =============== réglages : stockage =============== */
function rendreStockage() {
  var hote = $("reg-persistance");
  if (!navigator.storage || !navigator.storage.persisted) {
    hote.innerHTML = '<div class="note alerte">Ce navigateur ne permet pas de garantir la conservation des données. Exportez des sauvegardes régulières.</div>';
  } else {
    navigator.storage.persisted().then(function (ok) {
      hote.innerHTML = ok
        ? '<div class="note ok">Stockage persistant activé : le navigateur ne supprimera pas ces données automatiquement en cas de manque d\'espace.</div>'
        : '<div class="note alerte">Stockage persistant refusé ou non confirmé par le navigateur : ces données pourraient être effacées automatiquement en cas de manque d\'espace. Exportez des sauvegardes régulières.</div>';
    });
  }
  var hoteEspace = $("reg-espace");
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(function (info) {
      var mo = function (o) { return ((o || 0) / 1048576).toFixed(1); };
      hoteEspace.innerHTML = '<p>Espace utilisé : <strong>' + mo(info.usage) + ' Mo</strong> sur ' + mo(info.quota) + ' Mo disponibles.</p>';
    });
  } else {
    hoteEspace.innerHTML = "";
  }
}
$("btn-rafraichir-espace").addEventListener("click", rendreStockage);

/* =============== réglages : sécurité (mot de passe) =============== */
$("btn-changer-mdp").addEventListener("click", function () {
  $("form-changer-mdp").hidden = !$("form-changer-mdp").hidden;
});
$("cm-annuler").addEventListener("click", function () {
  $("form-changer-mdp").hidden = true;
  $("cm-ancien").value = ""; $("cm-nouveau1").value = ""; $("cm-nouveau2").value = "";
});
$("form-changer-mdp").addEventListener("submit", function (evt) {
  evt.preventDefault();
  var ancien = $("cm-ancien").value, n1 = $("cm-nouveau1").value, n2 = $("cm-nouveau2").value;
  function afficherErreurMdp(m) { var el = $("cm-erreur"); el.textContent = m || ""; el.hidden = !m; }
  if (!n1) { afficherErreurMdp("Indiquez un nouveau mot de passe."); return; }
  if (n1 !== n2) { afficherErreurMdp("Les deux mots de passe ne correspondent pas."); return; }
  window.PialAuth.verifierMotDePasse(ancien).then(function (ok) {
    if (!ok) { afficherErreurMdp("Ancien mot de passe incorrect."); return; }
    return window.PialAuth.changerMotDePasse(n1).then(function () {
      $("form-changer-mdp").hidden = true;
      $("cm-ancien").value = ""; $("cm-nouveau1").value = ""; $("cm-nouveau2").value = "";
      afficherErreurMdp("");
      toast("Mot de passe modifié.");
    });
  });
});

/* =============== réglages : sauvegarde / restauration =============== */
$("btn-exporter-sauvegarde").addEventListener("click", function () {
  PialDB.exporterTout().then(function (donnees) {
    var contenu = { format: "pial-suivi/1", exporte_le: isoJour(new Date()), rapports: donnees.rapports, imports: donnees.imports };
    telecharger("sauvegarde-pial-" + isoJour(new Date()) + ".json", JSON.stringify(contenu, null, 2), "application/json");
    toast("Sauvegarde téléchargée.");
  });
});
$("btn-restaurer-sauvegarde").addEventListener("click", function () { $("entree-restauration").click(); });
$("entree-restauration").addEventListener("change", function () {
  var fichier = this.files[0]; this.value = ""; if (!fichier) return;
  lireFichierTexte(fichier).then(function (texte) {
    var donnees;
    try { donnees = JSON.parse(texte); } catch (e) { toast("Ce fichier n'est pas une sauvegarde valide."); return; }
    if (!donnees || !Array.isArray(donnees.rapports)) { toast("Ce fichier n'est pas une sauvegarde valide."); return; }
    confirmationForte(
      "Restaurer cette sauvegarde remplacera intégralement les données actuelles (" + cache.length + " rapport(s) enregistrés ici, qui seront perdus s'ils ne figurent pas dans la sauvegarde). Cette action est irréversible.",
      "Remplacer",
      function () {
        PialDB.remplacerTout(donnees).then(function () {
          return Promise.all([rafraichirCache(), rafraichirImports()]);
        }).then(function () {
          initialiserFiltres(); initialiserPurge(); rendreRapports(); rendreImports(); rendreIndicateurs();
          initialiserFiltresStats(); rendreStats();
          toast("Sauvegarde restaurée.");
        });
      }
    );
  });
});

/* =============== réglages : purge =============== */
function anneesScolairesPresentes() {
  var vus = {};
  cache.forEach(function (r) { vus[anneeScolaireDebut(r.creeJour)] = true; });
  return Object.keys(vus).map(Number).sort(function (a, b) { return a - b; });
}
function initialiserPurge() {
  var annees = anneesScolairesPresentes();
  $("purge-annee").innerHTML = annees.map(function (a) { return '<option value="' + a + '">' + a + '-' + (a + 1) + '</option>'; }).join("");
}
$("btn-purger").addEventListener("click", function () {
  var val = $("purge-annee").value;
  if (!val) { toast("Aucune année disponible."); return; }
  var seuil = parseInt(val, 10);
  var predicat = function (r) { return anneeScolaireDebut(r.creeJour) < seuil; };
  var n = cache.filter(predicat).length;
  if (!n) { toast("Aucun rapport antérieur à cette année scolaire."); return; }
  confirmationForte(
    n + " rapport(s) antérieur(s) à l'année scolaire " + seuil + "-" + (seuil + 1) + " seront supprimés définitivement de cet ordinateur. Cette action est irréversible.",
    "Purger",
    function () {
      PialDB.purgerAvecPredicat(predicat).then(function () { return rafraichirCache(); }).then(function () {
        initialiserFiltres(); initialiserPurge(); rendreRapports(); rendreIndicateurs();
        initialiserFiltresStats(); rendreStats();
        toast(n + " rapport(s) purgé(s).");
      });
    }
  );
});

/* =============== démarrage =============== */
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
rendreStockage();
Promise.all([rafraichirCache(), rafraichirImports()]).then(function () {
  initialiserFiltres();
  initialiserPurge();
  rendreRapports();
  rendreImports();
  rendreIndicateurs();
  initialiserFiltresStats();
  rendreStats();
});

})();
