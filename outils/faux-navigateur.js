"use strict";

/* =====================================================================
   Faux navigateur minimal pour les tests de fumée (outils/test-fumee.js).
   Sans npm, sans navigateur : le DOM est construit à partir du VRAI html de
   la page (mêmes identifiants, mêmes classes, mêmes boutons), et une
   IndexedDB en mémoire fait tourner pial/db.js tel quel.

   Fidélité voulue : getElementById d'un identifiant absent renvoie null,
   comme un vrai navigateur (le code fautif lève alors une TypeError).

   Limites : pas de mise en page, pas de sélecteurs avancés (voir
   `correspond`), pas de vrai événement clavier ou fichier.
   ===================================================================== */

var VIDES = { meta: 1, link: 1, br: 1, hr: 1, img: 1, input: 1, source: 1, col: 1, area: 1, base: 1, wbr: 1 };

/* ---------- analyse HTML (arbre de noeuds) ---------- */

function noeud(tag, attrs) { return { tag: tag, attrs: attrs || {}, enfants: [], parent: null, el: null }; }

function analyserAttributs(s) {
  var attrs = {}, re = /([^\s=\/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, m;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ""));
  return attrs;
}

/* html -> liste de noeuds racines ; <script> et <style> sont retirés (jamais exécutés par le DOM) */
function analyserHtml(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  var racine = noeud("#racine"), pile = [racine], re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g, m;
  while ((m = re.exec(html))) {
    var ferme = m[1], tag = m[2].toLowerCase();
    if (ferme) {
      for (var k = pile.length - 1; k > 0; k--) if (pile[k].tag === tag) { pile.length = k; break; }
      continue;
    }
    var n = noeud(tag, analyserAttributs(m[3]));
    n.parent = pile[pile.length - 1]; n.parent.enfants.push(n);
    if (!VIDES[tag] && !m[4]) pile.push(n);
  }
  return racine;
}

/* ---------- sélecteurs simples ---------- */

function analyserSimple(s) {
  var c = { tag: null, id: null, classes: [], attrs: [], checked: false }, m;
  var re = /([#.]?)([\w-]+)|\[([\w-]+)(?:([~^$*]?=)"?([^\]"]*)"?)?\]|:(checked)/g;
  while ((m = re.exec(s))) {
    if (m[6]) c.checked = true;
    else if (m[3]) c.attrs.push({ nom: m[3].toLowerCase(), op: m[4] || "", val: m[5] });
    else if (m[1] === "#") c.id = m[2];
    else if (m[1] === ".") c.classes.push(m[2]);
    else c.tag = m[2].toLowerCase();
  }
  return c;
}
function simpleOk(n, c) {
  if (c.tag && n.tag !== c.tag) return false;
  if (c.id && n.attrs.id !== c.id) return false;
  var cl = (n.attrs["class"] || "").split(/\s+/);
  for (var i = 0; i < c.classes.length; i++) if (cl.indexOf(c.classes[i]) < 0) return false;
  if (c.checked && !(n.el ? n.el.checked : "checked" in n.attrs)) return false;
  for (var j = 0; j < c.attrs.length; j++) {
    var a = c.attrs[j], v = n.attrs[a.nom];
    if (v === undefined) return false;
    if (a.op === "=" && v !== a.val) return false;
    if (a.op === "^=" && v.indexOf(a.val) !== 0) return false;
    if (a.op === "*=" && v.indexOf(a.val) < 0) return false;
    if (a.op === "$=" && v.slice(-a.val.length) !== a.val) return false;
  }
  return true;
}
/* sélecteur : virgules, descendants (espace) et enfants directs (>) */
function correspond(n, selecteur, limite) {
  return selecteur.split(",").some(function (un) {
    var parts = un.trim().replace(/\s*>\s*/g, " > ").split(/\s+/).filter(Boolean), i = parts.length - 1, courant = n;
    if (!simpleOk(courant, analyserSimple(parts[i]))) return false;
    var direct = false;
    for (i--; i >= 0; i--) {
      if (parts[i] === ">") { direct = true; continue; }
      var c = analyserSimple(parts[i]), p = courant.parent, ok = false;
      while (p && p !== limite) { if (simpleOk(p, c)) { ok = true; courant = p; break; } if (direct) break; p = p.parent; }
      if (!ok) return false;
      direct = false;
    }
    return true;
  });
}
function parcourir(n, f) { n.enfants.forEach(function (e) { f(e); parcourir(e, f); }); }

/* ---------- DOM ---------- */

function creerNavigateur(opts) {
  var erreurs = opts.erreurs;
  var version = 0;                       // incrémenté à chaque changement de structure (invalide le cache d'identifiants)
  var cacheIds = null;
  var racineDoc = analyserHtml(opts.html);
  var corps = noeud("body"), tete = noeud("head");

  function enregistrer(msg, e) { erreurs.push(msg + " : " + (e && e.stack ? String(e.stack).split("\n").slice(0, 3).join(" | ") : String(e))); }

  function enveloppe(n) {
    if (n.el) return n.el;
    var el = { _n: n, _classes: null, _html: "", _ecouteurs: {}, style: {}, files: [], value: n.attrs.value || "", checked: "checked" in n.attrs, disabled: "disabled" in n.attrs,
      textContent: "", innerText: "", selectedIndex: 0, scrollTop: 0, scrollLeft: 0, offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0, scrollHeight: 0 };
    var classes = (n.attrs["class"] || "").split(/\s+/).filter(Boolean);
    el.classList = {
      add: function () { for (var i = 0; i < arguments.length; i++) if (classes.indexOf(arguments[i]) < 0) classes.push(arguments[i]); },
      remove: function () { for (var i = 0; i < arguments.length; i++) { var k = classes.indexOf(arguments[i]); if (k >= 0) classes.splice(k, 1); } },
      toggle: function (c, force) { var a = classes.indexOf(c) >= 0, veut = force === undefined ? !a : !!force; if (veut && !a) classes.push(c); if (!veut && a) classes.splice(classes.indexOf(c), 1); return veut; },
      contains: function (c) { return classes.indexOf(c) >= 0; }
    };
    n.classes = classes;
    var ds = {};
    Object.keys(n.attrs).forEach(function (k) { if (k.indexOf("data-") === 0) ds[k.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = n.attrs[k]; });
    el.dataset = ds;
    var cache = {};
    Object.defineProperties(el, {
      id: { get: function () { return n.attrs.id || ""; }, set: function (v) { n.attrs.id = String(v); version++; } },
      tagName: { get: function () { return n.tag.toUpperCase(); } },
      nodeName: { get: function () { return n.tag.toUpperCase(); } },
      nodeType: { get: function () { return 1; } },
      className: { get: function () { return classes.join(" "); }, set: function (v) { classes.length = 0; String(v).split(/\s+/).filter(Boolean).forEach(function (c) { classes.push(c); }); } },
      hidden: { get: function () { return "hidden" in n.attrs; }, set: function (v) { if (v) n.attrs.hidden = ""; else delete n.attrs.hidden; } },
      type: { get: function () { return n.attrs.type || (n.tag === "button" ? "submit" : ""); }, set: function (v) { n.attrs.type = v; } },
      name: { get: function () { return n.attrs.name || ""; }, set: function (v) { n.attrs.name = v; } },
      href: { get: function () { return n.attrs.href || ""; }, set: function (v) { n.attrs.href = v; } },
      src: { get: function () { return n.attrs.src || ""; }, set: function (v) { n.attrs.src = v; } },
      download: { get: function () { return n.attrs.download || ""; }, set: function (v) { n.attrs.download = v; } },
      title: { get: function () { return n.attrs.title || ""; }, set: function (v) { n.attrs.title = v; } },
      placeholder: { get: function () { return n.attrs.placeholder || ""; }, set: function (v) { n.attrs.placeholder = v; } },
      innerHTML: {
        get: function () { return el._html; },
        set: function (v) { el._html = String(v); n.enfants = analyserHtml(el._html).enfants; n.enfants.forEach(function (e) { e.parent = n; }); version++; }
      },
      children: { get: function () { return n.enfants.map(enveloppe); } },
      childNodes: { get: function () { return n.enfants.map(enveloppe); } },
      firstChild: { get: function () { return n.enfants.length ? enveloppe(n.enfants[0]) : null; } },
      firstElementChild: { get: function () { return n.enfants.length ? enveloppe(n.enfants[0]) : null; } },
      lastChild: { get: function () { return n.enfants.length ? enveloppe(n.enfants[n.enfants.length - 1]) : null; } },
      parentNode: { get: function () { return n.parent && n.parent.tag !== "#racine" ? enveloppe(n.parent) : (n.parent ? enveloppe(corps) : null); } },
      parentElement: { get: function () { return n.parent && n.parent.tag !== "#racine" ? enveloppe(n.parent) : null; } },
      options: { get: function () { var o = []; parcourir(n, function (e) { if (e.tag === "option") o.push(enveloppe(e)); }); return o; } },
      length: { get: function () { return n.enfants.length; } }
    });
    el.getAttribute = function (k) { k = String(k).toLowerCase(); return k in n.attrs ? n.attrs[k] : null; };
    el.setAttribute = function (k, v) { k = String(k).toLowerCase(); n.attrs[k] = String(v); if (k === "id") version++; if (k.indexOf("data-") === 0) ds[k.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = String(v); };
    el.removeAttribute = function (k) { delete n.attrs[String(k).toLowerCase()]; };
    el.hasAttribute = function (k) { return String(k).toLowerCase() in n.attrs; };
    el.addEventListener = function (t, f) { (el._ecouteurs[t] = el._ecouteurs[t] || []).push(f); };
    el.removeEventListener = function (t, f) { var l = el._ecouteurs[t] || [], i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
    el.dispatchEvent = function (evt) { return declencher(el, evt.type, evt); };
    el.click = function () { declencher(el, "click"); };
    el.appendChild = function (c) { var cn = c._n || c; if (cn.parent) { var i = cn.parent.enfants.indexOf(cn); if (i >= 0) cn.parent.enfants.splice(i, 1); } cn.parent = n; n.enfants.push(cn); version++; return c; };
    el.append = function () { for (var i = 0; i < arguments.length; i++) if (arguments[i] && arguments[i]._n) el.appendChild(arguments[i]); };
    el.prepend = el.append;
    el.insertBefore = function (c, ref) { var cn = c._n, i = ref && ref._n ? n.enfants.indexOf(ref._n) : -1; if (cn.parent) { var k = cn.parent.enfants.indexOf(cn); if (k >= 0) cn.parent.enfants.splice(k, 1); } cn.parent = n; if (i < 0) n.enfants.push(cn); else n.enfants.splice(i, 0, cn); version++; return c; };
    el.removeChild = function (c) { var i = n.enfants.indexOf(c._n); if (i >= 0) n.enfants.splice(i, 1); version++; return c; };
    el.remove = function () { if (n.parent) { var i = n.parent.enfants.indexOf(n); if (i >= 0) n.parent.enfants.splice(i, 1); n.parent = null; version++; } };
    el.insertAdjacentHTML = function (pos, h) {
      var nouveaux = analyserHtml(String(h)).enfants;
      nouveaux.forEach(function (e) { e.parent = n; });
      n.enfants = pos === "afterbegin" ? nouveaux.concat(n.enfants) : n.enfants.concat(nouveaux);
      el._html += String(h); version++;
    };
    ['lastElementChild','nextElementSibling','previousElementSibling'].forEach(function (k) { Object.defineProperty(el, k, { get: function () {
      if (k === 'lastElementChild') return n.enfants.length ? enveloppe(n.enfants[n.enfants.length - 1]) : null;
      var i = n.parent ? n.parent.enfants.indexOf(n) : -1, v = n.parent ? n.parent.enfants[i + (k === 'nextElementSibling' ? 1 : -1)] : null; return v ? enveloppe(v) : null; } }); });
    el.replaceChildren = function () { n.enfants = []; version++; };
    el.cloneNode = function () { return enveloppe(noeud(n.tag, JSON.parse(JSON.stringify(n.attrs)))); };
    el.contains = function (x) { var p = x && x._n; while (p) { if (p === n) return true; p = p.parent; } return false; };
    el.closest = function (sel) { var p = n; while (p && p.tag !== "#racine") { if (correspond(p, sel)) return enveloppe(p); p = p.parent; } return null; };
    el.matches = function (sel) { return correspond(n, sel); };
    el.querySelector = function (sel) { var r = null; parcourir(n, function (e) { if (!r && correspond(e, sel, n)) r = e; }); return r ? enveloppe(r) : null; };
    el.querySelectorAll = function (sel) { var r = []; parcourir(n, function (e) { if (correspond(e, sel, n)) r.push(enveloppe(e)); }); return r; };
    el.getElementsByTagName = function (t) { var r = []; parcourir(n, function (e) { if (e.tag === String(t).toLowerCase()) r.push(enveloppe(e)); }); return r; };
    el.focus = el.blur = el.select = el.scrollIntoView = el.setCustomValidity = el.reset = el.showModal = el.close = function () {};
    el.getBoundingClientRect = function () { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; };
    el.setSelectionRange = function () {};
    n.el = el;
    return el;
  }

  /* appelle les écouteurs ; toute exception est enregistrée comme une erreur de la page */
  function declencher(el, type, evt) {
    evt = evt || {};
    evt.type = type; evt.target = evt.target || el; evt.currentTarget = el;
    evt.preventDefault = evt.preventDefault || function () {}; evt.stopPropagation = evt.stopPropagation || function () {};
    var liste = (el._ecouteurs[type] || []).slice();
    if (typeof el["on" + type] === "function") liste.push(el["on" + type]);
    liste.forEach(function (f) {
      try { f.call(el, evt); } catch (e) { enregistrer("exception dans l'écouteur « " + type + " » de #" + (el.id || el.tagName), e); }
    });
    return liste.length;
  }

  function indexIds() {
    if (cacheIds && cacheIds.v === version) return cacheIds.map;
    var map = {};
    [racineDoc, corps, tete].forEach(function (r) { parcourir(r, function (n) { if (n.attrs.id && !map[n.attrs.id]) map[n.attrs.id] = n; }); });
    cacheIds = { v: version, map: map };
    return map;
  }

  var ecouteursDoc = {};
  var document = {
    getElementById: function (id) { var n = indexIds()[id]; return n ? enveloppe(n) : null; },
    querySelector: function (sel) { var r = null; [racineDoc, corps].forEach(function (rc) { parcourir(rc, function (n) { if (!r && correspond(n, sel)) r = n; }); }); return r ? enveloppe(r) : null; },
    querySelectorAll: function (sel) { var r = []; [racineDoc, corps].forEach(function (rc) { parcourir(rc, function (n) { if (correspond(n, sel)) r.push(enveloppe(n)); }); }); return r; },
    getElementsByTagName: function (t) { return document.querySelectorAll(t); },
    getElementsByClassName: function (c) { return document.querySelectorAll("." + c); },
    createElement: function (t) { return enveloppe(noeud(String(t).toLowerCase())); },
    createTextNode: function (t) { return { nodeType: 3, textContent: String(t), _n: noeud("#texte") }; },
    createDocumentFragment: function () { return enveloppe(noeud("#fragment")); },
    addEventListener: function (t, f) { (ecouteursDoc[t] = ecouteursDoc[t] || []).push(f); },
    removeEventListener: function () {},
    write: function () {}, execCommand: function () { return false; },
    title: "", hidden: false, readyState: "complete", cookie: "", referrer: "", activeElement: null, visibilityState: "visible",
    fonts: { ready: Promise.resolve() }
  };
  document.body = enveloppe(corps); document.head = enveloppe(tete); document.documentElement = enveloppe(noeud("html"));
  // le <body> réel contient les éléments de la page : on les rattache pour que body.querySelector fonctionne
  corps.enfants = racineDoc.enfants; racineDoc.enfants.forEach(function (e) { e.parent = corps; });
  racineDoc = noeud("#racine-vide");

  /* ---------- stockage local ---------- */
  var stock = {};
  Object.keys(opts.localStorage || {}).forEach(function (k) { stock[k] = String(opts.localStorage[k]); });
  var localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(stock, k) ? stock[k] : null; },
    setItem: function (k, v) { stock[k] = String(v); }, removeItem: function (k) { delete stock[k]; }, clear: function () { stock = {}; },
    key: function (i) { return Object.keys(stock)[i] || null; }
  };
  Object.defineProperty(localStorage, "length", { get: function () { return Object.keys(stock).length; } });

  /* ---------- contexte global ---------- */
  var ctx = {
    document: document, localStorage: localStorage, sessionStorage: localStorage,
    navigator: { serviceWorker: { register: function () { return Promise.resolve(); } }, storage: { persist: function () { return Promise.resolve(false); }, estimate: function () { return Promise.resolve({ usage: 0, quota: 1e9 }); } }, userAgent: "node", clipboard: { writeText: function () { return Promise.resolve(); } }, onLine: true, language: "fr-FR" },
    location: { protocol: "file:", href: "file:///index.html", hash: "", search: "", pathname: "/index.html", reload: function () {} },
    history: { replaceState: function () {}, pushState: function () {} },
    setTimeout: function (f, ms) { var t = setTimeout(function () { try { f(); } catch (e) { enregistrer("exception dans un setTimeout", e); } }, Math.min(ms || 0, 20)); if (t.unref) t.unref(); return t; },
    clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function (f) { var t = setTimeout(function () { try { f(0); } catch (e) { enregistrer("exception dans un requestAnimationFrame", e); } }, 0); if (t.unref) t.unref(); return t; },
    cancelAnimationFrame: function () {},
    matchMedia: function () { return { matches: false, addEventListener: function () {}, addListener: function () {} }; },
    getComputedStyle: function () { return { getPropertyValue: function () { return ""; } }; },
    scrollTo: function () {}, print: function () {}, open: function () { return null; }, focus: function () {}, close: function () {},
    confirm: function () { return false; }, alert: function () {}, prompt: function () { return null; },
    addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return true; },
    innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, isSecureContext: true,
    FileReader: function () { this.readAsText = function () {}; this.readAsArrayBuffer = function () {}; },
    DOMParser: function () { this.parseFromString = function () { return { documentElement: {}, querySelector: function () { return null; }, querySelectorAll: function () { return []; } }; }; },
    Event: function (t) { this.type = t; }, CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; }, DataTransfer: function () { this.files = []; },
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    ResizeObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    URL: (function () { var U = function (a, b) { return new URL(a, b); }; U.createObjectURL = function () { return "blob:fumee"; }; U.revokeObjectURL = function () {}; return U; })()
  };
  ["Array", "Object", "String", "Number", "Boolean", "Date", "Math", "JSON", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "Promise", "Map", "Set", "WeakMap", "WeakSet", "Symbol",
    "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape",
    "Uint8Array", "Uint16Array", "Uint32Array", "Int32Array", "Float64Array", "ArrayBuffer", "DataView", "TextEncoder", "TextDecoder", "Blob", "File",
    "Intl", "structuredClone", "DecompressionStream", "CompressionStream", "Response", "btoa", "atob", "crypto", "queueMicrotask", "performance", "AbortController"].forEach(function (k) {
    if (typeof globalThis[k] !== "undefined") ctx[k] = globalThis[k];
  });
  if (opts.indexedDB) { ctx.indexedDB = opts.indexedDB.indexedDB; ctx.IDBKeyRange = opts.indexedDB.IDBKeyRange; }
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.parent = ctx; ctx.top = ctx;
  ctx.console = { log: function () {}, warn: function () {}, info: function () {}, debug: function () {}, error: function () {} };

  return {
    ctx: ctx, document: document, erreurs: erreurs, stock: function () { return stock; }, declencher: declencher, enveloppe: enveloppe,
    /* éléments de la page ayant au moins un écouteur de clic, dans l'ordre du document */
    cliquables: function (dans) {
      var r = [], base = dans ? (dans._n || dans) : corps;
      parcourir(base, function (n) { if (n.el && (n.el._ecouteurs.click || []).length) r.push(n.el); });
      return r;
    },
    ecouteursDocument: ecouteursDoc
  };
}

/* ---------- IndexedDB en mémoire ---------- */

function comparerCles(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) { a = [].concat(a); b = [].concat(b); for (var i = 0; i < Math.max(a.length, b.length); i++) { var c = comparerCles(a[i], b[i]); if (c) return c; } return 0; }
  if (a === b) return 0;
  if (a === undefined) return -1; if (b === undefined) return 1;
  if (typeof a === typeof b) return a < b ? -1 : 1;
  return typeof a === "number" ? -1 : 1;
}
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/* « disque » : l'objet renvoyé conserve les bases entre deux pages (graine puis page testée) */
function creerIndexedDB() {
  var bases = {};
  var IDBKeyRange = { only: function (v) { return { only: v }; } };

  function creerTx(db, mode, rappelFin) {
    var tx = { mode: mode, oncomplete: null, onabort: null, onerror: null, error: null, enAttente: 0, fini: false };
    tx.verifier = function () {
      if (tx.fini || tx.enAttente > 0) return;
      tx.fini = true;
      if (rappelFin) rappelFin(tx);
      if (tx.oncomplete) tx.oncomplete({ target: tx });
    };
    tx.abort = function () { if (tx.fini) return; tx.fini = true; tx.error = tx.error || { name: "AbortError" }; if (tx.onabort) tx.onabort({ target: tx }); };
    tx.requete = function (fn, avecCurseur) {
      var req = { result: undefined, error: null, onsuccess: null, onerror: null, readyState: "pending" };
      tx.enAttente++;
      setImmediate(function () {
        if (tx.fini) { tx.enAttente--; return; }
        try { req.result = fn(req); }
        catch (e) {
          req.error = e; var empeche = false;
          tx.enAttente--;
          if (req.onerror) req.onerror({ target: req, preventDefault: function () { empeche = true; }, stopPropagation: function () {} });
          if (!empeche) { tx.error = e; tx.abort(); } else setImmediate(tx.verifier);
          return;
        }
        req.readyState = "done";
        if (req.onsuccess) { try { req.onsuccess({ target: req }); } catch (e) { tx.error = e; tx.abort(); tx.enAttente--; return; } }
        tx.enAttente--;
        setImmediate(tx.verifier);   // les microtâches de la page (chaînes de promesses) peuvent encore ouvrir des requêtes
      });
      return req;
    };
    setImmediate(tx.verifier);
    tx.objectStore = function (nom) {
      var m = db.magasins[nom];
      if (!m) throw new Error("NotFoundError : magasin « " + nom + " » absent");
      return enveloppeMagasin(tx, m);
    };
    return tx;
  }

  function cle(m, v) {
    if (m.keyPath) return v[m.keyPath];
    return undefined;
  }
  function enveloppeMagasin(tx, m) {
    function ecrire(v, ajout) {
      v = clone(v);
      var k = cle(m, v);
      if (k === undefined && m.auto) { k = ++m.seq; v[m.keyPath] = k; }
      if (k === undefined) throw new Error("DataError");
      if (ajout && m.lignes.has(JSON.stringify(k))) { var e = new Error("ConstraintError"); e.name = "ConstraintError"; throw e; }
      m.lignes.set(JSON.stringify(k), v);
      return k;
    }
    function tout() {
      return Array.from(m.lignes.values()).sort(function (a, b) { return comparerCles(cle(m, a), cle(m, b)); });
    }
    function curseur(req, valeurs) {
      var i = 0;
      function courant() {
        if (i >= valeurs.length) return null;
        var v = valeurs[i];
        return { value: clone(v), key: cle(m, v), primaryKey: cle(m, v), delete: function () { m.lignes.delete(JSON.stringify(cle(m, v))); return tx.requete(function () {}); }, update: function (nv) { m.lignes.set(JSON.stringify(cle(m, v)), clone(nv)); return tx.requete(function () {}); },
          "continue": function () { i++; setImmediate(function () { req.result = courant(); if (req.onsuccess) req.onsuccess({ target: req }); tx.enAttente--; setImmediate(tx.verifier); }); tx.enAttente++; } };
      }
      return courant();
    }
    var s = {
      keyPath: m.keyPath, name: m.nom,
      indexNames: { contains: function (n) { return !!m.indexes[n]; } },
      add: function (v) { return tx.requete(function () { return ecrire(v, true); }); },
      put: function (v) { return tx.requete(function () { return ecrire(v, false); }); },
      get: function (k) { return tx.requete(function () { return clone(m.lignes.get(JSON.stringify(k))); }); },
      getAll: function () { return tx.requete(function () { return tout().map(clone); }); },
      getAllKeys: function () { return tx.requete(function () { return tout().map(function (v) { return cle(m, v); }); }); },
      count: function () { return tx.requete(function () { return m.lignes.size; }); },
      "delete": function (k) { return tx.requete(function () { m.lignes["delete"](JSON.stringify(k)); }); },
      clear: function () { return tx.requete(function () { m.lignes.clear(); }); },
      openCursor: function () { return tx.requete(function (req) { return curseur(req, tout()); }); },
      createIndex: function (nom, chemin, o) { m.indexes[nom] = { chemin: chemin, unique: !!(o && o.unique) }; return {}; },
      index: function (nom) {
        var ix = m.indexes[nom];
        if (!ix) throw new Error("NotFoundError : index « " + nom + " »");
        function val(v) { return Array.isArray(ix.chemin) ? ix.chemin.map(function (c) { return v[c]; }) : v[ix.chemin]; }
        return {
          openCursor: function (plage) { return tx.requete(function (req) { return curseur(req, tout().filter(function (v) { return !plage || comparerCles(val(v), plage.only) === 0; })); }); },
          getAll: function (plage) { return tx.requete(function () { return tout().filter(function (v) { return !plage || comparerCles(val(v), plage.only) === 0; }).map(clone); }); },
          get: function (k) { return tx.requete(function () { return clone(tout().filter(function (v) { return comparerCles(val(v), k) === 0; })[0]); }); },
          count: function () { return tx.requete(function () { return tout().length; }); }
        };
      }
    };
    return s;
  }

  function open(nom, version) {
    var req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, transaction: null };
    setImmediate(function () {
      var b = bases[nom], ancienne = b ? b.version : 0;
      if (!b) b = bases[nom] = { version: 0, magasins: {} };
      var cible = version || (ancienne || 1);
      var db = {
        name: nom, version: cible, onversionchange: null, close: function () {},
        objectStoreNames: { contains: function (n) { return !!b.magasins[n]; } },
        createObjectStore: function (n, o) {
          b.magasins[n] = { nom: n, keyPath: o && o.keyPath, auto: !!(o && o.autoIncrement), seq: 0, lignes: new Map(), indexes: {} };
          return enveloppeMagasin(req.transaction, b.magasins[n]);
        },
        transaction: function (noms, mode) {
          [].concat(noms).forEach(function (n) { if (!b.magasins[n]) throw new Error("NotFoundError : magasin « " + n + " »"); });
          return creerTx(b, mode || "readonly");
        }
      };
      req.result = db;
      if (cible > ancienne) {
        b.version = cible;
        var tx = creerTx(b, "versionchange", function () { if (req.onsuccess) req.onsuccess({ target: req }); });
        tx.onabort = function () { b.version = ancienne; if (req.onerror) req.onerror({ target: req }); };
        req.transaction = tx;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion: ancienne, newVersion: cible });
        setImmediate(tx.verifier);
      } else if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  }

  return { indexedDB: { open: open }, IDBKeyRange: IDBKeyRange, bases: bases };
}

module.exports = { creerNavigateur: creerNavigateur, creerIndexedDB: creerIndexedDB, analyserHtml: analyserHtml };
