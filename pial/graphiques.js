"use strict";

/* =====================================================================
   PialGraphiques — graphiques SVG construits à la main, sans dépendance
   externe (pas de bibliothèque de graphiques, pas de CDN). Chaque
   fonction renvoie une chaîne SVG prête à être injectée dans le DOM,
   aussi bien pour l'affichage écran que pour l'impression : le SVG
   utilise un viewBox et s'adapte à la largeur de son conteneur (voir la
   règle CSS ".carte-graphique svg{width:100%;height:auto}" dans
   index.html), donc il s'imprime net en A4 quelle que soit la taille
   d'écran d'origine.

   Choix de conception :
   - Pas d'animation, pas d'interactivité complexe : uniquement des
     formes statiques.
   - Chaque famille de couleurs est doublée d'un motif (hachures,
     pointillés, croisillons...) via des <pattern> SVG, pour rester
     distinguable même à l'impression noir et blanc.
   - Les valeurs numériques sont toujours écrites directement sur le
     graphique (à côté des barres, dans la légende du camembert) plutôt
     que devinées visuellement.
   - Le cas "aucune donnée" renvoie un message clair plutôt qu'un SVG
     vide ou une exception.
   ===================================================================== */
var PialGraphiques = (function () {

  var COULEURS = ["#1F3B63", "#3A5A85", "#697079", "#B0473C", "#2F6B4F", "#9AA1A9", "#C6CFE3"];
  var MOTIFS = ["plein", "hachure-45", "pointille", "hachure-135", "croisillon", "hachure-verticale", "plein"];

  var compteurId = 0;
  function idUnique(prefixe) { compteurId++; return prefixe + "-" + compteurId + "-" + Math.random().toString(36).slice(2, 6); }

  function ech(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function motifSvg(id, coul, motif) {
    var fond = '<rect width="8" height="8" fill="' + coul + '"/>';
    switch (motif) {
      case "hachure-45":
        return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' + fond + '<line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" stroke-opacity=".55" stroke-width="2"/></pattern>';
      case "hachure-135":
        return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">' + fond + '<line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" stroke-opacity=".55" stroke-width="2"/></pattern>';
      case "pointille":
        return '<pattern id="' + id + '" width="7" height="7" patternUnits="userSpaceOnUse">' + fond.replace("8", "7") + '<circle cx="1.6" cy="1.6" r="1.2" fill="#ffffff" fill-opacity=".65"/></pattern>';
      case "croisillon":
        return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse">' + fond + '<path d="M0 0L6 6M6 0L0 6" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.3"/></pattern>';
      case "hachure-verticale":
        return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse">' + fond + '<line x1="3" y1="0" x2="3" y2="6" stroke="#ffffff" stroke-opacity=".55" stroke-width="2"/></pattern>';
      default:
        return '<pattern id="' + id + '" width="8" height="8" patternUnits="userSpaceOnUse">' + fond + '</pattern>';
    }
  }
  // prépare n remplissages (couleur + motif) distincts, renvoie {defs, ids:[idCss,...]}
  function preparerMotifs(n) {
    var defs = "", ids = [];
    for (var i = 0; i < n; i++) {
      var coul = COULEURS[i % COULEURS.length], motif = MOTIFS[i % MOTIFS.length];
      var id = idUnique("motif");
      ids.push(id);
      defs += motifSvg(id, coul, motif);
    }
    return { defs: defs, ids: ids };
  }

  function ouvrirSvg(largeur, hauteur, classe) {
    return '<svg class="graphique-svg ' + (classe || "") + '" viewBox="0 0 ' + largeur + ' ' + hauteur + '" width="100%" role="img" xmlns="http://www.w3.org/2000/svg">';
  }
  function messageVide(texte) {
    var t = ech(texte || "Aucune donnée sur la période.");
    return ouvrirSvg(420, 80, "graphique-vide")
      + '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="13" font-style="italic" fill="#697079">' + t + '</text></svg>';
  }

  /* ---------- camembert ---------- */
  // data: [{libelle, valeur}]
  function camembert(data, options) {
    options = options || {};
    data = (data || []).filter(function (d) { return d && d.valeur > 0; });
    var total = data.reduce(function (s, d) { return s + d.valeur; }, 0);
    if (!total) return messageVide(options.texteVide);
    var larg = options.largeur || 420;
    var haut = Math.max(220, 20 + data.length * 22);
    var cx = 108, cy = haut / 2, r = Math.min(cy, 118) - 16;
    var m = preparerMotifs(data.length);
    var angle = -Math.PI / 2, chemins = "";
    function pt(a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
    data.forEach(function (d, i) {
      var part = d.valeur / total * Math.PI * 2;
      var a0 = angle, a1 = angle + part;
      var chemin;
      if (data.length === 1) {
        chemin = 'M' + (cx - r) + ',' + cy + ' a ' + r + ',' + r + ' 0 1,0 ' + (2 * r) + ',0 a ' + r + ',' + r + ' 0 1,0 -' + (2 * r) + ',0 Z';
      } else {
        var p0 = pt(a0), p1 = pt(a1);
        var grand = (part > Math.PI) ? 1 : 0;
        chemin = 'M' + cx + ',' + cy + ' L' + p0[0].toFixed(1) + ',' + p0[1].toFixed(1)
          + ' A' + r + ',' + r + ' 0 ' + grand + ' 1 ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) + ' Z';
      }
      chemins += '<path d="' + chemin + '" fill="url(#' + m.ids[i] + ')" stroke="#fff" stroke-width="1.5"/>';
      angle = a1;
    });
    var legende = "";
    data.forEach(function (d, i) {
      var pct = Math.round(d.valeur / total * 100);
      var y = 20 + i * 22;
      legende += '<rect x="234" y="' + (y - 11) + '" width="14" height="14" fill="url(#' + m.ids[i] + ')" stroke="#C6CFE3"/>'
        + '<text x="254" y="' + y + '" font-size="12.5" fill="#23262B">' + ech(d.libelle) + ' — ' + d.valeur + ' (' + pct + '%)</text>';
    });
    return ouvrirSvg(larg, haut, "graphique-camembert") + '<defs>' + m.defs + '</defs>' + chemins + legende + '</svg>';
  }

  /* ---------- barres verticales (une série) ---------- */
  // data: [{libelle, valeur}]
  function barresVerticales(data, options) {
    options = options || {};
    data = data || [];
    var total = data.reduce(function (s, d) { return s + d.valeur; }, 0);
    if (!data.length || !total) return messageVide(options.texteVide);
    var larg = options.largeur || 520;
    var hautZone = 160, margeBas = 40, margeHaut = 22;
    var haut = hautZone + margeBas + margeHaut;
    var n = data.length;
    var maxV = Math.max.apply(null, data.map(function (d) { return d.valeur; }));
    var pas = (larg - 44) / n;
    var largeurBarre = Math.max(10, Math.min(52, pas - 14));
    var m = preparerMotifs(1);
    var barres = "", etiquettes = "";
    data.forEach(function (d, i) {
      var h = maxV ? Math.round(d.valeur / maxV * hautZone) : 0;
      var x = 34 + i * pas + (pas - largeurBarre) / 2;
      var y = margeHaut + (hautZone - h);
      barres += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + largeurBarre.toFixed(1) + '" height="' + h + '" fill="url(#' + m.ids[0] + ')"/>'
        + '<text x="' + (x + largeurBarre / 2).toFixed(1) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="12" fill="#23262B">' + d.valeur + '</text>';
      etiquettes += '<text x="' + (x + largeurBarre / 2).toFixed(1) + '" y="' + (margeHaut + hautZone + 18) + '" text-anchor="middle" font-size="11" fill="#697079">' + ech(d.libelle) + '</text>';
    });
    return ouvrirSvg(larg, haut, "graphique-barres")
      + '<defs>' + m.defs + '</defs>'
      + '<line x1="30" y1="' + (margeHaut + hautZone) + '" x2="' + (larg - 10) + '" y2="' + (margeHaut + hautZone) + '" stroke="#C6CFE3"/>'
      + barres + etiquettes + '</svg>';
  }

  /* ---------- barres horizontales (une série, classement) ---------- */
  // data: [{libelle, valeur}]
  function barresHorizontales(data, options) {
    options = options || {};
    data = (data || []).slice().sort(function (a, b) { return b.valeur - a.valeur; });
    if (!data.length) return messageVide(options.texteVide);
    var larg = options.largeur || 520;
    var hLigne = 26, margeHaut = 12;
    var haut = margeHaut * 2 + data.length * hLigne;
    var maxV = Math.max.apply(null, data.map(function (d) { return d.valeur; }));
    var zoneEtiquette = Math.min(180, larg * 0.32), zoneBarre = larg - zoneEtiquette - 46;
    var m = preparerMotifs(1);
    var lignes = "";
    data.forEach(function (d, i) {
      var y = margeHaut + i * hLigne;
      var w = maxV ? Math.round(d.valeur / maxV * zoneBarre) : 0;
      lignes += '<text x="' + (zoneEtiquette - 8) + '" y="' + (y + hLigne / 2 + 4) + '" text-anchor="end" font-size="12" fill="#23262B">' + ech(d.libelle) + '</text>'
        + '<rect x="' + zoneEtiquette + '" y="' + (y + 4) + '" width="' + w + '" height="' + (hLigne - 9) + '" fill="url(#' + m.ids[0] + ')"/>'
        + '<text x="' + (zoneEtiquette + w + 6) + '" y="' + (y + hLigne / 2 + 4) + '" font-size="12" fill="#23262B">' + d.valeur + '</text>';
    });
    return ouvrirSvg(larg, haut, "graphique-barres-h") + '<defs>' + m.defs + '</defs>' + lignes + '</svg>';
  }

  /* ---------- barres empilées, une colonne par mois ---------- */
  // mois: [libelle,...]  series: [{libelle, valeurs:[n,...]}] (même longueur que mois)
  function barresEmpileesMensuelles(mois, series, options) {
    options = options || {};
    mois = mois || []; series = series || [];
    var total = series.reduce(function (s, se) { return s + se.valeurs.reduce(function (a, b) { return a + b; }, 0); }, 0);
    if (!mois.length || !total) return messageVide(options.texteVide);
    var larg = options.largeur || 600;
    var hautZone = 150, margeBas = 40, margeHaut = 20, hautLegende = 20 * series.length;
    var haut = hautZone + margeBas + margeHaut + hautLegende + 8;
    var n = mois.length;
    var maxV = 0;
    for (var i = 0; i < n; i++) {
      var s = 0;
      series.forEach(function (se) { s += se.valeurs[i] || 0; });
      if (s > maxV) maxV = s;
    }
    var pas = (larg - 44) / n;
    var largeurBarre = Math.max(8, Math.min(40, pas - 10));
    var m = preparerMotifs(series.length);
    var barres = "", etiquettes = "";
    for (i = 0; i < n; i++) {
      var x = 34 + i * pas + (pas - largeurBarre) / 2;
      var yCum = margeHaut + hautZone;
      for (var sIdx = 0; sIdx < series.length; sIdx++) {
        var v = series[sIdx].valeurs[i] || 0;
        var h = maxV ? Math.round(v / maxV * hautZone) : 0;
        if (h > 0) {
          yCum -= h;
          barres += '<rect x="' + x.toFixed(1) + '" y="' + yCum + '" width="' + largeurBarre.toFixed(1) + '" height="' + h + '" fill="url(#' + m.ids[sIdx] + ')"/>';
        }
      }
      etiquettes += '<text x="' + (x + largeurBarre / 2).toFixed(1) + '" y="' + (margeHaut + hautZone + 16) + '" text-anchor="middle" font-size="10" fill="#697079">' + ech(mois[i]) + '</text>';
    }
    var legende = "";
    series.forEach(function (se, i2) {
      var totalSerie = se.valeurs.reduce(function (a, b) { return a + b; }, 0);
      var y = margeHaut + hautZone + margeBas + i2 * 20;
      legende += '<rect x="30" y="' + (y - 12) + '" width="14" height="14" fill="url(#' + m.ids[i2] + ')" stroke="#C6CFE3"/>'
        + '<text x="50" y="' + (y - 1) + '" font-size="12" fill="#23262B">' + ech(se.libelle) + ' — ' + totalSerie + '</text>';
    });
    return ouvrirSvg(larg, haut, "graphique-barres-empilees")
      + '<defs>' + m.defs + '</defs>'
      + '<line x1="30" y1="' + (margeHaut + hautZone) + '" x2="' + (larg - 10) + '" y2="' + (margeHaut + hautZone) + '" stroke="#C6CFE3"/>'
      + barres + etiquettes + legende + '</svg>';
  }

  return {
    camembert: camembert,
    barresVerticales: barresVerticales,
    barresHorizontales: barresHorizontales,
    barresEmpileesMensuelles: barresEmpileesMensuelles,
    messageVide: messageVide
  };
})();
