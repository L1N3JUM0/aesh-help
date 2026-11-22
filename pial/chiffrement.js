"use strict";

/* =====================================================================
   PialChiffre — sauvegarde chiffrée par mot de passe (spec §8.4).
   PBKDF2-SHA256 (au moins 200 000 itérations) puis AES-GCM 256 bits, par
   crypto.subtle (navigateur, ou Node ≥ 22 pour les tests). Aucune
   dépendance, aucun réseau.

   Format `pial-suivi-chiffre/1` :
     { format, sel (base64), iv (base64), iterations, donnees_b64 }
   où donnees_b64 est le texte JSON de la sauvegarde (pial-suivi/N)
   chiffré. Mot de passe perdu = sauvegarde illisible : il n'existe aucun
   moyen de la récupérer.
   ===================================================================== */
var PialChiffre = (function () {

  var FORMAT = "pial-suivi-chiffre/1";
  var ITERATIONS = 300000;
  var ITERATIONS_MIN = 200000;

  function subtle() {
    var c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    return c && c.subtle ? c : null;
  }
  function disponible() { return !!subtle(); }

  function versBase64(octets) {
    var s = "", pas = 0x8000;
    for (var i = 0; i < octets.length; i += pas) s += String.fromCharCode.apply(null, octets.subarray(i, i + pas));
    return btoa(s);
  }
  function depuisBase64(b64) {
    var s = atob(b64), o = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  }

  function deriver(motDePasse, sel, iterations) {
    var c = subtle();
    return c.subtle.importKey("raw", new TextEncoder().encode(String(motDePasse)), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return c.subtle.deriveKey({ name: "PBKDF2", salt: sel, iterations: iterations, hash: "SHA-256" }, base,
        { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }

  function estChiffre(objet) {
    return !!objet && typeof objet === "object" && objet.format === FORMAT;
  }

  /* chiffre un texte : promesse de l'enveloppe (objet JSON-isable) */
  function chiffrer(texte, motDePasse) {
    if (!disponible()) return Promise.reject(new Error("Le chiffrement n'est pas disponible dans ce navigateur."));
    if (!String(motDePasse || "")) return Promise.reject(new Error("Mot de passe vide."));
    var c = subtle(), sel = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    return deriver(motDePasse, sel, ITERATIONS).then(function (cle) {
      return c.subtle.encrypt({ name: "AES-GCM", iv: iv }, cle, new TextEncoder().encode(String(texte)));
    }).then(function (chiffre) {
      return { format: FORMAT, sel: versBase64(sel), iv: versBase64(iv), iterations: ITERATIONS, donnees_b64: versBase64(new Uint8Array(chiffre)) };
    });
  }

  /* déchiffre une enveloppe : promesse du texte. Rejette avec
     Error("mot-de-passe") si le mot de passe est faux ou le fichier altéré,
     Error("format") si l'enveloppe est invalide. */
  function dechiffrer(enveloppe, motDePasse) {
    if (!disponible()) return Promise.reject(new Error("Le chiffrement n'est pas disponible dans ce navigateur."));
    if (!estChiffre(enveloppe) || typeof enveloppe.sel !== "string" || typeof enveloppe.iv !== "string"
      || typeof enveloppe.donnees_b64 !== "string" || !(enveloppe.iterations >= ITERATIONS_MIN)) {
      return Promise.reject(new Error("format"));
    }
    var c = subtle(), sel, iv, donnees;
    try { sel = depuisBase64(enveloppe.sel); iv = depuisBase64(enveloppe.iv); donnees = depuisBase64(enveloppe.donnees_b64); }
    catch (e) { return Promise.reject(new Error("format")); }
    return deriver(motDePasse, sel, enveloppe.iterations).then(function (cle) {
      return c.subtle.decrypt({ name: "AES-GCM", iv: iv }, cle, donnees);
    }).then(function (clair) {
      return new TextDecoder().decode(clair);
    }, function () { throw new Error("mot-de-passe"); });
  }

  return { FORMAT: FORMAT, ITERATIONS: ITERATIONS, ITERATIONS_MIN: ITERATIONS_MIN, disponible: disponible, estChiffre: estChiffre,
    chiffrer: chiffrer, dechiffrer: dechiffrer };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialChiffre;
