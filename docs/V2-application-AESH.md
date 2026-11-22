# V2 de l'application AESH — chantier 1 : « ne plus jamais perdre de données »

> Document de travail versionné (copie de `docs/notes/v2-indexeddb.md`, non versionné). Rien n'est commencé : en attente des réponses des AESH au questionnaire.
> Décidé le 22/11/2026 : les commits de l'étape 4 qui touchent `index.html` (« Importer mon affectation », dernier : `51fcf20`) ne sont pas poussés ; ils partiront avec le premier lot de la V2.

Contenu visé : passage de localStorage à IndexedDB avec `persist()`, sauvegarde automatique dans un fichier quand le navigateur le permet, restauration proposée si l'appli démarre vide.
## Ce qui est déjà prêt

Tout accès au stockage de `index.html` est isolé dans le bloc « stockage » (début du script) :

| Fonction | Rôle actuel (localStorage) |
|---|---|
| `lire()` | texte JSON des données (clé `suivi-aesh-v1`) |
| `ecrire(texte)` | écriture simple, repli en mémoire si impossible (`stockageOk`) |
| `ecrireDonneesStrict(db)` | écrit, relit, compare ; rétablit l'ancien contenu en cas d'échec |
| `lireInstantane()` / `ecrireInstantane(texte)` / `effacerInstantane()` | copie de secours avant import (clé `suivi-aesh-avant-import`), écrite puis relue |

`outils/test-index-sans-module.js` vérifie qu'aucune autre ligne de `index.html` ne touche `localStorage`. Le passage à IndexedDB ne doit donc modifier que ce bloc… **à une réserve près : IndexedDB est asynchrone**, alors que ces fonctions sont synchrones (voir « Asynchrone » ci-dessous).

## Ce que la migration impliquerait

### 1. Données existantes (le point le plus sensible)
- Au premier démarrage de la V2 : si IndexedDB est vide **et** `localStorage["suivi-aesh-v1"]` existe → copier vers IndexedDB, **relire et comparer** (empreinte), et seulement alors marquer « migré ». **Ne jamais supprimer l'ancienne clé** à ce moment : la garder au moins une version entière (et la copie de secours `suivi-aesh-avant-import` aussi).
- Si les deux existent et diffèrent (retour d'une ancienne version en cache, deux onglets) : ne rien écraser, garder la plus récente (`modifie` / `cree` des fiches et rapports) en proposant la fusion existante (`fusionner()`), et télécharger une sauvegarde avant.
- Migration idempotente et reprenable : un drapeau `migre` dans IndexedDB écrit EN DERNIER, dans la même transaction que les données.
- Un navigateur qui a vidé IndexedDB mais gardé localStorage (ou l'inverse) doit retomber sur l'autre support, jamais sur un état vide.
- Le service worker : `CACHE_VERSION` à incrémenter ; une ancienne page en cache (v≤35) continue d'écrire dans localStorage pendant la période d'installation → la migration doit pouvoir se rejouer tant que localStorage change.

### 2. `file://` (index.html ouvert par double-clic)
- Chrome : IndexedDB fonctionne en `file://` mais l'origine est opaque/partagée par fichier selon les versions ; Firefox : une base par chemin de fichier. Les données localStorage et IndexedDB d'un `file://` sont **liées au chemin exact du fichier** : déplacer ou renommer `index.html` fait « perdre » les données (elles sont toujours dans le profil, mais inaccessibles). Aujourd'hui déjà vrai pour localStorage.
- Safari / navigation privée : IndexedDB peut être absent ou en lecture seule. Garder le repli actuel (mémoire) et le bandeau « la sauvegarde ne fonctionne pas ici ».
- La sauvegarde automatique dans un fichier (File System Access API : `showSaveFilePicker`, handle conservé dans IndexedDB) n'existe que sur Chrome/Edge de bureau, en contexte sécurisé : **pas en `file://`**, pas sur Firefox ni Safari, pas sur Android Chrome. Prévoir un repli : rappel de téléchargement de la sauvegarde manuelle (existant, 30 jours) plus fréquent.
- `navigator.storage.persist()` : déjà demandé ; en `file://` souvent refusé. À conserver et à afficher.

### 3. Asynchrone
- `lire()` / `ecrire()` deviennent asynchrones : le démarrage doit attendre la lecture avant de dessiner (`db` n'existe plus au chargement du script). `sauver()` est appelée après chaque mutation, de façon synchrone, dans ~20 endroits.
- Piste la moins risquée : **garder `db` en mémoire et un cache synchrone**, et que `sauver()` déclenche une écriture IndexedDB asynchrone « la dernière gagne » (file d'attente, une écriture à la fois) avec accusé de réception (voyant « enregistré » / alerte si échec). Ainsi le reste du code ne change pas.
- Risque à traiter : fermeture de l'onglet pendant une écriture en attente (`visibilitychange` / `pagehide` pour forcer l'écriture) ; échec silencieux (quota) → bandeau visible + proposition de téléchargement immédiat.
- `ecrireDonneesStrict` et l'instantané (« écrire puis relire ») deviennent des promesses : le flux de `demanderSauvegardeAvant` et de l'import doit être adapté (callbacks ou `Promise`, rester en ES5 : pas d'`async/await`, CLAUDE.md).

### 4. Structure des données
- Un seul enregistrement JSON (comme aujourd'hui) est le plus sûr pour la migration ; un découpage en magasins (élèves / rapports) permettrait des écritures partielles mais complique le « tout ou rien » et la compatibilité avec les sauvegardes `suivi-aesh-backup/1`. À trancher dans la V2 ; le format de sauvegarde, lui, ne change pas.
- Versionner l'enregistrement (`schema: 2`) pour les évolutions suivantes (déjà : champs additifs `archive`, `affecteId`).

### 5. Restauration « si l'appli démarre vide »
- Critère de « vide » : aucune fiche ET aucun rapport ET aucun réglage rempli, alors qu'un fichier de sauvegarde automatique ou une copie existe (handle de fichier mémorisé, ou ancienne clé localStorage, ou copie de secours). Proposer, ne jamais restaurer sans demander. Cas « premier lancement légitime » : ne pas alarmer (pas de handle, pas d'ancienne clé).

### 6. Test de non-perte (à écrire avec la V2)
- Test Node (comme `test-index-sans-module.js`, avec un faux IndexedDB en mémoire dans le contexte `vm`) :
  1. localStorage rempli avec `exemples/FICTIF_sauvegarde_aesh_desordonnee.json` (14 fiches, 19 rapports), IndexedDB vide → démarrage → mêmes fiches, mêmes rapports, mêmes notes, ancienne clé intacte ;
  2. migration interrompue à chaque étape (écriture partielle simulée) → relance → aucune perte, aucune duplication ;
  3. échec d'écriture IndexedDB (quota) → bandeau + données intactes en mémoire + localStorage conservé ;
  4. démarrage vide avec sauvegarde disponible → restauration proposée, rien d'écrasé sans accord ;
  5. import d'affectation puis « Revenir à l'état d'avant » sur le nouveau support (même test de non-perte que `retourEtatAvant`).
- Test navigateur à la main : `file://` (Chrome, Firefox), HTTP(S) installé en PWA, navigation privée, avec des données de test réelles anonymisées.

## Ordre conseillé
1. Publier le lot « Importer mon affectation » (étape 4, déjà prêt) avec le premier lot V2.
2. Migration IndexedDB avec cache synchrone, ancienne clé conservée, tests de non-perte.
3. Sauvegarde automatique dans un fichier (Chrome/Edge) + rappel renforcé ailleurs.
4. Restauration proposée au démarrage vide.
