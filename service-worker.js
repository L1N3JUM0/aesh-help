"use strict";

/* Service worker de "Suivi AESH".
   Incrémenter CACHE_VERSION à chaque déploiement pour forcer la mise à
   jour du cache chez les utilisateurs (les anciens caches sont supprimés
   automatiquement dans "activate"). */
var CACHE_VERSION = "v2";
var CACHE_NOM = "suivi-aesh-" + CACHE_VERSION;

var FICHIERS = [
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

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
   la page d'accueil mise en cache pour rester utilisable hors ligne. */
self.addEventListener("fetch", function (evt) {
  if (evt.request.method !== "GET") return;
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
        if (evt.request.mode === "navigate") return caches.match("index.html");
      });
    })
  );
});
