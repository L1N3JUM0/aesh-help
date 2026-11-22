"use strict";

/* =====================================================================
   Contrôle statique, sans npm ni navigateur : détecte qu'une fonction
   supprimée (ou renommée) est encore appelée, et qu'un identifiant HTML
   cherché par le code n'existe plus.

   Il attrape, avant tout test d'interface, le bug « fonction supprimée mais
   encore appelée » (ReferenceError au premier clic).

   Pour chaque PAGE (index.html + ses scripts ; pial/index.html + ses
   scripts), on lit le code sans commentaires ni chaînes, puis :
     1. appels de fonction nus  nom(  : le nom doit être déclaré dans le même
        fichier (function nom, var nom, paramètre, catch) ou être un global
        d'un autre fichier de la page (déclaré au niveau le plus haut), ou
        un global du navigateur / de JavaScript (liste blanche ci-dessous) ;
     2. références d'identifiants  $("x")  /  getElementById("x") : « x »
        doit exister (id="x" dans le HTML, ou fabriqué dans une chaîne du
        code, ex. innerHTML) ;
     3. identifiants en double dans le HTML statique.

   Limites assumées : un nom déclaré ailleurs dans le même fichier mais hors
   de portée n'est pas vu (le test de fumée, outils/test-fumee.js, exécute le
   code et couvre ce cas) ; les identifiants fabriqués par concaténation ne
   sont pas vérifiés.

   Lancé par outils/tests-node.js ; exécutable seul :
     node outils/verifier-appels.js
   ===================================================================== */

var fs = require("fs");
var path = require("path");

var RACINE = path.join(__dirname, "..");

var MOTS_CLES = {};
("if for while switch catch function return typeof void delete in instanceof do else throw case with yield new try finally var let const break continue default this super class import export await async of").split(" ").forEach(function (m) { MOTS_CLES[m] = true; });

/* globaux JavaScript / navigateur qui peuvent être appelés sans être déclarés.
   Volontairement sans fetch, XMLHttpRequest ni sendBeacon : l'application ne
   doit jamais contacter un serveur (CLAUDE.md) — un tel appel est signalé. */
var GLOBAUX = {};
("Array Object String Number Boolean Date Math JSON RegExp Error TypeError RangeError SyntaxError Promise Map Set WeakMap Symbol "
  + "parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape "
  + "setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask "
  + "alert confirm prompt print structuredClone "
  + "Uint8Array Uint16Array Uint32Array Int32Array Float64Array ArrayBuffer DataView TextEncoder TextDecoder Blob File FileReader URL Image "
  + "Intl require btoa atob Response Event CustomEvent DecompressionStream CompressionStream").split(" ").forEach(function (g) { GLOBAUX[g] = true; });

/* ---------- lecture du code : retire commentaires et contenu des chaînes ---------- */

/* renvoie {code, chaines} : code = source où commentaires, chaînes et
   expressions rationnelles sont remplacés par des espaces (mêmes longueurs,
   donc mêmes positions) ; chaines = texte brut des chaînes (pour les id) */
function nettoyer(src) {
  var n = src.length, out = new Array(n), chaines = [], i = 0, dernier = "";   // dernier = dernier caractère significatif
  function blanc(a, b) { for (var k = a; k < b; k++) out[k] = src[k] === "\n" ? "\n" : " "; }
  for (; i < n; i++) out[i] = src[i];
  i = 0;
  while (i < n) {
    var c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { var f = src.indexOf("\n", i); if (f < 0) f = n; blanc(i, f); i = f; continue; }
    if (c === "/" && d === "*") { var g = src.indexOf("*/", i + 2); g = g < 0 ? n : g + 2; blanc(i, g); i = g; continue; }
    if (c === "'" || c === '"' || c === "`") {
      var j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; else if (c !== "`" && src[j] === "\n") break; j++; }
      chaines.push(src.slice(i + 1, j));
      blanc(i + 1, j); dernier = c; i = j + 1; continue;
    }
    if (c === "/" && /[(,=:\[!&|?{};+\-*%<>~^]|^$/.test(dernier) || (c === "/" && /\breturn$|\btypeof$/.test(out.slice(Math.max(0, i - 8), i).join("").trim()))) {
      // expression rationnelle : jusqu'au / non échappé (hors classe [...])
      var k = i + 1, classe = false;
      while (k < n && src[k] !== "\n") {
        if (src[k] === "\\") { k += 2; continue; }
        if (src[k] === "[") classe = true; else if (src[k] === "]") classe = false;
        else if (src[k] === "/" && !classe) break;
        k++;
      }
      if (k < n && src[k] === "/") { blanc(i + 1, k); dernier = "/"; i = k + 1; while (i < n && /[a-z]/.test(src[i])) i++; dernier = "a"; continue; }
    }
    if (!/\s/.test(c)) dernier = c;
    i++;
  }
  return { code: out.join(""), chaines: chaines };
}

/* ---------- déclarations ---------- */

/* parcourt le code : renvoie {tous: noms déclarés quelque part, globaux: noms déclarés au niveau 0} */
function declarations(code) {
  var tous = {}, globaux = {}, n = code.length, prof = 0;
  var re = /(\bfunction\b\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\))|(\b(?:var|let|const)\b)|(\bcatch\s*\(\s*([A-Za-z_$][\w$]*))|([{}()\[\]])/g, m;
  while ((m = re.exec(code))) {
    if (m[7]) { if (m[7] === "{" || m[7] === "(" || m[7] === "[") prof++; else prof--; continue; }
    if (m[1]) {
      if (m[2]) { tous[m[2]] = true; if (prof === 0) globaux[m[2]] = true; }
      m[3].split(",").forEach(function (p) { p = p.trim().replace(/=.*$/, "").trim(); if (/^[A-Za-z_$][\w$]*$/.test(p)) tous[p] = true; });
      // la parenthèse ouvrante de la signature est déjà consommée ; la fermante aussi (rien à ajuster)
      continue;
    }
    if (m[5]) { tous[m[6]] = true; prof++; continue; }  // catch (e : la « ( » compte, la « ) » fermera
    if (m[4]) {
      // var a = 1, b = [x, y], c;  : lit les noms séparés par des virgules de niveau 0
      var p = re.lastIndex, niveau = 0, debut = true;
      while (p < n) {
        var ch = code[p];
        if (debut) {
          var mm = /^\s*([A-Za-z_$][\w$]*)/.exec(code.slice(p, p + 80));
          if (mm) { tous[mm[1]] = true; if (prof === 0) globaux[mm[1]] = true; p += mm[0].length; debut = false; continue; }
          if (!/\s/.test(ch)) break;   // déstructuration ou autre : on laisse
          p++; continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") niveau++;
        else if (ch === ")" || ch === "]" || ch === "}") { if (niveau === 0) break; niveau--; }
        else if (niveau === 0 && ch === ";") break;
        else if (niveau === 0 && ch === ",") debut = true;
        p++;
      }
    }
  }
  return { tous: tous, globaux: globaux };
}

/* appels nus : [{nom, ligne}] */
function appels(code) {
  var out = [], re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g, m;
  while ((m = re.exec(code))) {
    var nom = m[2];
    if (MOTS_CLES[nom]) continue;
    var pos = m.index + m[1].length;
    out.push({ nom: nom, ligne: code.slice(0, pos).split("\n").length });
  }
  return out;
}

/* ---------- pages ---------- */

function scriptsDePage(htmlRelatif) {
  var chemin = path.join(RACINE, htmlRelatif), html = fs.readFileSync(chemin, "utf8"), dossier = path.dirname(chemin);
  var fichiers = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g, m, k = 0;
  while ((m = re.exec(html))) {
    var src = /\ssrc="([^"]+)"/.exec(" " + m[1]);
    if (src) {
      var cible = path.join(dossier, src[1]);
      if (fs.existsSync(cible)) fichiers.push({ nom: path.relative(RACINE, cible).replace(/\\/g, "/"), source: fs.readFileSync(cible, "utf8") });
    } else if (m[2].trim()) {
      fichiers.push({ nom: htmlRelatif + "#script" + (++k), source: m[2] });
    }
  }
  return { html: html, fichiers: fichiers };
}

/* identifiants présents dans le HTML (hors <script>) : {id: nombre d'occurrences} */
function idsHtml(html) {
  var sansScripts = html.replace(/<script\b[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, ""), ids = {}, re = /\sid\s*=\s*"([^"]+)"/g, m;
  while ((m = re.exec(sansScripts))) ids[m[1]] = (ids[m[1]] || 0) + 1;
  return ids;
}

/* identifiants fabriqués dans les chaînes du code : id="x", id=\"x\", .id = "x" */
function idsFabriques(chaines, source) {
  var ids = {}, re = /\bid\s*=\s*\\?["']([\w-]+)/g, m;
  chaines.forEach(function (s) { re.lastIndex = 0; while ((m = re.exec(s))) ids[m[1]] = true; });
  var re2 = /\.id\s*=\s*["']([\w-]+)["']/g;
  while ((m = re2.exec(source))) ids[m[1]] = true;
  return ids;
}

function analyserPage(htmlRelatif) {
  var page = scriptsDePage(htmlRelatif), problemes = [];
  var infos = page.fichiers.map(function (f) {
    var net = nettoyer(f.source), d = declarations(net.code);
    return { nom: f.nom, source: f.source, code: net.code, chaines: net.chaines, tous: d.tous, globaux: d.globaux, ids: idsFabriques(net.chaines, f.source) };
  });
  // globaux de la page = déclarés au niveau 0 d'un fichier
  var globauxPage = {};
  infos.forEach(function (f) { Object.keys(f.globaux).forEach(function (g) { globauxPage[g] = true; }); });
  // 1. appels nus
  infos.forEach(function (f) {
    var vus = {};
    appels(f.code).forEach(function (a) {
      if (f.tous[a.nom] || globauxPage[a.nom] || GLOBAUX[a.nom] || vus[a.nom]) return;
      vus[a.nom] = true;
      problemes.push(f.nom + ":" + a.ligne + " : « " + a.nom + "(…) » est appelée mais n'est déclarée nulle part (fonction supprimée ou renommée ?)");
    });
  });
  // 2. identifiants demandés au DOM
  var ids = idsHtml(page.html), fabriques = {};
  infos.forEach(function (f) { Object.keys(f.ids).forEach(function (i) { fabriques[i] = true; }); });
  infos.forEach(function (f) {
    // $ n'est un raccourci de getElementById que s'il est défini ainsi dans ce fichier
    var aDollar = /function \$\(\s*\w+\s*\)\s*\{\s*return document\.getElementById\(/.test(f.source) || /var \$\s*=\s*function\s*\(\s*\w+\s*\)\s*\{\s*return document\.getElementById\(/.test(f.source);
    var re = aDollar ? /(?:\$|getElementById)\(\s*"([^"]+)"\s*\)/g : /getElementById\(\s*"([^"]+)"\s*\)/g, m, vus = {};
    while ((m = re.exec(f.source))) {
      var id = m[1];
      if (ids[id] || fabriques[id] || vus[id]) continue;
      // la source brute peut contenir la référence dans un commentaire : on ne garde que celles présentes dans le code nettoyé
      var ligne = f.source.slice(0, m.index).split("\n").length;
      var lignes = f.code.split("\n");
      if (!/(\$|getElementById)\s*\(/.test(lignes[ligne - 1] || "")) continue;
      vus[id] = true;
      problemes.push(f.nom + ":" + ligne + " : l'identifiant « " + id + " » est demandé au DOM mais absent de " + htmlRelatif);
    }
  });
  // 3. doublons
  Object.keys(ids).forEach(function (i) { if (ids[i] > 1) problemes.push(htmlRelatif + " : l'identifiant « " + i + " » apparaît " + ids[i] + " fois"); });
  return { fichiers: infos.map(function (f) { return f.nom; }), problemes: problemes };
}

var PAGES = ["index.html", "pial/index.html"];

function executer() {
  var lignes = [], echecs = 0;
  /* le contrôle lui-même : il voit un appel nu sans déclaration, et ignore commentaires, chaînes, expressions rationnelles et méthodes */
  (function () {
    var nom = "le contrôle détecte un appel sans déclaration et ignore commentaires, chaînes et méthodes";
    try {
      var src = ["function a(x){ return x; }",
        "var b = function(){ a(1); manquante(2); o.methode(3); };",
        "// commentee(4)",
        "var s = 'chaine(5)'; var r = /re(6)/g;",
        "var c = 1, d = function(){ d2(); };"].join("\n");
      var net = nettoyer(src), decl = declarations(net.code);
      var inconnus = appels(net.code).filter(function (x) { return !decl.tous[x.nom]; }).map(function (x) { return x.nom; });
      var attendu = ["manquante", "d2"].sort().join();
      if (inconnus.sort().join() !== attendu) throw new Error("appels inconnus trouvés : " + inconnus.join(",") + " (attendu : " + attendu + ")");
      lignes.push({ etat: "ok", nom: nom });
    } catch (e) { echecs++; lignes.push({ etat: "echec", nom: nom, message: e.message }); }
  })();
  PAGES.forEach(function (p) {
    var r = analyserPage(p);
    var nom = "appels et identifiants : " + p + " (" + r.fichiers.length + " script(s))";
    if (r.problemes.length) { echecs++; lignes.push({ etat: "echec", nom: nom, message: r.problemes.join("\n          ") }); }
    else lignes.push({ etat: "ok", nom: nom });
  });
  return { reussis: lignes.length - echecs, echecs: echecs, lignes: lignes };
}

module.exports = { executer: executer, scriptsDePage: scriptsDePage, analyserPage: analyserPage, nettoyer: nettoyer, declarations: declarations, appels: appels };

if (require.main === module) {
  var b = executer();
  b.lignes.forEach(function (l) { console.log((l.etat === "ok" ? "  ok    " : "  ÉCHEC ") + l.nom + (l.message ? "\n          " + l.message : "")); });
  console.log("\n" + b.reussis + " réussi(s), " + b.echecs + " échec(s).");
  process.exitCode = b.echecs ? 1 : 0;
}
