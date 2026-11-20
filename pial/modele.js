"use strict";

/* =====================================================================
   PialModele — règles de calcul du module Affectations (spec §3, §4).

   Uniquement des fonctions pures : aucune lecture du DOM, d'IndexedDB ni
   de l'horloge (la date du jour est toujours passée en paramètre). Elles
   sont couvertes par pial/tests.js, exécuté dans le navigateur
   (pial/tests.html) et en ligne de commande (outils/tests-node.js).

   Vocabulaire des objets manipulés :
   - établissement : {id, nom, type, alternance, recreations:[{debut,fin}],
       meridienne:{debut,fin}, pauseRepas:{debut,fin}, joursOuvres:[...]}
   - élève : {id (interne, « el-… »), cle, annee, parcours, nomCourt, classe,
       etablissement (id), heuresInd, heuresMut, recreation, meridienne,
       etatsPeriscolaires, besoins, finNotif...}
   - AESH : {id (interne, « ae-… »), cle (nom|prenom), nom, prenom, quotite,
       etablissements:[id] (vide = tous),
       indisponibilites:["mer","ven-pm"], ignorerIndispos, formations}
   - cours : {id, eleveId, etablissement, classe, jour, debut, fin,
       matiere, semaine:"A"|"B"|"", groupe, etat}
   - créneau : {etab, jour, debut, fin, semaine:"A"|"B"|"toutes"}
   - affectation : {id, version, aeshId, creneau, creneauCle, modalite:
       "individuel"|"mutualise"|"periscolaire", periscolaire:
       "recreation"|"meridienne" (temps périscolaire seulement),
       eleves:[id élève], epinglee, origine, raisons, alertes}
   - contexte : {etablissements:{id:etab}, eleves:[], aesh:[], cours:[],
       affectations:[], reglages:{...}} — voir contexte() ci-dessous.
   ===================================================================== */
var PialModele = (function () {

  var EPS = 1e-9;
  var JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  var ABREV_JOURS = { lun: "lundi", mar: "mardi", mer: "mercredi", jeu: "jeudi", ven: "vendredi", sam: "samedi" };

  // Spécialités des AESH (formations déclarées, §7.3) et besoins
  // fonctionnels qu'elles couvrent. Table modifiable dans Réglages. Pas de
  // diagnostic côté élève : le moteur rapproche ces besoins de ceux des
  // élèves (liste ACCOMP).
  var SPECIALITES_DEFAUT = [
    { nom: "TSA", besoins: ["Structuration par supports visuels (pictogrammes, emploi du temps imagé)", "Préparation des transitions et des changements",
      "Gestion des émotions", "Recentrage sur la tâche", "Relations avec les autres élèves", "Reformulation des consignes"] },
    { nom: "Troubles visuels", besoins: ["Adaptation des supports visuels", "Description orale des documents", "Lecture à voix haute",
      "Aide à l'utilisation des outils numériques", "Aide aux déplacements", "Prise de notes"] },
    { nom: "Braille", besoins: ["Adaptation des supports visuels", "Aide à l'utilisation des outils numériques", "Aménagement des évaluations"] },
    { nom: "Fauteuil / mobilité", besoins: ["Aide aux déplacements", "Aide à l'installation et aux transferts", "Gestes du quotidien",
      "Aide à la manipulation", "Aide à la mise en place du matériel", "Secrétaire, scripteur"] },
    { nom: "LSF", besoins: ["Communication en LSF ou LfPC", "Accès aux informations orales", "Prise de notes", "Reformulation des consignes"] },
    { nom: "Troubles auditifs", besoins: ["Accès aux informations orales", "Prise de notes", "Reformulation des consignes", "Médiation avec l'enseignant"] },
    { nom: "Troubles des apprentissages (dys)", besoins: ["Lecture à voix haute", "Secrétaire, scripteur", "Prise de notes", "Aménagement des évaluations",
      "Adaptation des supports visuels", "Aide à l'utilisation des outils numériques", "Aide à l'organisation"] },
    { nom: "Attention, concentration", besoins: ["Recentrage sur la tâche", "Aide à l'organisation", "Gestion de la fatigue et des pauses",
      "Mise en confiance, encouragement"] },
    { nom: "Gestion des comportements", besoins: ["Gestion des émotions", "Médiation avec l'enseignant", "Relations avec les autres élèves",
      "Mise en confiance, encouragement"] }
  ];

  var REGLAGES_DEFAUT = {
    dureeReelle: false,          // §4.1 « Compter la durée réelle »
    respecterIndispos: true,     // §4.4 contrainte 7
    gererPeriscolaire: false,    // §5.2 « Gérer les temps périscolaires »
    pauseRepasMin: 45,           // §4.4 contrainte 6, en minutes
    seuilJourneePause: 360,      // journée de plus de 6 h de présence
    deplacementMin: 60,          // §4.4 contrainte 4
    seuilSousUtilisation: 0.9,   // §4.3
    ecartMax: 120,               // §5.3.5 écart maximal entre deux accompagnements (minutes)
    journeeMin: 120,             // §5.3.5 journée courte : moins de 2 h de présence
    budgetOrdres: 2,             // §16 secondes de recherche de « Proposer » (au moins 4 ordres de départage)
    specialites: SPECIALITES_DEFAUT, // §16 table spécialité → besoins fonctionnels
    joursAlerteNotification: 30  // §6
  };

  /* =============== texte, clés =============== */
  function txt(s) { return String(s == null ? "" : s); }

  // casse, accents et espaces ignorés
  function normaliser(s) {
    return txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // §3 : le nom de famille est réduit à son initiale, sauf s'il se termine
  // déjà par un point (abréviation choisie pour lever une collision).
  function abregerNom(nom) {
    var n = txt(nom).replace(/\s+/g, " ").trim();
    if (!n) return "";
    if (n.charAt(n.length - 1) === ".") return n;
    return n.charAt(0).toUpperCase() + ".";
  }
  function nomCourt(prenom, nom) {
    return (txt(prenom).replace(/\s+/g, " ").trim() + " " + abregerNom(nom)).trim();
  }
  function cleEleve(nomCourtEleve, classe, etablissement) {
    return normaliser(nomCourtEleve) + "|" + normaliser(classe) + "|" + normaliser(etablissement);
  }
  function idEleve(annee, cle) { return annee + "|" + cle; }
  function idAesh(nom, prenom) { return normaliser(nom) + "|" + normaliser(prenom); }
  function idEtablissement(nom) { return normaliser(nom); }

  /* =============== identifiants internes (schéma v4, spec §3) ===============
     Depuis le schéma v4, un élève et une AESH ont un identifiant interne
     généré à la création et jamais modifié (« el-… », « ae-… », sans « | »).
     Les clés restent des index uniques : annee|cle pour un élève
     (idEleve), nom|prenom normalisés pour une AESH (champ cle, idAesh).
     Elles servent à l'import, au rapprochement des rapports et à la
     détection des collisions ; changer de classe, d'établissement ou de nom
     ne modifie que des champs. parcours : identifiant commun aux fiches
     d'un même élève d'une année sur l'autre (phase 4) ; vaut l'identifiant
     de la fiche tant qu'aucun rapprochement n'est fait. */
  var compteurIdentifiants = 0;
  function nouvelIdentifiant(prefixe) {
    compteurIdentifiants++;
    return prefixe + "-" + Date.now().toString(36) + compteurIdentifiants.toString(36) + "-" + Math.floor(Math.random() * 2176782336).toString(36);
  }
  function estIdentifiantInterne(id) { return /^(el|ae)-[0-9a-z-]+$/.test(txt(id)); }
  function cleAesh(a) { return idAesh(a.nom, a.prenom); }
  // clé unique d'une fiche élève, avec l'année (ancienne forme de l'identifiant)
  function cleFicheEleve(e) { return idEleve(e.annee, e.cle); }
  function idCours(c) { return [c.eleveId, c.jour, c.debut, c.fin, c.semaine || "", normaliser(c.matiere), normaliser(c.groupe)].join("|"); }
  function copie(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }
  function possede(carte, k) { return Object.prototype.hasOwnProperty.call(carte, k); }
  // identifiant d'une affectation du moteur : [vN|]mo|<AESH>|<créneau>.
  // L'AESH en fait partie : on la traduit avec la carte (identifiant interne
  // sans « | », ou clé nom|prenom avec un « | »).
  function idAffectationTraduit(id, carte) {
    var m = /^((?:v\d+\|)?mo\|)(.*)$/.exec(txt(id));
    if (!m) return id;
    var p = m[2].split("|");
    for (var n = 1; n <= 2 && n < p.length; n++) {
      var k = p.slice(0, n).join("|");
      if (possede(carte, k)) return m[1] + carte[k] + "|" + p.slice(n).join("|");
    }
    return id;
  }
  // table de passage identifiant interne <-> clé, pour les élèves et AESH donnés
  function tableCles(eleves, aesh) {
    var t = { versCle: {}, versId: {} };
    (eleves || []).forEach(function (e) { var k = cleFicheEleve(e); t.versCle[e.id] = k; t.versId[k] = e.id; });
    (aesh || []).forEach(function (a) { var k = a.cle || cleAesh(a); t.versCle[a.id] = k; t.versId[k] = a.id; });
    return t;
  }
  // traduit en profondeur les chaînes (et clés d'objet) qui sont des identifiants
  function traduireIds(x, carte) {
    if (typeof x === "string") return possede(carte, x) ? carte[x] : idAffectationTraduit(x, carte);
    if (Array.isArray(x)) return x.map(function (v) { return traduireIds(v, carte); });
    if (x && typeof x === "object") {
      var o = {};
      Object.keys(x).forEach(function (k) { o[possede(carte, k) ? carte[k] : k] = traduireIds(x[k], carte); });
      return o;
    }
    return x;
  }
  /* données du moteur avec les clés à la place des identifiants internes :
     le moteur départage les égalités par l'ordre des identifiants (spec
     §5.3.5) ; lui donner les clés garde cet ordre (et les résultats)
     indépendant des identifiants internes, identique au schéma v3.
     Renvoie {donnees, versId} : versId sert à traduire le résultat
     (traduireIds(resultat, versId)). */
  function donneesParCles(d) {
    var t = tableCles(d.eleves, d.aesh), vc = t.versCle;
    function id(x) { return possede(vc, x) ? vc[x] : x; }
    var out = copie(d);
    out.eleves = (d.eleves || []).map(function (e) { var c = copie(e); c.id = id(e.id); delete c.parcours; return c; });
    out.aesh = (d.aesh || []).map(function (a) {
      var c = copie(a); c.id = id(a.id); delete c.cle;
      if (a.elevesExclus) c.elevesExclus = a.elevesExclus.map(id);
      return c;
    });
    out.cours = (d.cours || []).map(function (co) { var c = copie(co); c.eleveId = id(co.eleveId); c.id = idCours(c); return c; });
    out.affectations = (d.affectations || []).map(function (a) {
      var c = copie(a); c.aeshId = id(a.aeshId); c.eleves = (a.eleves || []).map(id); c.id = idAffectationTraduit(a.id, vc);
      return c;
    });
    return { donnees: out, versId: t.versId, versCle: vc };
  }
  /* migration v3 -> v4 (IndexedDB, et restauration d'une sauvegarde
     pial-suivi/2). d : {eleves, aesh, cours, affectations, versions}.
     Chaque élève et chaque AESH reçoit un identifiant interne ; toutes les
     références suivent (cours, affectations du brouillon et des versions,
     élèves à ne pas affecter, libellés des versions). Une référence à un
     élève ou une AESH supprimé reste telle quelle (la version garde son
     libellé). Idempotente : une donnée déjà migrée n'est pas modifiée.
     Renvoie les mêmes listes, plus carte {ancien id: nouvel id}. */
  function migrerV4(d) {
    var carte = {};
    var eleves = (d.eleves || []).map(function (e) {
      var c = JSON.parse(JSON.stringify(e));
      if (!estIdentifiantInterne(c.id)) { c.id = nouvelIdentifiant("el"); carte[e.id] = c.id; }
      if (!c.parcours) c.parcours = c.id;
      return c;
    });
    var aesh = (d.aesh || []).map(function (a) {
      var c = JSON.parse(JSON.stringify(a));
      if (!estIdentifiantInterne(c.id)) { c.id = nouvelIdentifiant("ae"); carte[a.id] = c.id; }
      if (!c.cle) c.cle = cleAesh(c);
      return c;
    });
    function id(x) { return possede(carte, x) ? carte[x] : x; }
    aesh.forEach(function (a) { if (a.elevesExclus) a.elevesExclus = a.elevesExclus.map(id); });
    var cours = (d.cours || []).map(function (co) {
      var c = JSON.parse(JSON.stringify(co));
      c.eleveId = id(c.eleveId); c.id = idCours(c);
      return c;
    });
    var affectations = (d.affectations || []).map(function (a) {
      var c = JSON.parse(JSON.stringify(a));
      c.aeshId = id(c.aeshId); c.eleves = (c.eleves || []).map(id); c.id = idAffectationTraduit(c.id, carte);
      return c;
    });
    var versions = (d.versions || []).map(function (v) {
      var c = JSON.parse(JSON.stringify(v));
      if (c.libelles) ["eleves", "aesh"].forEach(function (k) {
        var l = c.libelles[k] || {}, n = {};
        Object.keys(l).forEach(function (ancien) { n[id(ancien)] = l[ancien]; });
        c.libelles[k] = n;
      });
      return c;
    });
    return { eleves: eleves, aesh: aesh, cours: cours, affectations: affectations, versions: versions, carte: carte };
  }
  /* import : les objets validés portent l'ancienne forme d'identifiant
     (annee|cle, nom|prenom ; cours : élève sous cette forme). Une fiche
     existante de même clé garde son identifiant (et son parcours), une
     nouvelle en reçoit un. type : "eleves" | "aesh" | "edt" ; existants :
     fiches du même type en base ; eleves : élèves en base (pour l'EDT). */
  function attribuerIdentifiants(type, objets, existants, eleves) {
    if (type === "edt") {
      var versId = tableCles(eleves || existants, []).versId;
      return objets.map(function (o) {
        var c = copie(o);
        if (possede(versId, o.eleveId)) c.eleveId = versId[o.eleveId];
        c.id = idCours(c);
        return c;
      });
    }
    var parCle = {};
    (existants || []).forEach(function (e) { parCle[type === "aesh" ? (e.cle || cleAesh(e)) : cleFicheEleve(e)] = e; });
    return objets.map(function (o) {
      var c = copie(o), k = type === "aesh" ? cleAesh(o) : cleFicheEleve(o), ex = parCle[k];
      c.id = ex ? ex.id : nouvelIdentifiant(type === "aesh" ? "ae" : "el");
      if (type === "aesh") c.cle = k;
      else c.parcours = ex ? (ex.parcours || ex.id) : c.id;
      return c;
    });
  }

  /* =============== fiches : identité, collisions, classes, archivage (§17) =============== */
  // « Lucas M. » -> {prenom: "Lucas", nom: "M."} (l'initiale terminée par un point)
  function decomposerNomCourt(nc) {
    var m = /^(.*\S)\s+(\S+\.)$/.exec(txt(nc).replace(/\s+/g, " ").trim());
    return m ? { prenom: m[1], nom: m[2] } : { prenom: txt(nc).trim(), nom: "" };
  }
  /* fiche élève après un changement d'identité (prénom, nom, classe,
     établissement) : seuls des champs changent, l'identifiant reste.
     changements : {prenom?, nom?, classe?, etablissement? (id),
     etablissementNom?} ; nom réduit à l'initiale (§3). */
  function eleveModifie(e, changements) {
    var c = JSON.parse(JSON.stringify(e)), d = decomposerNomCourt(e.nomCourt), ch = changements || {};
    if ("prenom" in ch || "nom" in ch) c.nomCourt = nomCourt("prenom" in ch ? ch.prenom : d.prenom, "nom" in ch ? ch.nom : d.nom);
    if ("classe" in ch) c.classe = txt(ch.classe).replace(/\s+/g, " ").trim();
    if ("etablissement" in ch) { c.etablissement = ch.etablissement; c.etablissementNom = ch.etablissementNom || ch.etablissement; }
    c.cle = cleEleve(c.nomCourt, c.classe, c.etablissement);
    return c;
  }
  function aeshModifiee(a, changements) {
    var c = JSON.parse(JSON.stringify(a)), ch = changements || {};
    if ("nom" in ch) c.nom = txt(ch.nom).replace(/\s+/g, " ").trim();
    if ("prenom" in ch) c.prenom = txt(ch.prenom).replace(/\s+/g, " ").trim();
    c.cle = cleAesh(c);
    return c;
  }
  // autre fiche qui a déjà la clé de « fiche » (même année pour un élève),
  // archivées comprises ; null s'il n'y en a pas
  function collisionEleve(eleves, fiche) {
    var k = cleFicheEleve(fiche);
    return (eleves || []).filter(function (e) { return e.id !== fiche.id && cleFicheEleve(e) === k; })[0] || null;
  }
  function collisionAesh(aesh, fiche) {
    var k = cleAesh(fiche);
    return (aesh || []).filter(function (a) { return a.id !== fiche.id && (a.cle || cleAesh(a)) === k; })[0] || null;
  }
  // les cours d'un élève suivent sa classe et son établissement
  function coursSuivantEleve(cours, e) {
    var out = [];
    (cours || []).forEach(function (c) {
      if (c.eleveId !== e.id) return;
      var x = copie(c);
      x.eleveCle = e.cle; x.classe = e.classe; x.etablissement = e.etablissement;
      if (e.etablissementNom) x.etablissementNom = e.etablissementNom;
      if (x.eleveCle !== c.eleveCle || x.classe !== c.classe || x.etablissement !== c.etablissement || x.etablissementNom !== c.etablissementNom) out.push(x);
    });
    return out;
  }

  // ordre des classes : niveau (NIVEAUX), puis ordre naturel (6A, 6B, 6C10)
  function comparerClasses(a, b) {
    return (NIVEAUX.indexOf(niveauClasse(a)) - NIVEAUX.indexOf(niveauClasse(b)))
      || txt(a).localeCompare(txt(b), "fr", { numeric: true, sensitivity: "base" });
  }
  /* référentiel des classes d'une année : {etablissement (id): [classe]}.
     enregistre : table modifiée dans Réglages (prioritaire, garde son
     orthographe) ; complétée par les classes des élèves et des cours.
     Classes comparées sans casse ni espaces superflus, triées. */
  function referentielClasses(enregistre, eleves, cours) {
    var out = {}, vus = {};
    function ajouter(etab, classe) {
      var c = txt(classe).replace(/\s+/g, " ").trim(), k = etab + "|" + normaliser(c);
      if (!etab || !c || vus[k]) return;
      vus[k] = true;
      (out[etab] = out[etab] || []).push(c);
    }
    Object.keys(enregistre || {}).forEach(function (etab) { (enregistre[etab] || []).forEach(function (c) { ajouter(etab, c); }); });
    (eleves || []).forEach(function (e) { ajouter(e.etablissement, e.classe); });
    (cours || []).forEach(function (c) { ajouter(c.etablissement, c.classe); });
    Object.keys(out).forEach(function (etab) { out[etab].sort(comparerClasses); });
    return out;
  }

  // archivé (§17) : sorti des listes actives et des propositions, gardé dans
  // l'historique et les versions. archiveLe : date ISO (aujourd'hui ou passée).
  function estArchive(x) { return !!(x && x.archiveLe); }
  function actifs(liste) { return (liste || []).filter(function (x) { return !estArchive(x); }); }
  /* données du moteur sans les fiches archivées : leurs cours et leurs
     affectations sortent avec elles (un élève archivé quitte un groupe
     mutualisé, qui reste aux autres). */
  function donneesActives(d) {
    var arch = {};
    (d.eleves || []).concat(d.aesh || []).forEach(function (x) { if (estArchive(x)) arch[x.id] = true; });
    if (!Object.keys(arch).length) return d;
    var out = copie(d);
    out.eleves = actifs(d.eleves); out.aesh = actifs(d.aesh);
    out.cours = (d.cours || []).filter(function (c) { return !arch[c.eleveId]; });
    out.affectations = [];
    (d.affectations || []).forEach(function (a) {
      if (arch[a.aeshId]) return;
      var restants = (a.eleves || []).filter(function (id) { return !arch[id]; });
      if (!restants.length) return;
      if (restants.length === a.eleves.length) { out.affectations.push(a); return; }
      var c = copie(a); c.eleves = restants; out.affectations.push(c);
    });
    return out;
  }
  /* effets de l'archivage ou de la suppression d'élèves / d'AESH sur les
     affectations (ids : identifiants ; type : "eleves" | "aesh").
     brouillon : affectations version 0 ; versions : copies validées.
     Renvoie {supprimees: [id], modifiees: [affectation], mutualisees
     (groupes quittés), versions: [numéro] (versions où ces fiches
     figurent), cours (nombre, élèves seulement), exclusions (nombre
     d'AESH dont la liste « ne pas affecter » les cite)}. */
  function effetsRetrait(type, ids, d) {
    var cible = {}, r = { supprimees: [], modifiees: [], mutualisees: 0, versions: [], cours: 0, exclusions: 0 };
    ids.forEach(function (id) { cible[id] = true; });
    var vers = {};
    (d.affectations || []).forEach(function (a) {
      var touche = type === "aesh" ? cible[a.aeshId] : (a.eleves || []).some(function (id) { return cible[id]; });
      if (!touche) return;
      if (a.version) { vers[a.version] = true; return; }
      if (type === "aesh") { r.supprimees.push(a.id); return; }
      var restants = a.eleves.filter(function (id) { return !cible[id]; });
      if (!restants.length) r.supprimees.push(a.id);
      else { var c = JSON.parse(JSON.stringify(a)); c.eleves = restants; r.modifiees.push(c); r.mutualisees++; }
    });
    r.versions = Object.keys(vers).map(Number).sort(function (a, b) { return a - b; });
    if (type === "eleves") {
      r.cours = (d.cours || []).filter(function (c) { return cible[c.eleveId]; }).length;
      r.exclusions = (d.aesh || []).filter(function (a) { return (a.elevesExclus || []).some(function (id) { return cible[id]; }); }).length;
    }
    return r;
  }

  // renvoie les clés présentes plusieurs fois : {cle: [indices]}
  function collisions(cles) {
    var vus = {}, out = {};
    cles.forEach(function (c, i) { (vus[c] = vus[c] || []).push(i); });
    Object.keys(vus).forEach(function (c) { if (vus[c].length > 1) out[c] = vus[c]; });
    return out;
  }

  /* =============== années, niveaux, établissements =============== */
  function anneeScolaire(iso) {
    var y = parseInt(txt(iso).slice(0, 4), 10), m = parseInt(txt(iso).slice(5, 7), 10);
    if (!y || !m) return "";
    var debut = m >= 8 ? y : y - 1;
    return debut + "-" + (debut + 1);
  }

  var NIVEAUX = ["PS", "MS", "GS", "CP", "CE1", "CE2", "CM1", "CM2", "6e", "5e", "4e", "3e", "2de", "1re", "Tle", "Autre"];
  function niveauClasse(classe) {
    var c = normaliser(classe).replace(/\s/g, "");
    var m = c.match(/^(ps|ms|gs|cp|ce1|ce2|cm1|cm2)/);
    if (m) return m[1].toUpperCase();
    m = c.match(/^([3-6])(?:e(?:me)?)?(?:[^0-9]|$)/);
    if (m) return m[1] + "e";
    if (/^(2|2nde|2de|seconde)(?:[^0-9]|$)/.test(c)) return "2de";
    if (/^(1|1re|1ere|premiere)(?:[^0-9]|$)/.test(c)) return "1re";
    if (/^(tle|terminale|t[0-9]|tg|tstmg|tsti|tst2s)/.test(c)) return "Tle";
    return "Autre";
  }

  function typeEtablissement(nom) {
    var n = normaliser(nom);
    if (/^(ecole|groupe scolaire|maternelle|elementaire)/.test(n) || /\becole\b/.test(n)) return "ecole";
    if (/\blycee\b/.test(n)) return "lycee";
    return "college";
  }

  // §2.5 : paramètres créés au premier import qui mentionne l'établissement
  function etablissementParDefaut(nom) {
    var type = typeEtablissement(nom);
    var ecole = type === "ecole";
    return {
      id: idEtablissement(nom), nom: txt(nom).trim(), type: type,
      alternance: type === "college",
      recreations: ecole ? [{ debut: "10:15", fin: "10:30" }, { debut: "15:15", fin: "15:30" }]
        : [{ debut: "10:00", fin: "10:15" }, { debut: "15:00", fin: "15:15" }],
      meridienne: ecole ? { debut: "11:30", fin: "13:30" } : { debut: "12:00", fin: "13:30" },
      pauseRepas: { debut: "11:30", fin: "14:00" },
      joursOuvres: ecole ? ["lundi", "mardi", "jeudi", "vendredi"] : ["lundi", "mardi", "mercredi", "jeudi", "vendredi"]
    };
  }

  /* =============== jours, heures, durées =============== */
  function jourNormalise(j) {
    var n = normaliser(j).replace(/\.$/, "");
    if (JOURS.indexOf(n) > -1) return n;
    var complet = ABREV_JOURS[n.slice(0, 3)];
    return complet && complet.indexOf(n) === 0 ? complet : ""; // "mer", "merc", "mercredi"
  }
  // "08:00", "8h00", "8h", "8:5" -> minutes depuis minuit ; NaN si illisible
  function minutes(h) {
    var m = txt(h).trim().toLowerCase().match(/^(\d{1,2})\s*[:h]\s*(\d{0,2})$/);
    if (!m) return NaN;
    var hh = parseInt(m[1], 10), mm = m[2] ? parseInt(m[2], 10) : 0;
    if (hh > 23 || mm > 59) return NaN;
    return hh * 60 + mm;
  }
  function hhmm(min) { return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }
  function heureNormalisee(h) { var m = minutes(h); return isNaN(m) ? "" : hhmm(m); }

  // §4.1 : un cours compte pour sa durée arrondie à l'heure la plus proche,
  // au minimum 1 h ; le temps périscolaire compte toujours pour sa durée réelle.
  function dureeComptee(debut, fin, periscolaire, reglages) {
    var d = minutes(fin) - minutes(debut);
    if (!(d > 0)) return 0;
    if (periscolaire || (reglages && reglages.dureeReelle)) return d / 60;
    return Math.max(1, Math.round(d / 60));
  }

  /* =============== semaines A/B, créneaux =============== */
  function semaineNormalisee(s) {
    var n = normaliser(s);
    if (n === "a" || n === "semaine a") return "A";
    if (n === "b" || n === "semaine b") return "B";
    return "toutes";
  }
  // semaines effectives d'un créneau ; établissement sans alternance : A = B
  function semainesDe(semaine, etab) {
    if (etab && etab.alternance === false) return ["A", "B"];
    var s = semaineNormalisee(semaine);
    return s === "toutes" ? ["A", "B"] : [s];
  }
  function creneauCle(c) { return [c.etab, c.jour, c.debut, c.fin, c.semaine || "toutes"].join("|"); }
  function semainesCommunes(c1, c2, ctx) {
    var s1 = semainesDe(c1.semaine, ctx && ctx.etablissements[c1.etab]);
    var s2 = semainesDe(c2.semaine, ctx && ctx.etablissements[c2.etab]);
    return s1.filter(function (s) { return s2.indexOf(s) > -1; });
  }
  function chevauchent(c1, c2, ctx) {
    if (c1.jour !== c2.jour) return false;
    if (!semainesCommunes(c1, c2, ctx).length) return false;
    return minutes(c1.debut) < minutes(c2.fin) && minutes(c2.debut) < minutes(c1.fin);
  }

  /* =============== contexte =============== */
  function contexte(donnees) {
    donnees = donnees || {};
    var reglages = {};
    Object.keys(REGLAGES_DEFAUT).forEach(function (k) { reglages[k] = REGLAGES_DEFAUT[k]; });
    Object.keys(donnees.reglages || {}).forEach(function (k) { reglages[k] = donnees.reglages[k]; });
    var etabs = {};
    (donnees.etablissements || []).forEach(function (e) { etabs[e.id] = e; });
    // temps périscolaires non gérés : leurs affectations restent en base
    // mais sont ignorées partout (grille, charge, alertes, moteur)
    var affectations = donnees.affectations || [];
    if (!reglages.gererPeriscolaire) affectations = affectations.filter(function (a) { return a.modalite !== "periscolaire"; });
    var ctx = {
      etablissements: etabs, eleves: donnees.eleves || [], aesh: donnees.aesh || [],
      cours: donnees.cours || [], affectations: affectations, reglages: reglages,
      _eleves: {}, _aesh: {}, _coursParEleve: {}, _affParAesh: {}, _affParEleve: {}
    };
    ctx.eleves.forEach(function (e) { ctx._eleves[e.id] = e; });
    ctx.aesh.forEach(function (a) { ctx._aesh[a.id] = a; });
    ctx.cours.forEach(function (c) { (ctx._coursParEleve[c.eleveId] = ctx._coursParEleve[c.eleveId] || []).push(c); });
    ctx.affectations.forEach(function (a) {
      (ctx._affParAesh[a.aeshId] = ctx._affParAesh[a.aeshId] || []).push(a);
      (a.eleves || []).forEach(function (id) { (ctx._affParEleve[id] = ctx._affParEleve[id] || []).push(a); });
    });
    return ctx;
  }
  function etabDe(ctx, id) { return ctx.etablissements[id] || etablissementParDefaut(id); }

  // durée d'une affectation pour une semaine donnée (0 si elle n'a pas lieu cette semaine-là)
  function dureeAffectation(aff, semaine, ctx) {
    if (semainesDe(aff.creneau.semaine, ctx.etablissements[aff.creneau.etab]).indexOf(semaine) < 0) return 0;
    return dureeComptee(aff.creneau.debut, aff.creneau.fin, aff.modalite === "periscolaire", ctx.reglages);
  }

  /* =============== §4.2 couverture d'un élève =============== */
  var GRAVITE_COUVERTURE = { sous: 3, partiel: 2, sur: 1, couvert: 0 };
  function etatCouverture(notifie, couvert) {
    var ecart = (notifie || 0) - (couvert || 0);
    if (ecart >= 1 - EPS) return "sous";
    if (ecart > EPS) return "partiel";
    if (ecart < -EPS) return "sur";
    return "couvert";
  }
  function couvertureEleve(eleve, ctx) {
    var r = { ind: { A: 0, B: 0 }, mut: { A: 0, B: 0 }, peri: { A: 0, B: 0 } };
    (ctx._affParEleve[eleve.id] || []).forEach(function (aff) {
      var cible = aff.modalite === "individuel" ? r.ind : (aff.modalite === "mutualise" ? r.mut : r.peri);
      cible.A += dureeAffectation(aff, "A", ctx);
      cible.B += dureeAffectation(aff, "B", ctx);
    });
    ["ind", "mut", "peri"].forEach(function (k) { r[k].moy = (r[k].A + r[k].B) / 2; });
    r.ind.notifie = eleve.heuresInd || 0;
    r.mut.notifie = eleve.heuresMut || 0;
    r.ind.etat = etatCouverture(r.ind.notifie, r.ind.moy);
    r.mut.etat = etatCouverture(r.mut.notifie, r.mut.moy);
    r.etat = GRAVITE_COUVERTURE[r.ind.etat] >= GRAVITE_COUVERTURE[r.mut.etat] ? r.ind.etat : r.mut.etat;
    return r;
  }

  /* =============== §4.3 charge d'une AESH =============== */
  function etatCharge(A, B, quotite, reglages) {
    var seuil = (reglages && reglages.seuilSousUtilisation) || REGLAGES_DEFAUT.seuilSousUtilisation;
    if (A > quotite + EPS || B > quotite + EPS) return "depassement";
    var moy = (A + B) / 2;
    if (quotite > 0 && moy >= quotite * seuil - EPS) return "complete";
    return "sous";
  }
  function chargeAesh(aesh, ctx) {
    var A = 0, B = 0;
    (ctx._affParAesh[aesh.id] || []).forEach(function (aff) {
      A += dureeAffectation(aff, "A", ctx);
      B += dureeAffectation(aff, "B", ctx);
    });
    return { A: A, B: B, moy: (A + B) / 2, quotite: aesh.quotite || 0, etat: etatCharge(A, B, aesh.quotite || 0, ctx.reglages) };
  }

  /* =============== fiche élève (spec §16) =============== */
  // Champs de notification modifiables dans la fiche ; une modification est
  // notée dans eleve.modifiesAppli[champ] pour être protégée au réimport.
  var CHAMPS_NOTIFICATION = ["heuresInd", "heuresMut", "debutNotif", "finNotif", "besoins"];
  // même mécanisme pour la fiche AESH (§16) : champs aussi présents dans le
  // fichier des AESH, et champs propres à l'application
  var CHAMPS_FICHE_AESH = ["quotite", "etablissements", "indisponibilites", "formations"];
  var PROPRES = { eleves: ["commentaire", "etatsMatieres"], aesh: ["voeux", "elevesExclus", "ignorerIndispos", "alias"] };
  // champs modifiés dans l'application dont la valeur du fichier diffère
  function conflitsReimport(existant, nouveau) {
    var m = (existant && existant.modifiesAppli) || {};
    return CHAMPS_NOTIFICATION.concat(CHAMPS_FICHE_AESH).filter(function (k) {
      return m[k] && k in nouveau && JSON.stringify(existant[k]) !== JSON.stringify(nouveau[k]);
    });
  }
  // Élève (ou AESH, type "aesh") réimporté : valeurs du fichier, sauf les
  // champs propres à l'application (commentaire, états par matière ; vœux,
  // élèves exclus…) et, si garderAppli, les champs modifiés dans
  // l'application (sinon le fichier l'emporte et la marque « modifié » tombe).
  function fusionEleve(existant, nouveau, garderAppli, type) {
    var o = {};
    Object.keys(nouveau).forEach(function (k) { o[k] = nouveau[k]; });
    if (!existant) return o;
    PROPRES[type || "eleves"].forEach(function (k) { if (k in existant) o[k] = existant[k]; });
    var m = existant.modifiesAppli || {}, garde = {};
    Object.keys(m).forEach(function (k) {
      if (!m[k]) return;
      if (garderAppli || !(k in nouveau)) { o[k] = existant[k]; garde[k] = true; }
    });
    if (Object.keys(garde).length) o.modifiesAppli = garde;
    return o;
  }
  // matière sans casse ni accents : clé de eleve.etatsMatieres
  function cleMatiere(matiere) { return normaliser(matiere); }
  // état d'un cours importé : celui du fichier s'il n'est pas « normal » ;
  // sinon celui déjà choisi dans l'application pour ce cours, puis celui de
  // sa matière (fiche élève), puis « normal »
  function etatCoursImporte(nouveau, existant, eleve) {
    if (nouveau.etat && nouveau.etat !== "normal") return nouveau.etat;
    if (existant && existant.etat) return existant.etat;
    var m = eleve && eleve.etatsMatieres && eleve.etatsMatieres[cleMatiere(nouveau.matiere)];
    return m || "normal";
  }
  // matières d'un élève, avec le nombre de cours par état
  function matieresEleve(eleve, cours) {
    var par = {}, ordre = [];
    cours.forEach(function (c) {
      if (c.eleveId !== eleve.id) return;
      var k = cleMatiere(c.matiere);
      if (!par[k]) { par[k] = { cle: k, libelle: c.matiere, nb: 0, etats: { prioritaire: 0, normal: 0, exclu: 0 } }; ordre.push(k); }
      par[k].nb++;
      par[k].etats[c.etat || "normal"]++;
    });
    return ordre.sort(function (a, b) { return par[a].libelle.localeCompare(par[b].libelle, "fr"); }).map(function (k) {
      var x = par[k];
      x.etatMatiere = (eleve.etatsMatieres || {})[k] || "normal";
      x.uniforme = ["prioritaire", "normal", "exclu"].filter(function (s) { return x.etats[s] === x.nb; })[0] || null;
      return x;
    });
  }

  /* =============== trous et journées courtes (§5.3.5) =============== */
  // intervalles : [[début, fin]] en minutes, pour une journée et une
  // semaine. Renvoie la présence (minutes, chevauchements fusionnés), les
  // écarts entre deux accompagnements et le nombre de trous (écart >
  // ecartMax). Une journée sans créneau n'a ni trou ni présence.
  function mesureJournee(intervalles, ecartMax) {
    var l = intervalles.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var presence = 0, ecarts = [], fin = null, debut = null;
    l.forEach(function (x) {
      if (fin === null) { debut = x[0]; fin = x[1]; return; }
      if (x[0] > fin) { presence += fin - debut; ecarts.push(x[0] - fin); debut = x[0]; fin = x[1]; }
      else fin = Math.max(fin, x[1]);
    });
    if (fin !== null) presence += fin - debut;
    var trous = ecarts.filter(function (e) { return e > ecartMax; }).length;
    return { presence: presence, ecarts: ecarts, trous: trous };
  }
  // par semaine (A, B) : jours de présence, trous > ecartMax et journées
  // courtes (présence < journeeMin), avec le détail par jour
  function journeesAesh(aesh, ctx) {
    var r = ctx.reglages, out = {};
    ["A", "B"].forEach(function (s) {
      var parJour = {};
      (ctx._affParAesh[aesh.id] || []).forEach(function (aff) {
        if (semainesDe(aff.creneau.semaine, ctx.etablissements[aff.creneau.etab]).indexOf(s) < 0) return;
        (parJour[aff.creneau.jour] = parJour[aff.creneau.jour] || []).push([minutes(aff.creneau.debut), minutes(aff.creneau.fin)]);
      });
      var res = { jours: {}, trous: 0, courtes: 0 };
      JOURS.forEach(function (j) {
        if (!parJour[j]) return;
        var m = mesureJournee(parJour[j], r.ecartMax);
        m.courte = m.presence < r.journeeMin;
        res.jours[j] = m;
        res.trous += m.trous;
        if (m.courte) res.courtes++;
      });
      out[s] = res;
    });
    return out;
  }

  /* =============== §4.4 contraintes dures =============== */
  // cours d'un élève qui a lieu exactement sur ce créneau (au moins une semaine commune)
  function coursSurCreneau(eleveId, c, ctx) {
    return (ctx._coursParEleve[eleveId] || []).filter(function (co) {
      return co.etablissement === c.etab && co.jour === c.jour && co.debut === c.debut && co.fin === c.fin
        && semainesCommunes({ etab: co.etablissement, semaine: co.semaine }, c, ctx).length;
    });
  }

  // §2.4 / contrainte 3 : deux cours sont « le même cours » pour la mutualisation
  function memeCours(c1, c2) {
    return c1.etablissement === c2.etablissement && normaliser(c1.classe) === normaliser(c2.classe)
      && c1.jour === c2.jour && c1.debut === c2.debut && c1.fin === c2.fin
      && normaliser(c1.matiere) === normaliser(c2.matiere) && normaliser(c1.groupe) === normaliser(c2.groupe);
  }
  function peutMutualiser(eleve1, cours1, eleve2, cours2) {
    if (!(eleve1.heuresMut > 0) || !(eleve2.heuresMut > 0)) return false;
    return memeCours(cours1, cours2);
  }

  function violation(code, message) { return { code: code, message: message }; }
  function libelleAff(aff, ctx) {
    var noms = (aff.eleves || []).map(function (id) { var e = ctx._eleves[id]; return e ? e.nomCourt + " (" + e.classe + ")" : id; });
    return noms.join(", ") || "créneau";
  }

  function demiJourneeTouchee(c, demi) {
    var midi = 12 * 60;
    return demi === "am" ? minutes(c.debut) < midi : minutes(c.fin) > midi;
  }
  // contrainte 7, indisponibilités : "mer" (journée), "ven-am", "ven-pm"
  function indisponibilite(aesh, c) {
    var liste = aesh.indisponibilites || [];
    for (var i = 0; i < liste.length; i++) {
      var p = normaliser(liste[i]).split("-");
      var j = jourNormalise(p[0]);
      if (j !== c.jour) continue;
      if (!p[1] || demiJourneeTouchee(c, p[1])) return liste[i];
    }
    return "";
  }

  /* =============== fiche AESH : exclusions, vœux, spécialités (§16) =============== */
  // élèves de l'affectation que cette AESH ne doit pas accompagner
  function elevesExclusDe(aesh, eleveIds) {
    var ex = (aesh && aesh.elevesExclus) || [];
    return (eleveIds || []).filter(function (id) { return ex.indexOf(id) > -1; });
  }
  // vœux touchés par un créneau : demi-journées ou journées à éviter
  // (même codes que les indisponibilités : « mer », « ven-pm ») et plages
  // horaires à éviter ({jour: "" = tous les jours, debut, fin}).
  // Renvoie les libellés (« mercredi après-midi », « 12:00–14:00 »).
  function voeuxTouches(aesh, c) {
    var v = (aesh && aesh.voeux) || {}, out = [];
    (v.demiJournees || []).forEach(function (code) {
      var p = normaliser(code).split("-");
      if (jourNormalise(p[0]) !== c.jour) return;
      if (!p[1] || demiJourneeTouchee(c, p[1])) out.push(c.jour + (p[1] === "am" ? " matin" : (p[1] === "pm" ? " après-midi" : "")));
    });
    var d = minutes(c.debut), f = minutes(c.fin);
    (v.plages || []).forEach(function (pl) {
      if (pl.jour && pl.jour !== c.jour) return;
      if (minutes(pl.debut) < f && d < minutes(pl.fin)) out.push((pl.jour ? pl.jour + " " : "") + pl.debut + "–" + pl.fin);
    });
    return out;
  }
  // besoins fonctionnels couverts par les spécialités d'une AESH (champ
  // formations), selon la table ; les spécialités hors table sont sans effet
  function besoinsCouverts(aesh, table) {
    var parNom = {}, out = {};
    (table || []).forEach(function (s) { parNom[normaliser(s.nom)] = s; });
    ((aesh && aesh.formations) || []).forEach(function (f) {
      var s = parNom[normaliser(f)];
      if (s) (s.besoins || []).forEach(function (b) { out[b] = true; });
    });
    return out;
  }
  // spécialités d'une AESH absentes de la table
  function specialitesInconnues(aesh, table) {
    var noms = (table || []).map(function (s) { return normaliser(s.nom); });
    return ((aesh && aesh.formations) || []).filter(function (f) { return noms.indexOf(normaliser(f)) < 0; });
  }

  // vérifie la pause repas d'une AESH pour un jour et une semaine donnés,
  // sur la liste (triée) de ses créneaux de ce jour.
  function verifierPauseRepas(liste, ctx) {
    var r = ctx.reglages;
    var presence = 0;
    liste.forEach(function (a) { presence += minutes(a.creneau.fin) - minutes(a.creneau.debut); });
    if (presence <= r.seuilJourneePause) return null;
    var avecMeridienne = liste.some(function (a) { return a.modalite === "periscolaire" && a.periscolaire === "meridienne"; });
    var plage = etabDe(ctx, liste[0].creneau.etab).pauseRepas || { debut: "11:30", fin: "14:00" };
    var debutJour = minutes(liste[0].creneau.debut), finJour = 0;
    liste.forEach(function (a) { finJour = Math.max(finJour, minutes(a.creneau.fin)); });
    // intervalles libres dans la journée
    var libres = [], curseur = debutJour;
    liste.forEach(function (a) {
      var d = minutes(a.creneau.debut);
      if (d > curseur) libres.push([curseur, d]);
      curseur = Math.max(curseur, minutes(a.creneau.fin));
    });
    var pD = minutes(plage.debut), pF = minutes(plage.fin);
    var dansPlage = libres.concat([[0, debutJour], [finJour, 24 * 60]]).some(function (l) {
      return Math.min(l[1], pF) - Math.max(l[0], pD) >= r.pauseRepasMin;
    });
    if (dansPlage) return null;
    if (avecMeridienne) {
      var ailleurs = libres.some(function (l) { return l[1] - l[0] >= r.pauseRepasMin; });
      if (ailleurs) return { niveau: "info", message: "Pause repas hors de la plage " + plage.debut + "–" + plage.fin + " (accompagnement de la pause méridienne)." };
    }
    return { niveau: "erreur", message: "Pas de pause repas de " + r.pauseRepasMin + " min entre " + plage.debut + " et " + plage.fin + " (journée de plus de " + (r.seuilJourneePause / 60) + " h)." };
  }

  /* Vérifie une affectation au regard des 7 contraintes dures, en tenant
     compte de toutes les autres affectations du contexte. Renvoie une
     liste de {code, message, niveau}. Le code donne la contrainte :
     chevauchement (1), individuel (2), mutualisation (3), deplacement (4),
     quotite (5), pause (6), indisponibilite / etablissement (7), plus
     presence / exclu / notification (cohérence avec les données élève). */
  function verifierAffectation(aff, ctx) {
    var out = [];
    var c = aff.creneau;
    var aesh = ctx._aesh[aff.aeshId];
    var autres = (ctx._affParAesh[aff.aeshId] || []).filter(function (a) { return a.id !== aff.id; });
    var eleves = (aff.eleves || []).map(function (id) { return ctx._eleves[id]; }).filter(Boolean);

    // 1. chevauchement
    autres.forEach(function (a) {
      if (chevauchent(a.creneau, c, ctx)) {
        out.push(violation("chevauchement", "Déjà affectée " + a.creneau.debut + "–" + a.creneau.fin + " : " + libelleAff(a, ctx) + "."));
      }
    });

    // 2. individuel exclusif
    if (aff.modalite === "individuel" && (aff.eleves || []).length !== 1) {
      out.push(violation("individuel", "Un créneau individuel n'accompagne qu'un seul élève."));
    }

    // 3. mutualisation, et cohérence avec l'emploi du temps des élèves
    if (aff.modalite === "periscolaire") {
      eleves.forEach(function (e) {
        if (e.etablissement !== c.etab) out.push(violation("mutualisation", e.nomCourt + " n'est pas dans cet établissement."));
        var concerne = aff.periscolaire === "meridienne" ? e.meridienne : e.recreation;
        if (!concerne) out.push(violation("notification", e.nomCourt + " n'est pas notifié(e) pour ce temps périscolaire."));
        else if (etatPeriscolaire(e, aff.periscolaire, c) === "exclu") out.push(violation("exclu", "Temps périscolaire exclu pour " + e.nomCourt + "."));
      });
    } else {
      var coursParEleve = eleves.map(function (e) {
        var cs = coursSurCreneau(e.id, c, ctx);
        if (!cs.length) out.push(violation("presence", e.nomCourt + " n'a pas cours sur ce créneau."));
        else {
          var semCours = [];
          cs.forEach(function (co) {
            semainesDe(co.semaine, ctx.etablissements[co.etablissement]).forEach(function (s) { if (semCours.indexOf(s) < 0) semCours.push(s); });
          });
          var manquantes = semainesDe(c.semaine, ctx.etablissements[c.etab]).filter(function (s) { return semCours.indexOf(s) < 0; });
          if (manquantes.length) out.push(violation("presence", e.nomCourt + " n'a pas cours en semaine " + manquantes.join(", ") + " sur ce créneau."));
          if (cs.every(function (co) { return co.etat === "exclu"; })) out.push(violation("exclu", "Cours exclu pour " + e.nomCourt + "."));
        }
        return cs[0] || null;
      });
      if (aff.modalite === "individuel") {
        eleves.forEach(function (e) { if (!(e.heuresInd > 0)) out.push(violation("notification", e.nomCourt + " n'a pas d'heures individuelles notifiées.")); });
      }
      if (aff.modalite === "mutualise") {
        eleves.forEach(function (e) { if (!(e.heuresMut > 0)) out.push(violation("mutualisation", e.nomCourt + " n'est pas notifié(e) en mutualisé.")); });
        for (var i = 1; i < eleves.length; i++) {
          if (coursParEleve[0] && coursParEleve[i] && !memeCours(coursParEleve[0], coursParEleve[i])) {
            out.push(violation("mutualisation", eleves[0].nomCourt + " et " + eleves[i].nomCourt + " ne suivent pas le même cours (classe, matière ou groupe)."));
          }
        }
      }
    }

    // 4. changement d'établissement
    autres.forEach(function (a) {
      if (a.creneau.etab === c.etab || a.creneau.jour !== c.jour || !semainesCommunes(a.creneau, c, ctx).length) return;
      if (chevauchent(a.creneau, c, ctx)) return; // déjà signalé
      var ecart = minutes(c.debut) >= minutes(a.creneau.fin)
        ? minutes(c.debut) - minutes(a.creneau.fin)
        : minutes(a.creneau.debut) - minutes(c.fin);
      if (ecart < ctx.reglages.deplacementMin) {
        out.push(violation("deplacement", "Déplacement < " + (ctx.reglages.deplacementMin / 60) + " h depuis " + etabDe(ctx, a.creneau.etab).nom + " (" + a.creneau.debut + "–" + a.creneau.fin + ")."));
      }
    });

    if (aesh) {
      // 5. quotité
      var ch = chargeAesh(aesh, ctx);
      ["A", "B"].forEach(function (s) {
        if (dureeAffectation(aff, s, ctx) > 0 && ch[s] > ch.quotite + EPS) {
          out.push(violation("quotite", "Quotité dépassée en semaine " + s + " (" + arrondi(ch[s]) + " h / " + ch.quotite + " h)."));
        }
      });

      // 6. pause repas
      ["A", "B"].forEach(function (s) {
        if (semainesDe(c.semaine, ctx.etablissements[c.etab]).indexOf(s) < 0) return;
        var jour = (ctx._affParAesh[aff.aeshId] || []).filter(function (a) {
          return a.creneau.jour === c.jour && semainesDe(a.creneau.semaine, ctx.etablissements[a.creneau.etab]).indexOf(s) > -1;
        });
        if (jour.indexOf(aff) < 0) jour.push(aff);
        jour.sort(function (x, y) { return minutes(x.creneau.debut) - minutes(y.creneau.debut); });
        var p = verifierPauseRepas(jour, ctx);
        if (p && !out.some(function (v) { return v.code === "pause"; })) {
          out.push({ code: "pause", niveau: p.niveau, message: p.message });
        }
      });

      // élèves à ne pas affecter à cette AESH : toujours appliqué
      elevesExclusDe(aesh, aff.eleves).forEach(function (id) {
        var e = ctx._eleves[id];
        out.push(violation("exclusion", "Ne pas affecter à " + (e ? e.nomCourt : id) + " (fiche de l'AESH)."));
      });
      // vœux : simple information (pénalité dans le score)
      var vx = voeuxTouches(aesh, c);
      if (vx.length) out.push({ code: "voeu", niveau: "info", message: "Vœu de l'AESH non respecté : éviter " + vx.join(", ") + "." });

      // 7. indisponibilités et établissements possibles
      if (ctx.reglages.respecterIndispos && !aesh.ignorerIndispos) {
        var ind = indisponibilite(aesh, c);
        if (ind) out.push(violation("indisponibilite", "Indisponible (" + ind + ")."));
        if ((aesh.etablissements || []).length && aesh.etablissements.indexOf(c.etab) < 0) {
          out.push(violation("etablissement", "N'intervient pas dans cet établissement."));
        }
      }
    }
    out.forEach(function (v) { if (!v.niveau) v.niveau = "erreur"; });
    return out;
  }

  function arrondi(x) { return Math.round(x * 100) / 100; }

  /* Motifs pour lesquels une AESH ne peut pas prendre ce créneau (menu de
     la grille élève). On simule l'affectation dans un contexte où elle
     remplace celle qu'on modifie éventuellement (remplaceId). Renvoie []
     si l'AESH est disponible. */
  function motifsIndisponibilite(aeshId, candidat, ctx, remplaceId) {
    return violationsSimulees(aeshId, candidat, ctx, remplaceId).filter(function (v) {
      return ["exclusion", "chevauchement", "deplacement", "quotite", "pause", "indisponibilite", "etablissement"].indexOf(v.code) > -1;
    });
  }
  // Toutes les violations de niveau « erreur » si l'AESH prenait ce
  // candidat (glisser-déposer : créneau valide ou non, avec le motif)
  function violationsSimulees(aeshId, candidat, ctx, remplaceId) {
    var simulee = {
      id: "__simulation__", aeshId: aeshId, creneau: candidat.creneau, modalite: candidat.modalite,
      periscolaire: candidat.periscolaire, eleves: candidat.eleves
    };
    var affs = ctx.affectations.filter(function (a) { return a.id !== remplaceId; }).concat([simulee]);
    var ctx2 = contexte({
      etablissements: Object.keys(ctx.etablissements).map(function (k) { return ctx.etablissements[k]; }),
      eleves: ctx.eleves, aesh: ctx.aesh, cours: ctx.cours, affectations: affs, reglages: ctx.reglages
    });
    return verifierAffectation(simulee, ctx2).filter(function (v) { return v.niveau === "erreur"; });
  }

  /* =============== besoins périscolaires (§5.2) =============== */
  // état prioritaire / normal / exclu d'un créneau périscolaire, stocké dans
  // l'élève : clé précise « type|jour|debut », sinon état par défaut du type
  function cleEtatPeriscolaire(type, c) { return type + "|" + c.jour + "|" + c.debut; }
  function etatPeriscolaire(eleve, type, c) {
    var m = eleve.etatsPeriscolaires || {};
    return m[cleEtatPeriscolaire(type, c)] || m[type] || "normal";
  }
  // créneaux de récréation / pause méridienne pour lesquels l'élève doit
  // être accompagné : les jours où il a cours dans la demi-journée concernée
  // (le matin et l'après-midi pour la pause méridienne). Chaque créneau
  // porte son état (prioritaire / normal / exclu).
  function creneauxPeriscolaires(eleve, ctx) {
    if (!ctx.reglages.gererPeriscolaire) return [];
    var etab = etabDe(ctx, eleve.etablissement);
    var cours = ctx._coursParEleve[eleve.id] || [];
    var out = [];
    JOURS.forEach(function (j) {
      var duJour = cours.filter(function (c) { return c.jour === j; });
      if (!duJour.length) return;
      var matin = duJour.some(function (c) { return minutes(c.debut) < 12 * 60; });
      var aprem = duJour.some(function (c) { return minutes(c.fin) > 13 * 60; });
      if (eleve.recreation) {
        (etab.recreations || []).forEach(function (r) {
          var duMatin = minutes(r.debut) < 12 * 60;
          if ((duMatin && matin) || (!duMatin && aprem)) out.push({ type: "recreation", creneau: { etab: etab.id, jour: j, debut: r.debut, fin: r.fin, semaine: "toutes" } });
        });
      }
      if (eleve.meridienne && matin && aprem && etab.meridienne) {
        out.push({ type: "meridienne", creneau: { etab: etab.id, jour: j, debut: etab.meridienne.debut, fin: etab.meridienne.fin, semaine: "toutes" } });
      }
    });
    out.forEach(function (p) { p.etat = etatPeriscolaire(eleve, p.type, p.creneau); });
    return out;
  }

  /* =============== alertes (panneau §7.1) =============== */
  function joursEntre(iso1, iso2) {
    return Math.round((Date.UTC(+iso2.slice(0, 4), +iso2.slice(5, 7) - 1, +iso2.slice(8, 10))
      - Date.UTC(+iso1.slice(0, 4), +iso1.slice(5, 7) - 1, +iso1.slice(8, 10))) / 86400000);
  }

  // aujourdhui : date ISO (paramètre, pour rester pur)
  function alertes(ctx, aujourdhui) {
    var out = [];
    var affs = ctx.affectations.slice().sort(function (a, b) { return txt(a.id).localeCompare(txt(b.id)); });
    var dejaVus = {};
    affs.forEach(function (aff) {
      verifierAffectation(aff, ctx).forEach(function (v) {
        // quotité et pause portent sur la semaine ou la journée : une seule
        // alerte par AESH (et par jour), pas une par créneau concerné
        if (v.code === "quotite" || v.code === "pause") {
          var k = v.code + "|" + aff.aeshId + "|" + (v.code === "pause" ? aff.creneau.jour : "") + "|" + v.message;
          if (dejaVus[k]) return;
          dejaVus[k] = true;
        }
        out.push({ type: "conflit", niveau: v.niveau, code: v.code, message: v.message, affectationId: aff.id, aeshId: aff.aeshId, eleveId: (aff.eleves || [])[0], creneau: aff.creneau });
      });
    });
    ctx.eleves.forEach(function (e) {
      var cv = couvertureEleve(e, ctx);
      if (cv.etat === "sous") out.push({ type: "couverture", niveau: "attention", message: e.nomCourt + " (" + e.classe + ") sous-couvert.", eleveId: e.id });
      if (e.finNotif && aujourdhui) {
        var j = joursEntre(aujourdhui, e.finNotif);
        if (j < 0) out.push({ type: "notification", niveau: "erreur", message: "Notification de " + e.nomCourt + " (" + e.classe + ") échue depuis le " + e.finNotif + ".", eleveId: e.id });
        else if (j < ctx.reglages.joursAlerteNotification) out.push({ type: "notification", niveau: "attention", message: "Notification de " + e.nomCourt + " (" + e.classe + ") : fin dans " + j + " jour" + (j > 1 ? "s" : "") + ".", eleveId: e.id });
      }
    });
    ctx.aesh.forEach(function (a) {
      var ch = chargeAesh(a, ctx);
      if (ch.etat === "depassement") out.push({ type: "charge", niveau: "erreur", message: a.prenom + " " + a.nom + " : quotité dépassée.", aeshId: a.id });
    });
    var ORDRE = { erreur: 0, attention: 1, info: 2 };
    // tri stable : niveau, puis ordre de production
    return out.map(function (x, i) { return { x: x, i: i }; })
      .sort(function (p, q) { return (ORDRE[p.x.niveau] - ORDRE[q.x.niveau]) || (p.i - q.i); })
      .map(function (p) { return p.x; });
  }

  /* =============== synthèse (bandeau §7.1) =============== */
  function synthese(ctx) {
    // capacité : quotités totales, heures affectées (charge) et heures
    // libres (somme par AESH de max(0, quotité − charge)), en A et en B ;
    // écart théorique = heures notifiées (individuel + mutualisé) − quotités
    var s = { indDemande: 0, indCouvert: 0, mutDemande: 0, mutCouvert: 0, elevesSous: 0, aeshDepassement: 0, aeshSous: 0,
      quotites: 0, affecteesA: 0, affecteesB: 0, libresA: 0, libresB: 0 };
    ctx.eleves.forEach(function (e) {
      var cv = couvertureEleve(e, ctx);
      s.indDemande += cv.ind.notifie; s.mutDemande += cv.mut.notifie;
      s.indCouvert += Math.min(cv.ind.moy, cv.ind.notifie); s.mutCouvert += Math.min(cv.mut.moy, cv.mut.notifie);
      if (cv.etat === "sous") s.elevesSous++;
    });
    ctx.aesh.forEach(function (a) {
      var ch = chargeAesh(a, ctx);
      if (ch.etat === "depassement") s.aeshDepassement++;
      if (ch.etat === "sous") s.aeshSous++;
      s.quotites += ch.quotite;
      s.affecteesA += ch.A; s.affecteesB += ch.B;
      s.libresA += Math.max(0, ch.quotite - ch.A); s.libresB += Math.max(0, ch.quotite - ch.B);
    });
    s.affectees = (s.affecteesA + s.affecteesB) / 2;
    s.libres = (s.libresA + s.libresB) / 2;
    s.ecartTheorique = s.indDemande + s.mutDemande - s.quotites;
    return s;
  }

  /* =============== annulation (§6) =============== */
  // ops : opérations PialDB.appliquer ({magasin, supprimer:[id],
  // enregistrer:[objet]}) sur des objets de clé « id » ; existants :
  // {magasin: [objets avant l'opération]}. Renvoie les opérations qui
  // remettent ces magasins dans leur état d'avant : objets supprimés ou
  // modifiés réenregistrés (copies), objets créés supprimés.
  function operationsInverses(ops, existants) {
    var inv = [];
    ops.forEach(function (op) {
      var parId = {}, vus = {}, remettre = [], supprimer = [];
      (existants[op.magasin] || []).forEach(function (o) { parId[o.id] = o; });
      (op.supprimer || []).forEach(function (id) {
        if (vus[id]) return;
        vus[id] = true;
        if (parId[id]) remettre.push(JSON.parse(JSON.stringify(parId[id])));
      });
      (op.enregistrer || []).forEach(function (o) {
        if (vus[o.id]) return;
        vus[o.id] = true;
        if (parId[o.id]) remettre.push(JSON.parse(JSON.stringify(parId[o.id])));
        else supprimer.push(o.id);
      });
      inv.push({ magasin: op.magasin, supprimer: supprimer, enregistrer: remettre });
    });
    return inv.reverse();
  }

  /* =============== comparatif de deux versions (§6) =============== */
  // avant, apres : listes d'affectations ; etablissements : liste (pour
  // l'alternance A/B). Comparaison par élève × créneau × semaine : un
  // créneau scindé en A et B se compare à un créneau « toutes semaines ».
  // Renvoie {lignes:[{eleveId, jour, debut, fin, etab, periscolaire,
  // semaines:["A","B"], type:"ajout"|"retrait"|"changement", avant, apres}],
  // resume:{ajout, retrait, changement}} ; avant / apres = {aeshIds,
  // modalite} ou null. Une ligne regroupe les semaines A et B quand la
  // différence est la même ; lignes triées par élève, jour, heure.
  function comparerAffectations(avant, apres, etablissements) {
    var etabs = {};
    (etablissements || []).forEach(function (e) { etabs[e.id] = e; });
    function indexer(affs) {
      var idx = {};
      (affs || []).forEach(function (a) {
        var c = a.creneau;
        semainesDe(c.semaine, etabs[c.etab]).forEach(function (s) {
          (a.eleves || []).forEach(function (id) {
            var k = [id, JOURS.indexOf(c.jour), hhmm(minutes(c.debut)), hhmm(minutes(c.fin)), txt(a.periscolaire), s].join("|");
            var x = idx[k] = idx[k] || { eleveId: id, jour: c.jour, debut: c.debut, fin: c.fin, etab: c.etab, periscolaire: a.periscolaire || "", semaine: s, aeshIds: [], modalite: a.modalite };
            if (x.aeshIds.indexOf(a.aeshId) < 0) x.aeshIds.push(a.aeshId);
          });
        });
      });
      Object.keys(idx).forEach(function (k) { idx[k].aeshIds.sort(); });
      return idx;
    }
    var ia = indexer(avant), ib = indexer(apres), cles = {}, parCreneau = {};
    Object.keys(ia).concat(Object.keys(ib)).forEach(function (k) { cles[k] = true; });
    Object.keys(cles).sort().forEach(function (k) {
      var a = ia[k], b = ib[k], x = a || b;
      var va = a ? { aeshIds: a.aeshIds, modalite: a.modalite } : null, vb = b ? { aeshIds: b.aeshIds, modalite: b.modalite } : null;
      if (va && vb && JSON.stringify(va) === JSON.stringify(vb)) return;
      var type = !va ? "ajout" : (!vb ? "retrait" : "changement");
      // même différence en A et en B : une seule ligne
      var kc = k.slice(0, k.lastIndexOf("|")) + "|" + type + "|" + JSON.stringify([va, vb]);
      if (parCreneau[kc]) { parCreneau[kc].semaines.push(x.semaine); return; }
      parCreneau[kc] = { eleveId: x.eleveId, jour: x.jour, debut: x.debut, fin: x.fin, etab: x.etab, periscolaire: x.periscolaire,
        semaines: [x.semaine], type: type, avant: va, apres: vb, _cle: k };
    });
    var lignes = Object.keys(parCreneau).map(function (kc) { return parCreneau[kc]; })
      .sort(function (p, q) { return p._cle < q._cle ? -1 : (p._cle > q._cle ? 1 : 0); });
    var resume = { ajout: 0, retrait: 0, changement: 0 };
    lignes.forEach(function (l) { delete l._cle; resume[l.type]++; });
    return { lignes: lignes, resume: resume };
  }

  return {
    REGLAGES_DEFAUT: REGLAGES_DEFAUT, JOURS: JOURS, NIVEAUX: NIVEAUX,
    normaliser: normaliser, abregerNom: abregerNom, nomCourt: nomCourt, cleEleve: cleEleve,
    idEleve: idEleve, idAesh: idAesh, idEtablissement: idEtablissement, collisions: collisions,
    nouvelIdentifiant: nouvelIdentifiant, estIdentifiantInterne: estIdentifiantInterne, cleAesh: cleAesh, cleFicheEleve: cleFicheEleve,
    idCours: idCours, idAffectationTraduit: idAffectationTraduit, tableCles: tableCles, traduireIds: traduireIds,
    donneesParCles: donneesParCles, migrerV4: migrerV4, attribuerIdentifiants: attribuerIdentifiants,
    decomposerNomCourt: decomposerNomCourt, eleveModifie: eleveModifie, aeshModifiee: aeshModifiee,
    collisionEleve: collisionEleve, collisionAesh: collisionAesh, coursSuivantEleve: coursSuivantEleve,
    comparerClasses: comparerClasses, referentielClasses: referentielClasses,
    estArchive: estArchive, actifs: actifs, donneesActives: donneesActives, effetsRetrait: effetsRetrait,
    anneeScolaire: anneeScolaire, niveauClasse: niveauClasse, typeEtablissement: typeEtablissement,
    etablissementParDefaut: etablissementParDefaut,
    jourNormalise: jourNormalise, minutes: minutes, hhmm: hhmm, heureNormalisee: heureNormalisee,
    dureeComptee: dureeComptee, semaineNormalisee: semaineNormalisee, semainesDe: semainesDe,
    creneauCle: creneauCle, chevauchent: chevauchent,
    contexte: contexte, dureeAffectation: dureeAffectation,
    etatCouverture: etatCouverture, couvertureEleve: couvertureEleve,
    etatCharge: etatCharge, chargeAesh: chargeAesh, mesureJournee: mesureJournee, journeesAesh: journeesAesh,
    SPECIALITES_DEFAUT: SPECIALITES_DEFAUT, elevesExclusDe: elevesExclusDe, voeuxTouches: voeuxTouches,
    besoinsCouverts: besoinsCouverts, specialitesInconnues: specialitesInconnues,
    CHAMPS_NOTIFICATION: CHAMPS_NOTIFICATION, CHAMPS_FICHE_AESH: CHAMPS_FICHE_AESH, conflitsReimport: conflitsReimport, fusionEleve: fusionEleve,
    cleMatiere: cleMatiere, etatCoursImporte: etatCoursImporte, matieresEleve: matieresEleve,
    memeCours: memeCours, peutMutualiser: peutMutualiser, coursSurCreneau: coursSurCreneau,
    indisponibilite: indisponibilite, verifierPauseRepas: verifierPauseRepas, verifierAffectation: verifierAffectation,
    motifsIndisponibilite: motifsIndisponibilite, violationsSimulees: violationsSimulees, cleEtatPeriscolaire: cleEtatPeriscolaire,
    etatPeriscolaire: etatPeriscolaire, creneauxPeriscolaires: creneauxPeriscolaires,
    joursEntre: joursEntre, alertes: alertes, synthese: synthese, comparerAffectations: comparerAffectations,
    operationsInverses: operationsInverses
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialModele;
