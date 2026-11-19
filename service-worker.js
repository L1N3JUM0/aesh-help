"use strict";

/* Service worker de "Suivi AESH".
   Incrémenter CACHE_VERSION à chaque déploiement pour forcer la mise à
   jour du cache chez les utilisateurs (les anciens caches sont supprimés
   automatiquement dans "activate"). */
var CACHE_VERSION = "v12";
var CACHE_NOM = "suivi-aesh-" + CACHE_VERSION;

var FICHIERS = [
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  // espace coordonnateur PIAL
  "pial/index.html",
  "pial/manifest.webmanifest",
  "icons/icon-pial-192.png",
  "icons/icon-pial-512.png",
  "pial/auth.js",
  "pial/db.js",
  "pial/graphiques.js",
  "pial/modele.js",
  "pial/moteur.js",
  "pial/zip.js",
  "pial/import-fichiers.js",
  "pial/affectations.js",
  "pial/app.js"
];

// jamais mis en cache : données d'exemple et outils de développement
var HORS_CACHE = /\/(exemples|outils)\//;

self.addEventListener("install", function (evt) {
  self.skipWaiting();
  evt.waitUntil(
    caches.open(CACHE_NOM).then(function (cache) {
      return cache.addAll(FICHIERS);
    })
  );
});

self.addEventListener("activate", function (evt) {
  evt.waitUntil(
    caches.keys().then(function (noms) {
      return Promise.all(
        noms
          .filter(function (n) { return n !== CACHE_NOM; })
          .map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

/* Cache d'abord, réseau en secours (utile seulement pour recharger une
   version plus récente déjà en ligne : l'app ne fait aucune requête
   réseau pour son fonctionnement). En cas d'échec total, on retombe sur
   la page d'accueil mise en cache (celle de l'espace PIAL pour une
   navigation sous /pial/) pour rester utilisable hors ligne. */
self.addEventListener("fetch", function (evt) {
  if (evt.request.method !== "GET") return;
  var chemin = new URL(evt.request.url).pathname;
  if (HORS_CACHE.test(chemin)) return; // réseau seul, comportement par défaut du navigateur
  evt.respondWith(
    caches.match(evt.request).then(function (reponse) {
      if (reponse) return reponse;
      return fetch(evt.request).then(function (reseau) {
        if (reseau && reseau.status === 200 && reseau.type === "basic") {
          var copie = reseau.clone();
          caches.open(CACHE_NOM).then(function (cache) { cache.put(evt.request, copie); });
        }
        return reseau;
      }).catch(function () {
        if (evt.request.mode === "navigate") return caches.match(/\/pial\//.test(chemin) ? "pial/index.html" : "index.html");
      });
    })
  );
});
