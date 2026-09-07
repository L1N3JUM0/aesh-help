"use strict";

/* =====================================================================
   Écran de verrouillage de l'espace PIAL.

   AVERTISSEMENT DE SÉCURITÉ — À LIRE AVANT DE FAIRE CONFIANCE À CE CODE
   -----------------------------------------------------------------
   Ceci N'EST PAS un mécanisme d'authentification sécurisé. C'est un
   simple frein d'accès côté navigateur, destiné à éviter qu'une
   personne de passage sur ce poste n'ouvre l'application par erreur ou
   par curiosité — rien de plus.

   Concrètement, n'importe qui disposant d'un accès aux outils de
   développement du navigateur (F12), à la console JavaScript, ou au
   stockage local (localStorage) de ce profil peut contourner ce
   verrou : en modifiant le DOM pour masquer l'écran #verrou, en
   exécutant `localStorage.removeItem("pial-auth-v1")` pour repartir sur
   un mot de passe vierge, en lisant le hash stocké, ou simplement en
   désactivant JavaScript. Ce n'est pas non plus une protection contre
   un accès physique malveillant à l'ordinateur ou à son disque.

   Le mot de passe n'est jamais stocké en clair : seule son empreinte
   SHA-256 (via crypto.subtle, natif au navigateur, sans dépendance) est
   conservée dans localStorage. Il n'y a pas de sel (salt) : dans ce
   modèle de menace (un frein d'accès basique, contournable de toute
   façon par quiconque lit ce fichier ou ouvre la console), un sel
   n'apporterait pas de garantie supplémentaire réelle — on ne
   complexifie pas pour un faux sentiment de sécurité. La question de
   secours et sa réponse attendue sont fixes et codées en dur : la
   réponse ne change jamais, donc seule son empreinte SHA-256 est
   nécessaire, elle aussi sans sel.
   ===================================================================== */

(function () {

  var CLE_STOCKAGE = "pial-auth-v1";
  // empreinte SHA-256 de "julien" (réponse normalisée : minuscules, sans espaces superflus)
  var REPONSE_SECOURS_HASH = "e23c3d7ff76f6e6235ce091f2fcd5fd35748677799d1637acf5ba2bca350e258";

  var memoire = {}; // secours si localStorage est indisponible : le verrou ne persiste alors pas entre deux rechargements

  function $(id) { return document.getElementById(id); }

  function lireAuth() {
    try { var v = localStorage.getItem(CLE_STOCKAGE); return v ? JSON.parse(v) : null; }
    catch (e) { return memoire.auth || null; }
  }
  function ecrireAuth(donnees) {
    try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(donnees)); }
    catch (e) { memoire.auth = donnees; }
  }

  function hacher(texte) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)).then(function (tampon) {
      return Array.prototype.map.call(new Uint8Array(tampon), function (o) { return o.toString(16).padStart(2, "0"); }).join("");
    });
  }
  function normaliserReponseSecours(s) {
    return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function afficherEcran(nom) {
    ["ecran-creation", "ecran-connexion", "ecran-secours", "ecran-nouveau-mdp"].forEach(function (id) {
      $(id).hidden = (id !== nom);
    });
  }
  function erreur(id, message) {
    var el = $(id); el.textContent = message || ""; el.hidden = !message;
  }
  function deverrouiller() { $("verrou").hidden = true; }

  if (!window.crypto || !window.crypto.subtle) {
    // navigateur trop ancien / contexte non sécurisé pour Web Crypto : on
    // n'empêche pas l'accès à l'application pour autant (le verrou n'est
    // qu'un confort, pas une protection réelle).
    console.warn("crypto.subtle indisponible : écran de verrouillage désactivé.");
    deverrouiller();
    return;
  }

  $("ecran-creation").addEventListener("submit", function (evt) {
    evt.preventDefault();
    var m1 = $("c-mdp1").value, m2 = $("c-mdp2").value;
    if (!m1) { erreur("c-erreur", "Indiquez un mot de passe."); return; }
    if (m1 !== m2) { erreur("c-erreur", "Les deux mots de passe ne correspondent pas."); return; }
    hacher(m1).then(function (hash) {
      ecrireAuth({ hash: hash });
      deverrouiller();
    });
  });

  $("ecran-connexion").addEventListener("submit", function (evt) {
    evt.preventDefault();
    var saisi = $("x-mdp").value;
    var auth = lireAuth();
    hacher(saisi).then(function (hash) {
      if (auth && hash === auth.hash) { deverrouiller(); }
      else { erreur("x-erreur", "Mot de passe incorrect."); }
    });
  });
  $("x-oublie").addEventListener("click", function () {
    erreur("x-erreur", "");
    $("s-reponse").value = "";
    erreur("s-erreur", "");
    afficherEcran("ecran-secours");
  });
  $("s-annuler").addEventListener("click", function () {
    $("x-mdp").value = "";
    afficherEcran("ecran-connexion");
  });

  $("ecran-secours").addEventListener("submit", function (evt) {
    evt.preventDefault();
    hacher(normaliserReponseSecours($("s-reponse").value)).then(function (hash) {
      if (hash === REPONSE_SECOURS_HASH) {
        $("n-mdp1").value = ""; $("n-mdp2").value = ""; erreur("n-erreur", "");
        afficherEcran("ecran-nouveau-mdp");
      } else {
        erreur("s-erreur", "Réponse incorrecte.");
      }
    });
  });

  $("ecran-nouveau-mdp").addEventListener("submit", function (evt) {
    evt.preventDefault();
    var m1 = $("n-mdp1").value, m2 = $("n-mdp2").value;
    if (!m1) { erreur("n-erreur", "Indiquez un mot de passe."); return; }
    if (m1 !== m2) { erreur("n-erreur", "Les deux mots de passe ne correspondent pas."); return; }
    hacher(m1).then(function (hash) {
      ecrireAuth({ hash: hash });
      deverrouiller();
    });
  });

  afficherEcran(lireAuth() ? "ecran-connexion" : "ecran-creation");

  // API minimale pour le bouton "Changer le mot de passe" des Réglages
  // (app.js) — évite toute dépendance inverse d'auth.js vers app.js.
  window.PialAuth = {
    verifierMotDePasse: function (mdp) {
      var auth = lireAuth();
      return hacher(mdp).then(function (hash) { return !!(auth && hash === auth.hash); });
    },
    changerMotDePasse: function (nouveauMdp) {
      return hacher(nouveauMdp).then(function (hash) { ecrireAuth({ hash: hash }); });
    }
  };

})();
