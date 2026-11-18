"use strict";

/* =====================================================================
   PialZip — lecture et écriture d'archives ZIP, sans bibliothèque.

   - Lecture (pour les fichiers XLSX, qui sont des archives ZIP) : on lit
     le répertoire central, puis chaque entrée est soit stockée telle
     quelle (méthode 0), soit décompressée avec
     DecompressionStream("deflate-raw") (méthode 8). Le CRC32 est vérifié.
     Sans DecompressionStream (vieux navigateur), la promesse est rejetée
     avec l'erreur "decompression-indisponible".
   - Écriture (exports, phase 3) : méthode « store » (aucune compression)
     + CRC32 ; noms de fichiers en UTF-8.
   ZIP64 et archives chiffrées ne sont pas pris en charge.
   ===================================================================== */
var PialZip = (function () {

  var TABLE_CRC = (function () {
    var t = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(octets) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function enOctets(donnees) {
    if (donnees instanceof Uint8Array) return donnees;
    if (donnees instanceof ArrayBuffer) return new Uint8Array(donnees);
    return new TextEncoder().encode(String(donnees == null ? "" : donnees));
  }

  /* =============== lecture =============== */
  function u16(o, i) { return o[i] | (o[i + 1] << 8); }
  function u32(o, i) { return (o[i] | (o[i + 1] << 8) | (o[i + 2] << 16) | (o[i + 3] << 24)) >>> 0; }

  // liste des entrées d'après le répertoire central :
  // [{nom, methode, tailleCompressee, taille, crc, decalageEntete}]
  function entrees(octets) {
    octets = enOctets(octets);
    // la fin du répertoire central est dans les 22 + 65 535 derniers octets
    var fin = -1;
    for (var i = octets.length - 22; i >= 0 && i >= octets.length - 22 - 65535; i--) {
      if (u32(octets, i) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new Error("zip-invalide");
    var nombre = u16(octets, fin + 10), decalage = u32(octets, fin + 16);
    if (decalage === 0xFFFFFFFF || nombre === 0xFFFF) throw new Error("zip64-non-pris-en-charge");
    var liste = [], dec = new TextDecoder("utf-8");
    for (var n = 0; n < nombre; n++) {
      if (u32(octets, decalage) !== 0x02014b50) throw new Error("zip-invalide");
      var drapeaux = u16(octets, decalage + 8);
      var longNom = u16(octets, decalage + 28), longExtra = u16(octets, decalage + 30), longComm = u16(octets, decalage + 32);
      liste.push({
        nom: dec.decode(octets.subarray(decalage + 46, decalage + 46 + longNom)),
        chiffre: !!(drapeaux & 1),
        methode: u16(octets, decalage + 10),
        crc: u32(octets, decalage + 16),
        tailleCompressee: u32(octets, decalage + 20),
        taille: u32(octets, decalage + 24),
        decalageEntete: u32(octets, decalage + 42)
      });
      decalage += 46 + longNom + longExtra + longComm;
    }
    return liste;
  }

  function decompresser(donnees) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("decompression-indisponible"));
    var flux = new Blob([donnees]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(flux).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  // contenu d'une entrée (Uint8Array), CRC vérifié
  function extraire(octets, entree) {
    octets = enOctets(octets);
    var d = entree.decalageEntete;
    if (u32(octets, d) !== 0x04034b50) return Promise.reject(new Error("zip-invalide"));
    if (entree.chiffre) return Promise.reject(new Error("zip-chiffre"));
    var debut = d + 30 + u16(octets, d + 26) + u16(octets, d + 28);
    var brut = octets.subarray(debut, debut + entree.tailleCompressee);
    var p;
    if (entree.methode === 0) p = Promise.resolve(brut);
    else if (entree.methode === 8) p = decompresser(brut);
    else return Promise.reject(new Error("methode-non-prise-en-charge"));
    return p.then(function (contenu) {
      if (crc32(contenu) !== entree.crc) throw new Error("crc-invalide");
      return contenu;
    });
  }

  // lit toute l'archive (ou seulement les noms acceptés par filtre) :
  // promesse de {nom: Uint8Array}
  function lire(octets, filtre) {
    var liste;
    try { liste = entrees(octets); } catch (e) { return Promise.reject(e); }
    var resultat = {};
    return liste.filter(function (en) { return !/\/$/.test(en.nom) && (!filtre || filtre(en.nom)); })
      .reduce(function (p, en) {
        return p.then(function () { return extraire(octets, en).then(function (c) { resultat[en.nom] = c; }); });
      }, Promise.resolve()).then(function () { return resultat; });
  }

  /* =============== écriture (méthode « store ») =============== */
  // date et heure au format DOS
  function dateDos(d) {
    return {
      heure: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      jour: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }
  function ecrire16(o, i, v) { o[i] = v & 0xFF; o[i + 1] = (v >>> 8) & 0xFF; }
  function ecrire32(o, i, v) { o[i] = v & 0xFF; o[i + 1] = (v >>> 8) & 0xFF; o[i + 2] = (v >>> 16) & 0xFF; o[i + 3] = (v >>> 24) & 0xFF; }

  // fichiers : [{nom, donnees (Uint8Array ou texte)}] ; date : facultative
  // (fixée dans les tests pour obtenir une archive reproductible)
  function ecrire(fichiers, date) {
    var dd = dateDos(date || new Date());
    var parties = [], central = [], decalage = 0;
    fichiers.forEach(function (f) {
      var nom = new TextEncoder().encode(f.nom), donnees = enOctets(f.donnees), crc = crc32(donnees);
      var local = new Uint8Array(30 + nom.length);
      ecrire32(local, 0, 0x04034b50); ecrire16(local, 4, 20); ecrire16(local, 6, 0x0800); ecrire16(local, 8, 0);
      ecrire16(local, 10, dd.heure); ecrire16(local, 12, dd.jour);
      ecrire32(local, 14, crc); ecrire32(local, 18, donnees.length); ecrire32(local, 22, donnees.length);
      ecrire16(local, 26, nom.length); ecrire16(local, 28, 0);
      local.set(nom, 30);
      var cd = new Uint8Array(46 + nom.length);
      ecrire32(cd, 0, 0x02014b50); ecrire16(cd, 4, 20); ecrire16(cd, 6, 20); ecrire16(cd, 8, 0x0800); ecrire16(cd, 10, 0);
      ecrire16(cd, 12, dd.heure); ecrire16(cd, 14, dd.jour);
      ecrire32(cd, 16, crc); ecrire32(cd, 20, donnees.length); ecrire32(cd, 24, donnees.length);
      ecrire16(cd, 28, nom.length); ecrire32(cd, 42, decalage);
      cd.set(nom, 46);
      parties.push(local, donnees);
      central.push(cd);
      decalage += local.length + donnees.length;
    });
    var tailleCentral = central.reduce(function (s, b) { return s + b.length; }, 0);
    var fin = new Uint8Array(22);
    ecrire32(fin, 0, 0x06054b50); ecrire16(fin, 8, fichiers.length); ecrire16(fin, 10, fichiers.length);
    ecrire32(fin, 12, tailleCentral); ecrire32(fin, 16, decalage);
    var toutes = parties.concat(central, [fin]);
    var total = toutes.reduce(function (s, b) { return s + b.length; }, 0);
    var sortie = new Uint8Array(total), pos = 0;
    toutes.forEach(function (b) { sortie.set(b, pos); pos += b.length; });
    return sortie;
  }

  return { crc32: crc32, entrees: entrees, extraire: extraire, lire: lire, ecrire: ecrire };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PialZip;
