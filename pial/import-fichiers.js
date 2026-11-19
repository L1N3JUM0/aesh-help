"use strict";

/* =====================================================================
   PialImport — lecture des fichiers élèves / AESH / emplois du temps
   (spec §2), sans bibliothèque.

   - CSV : encodage UTF-8 (avec ou sans BOM), sinon Windows-1252 (CSV
     enregistrés par Excel en français) ; séparateur « ; » ou « , »
     détecté automatiquement ; guillemets selon la RFC 4180.
   - XLSX : archive ZIP lue par PialZip, première feuille du classeur
     (trouvée via xl/workbook.xml et ses relations). Le XML est analysé
     par un petit lecteur interne plutôt que par DOMParser, pour que le
     même code soit testé dans le navigateur et sous Node. Les nombres
     sont rendus bruts : les dates (n° de série Excel) et les heures
     (fraction de jour) sont converties champ par champ à la validation.
   - Correspondance des colonnes par synonymes, validation ligne à ligne,
     aperçu (lignes valides, erreurs avec motif, doublons, collisions) et
     plan de fusion. Rien ici n'écrit en base.

   Dépend de PialModele (et de PialZip pour le XLSX).
   ===================================================================== */
var PialImport = (function () {

  var M = typeof PialModele !== "undefined" ? PialModele
    : (typeof require === "function" ? require("./modele.js") : null);

  function txt(s) { return String(s == null ? "" : s); }

  // liste ACCOMP de l'application AESH (index.html racine) : la colonne
  // Besoins des élèves utilise les mêmes libellés (spec §7.3)
  var ACCOMP = ["Reformulation des consignes", "Secrétaire, scripteur", "Aide à la mise en place du matériel",
    "Recentrage sur la tâche", "Aide à l'organisation", "Prise de notes", "Lecture à voix haute",
    "Aide à la manipulation", "Mise en confiance, encouragement", "Gestion des émotions",
    "Médiation avec l'enseignant", "Relations avec les autres élèves", "Aménagement des évaluations",
    "Aide aux déplacements", "Gestes du quotidien", "Mise en mots, verbalisation"];

  /* =============== décodage du texte =============== */
  // octets : Uint8Array -> {texte, encodage}
  function decoderTexte(octets) {
    var bom = octets.length >= 3 && octets[0] === 0xEF && octets[1] === 0xBB && octets[2] === 0xBF;
    var corps = bom ? octets.subarray(3) : octets;
    try {
      return { texte: new TextDecoder("utf-8", { fatal: true }).decode(corps), encodage: "utf-8" };
    } catch (e) {
      return { texte: new TextDecoder("windows-1252").decode(octets), encodage: "windows-1252" };
    }
  }

  /* =============== CSV =============== */
  // compte les séparateurs hors guillemets sur la première ligne non vide
  function detecterSeparateur(texte) {
    var ligne = "", dansGuillemets = false;
    for (var i = 0; i < texte.length; i++) {
      var c = texte[i];
      if (c === '"') dansGuillemets = !dansGuillemets;
      if (!dansGuillemets && (c === "\n" || c === "\r")) { if (ligne.trim()) break; ligne = ""; continue; }
      ligne += c;
    }
    var n = { ";": 0, ",": 0, "\t": 0 };
    dansGuillemets = false;
    for (var j = 0; j < ligne.length; j++) {
      if (ligne[j] === '"') dansGuillemets = !dansGuillemets;
      else if (!dansGuillemets && n[ligne[j]] != null) n[ligne[j]]++;
    }
    if (n["\t"] > n[";"] && n["\t"] > n[","]) return "\t";
    return n[","] > n[";"] ? "," : ";";
  }

  // texte -> tableau de lignes (tableaux de cellules) ; lignes vides ignorées
  function analyserCSV(texte, sep) {
    sep = sep || detecterSeparateur(texte);
    var lignes = [], ligne = [], cel = "", i = 0, guill = false;
    function finCellule() { ligne.push(cel); cel = ""; }
    function finLigne() {
      finCellule();
      if (ligne.some(function (c) { return c.trim() !== ""; })) lignes.push(ligne);
      ligne = [];
    }
    while (i < texte.length) {
      var c = texte[i];
      if (guill) {
        if (c === '"') {
          if (texte[i + 1] === '"') { cel += '"'; i++; } else guill = false;
        } else cel += c;
      } else if (c === '"' && cel.trim() === "") { cel = ""; guill = true; }
      else if (c === sep) finCellule();
      else if (c === "\r") { if (texte[i + 1] === "\n") i++; finLigne(); }
      else if (c === "\n") finLigne();
      else cel += c;
      i++;
    }
    if (cel !== "" || ligne.length) finLigne();
    return lignes;
  }

  /* =============== XLSX =============== */
  function decoderEntites(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e.charAt(0) === "#") return String.fromCodePoint(e.charAt(1) === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e];
    });
  }
  function attribut(balise, nom) {
    var m = new RegExp("\\s" + nom + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')").exec(balise);
    return m ? decoderEntites(m[2] != null ? m[2] : m[3]) : null;
  }
  // concatène le texte de toutes les balises <t> (texte enrichi compris)
  function texteDesT(xml) {
    var out = "", re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t(?:\s[^>]*)?\/>/g, m;
    while ((m = re.exec(xml))) out += decoderEntites(m[1] || "");
    return out;
  }
  function chaineXml(octets) { return new TextDecoder("utf-8").decode(octets); }
  function indiceColonne(ref) {
    var lettres = /^[A-Z]+/.exec(ref || "");
    if (!lettres) return -1;
    var n = 0;
    for (var i = 0; i < lettres[0].length; i++) n = n * 26 + (lettres[0].charCodeAt(i) - 64);
    return n - 1;
  }

  // résout le chemin de la première feuille d'après workbook.xml et ses relations
  function cheminPremiereFeuille(fichiers) {
    var wb = fichiers["xl/workbook.xml"] ? chaineXml(fichiers["xl/workbook.xml"]) : "";
    var rels = fichiers["xl/_rels/workbook.xml.rels"] ? chaineXml(fichiers["xl/_rels/workbook.xml.rels"]) : "";
    var feuille = /<(?:\w+:)?sheet\s[^>]*>/.exec(wb);
    var rid = feuille ? attribut(feuille[0], "r:id") : null;
    if (rid) {
      var re = /<Relationship\s[^>]*>/g, m;
      while ((m = re.exec(rels))) {
        if (attribut(m[0], "Id") === rid) {
          var cible = attribut(m[0], "Target") || "";
          return cible.charAt(0) === "/" ? cible.slice(1) : "xl/" + cible.replace(/^\.\//, "");
        }
      }
    }
    return "xl/worksheets/sheet1.xml";
  }

  // octets d'un .xlsx -> promesse de tableau de lignes (cellules en texte)
  function lireXlsx(octets, Zip) {
    return Zip.lire(octets, function (nom) { return /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^\/]+\.xml)$/.test(nom); })
      .then(function (fichiers) {
        var partagees = [];
        if (fichiers["xl/sharedStrings.xml"]) {
          var sst = chaineXml(fichiers["xl/sharedStrings.xml"]), re = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\/>/g, m;
          while ((m = re.exec(sst))) partagees.push(texteDesT(m[1] || ""));
        }
        var chemin = cheminPremiereFeuille(fichiers);
        if (!fichiers[chemin]) throw new Error("feuille-introuvable");
        var xml = chaineXml(fichiers[chemin]);
        var lignes = [], reLigne = /<(?:\w+:)?row(\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?row>/g, ml;
        while ((ml = reLigne.exec(xml))) {
          var cellules = [], reCel = /<(?:\w+:)?c(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g, mc, rang = 0;
          while ((mc = reCel.exec(ml[2]))) {
            var ent = "<c" + mc[1] + ">", interieur = mc[2] || "";
            var col = indiceColonne(attribut(ent, "r"));
            if (col < 0) col = rang;
            var type = attribut(ent, "t"), valeur = "";
            var v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(interieur);
            if (type === "s") valeur = v ? (partagees[parseInt(v[1], 10)] || "") : "";
            else if (type === "inlineStr") valeur = texteDesT(interieur);
            else if (type === "b") valeur = v && v[1] === "1" ? "oui" : "non";
            else valeur = v ? decoderEntites(v[1]) : "";
            while (cellules.length < col) cellules.push("");
            cellules[col] = valeur;
            rang = col + 1;
          }
          if (cellules.some(function (c) { return txt(c).trim() !== ""; })) lignes.push(cellules);
        }
        return lignes;
      });
  }

  // nomFichier + octets -> promesse de {lignes, format, encodage, separateur}
  function lireFichier(nomFichier, octets, Zip) {
    var estXlsx = /\.xlsx$/i.test(nomFichier) || (octets.length > 3 && octets[0] === 0x50 && octets[1] === 0x4B && octets[2] === 3 && octets[3] === 4);
    if (estXlsx) {
      if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("decompression-indisponible"));
      return lireXlsx(octets, Zip).then(function (lignes) { return { lignes: lignes, format: "xlsx", encodage: "", separateur: "" }; });
    }
    if (/\.xls$/i.test(nomFichier)) return Promise.reject(new Error("xls-ancien-format"));
    var d = decoderTexte(octets);
    var sep = detecterSeparateur(d.texte);
    return Promise.resolve({ lignes: analyserCSV(d.texte, sep), format: "csv", encodage: d.encodage, separateur: sep });
  }

  /* =============== types de fichiers, gabarits, synonymes =============== */
  // chaque champ : {cle, entete (gabarit), obligatoire, synonymes}
  var TYPES = {
    eleves: {
      libelle: "Élèves", fichier: "eleves.csv",
      champs: [
        { cle: "etablissement", entete: "Etablissement", obligatoire: true, synonymes: ["etablissement", "etab", "nom etablissement", "ecole", "college", "lycee"] },
        { cle: "classe", entete: "Classe", obligatoire: true, synonymes: ["classe", "division", "classe eleve"] },
        { cle: "prenom", entete: "Prenom", obligatoire: true, synonymes: ["prenom", "prenom eleve", "prenoms"] },
        { cle: "nom", entete: "Nom", obligatoire: true, synonymes: ["nom", "nom eleve", "nom de famille", "nom famille"] },
        { cle: "heuresInd", entete: "Heures_individuelles", synonymes: ["heures individuelles", "h individuelles", "heures ind", "individuel", "aesh i", "aide individuelle"] },
        { cle: "heuresMut", entete: "Heures_mutualisees", synonymes: ["heures mutualisees", "h mutualisees", "heures mut", "mutualise", "aesh m", "aide mutualisee"] },
        { cle: "recreation", entete: "Recreation", synonymes: ["recreation", "recreations", "recre"] },
        { cle: "meridienne", entete: "Pause_meridienne", synonymes: ["pause meridienne", "meridienne", "cantine", "dejeuner"] },
        { cle: "besoins", entete: "Besoins", synonymes: ["besoins", "besoin", "types d accompagnement", "accompagnement"] },
        { cle: "debutNotif", entete: "Debut_notification", synonymes: ["debut notification", "debut notif", "date debut", "debut"] },
        { cle: "finNotif", entete: "Fin_notification", synonymes: ["fin notification", "fin notif", "date fin", "fin", "echeance"] }
      ],
      exemples: [
        ["Collège Paul Gauthier", "5B", "Lucas", "Martin", "6", "", "non", "non", "Secrétaire, scripteur | Aide aux déplacements", "2026-09-01", "2027-07-04"],
        ["École Jean Moulin", "CE2", "Léa", "Dupont", "", "4", "oui", "non", "Reformulation des consignes", "2026-09-01", "2027-07-04"]
      ]
    },
    aesh: {
      libelle: "AESH", fichier: "aesh.csv",
      champs: [
        { cle: "nom", entete: "Nom", obligatoire: true, synonymes: ["nom", "nom aesh", "nom de famille"] },
        { cle: "prenom", entete: "Prenom", obligatoire: true, synonymes: ["prenom", "prenom aesh"] },
        { cle: "quotite", entete: "Quotite_hebdo", obligatoire: true, synonymes: ["quotite hebdo", "quotite", "heures hebdo", "heures semaine", "quotite hebdomadaire", "temps de travail"] },
        { cle: "email", entete: "Email", synonymes: ["email", "e mail", "mail", "courriel", "adresse mail", "adresse electronique"] },
        { cle: "etablissements", entete: "Etablissements", synonymes: ["etablissements", "etablissement", "etablissements possibles", "lieux"] },
        { cle: "indisponibilites", entete: "Indisponibilites", synonymes: ["indisponibilites", "indisponibilite", "indispos", "absences"] },
        { cle: "formations", entete: "Formations", synonymes: ["formations", "formation", "competences"] }
      ],
      exemples: [
        ["Durand", "Sophie", "24", "sophie.durand@exemple.invalid", "Collège Paul Gauthier | École Jean Moulin", "mer; ven-am", "TSA | LSF"],
        ["Martin", "Karim", "20", "", "", "", ""]
      ]
    },
    edt: {
      libelle: "Emplois du temps", fichier: "edt_eleves.csv",
      champs: [
        { cle: "etablissement", entete: "Etablissement", obligatoire: true, synonymes: ["etablissement", "etab", "nom etablissement"] },
        { cle: "classe", entete: "Classe", obligatoire: true, synonymes: ["classe", "division"] },
        { cle: "eleve", entete: "Eleve", obligatoire: true, synonymes: ["eleve", "nom eleve", "eleve nom", "prenom nom"] },
        { cle: "jour", entete: "Jour", obligatoire: true, synonymes: ["jour"] },
        { cle: "debut", entete: "Debut", obligatoire: true, synonymes: ["debut", "heure debut", "h debut", "de"] },
        { cle: "fin", entete: "Fin", obligatoire: true, synonymes: ["fin", "heure fin", "h fin", "a"] },
        { cle: "matiere", entete: "Matiere", obligatoire: true, synonymes: ["matiere", "discipline", "enseignement", "cours"] },
        { cle: "semaine", entete: "Semaine", synonymes: ["semaine", "alternance", "sem"] },
        { cle: "groupe", entete: "Groupe", synonymes: ["groupe", "groupes", "salle", "intitule"] },
        { cle: "priorite", entete: "Priorite", synonymes: ["priorite", "etat"] }
      ],
      exemples: [
        ["Collège Paul Gauthier", "5B", "Lucas M.", "lundi", "08:00", "08:55", "Mathématiques", "", "", "prioritaire"],
        ["Collège Paul Gauthier", "5B", "Lucas M.", "lundi", "09:00", "09:55", "Espagnol", "A", "ESP2", ""]
      ]
    }
  };

  // libellés affichés (les en-têtes des gabarits restent sans accents pour
  // faciliter la saisie et les tableurs)
  var LIBELLES = {
    Etablissement: "Établissement", Prenom: "Prénom", Heures_individuelles: "Heures individuelles",
    Heures_mutualisees: "Heures mutualisées", Recreation: "Récréation", Pause_meridienne: "Pause méridienne",
    Debut_notification: "Début de notification", Fin_notification: "Fin de notification",
    Quotite_hebdo: "Quotité hebdomadaire", Email: "E-mail", Etablissements: "Établissements possibles",
    Indisponibilites: "Indisponibilités", Eleve: "Élève", Debut: "Début", Matiere: "Matière", Priorite: "Priorité"
  };
  function libelleChamp(c) { return LIBELLES[c.entete] || c.entete; }

  function celluleCSV(v) {
    v = txt(v);
    return /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // gabarit CSV UTF-8 avec BOM, séparateur « ; » (s'ouvre dans Excel en français)
  function gabarit(type) {
    var t = TYPES[type];
    var lignes = [t.champs.map(function (c) { return c.entete; })].concat(t.exemples);
    return "\uFEFF" + lignes.map(function (l) { return l.map(celluleCSV).join(";"); }).join("\r\n") + "\r\n";
  }

  function normaliserEntete(h) { return M.normaliser(txt(h).replace(/[_\-.'’\/]/g, " ")); }

  // entetes : première ligne du fichier ; memorisee : {cleChamp: entête
  // normalisée} retenue lors d'un import précédent. Renvoie {cleChamp: indice}.
  function correspondanceAuto(type, entetes, memorisee) {
    var champs = TYPES[type].champs, norm = entetes.map(normaliserEntete), res = {}, pris = {};
    function prendre(cle, i) { res[cle] = i; pris[i] = true; }
    Object.keys(memorisee || {}).forEach(function (cle) {
      var i = norm.indexOf(memorisee[cle]);
      if (i > -1 && !pris[i] && champs.some(function (c) { return c.cle === cle; })) prendre(cle, i);
    });
    // 1) égalité exacte avec l'en-tête du gabarit ou un synonyme
    champs.forEach(function (c) {
      if (res[c.cle] != null) return;
      var cibles = [normaliserEntete(c.entete)].concat(c.synonymes);
      for (var i = 0; i < norm.length; i++) if (!pris[i] && cibles.indexOf(norm[i]) > -1) { prendre(c.cle, i); return; }
    });
    // 2) l'en-tête contient un synonyme comme suite de mots entiers
    champs.forEach(function (c) {
      if (res[c.cle] != null) return;
      for (var i = 0; i < norm.length; i++) {
        if (pris[i]) continue;
        var mots = " " + norm[i] + " ";
        if (c.synonymes.some(function (s) { return s.length > 2 && mots.indexOf(" " + s + " ") > -1; })) { prendre(c.cle, i); return; }
      }
    });
    return res;
  }
  // correspondance à mémoriser : {cleChamp: entête normalisée}
  function correspondanceAMemoriser(entetes, correspondance) {
    var out = {};
    Object.keys(correspondance).forEach(function (cle) {
      var i = correspondance[cle];
      if (i != null && i > -1 && entetes[i] != null) out[cle] = normaliserEntete(entetes[i]);
    });
    return out;
  }
  function champsManquants(type, correspondance) {
    return TYPES[type].champs.filter(function (c) { return c.obligatoire && (correspondance[c.cle] == null || correspondance[c.cle] < 0); })
      .map(libelleChamp);
  }

  /* =============== conversion des valeurs =============== */
  function nombre(v) {
    var s = txt(v).trim().replace(/\s*h(eures?)?$/i, "").replace(",", ".");
    if (s === "") return 0;
    return /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }
  function booleen(v) {
    var n = M.normaliser(v);
    if (n === "" || n === "non" || n === "n" || n === "0" || n === "faux" || n === "no" || n === "false") return false;
    if (n === "oui" || n === "o" || n === "x" || n === "1" || n === "vrai" || n === "yes" || n === "true") return true;
    return null;
  }
  function serieVersIso(n) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  // "2026-09-01", "01/09/2026", "1/9/26" ou n° de série Excel -> ISO ; "" si vide ; null si illisible
  function dateIso(v) {
    var s = txt(v).trim();
    if (!s) return "";
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2}|\d{4})$/.exec(s);
    if (m) return (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
    if (/^\d+(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) return serieVersIso(+s);
    return null;
  }
  // "08:00", "8h", ou fraction de jour Excel (0.333…) -> "HH:MM" ; "" si illisible
  function heure(v) {
    var s = txt(v).trim();
    if (/^0?\.\d+$/.test(s) || s === "0") {
      var min = Math.round(parseFloat(s) * 24 * 60);
      return M.hhmm(min);
    }
    var hms = /^(\d{1,2}:\d{2}):\d{2}$/.exec(s); // "08:00:00" (export tableur)
    return M.heureNormalisee(hms ? hms[1] : s);
  }
  function liste(v, separateurs) {
    return txt(v).split(separateurs || /\|/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function besoinConnu(b) {
    var n = M.normaliser(b);
    for (var i = 0; i < ACCOMP.length; i++) if (M.normaliser(ACCOMP[i]) === n) return ACCOMP[i];
    return null;
  }
  function indisponibiliteValide(s) {
    var p = M.normaliser(s).split("-");
    return !!M.jourNormalise(p[0]) && (p.length === 1 || (p.length === 2 && (p[1] === "am" || p[1] === "pm")));
  }
  function emailPlausible(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

  /* =============== validation et aperçu =============== */
  function valeurs(ligne, correspondance) {
    var o = {};
    Object.keys(correspondance).forEach(function (cle) {
      var i = correspondance[cle];
      o[cle] = (i != null && i > -1) ? txt(ligne[i]).trim() : "";
    });
    return o;
  }
  function estLigneExemple(type, brut) {
    var n = brut.map(function (c) { return M.normaliser(c); }).join("|");
    return TYPES[type].exemples.some(function (ex) { return ex.map(function (c) { return M.normaliser(c); }).join("|") === n; });
  }

  function validerEleve(v, options) {
    var erreurs = [], avert = [];
    TYPES.eleves.champs.forEach(function (c) { if (c.obligatoire && !v[c.cle]) erreurs.push("« " + libelleChamp(c) + " » manquant"); });
    var ind = nombre(v.heuresInd), mut = nombre(v.heuresMut);
    if (isNaN(ind)) erreurs.push("heures individuelles illisibles (« " + v.heuresInd + " »)");
    if (isNaN(mut)) erreurs.push("heures mutualisées illisibles (« " + v.heuresMut + " »)");
    if (!isNaN(ind) && !isNaN(mut) && !(ind > 0) && !(mut > 0)) erreurs.push("aucune heure notifiée");
    // oui / non, ou « prioritaire » (= oui, créneaux prioritaires par défaut, spec §5.2)
    var prioRecre = M.normaliser(v.recreation) === "prioritaire", prioMerid = M.normaliser(v.meridienne) === "prioritaire";
    var recre = prioRecre || booleen(v.recreation), merid = prioMerid || booleen(v.meridienne);
    if (recre === null) erreurs.push("récréation : oui, non ou prioritaire attendu");
    if (merid === null) erreurs.push("pause méridienne : oui, non ou prioritaire attendu");
    var debut = dateIso(v.debutNotif), fin = dateIso(v.finNotif);
    if (debut === null) erreurs.push("date de début illisible");
    if (fin === null) erreurs.push("date de fin illisible");
    var besoins = [];
    liste(v.besoins).forEach(function (b) {
      var k = besoinConnu(b);
      if (k) besoins.push(k); else avert.push("besoin hors liste ignoré : « " + b + " »");
    });
    if (erreurs.length) return { erreurs: erreurs };
    var court = M.nomCourt(v.prenom, v.nom), cle = M.cleEleve(court, v.classe, v.etablissement);
    var objet = {
      id: M.idEleve(options.annee, cle), cle: cle, annee: options.annee, nomCourt: court,
      classe: v.classe.replace(/\s+/g, " "), etablissement: M.idEtablissement(v.etablissement), etablissementNom: v.etablissement.replace(/\s+/g, " "),
      heuresInd: ind || 0, heuresMut: mut || 0, recreation: !!recre, meridienne: !!merid,
      besoins: besoins, debutNotif: debut || "", finNotif: fin || ""
      // le nom de famille n'est jamais conservé (spec §3) : seul nomCourt l'est
    };
    // comme la colonne Priorite de l'EDT : seul « prioritaire » est transmis,
    // un « oui » ne remet pas à « normal » un état choisi dans l'application
    if (prioRecre || prioMerid) {
      objet.etatsPeriscolaires = {};
      if (prioRecre) objet.etatsPeriscolaires.recreation = "prioritaire";
      if (prioMerid) objet.etatsPeriscolaires.meridienne = "prioritaire";
    }
    return { avertissements: avert, objet: objet };
  }
  function validerAesh(v, options) {
    var erreurs = [], avert = [];
    TYPES.aesh.champs.forEach(function (c) { if (c.obligatoire && !v[c.cle]) erreurs.push("« " + libelleChamp(c) + " » manquant"); });
    var q = nombre(v.quotite);
    if (v.quotite && (isNaN(q) || !(q > 0) || q > 45)) erreurs.push("quotité illisible (« " + v.quotite + " »)");
    if (v.email && !emailPlausible(v.email)) erreurs.push("adresse e-mail invalide");
    var indispos = liste(v.indisponibilites, /[;,|]/);
    indispos.forEach(function (s) { if (!indisponibiliteValide(s)) erreurs.push("indisponibilité illisible : « " + s + " » (ex. : mer, ven-pm)"); });
    if (erreurs.length) return { erreurs: erreurs };
    var etabs = liste(v.etablissements);
    return {
      avertissements: avert,
      objet: {
        id: M.idAesh(v.nom, v.prenom), annee: options.annee, nom: v.nom.replace(/\s+/g, " "), prenom: v.prenom.replace(/\s+/g, " "),
        quotite: q, email: v.email,
        etablissements: etabs.map(M.idEtablissement), etablissementsNoms: etabs,
        indisponibilites: indispos.map(function (s) { var p = M.normaliser(s).split("-"); return M.jourNormalise(p[0]).slice(0, 3) + (p[1] ? "-" + p[1] : ""); }),
        formations: liste(v.formations), ignorerIndispos: false, alias: []
      }
    };
  }
  function validerCours(v, options) {
    var erreurs = [], avert = [];
    TYPES.edt.champs.forEach(function (c) { if (c.obligatoire && !v[c.cle]) erreurs.push("« " + libelleChamp(c) + " » manquant"); });
    var jour = M.jourNormalise(v.jour), debut = heure(v.debut), fin = heure(v.fin);
    if (v.jour && !jour) erreurs.push("jour illisible (« " + v.jour + " »)");
    if (v.debut && !debut) erreurs.push("heure de début illisible");
    if (v.fin && !fin) erreurs.push("heure de fin illisible");
    if (debut && fin && M.minutes(fin) <= M.minutes(debut)) erreurs.push("la fin précède le début");
    var sem = M.normaliser(v.semaine);
    if (sem && ["a", "b", "semaine a", "semaine b", "toutes", "ab", "a/b"].indexOf(sem) < 0) erreurs.push("semaine : A, B ou vide attendu");
    var prio = M.normaliser(v.priorite);
    var etat = !prio || prio === "normal" ? "normal" : (prio === "prioritaire" || prio === "p" ? "prioritaire" : (prio === "exclu" || prio === "e" ? "exclu" : null));
    if (!etat) erreurs.push("priorité : prioritaire, exclu ou vide attendu");
    var cle = v.eleve && v.classe && v.etablissement ? M.cleEleve(v.eleve, v.classe, v.etablissement) : "";
    if (cle && options.elevesConnus && !options.elevesConnus[cle]) {
      // « Lucas Martin » écrit en entier : on le réduit à « Lucas M. » (le nom n'est pas conservé)
      var mots = v.eleve.replace(/\s+/g, " ").trim().split(" ");
      if (mots.length > 1 && !/\.$/.test(mots[mots.length - 1])) {
        var abrege = M.cleEleve(M.nomCourt(mots.slice(0, -1).join(" "), mots[mots.length - 1]), v.classe, v.etablissement);
        if (options.elevesConnus[abrege]) cle = abrege;
      }
    }
    if (cle && options.elevesConnus && !options.elevesConnus[cle]) erreurs.push("élève inconnu (« " + v.eleve + " » en " + v.classe + ") : importez d'abord le fichier des élèves");
    if (erreurs.length) return { erreurs: erreurs };
    var semaine = M.semaineNormalisee(v.semaine) === "toutes" ? "" : M.semaineNormalisee(v.semaine);
    var etabId = M.idEtablissement(v.etablissement);
    var eleveId = M.idEleve(options.annee, cle);
    return {
      avertissements: avert,
      objet: {
        id: [eleveId, jour, debut, fin, semaine, M.normaliser(v.matiere), M.normaliser(v.groupe)].join("|"),
        annee: options.annee, eleveId: eleveId, eleveCle: cle, etablissement: etabId, etablissementNom: v.etablissement.replace(/\s+/g, " "),
        classe: v.classe.replace(/\s+/g, " "), jour: jour, debut: debut, fin: fin, matiere: v.matiere, semaine: semaine, groupe: v.groupe, etat: etat
      }
    };
  }
  var VALIDATEURS = { eleves: validerEleve, aesh: validerAesh, edt: validerCours };
  var CLE_IDENTITE = { eleves: "cle", aesh: "id", edt: "id" };

  /* lignes : tableau de lignes SANS l'en-tête. options : {annee,
     elevesConnus:{cle:true} (EDT seulement), premiereLigne (numéro de la
     première ligne de données dans le fichier, 2 par défaut)}.
     Renvoie {valides:[objet], erreurs:[{ligne, motifs}], doublons:[{ligne,
     identique}], collisions:[{cle, lignes}], avertissements:[{ligne, motif}],
     exemples:[ligne], etablissements:[nom]}. */
  function apercu(type, lignes, correspondance, options) {
    options = options || {};
    var premiere = options.premiereLigne || 2;
    var res = { valides: [], erreurs: [], doublons: [], collisions: [], avertissements: [], exemples: [], etablissements: [] };
    var parCle = {}, etabsVus = {};
    lignes.forEach(function (brut, i) {
      var num = premiere + i;
      if (estLigneExemple(type, brut)) { res.exemples.push(num); return; }
      var v = valeurs(brut, correspondance);
      var r = VALIDATEURS[type](v, options);
      if (r.erreurs) { res.erreurs.push({ ligne: num, motifs: r.erreurs }); return; }
      (r.avertissements || []).forEach(function (a) { res.avertissements.push({ ligne: num, motif: a }); });
      var cle = r.objet[CLE_IDENTITE[type]];
      (parCle[cle] = parCle[cle] || []).push({ ligne: num, objet: r.objet, empreinte: JSON.stringify(r.objet) });
      [v.etablissement].concat(type === "aesh" ? liste(v.etablissements) : []).forEach(function (e) {
        if (e && !etabsVus[M.idEtablissement(e)]) { etabsVus[M.idEtablissement(e)] = true; res.etablissements.push(e.replace(/\s+/g, " ")); }
      });
    });
    Object.keys(parCle).forEach(function (cle) {
      var groupe = parCle[cle];
      var distincts = {};
      groupe.forEach(function (g) { distincts[g.empreinte] = true; });
      if (Object.keys(distincts).length > 1 && type !== "edt") {
        // §3 : même clé pour des lignes différentes = collision, lignes bloquées
        res.collisions.push({ cle: cle, lignes: groupe.map(function (g) { return g.ligne; }) });
        return;
      }
      res.valides.push(groupe[0].objet);
      groupe.slice(1).forEach(function (g) { res.doublons.push({ ligne: g.ligne, premiere: groupe[0].ligne }); });
    });
    return res;
  }

  /* =============== plan de fusion (réimport) =============== */
  // existants / nouveaux : objets avec la propriété cleId ; mode "maj" ou
  // "remplacer". Renvoie {ajouts, modifies, inchanges, supprimes} (listes).
  function planFusion(existants, nouveaux, cleId, mode) {
    var parId = {};
    existants.forEach(function (e) { parId[e[cleId]] = e; });
    var vus = {}, plan = { ajouts: [], modifies: [], inchanges: [], supprimes: [] };
    nouveaux.forEach(function (n) {
      vus[n[cleId]] = true;
      var e = parId[n[cleId]];
      if (!e) plan.ajouts.push(n);
      else if (JSON.stringify(sansChampsInternes(e, n)) === JSON.stringify(n)) plan.inchanges.push(n);
      else plan.modifies.push(n);
    });
    if (mode === "remplacer") existants.forEach(function (e) { if (!vus[e[cleId]]) plan.supprimes.push(e); });
    return plan;
  }
  // ne compare que les champs fournis par l'import (les champs saisis dans
  // l'application, ex. ignorerIndispos ou alias, ne comptent pas comme une modification)
  function sansChampsInternes(existant, modele) {
    var o = {};
    Object.keys(modele).forEach(function (k) { o[k] = existant[k]; });
    return o;
  }

  return {
    ACCOMP: ACCOMP, TYPES: TYPES,
    decoderTexte: decoderTexte, detecterSeparateur: detecterSeparateur, analyserCSV: analyserCSV,
    lireXlsx: lireXlsx, lireFichier: lireFichier, gabarit: gabarit, libelleChamp: libelleChamp,
    normaliserEntete: normaliserEntete, correspondanceAuto: correspondanceAuto,
    correspondanceAMemoriser: correspondanceAMemoriser, champsManquants: champsManquants,
    nombre: nombre, booleen: booleen, dateIso: dateIso, heure: heure,
    apercu: apercu, planFusion: planFusion
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialImport;
