"use strict";

/* =====================================================================
   PialDossier — dossier d'envoi par AESH (spec §8.1, §8.3). Fonctions
   pures, sans DOM ni stockage : elles produisent les contenus de fichiers
   (texte), que l'interface range dans un ZIP (PialZip.ecrire).

   Pour chaque AESH : message.txt, message.eml (brouillon « X-Unsent: 1 »),
   emploi-du-temps.html (autonome, imprimable) et affectation.json au
   format pial-affectation/1. À la racine : recapitulatif.csv.

   donnees = {
     annee, version: {numero (0 = brouillon), dateEffet},
     genereLe (AAAA-MM-JJ), etablissements: [{id, nom}],
     eleves: [{id, cle, nomCourt, classe, etablissement (id), heuresInd, heuresMut}],
     aesh: [{id, nom, prenom, email?, quotite?}],
     cours: [{eleveId, jour, debut, fin, matiere}],
     affectations: [{id, aeshId, creneau: {etab, jour, debut, fin, semaine}, modalite, periscolaire?, eleves: [id]}]
   }
   ===================================================================== */
var PialDossier = (function () {

  var JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

  function txt(s) { return String(s == null ? "" : s); }
  function ech(s) { return txt(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function minutes(h) { var p = txt(h).split(":"); return (+p[0]) * 60 + (+p[1] || 0); }
  function sansAccent(s) { var t = txt(s); return (t.normalize ? t.normalize("NFD") : t).replace(/[̀-ͯ]/g, ""); }
  function dateFr(iso) { return iso ? txt(iso).slice(0, 10).split("-").reverse().join("/") : ""; }
  function nomCourtAesh(a) { var n = txt(a.nom).replace(/\s+/g, " ").trim(); return (txt(a.prenom).trim() + " " + (n ? n.charAt(0).toUpperCase() + "." : "")).trim(); }
  function nomAesh(a) { return (txt(a.prenom).trim() + " " + txt(a.nom).trim()).trim(); }
  function nomEtab(donnees, id) {
    var e = (donnees.etablissements || []).filter(function (x) { return x.id === id; })[0];
    return e ? e.nom : txt(id);
  }
  function parId(liste, id) { return (liste || []).filter(function (x) { return x.id === id; })[0]; }
  function heuresTexte(h) { return (Math.round(h * 100) / 100).toString().replace(".", ","); }

  /* hachage FNV-1a 32 bits d'un texte (signature d'une affectation, pas un hachage de sécurité) */
  function hachage(texte) {
    var h = 0x811c9dc5, s = txt(texte);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul ? Math.imul(h, 0x01000193) : (h * 0x01000193) >>> 0; }
    return (h >>> 0).toString(16);
  }

  /* cours de l'élève qui recoupe le créneau : donne la matière */
  function matiereDuCreneau(donnees, eleveId, cr) {
    var d = minutes(cr.debut), f = minutes(cr.fin), trouve = "";
    (donnees.cours || []).forEach(function (c) {
      if (trouve || c.eleveId !== eleveId || c.jour !== cr.jour) return;
      if (minutes(c.debut) < f && minutes(c.fin) > d) {
        var s = txt(c.semaine);
        if (!s || s === "toutes" || cr.semaine === "toutes" || s === cr.semaine) trouve = txt(c.matiere);
      }
    });
    return trouve;
  }

  /* pial-affectation/1 d'une AESH (spec §8.3, avec « eleveId » : identifiant
     interne stable de l'élève côté PIAL). Le commentaire de la fiche élève,
     les états par matière et les marques « modifié » n'y figurent jamais. */
  function affectationAesh(donnees, aeshId) {
    var a = parId(donnees.aesh, aeshId);
    var res = { format: "pial-affectation/1", genere_le: donnees.genereLe, annee: donnees.annee,
      version: donnees.version.numero, date_effet: donnees.version.dateEffet || "", aesh: a ? nomCourtAesh(a) : "", eleves: [] };
    var parEleve = {}, ordre = [];
    (donnees.affectations || []).forEach(function (aff) {
      if (aff.aeshId !== aeshId) return;
      (aff.eleves || []).forEach(function (eid) {
        var e = parId(donnees.eleves, eid);
        if (!e) return;
        var x = parEleve[eid];
        if (!x) {
          x = parEleve[eid] = { e: e, individuel: false, mutualise: false, creneaux: [] };
          ordre.push(eid);
        }
        if (aff.modalite === "individuel") x.individuel = true;
        else if (aff.modalite === "mutualise") x.mutualise = true;
        var cr = { jour: aff.creneau.jour, debut: aff.creneau.debut, fin: aff.creneau.fin, semaine: aff.creneau.semaine || "toutes" };
        if (aff.modalite === "periscolaire") {
          cr.matiere = aff.periscolaire === "meridienne" ? "Pause méridienne" : "Récréation"; cr.type = "periscolaire";
        } else cr.matiere = matiereDuCreneau(donnees, eid, cr);
        x.creneaux.push(cr);
      });
    });
    ordre.forEach(function (eid) {
      var x = parEleve[eid], e = x.e;
      var modalite = x.individuel ? "individuel" : (x.mutualise ? "mutualise" : "periscolaire");
      var heures = modalite === "individuel" ? (e.heuresInd || 0) : (modalite === "mutualise" ? (e.heuresMut || 0) : 0);
      x.creneaux.sort(function (p, q) {
        return JOURS.indexOf(p.jour) - JOURS.indexOf(q.jour) || minutes(p.debut) - minutes(q.debut) || txt(p.semaine).localeCompare(txt(q.semaine));
      });
      res.eleves.push({ eleveId: e.parcours || e.id, cle: e.cle, eleveNom: e.nomCourt, classe: e.classe, etablissement: nomEtab(donnees, e.etablissement),
        modalite: modalite, heures: heures, creneaux: x.creneaux });
    });
    res.eleves.sort(function (p, q) { return txt(p.eleveNom).localeCompare(txt(q.eleveNom), "fr") || txt(p.eleveId).localeCompare(txt(q.eleveId)); });
    return res;
  }

  /* signature de ce qui concerne l'AESH : sans date de génération ni numéro de version, pour que deux exports
     identiques aient la même signature */
  function signature(aff) {
    var c = JSON.parse(JSON.stringify(aff)); delete c.genere_le; delete c.version; delete c.date_effet;
    return hachage(JSON.stringify(c));
  }

  /* AESH ayant au moins une affectation dans ces données */
  function aeshConcernees(donnees) {
    var vus = {};
    (donnees.affectations || []).forEach(function (a) { vus[a.aeshId] = true; });
    return (donnees.aesh || []).filter(function (a) { return vus[a.id]; });
  }

  /* quelles AESH ont une affectation changée ?
     exportees : {aeshId: {signature}} (signature mémorisée au dernier export) ;
     precedent : données de la version précédente (repli si l'AESH n'a jamais été exportée) ou null.
     Renvoie [{aesh, signature, changee, raison: "jamais-exportee-nouvelle" | "modifiee" | "inchangee" | ...}] */
  function etatsAesh(donnees, exportees, precedent) {
    exportees = exportees || {};
    return aeshConcernees(donnees).map(function (a) {
      var sig = signature(affectationAesh(donnees, a.id)), base = null, source = "";
      if (exportees[a.id] && exportees[a.id].signature) { base = exportees[a.id].signature; source = "dernier export"; }
      else if (precedent) {
        base = signature(affectationAesh(precedent, a.id)); source = "version précédente";
      }
      var changee = base === null ? true : base !== sig;
      return { aesh: a, signature: sig, changee: changee, source: source || "aucun export ni version précédente" };
    });
  }

  /* =============== messages =============== */
  function resumeCreneaux(cr) {
    return cr.jour + " " + cr.debut + "–" + cr.fin + (cr.semaine && cr.semaine !== "toutes" ? " (semaine " + cr.semaine + ")" : "")
      + (cr.matiere ? " — " + cr.matiere : "");
  }
  function message(donnees, aeshId, options) {
    options = options || {};
    var a = parId(donnees.aesh, aeshId), aff = affectationAesh(donnees, aeshId);
    var v = donnees.version, num = v.numero ? "version n° " + v.numero : "proposition (brouillon)";
    var objet = "Votre affectation — " + num + (v.dateEffet ? ", à partir du " + dateFr(v.dateEffet) : "");
    var l = [];
    l.push("Bonjour " + txt(a && a.prenom).trim() + ",");
    l.push("");
    l.push("Voici votre affectation (" + num + ")" + (v.dateEffet ? ", applicable à partir du " + dateFr(v.dateEffet) : "") + " pour l'année scolaire " + donnees.annee + "."
      + (options.changee === true ? " Elle a changé depuis votre dernier envoi." : ""));
    l.push("");
    if (!aff.eleves.length) l.push("Aucun élève ne vous est affecté pour le moment.");
    else {
      l.push("Élèves accompagnés (" + aff.eleves.length + ") :");
      aff.eleves.forEach(function (e) {
        l.push("- " + e.eleveNom + " (" + e.classe + ", " + e.etablissement + ") — " + (e.modalite === "individuel" ? "individuel" : (e.modalite === "mutualise" ? "mutualisé" : "temps périscolaires")) + (e.heures ? ", " + heuresTexte(e.heures) + " h notifiées" : ""));
        e.creneaux.forEach(function (c) { l.push("    " + resumeCreneaux(c)); });
      });
    }
    l.push("");
    l.push("Pour mettre à jour vos fiches élèves dans l'application Suivi AESH : ouvrez-la, puis « Importer mon affectation » et choisissez le fichier affectation.json joint. Une sauvegarde de vos données est proposée avant toute modification ; vos notes et vos rapports ne sont jamais modifiés. Vous voyez les changements avant de les valider.");
    l.push("");
    l.push("Votre emploi du temps est en pièce jointe (emploi-du-temps.html : à ouvrir dans un navigateur ou à imprimer).");
    l.push("");
    l.push("Bien cordialement,");
    l.push(options.signature || "Le coordonnateur PIAL");
    return { objet: objet, corps: l.join("\r\n"), destinataire: txt(a && a.email).trim() };
  }

  function base64(octets) {
    var s = "", pas = 0x6000;
    for (var i = 0; i < octets.length; i += pas) s += String.fromCharCode.apply(null, octets.subarray(i, i + pas));
    return btoa(s);
  }
  function b64Lignes(texte) {
    var b = base64(new TextEncoder().encode(texte)), out = [];
    for (var i = 0; i < b.length; i += 76) out.push(b.slice(i, i + 76));
    return out.join("\r\n");
  }
  function enteteMime(s) { return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + base64(new TextEncoder().encode(s)) + "?="; }

  /* brouillon de mail : « X-Unsent: 1 » ouvre le fichier comme un message à
     envoyer (Outlook, Thunderbird) ; pièces jointes : emploi du temps et affectation.json.
     Ne fonctionne pas avec une messagerie web : utiliser message.txt. */
  function eml(donnees, aeshId, options) {
    var m = message(donnees, aeshId, options), frontiere = "=_pial_" + hachage(aeshId + donnees.genereLe) + hachage(m.objet);
    var pj = [{ nom: "emploi-du-temps.html", type: "text/html", contenu: edtHtml(donnees, aeshId) },
      { nom: "affectation.json", type: "application/json", contenu: JSON.stringify(affectationAesh(donnees, aeshId), null, 2) }];
    var h = ["X-Unsent: 1", "To: " + m.destinataire, "Subject: " + enteteMime(m.objet), "MIME-Version: 1.0",
      "Content-Type: multipart/mixed; boundary=\"" + frontiere + "\"", "",
      "--" + frontiere, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64Lignes(m.corps)];
    pj.forEach(function (p) {
      h.push("--" + frontiere, "Content-Type: " + p.type + "; charset=UTF-8; name=\"" + p.nom + "\"", "Content-Transfer-Encoding: base64",
        "Content-Disposition: attachment; filename=\"" + p.nom + "\"", "", b64Lignes(p.contenu));
    });
    h.push("--" + frontiere + "--", "");
    return h.join("\r\n");
  }

  /* =============== emploi du temps HTML autonome =============== */
  function edtHtml(donnees, aeshId) {
    var a = parId(donnees.aesh, aeshId), aff = affectationAesh(donnees, aeshId), v = donnees.version;
    // créneaux regroupés : jour, horaire, semaine, établissement → élèves
    var groupes = {}, ordre = [];
    aff.eleves.forEach(function (e) {
      e.creneaux.forEach(function (c) {
        var k = [c.jour, c.debut, c.fin, c.semaine, e.etablissement, c.matiere].join("|");
        if (!groupes[k]) { groupes[k] = { c: c, etab: e.etablissement, eleves: [] }; ordre.push(k); }
        groupes[k].eleves.push(e.eleveNom + " (" + e.classe + ")");
      });
    });
    ordre.sort(function (p, q) {
      var x = groupes[p].c, y = groupes[q].c;
      return JOURS.indexOf(x.jour) - JOURS.indexOf(y.jour) || minutes(x.debut) - minutes(y.debut) || txt(x.semaine).localeCompare(txt(y.semaine));
    });
    var semaines = { toutes: [], A: [], B: [] };
    ordre.forEach(function (k) { var s = groupes[k].c.semaine; (semaines[s] || semaines.toutes).push(groupes[k]); });
    var aDeux = semaines.A.length || semaines.B.length;
    function tableau(titre, liste) {
      if (!liste.length) return "";
      var h = "<h2>" + ech(titre) + "</h2><table><thead><tr><th>Jour</th><th>Horaire</th><th>Élève(s)</th><th>Établissement</th><th>Matière</th></tr></thead><tbody>";
      liste.forEach(function (g) {
        h += "<tr><td>" + ech(g.c.jour) + "</td><td>" + ech(g.c.debut) + " – " + ech(g.c.fin) + "</td><td>" + g.eleves.map(ech).join("<br>") + "</td><td>" + ech(g.etab) + "</td><td>" + ech(g.c.matiere || "") + "</td></tr>";
      });
      return h + "</tbody></table>";
    }
    var corps = tableau(aDeux ? "Toutes les semaines" : "Emploi du temps", semaines.toutes) + tableau("Semaine A", semaines.A) + tableau("Semaine B", semaines.B);
    if (!ordre.length) corps = "<p>Aucun créneau d'accompagnement pour le moment.</p>";
    return "<!DOCTYPE html>\n<html lang=\"fr\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
      + "<title>Emploi du temps — " + ech(a ? nomAesh(a) : "") + "</title><style>"
      + "body{font-family:Georgia,'Times New Roman',serif;color:#1d2a44;max-width:900px;margin:24px auto;padding:0 16px}"
      + "h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:22px 0 8px}p.sous{margin:0 0 12px;color:#555}"
      + "table{border-collapse:collapse;width:100%}th,td{border:1px solid #b9c3d6;padding:6px 9px;text-align:left;vertical-align:top;font-size:14px}"
      + "th{background:#eef2f9}@media print{body{margin:0}@page{size:A4 landscape;margin:12mm}}"
      + "</style></head><body><h1>" + ech(a ? nomAesh(a) : "") + "</h1><p class=\"sous\">Année scolaire " + ech(donnees.annee) + " · "
      + (v.numero ? "version n° " + v.numero : "proposition (brouillon)") + (v.dateEffet ? " · à partir du " + ech(dateFr(v.dateEffet)) : "")
      + " · édité le " + ech(dateFr(donnees.genereLe)) + "</p>" + corps + "</body></html>\n";
  }

  /* =============== récapitulatif et dossier =============== */
  function celluleCsv(s) { var t = txt(s); return /[;"\r\n]/.test(t) ? "\"" + t.replace(/"/g, "\"\"") + "\"" : t; }
  function recapitulatifCsv(donnees, aeshIds) {
    var l = ["AESH;Quotité;Élèves;Heures notifiées;Établissements;Créneaux"];
    aeshConcernees(donnees).filter(function (a) { return !aeshIds || aeshIds.indexOf(a.id) >= 0; }).forEach(function (a) {
      var aff = affectationAesh(donnees, a.id), etabs = {}, h = 0, n = 0;
      aff.eleves.forEach(function (e) { etabs[e.etablissement] = true; h += e.heures; n += e.creneaux.length; });
      l.push([nomAesh(a), a.quotite == null ? "" : a.quotite, aff.eleves.length, heuresTexte(h), Object.keys(etabs).sort().join(" / "), n].map(celluleCsv).join(";"));
    });
    return "﻿" + l.join("\r\n") + "\r\n";
  }
  function nomDossier(a) {
    var n = sansAccent(nomAesh(a)).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return n || "aesh";
  }
  /* fichiers du ZIP : [{nom, donnees}] ; aeshIds : les AESH retenues (toutes par défaut).
     options.changees : {aeshId: bool} pour le message ; options.signature : signature du mail. */
  function fichiersDossier(donnees, aeshIds, options) {
    options = options || {};
    var fichiers = [], pris = {};
    aeshConcernees(donnees).filter(function (a) { return !aeshIds || aeshIds.indexOf(a.id) >= 0; }).forEach(function (a) {
      var dossier = nomDossier(a), k = 2;
      while (pris[dossier]) dossier = nomDossier(a) + "-" + k++;
      pris[dossier] = true;
      var m = message(donnees, a.id, { changee: options.changees ? options.changees[a.id] : undefined, signature: options.signature });
      fichiers.push({ nom: dossier + "/message.txt", donnees: "Objet : " + m.objet + "\r\n" + (m.destinataire ? "À : " + m.destinataire + "\r\n" : "") + "\r\n" + m.corps + "\r\n" });
      fichiers.push({ nom: dossier + "/message.eml", donnees: eml(donnees, a.id, { changee: options.changees ? options.changees[a.id] : undefined, signature: options.signature }) });
      fichiers.push({ nom: dossier + "/emploi-du-temps.html", donnees: edtHtml(donnees, a.id) });
      fichiers.push({ nom: dossier + "/affectation.json", donnees: JSON.stringify(affectationAesh(donnees, a.id), null, 2) + "\n" });
    });
    fichiers.push({ nom: "recapitulatif.csv", donnees: recapitulatifCsv(donnees, aeshIds) });
    return fichiers;
  }

  return { affectationAesh: affectationAesh, signature: signature, aeshConcernees: aeshConcernees, etatsAesh: etatsAesh, message: message,
    eml: eml, edtHtml: edtHtml, recapitulatifCsv: recapitulatifCsv, fichiersDossier: fichiersDossier, nomDossier: nomDossier };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialDossier;
