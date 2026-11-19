# Espace coordonnateur PIAL — Module « Affectations »

Spécification fonctionnelle et technique, destinée à Claude Code.
À placer dans le dépôt sous `docs/SPEC-affectations-PIAL.md`.

> Rappel : toutes les règles de `CLAUDE.md` s'appliquent sans exception. Aucune dépendance externe, aucune requête réseau, fonctionnement sous `file://`, JS style ES5 (`var`, `function`), interface entièrement en français.

---

## 1. Objectif

Le coordonnateur PIAL importe trois fichiers : élèves, AESH et emplois du temps des élèves. L'outil doit alors :

1. **proposer** des affectations AESH ↔ élèves créneau par créneau ;
2. **montrer** immédiatement si les besoins sont couverts (élèves) et si les quotités sont respectées (AESH) ;
3. permettre de **modifier** facilement chaque affectation, avec une vision claire et rapide ;
4. **produire** l'emploi du temps de chaque AESH, puis un dossier d'envoi par AESH ;
5. offrir des **statistiques** filtrables ;
6. tenir une **fiche par AESH**, enrichie par les rapports déjà importés (types d'accompagnement réalisés, niveaux accompagnés…) ;
7. garder un **historique** des affectations dans l'année.

Utilisateur unique pour l'instant : le coordonnateur. Sorties attendues : export, sauvegarde sur clé USB, impression PDF.

Le module s'intègre à l'application existante `/pial/` : nouveaux onglets, nouveaux magasins IndexedDB. Ce n'est pas une nouvelle application.

---

## 2. Fichiers d'entrée (gabarits)

Aucun format SIECLE ni Pronote n'est imposé : **l'outil fournit ses propres gabarits**. Le coordonnateur les remplit, éventuellement par copier-coller depuis ses exports.

### 2.1 Règles communes d'import

- Formats acceptés : **CSV** (séparateur `;` ou `,`, détecté automatiquement) et **XLSX** (première feuille).
- Encodage CSV : essayer UTF-8 (avec ou sans BOM). Si le décodage échoue (`TextDecoder` avec `fatal:true`), basculer en **Windows-1252** : c'est le cas fréquent des CSV produits par Excel en français.
- XLSX lu **sans bibliothèque** : un XLSX est une archive ZIP. Lire le répertoire central, décompresser les entrées utiles avec `DecompressionStream("deflate-raw")`, puis analyser `xl/sharedStrings.xml` et la première feuille (trouvée via `xl/workbook.xml` et ses relations, pas forcément `sheet1.xml`) avec un petit lecteur XML interne plutôt que `DOMParser`, pour que le même code soit testé dans le navigateur et sous Node. Les nombres sont lus bruts ; les dates (n° de série Excel) et heures (fraction de jour) sont converties champ par champ. Si `DecompressionStream` est absent (vieux navigateur), afficher le message « Enregistrez le fichier en CSV et réimportez-le ».
- **Écran de correspondance des colonnes** : les colonnes sont reconnues automatiquement par synonymes (casse et accents ignorés : « Nom », « NOM ÉLÈVE », « nom_eleve »…). Le coordonnateur corrige si besoin, et la correspondance retenue est mémorisée pour les imports suivants.
- **Aperçu avant validation** : nombre de lignes reconnues, lignes en erreur (avec le motif), doublons. Rien n'est écrit en base avant la confirmation.
- **Réimport** : propose « Mettre à jour » (fusion par clé) ou « Remplacer ». Le remplacement passe par une confirmation renforcée qui affiche les nombres exacts, comme dans l'application actuelle.
- Les gabarits sont téléchargeables depuis l'onglet Import, au format CSV UTF-8 avec BOM et séparateur `;` (s'ouvre correctement dans Excel en français). Chaque gabarit contient une ligne d'en-tête et deux lignes d'exemple fictives.

### 2.2 Gabarit `eleves.csv`

| Colonne | Obligatoire | Exemple | Remarque |
|---|---|---|---|
| Etablissement | oui | Collège Paul Gauthier | |
| Classe | oui | 5B | |
| Prenom | oui | Lucas | |
| Nom | oui | Martin | **seule l'initiale est conservée** (voir §3) ; une valeur terminée par un point (« Ma. ») est gardée telle quelle |
| Heures_individuelles | non | 6 | heures/semaine, décimales acceptées (1,5) |
| Heures_mutualisees | non | 4 | heures/semaine |
| Recreation | non | oui/non/prioritaire | accompagnement pendant les récréations ; `prioritaire` = oui, avec des créneaux prioritaires par défaut (§5.2) |
| Pause_meridienne | non | oui/non/prioritaire | accompagnement pendant la pause méridienne ; `prioritaire` : idem |
| Besoins | non | Secrétaire, scripteur \| Aide aux déplacements | valeurs de la liste ACCOMP (§7.2), séparées par `\|` |
| Debut_notification | non | 2026-09-01 | |
| Fin_notification | non | 2027-07-04 | alerte quand la date approche |

Au moins une des deux colonnes d'heures doit être supérieure à 0.

Les colonnes `Recreation` et `Pause_meridienne` ne sont lues que si le réglage « Gérer les temps périscolaires » est coché (§5.2). Sinon elles sont ignorées, même si leur valeur est invalide, et l'aperçu d'import signale les lignes où elles sont remplies (`oui`, `prioritaire` ou autre valeur que `non`). L'élève importé n'a alors ni `recreation` ni `meridienne` : une mise à jour garde les valeurs déjà en base.

### 2.3 Gabarit `aesh.csv`

| Colonne | Obligatoire | Exemple | Remarque |
|---|---|---|---|
| Nom | oui | Durand | |
| Prenom | oui | Sophie | |
| Quotite_hebdo | oui | 24 | heures/semaine |
| Email | non | sophie.durand@ac-aix-marseille.fr | sert aux brouillons de mail |
| Etablissements | non | Collège Paul Gauthier \| École Jean Moulin | établissements possibles ; vide = tous |
| Indisponibilites | non | mer; ven-am | jours (`lun`…`ven`) ou demi-journées (`-am`/`-pm`) |
| Formations | non | TSA \| LSF | compétences déclarées (§7.3) |

**Identifiant d'une AESH** : `nom|prenom` normalisé (casse, accents, espaces), par exemple `durand|sophie`. Le nom complet des AESH est conservé : la minimisation du §3 ne vise que les élèves.

### 2.4 Gabarit `edt_eleves.csv` — une ligne par cours

| Colonne | Obligatoire | Exemple | Remarque |
|---|---|---|---|
| Etablissement | oui | Collège Paul Gauthier | |
| Classe | oui | 5B | |
| Eleve | oui | Lucas M. | Prénom + initiale du nom |
| Jour | oui | lundi | |
| Debut | oui | 08:00 | |
| Fin | oui | 08:55 | |
| Matiere | oui | Mathématiques | |
| Semaine | non | A / B / vide | vide = toutes les semaines |
| Groupe | non | ESP2 | groupe, salle ou intitulé du cours |
| Priorite | non | prioritaire / exclu / vide | pré-remplissage possible (§5.2) |

Le **groupe** sert à savoir si deux élèves de la même classe suivent vraiment le même cours (LV2, options, demi-groupes). Deux élèves ne peuvent être mutualisés sur un créneau que s'ils ont la même classe, le même créneau, la même matière **et** le même groupe (ou un groupe vide pour les deux).

### 2.5 Paramètres des établissements (saisis dans l'application, pas importés)

Ajouté automatiquement au premier import qui mentionne un nouvel établissement :

- type : école / collège / lycée (le type fixe la valeur par défaut de l'alternance A/B) ;
- alternance semaines A/B : oui/non (oui par défaut pour un collège) ;
- horaires de la récréation du matin et de l'après-midi ;
- horaires de la pause méridienne ;
- plage de la pause repas des AESH (11 h 30 – 14 h par défaut, voir §4.4 contrainte 6) ;
- jours ouvrés (ex. : une école n'a pas classe le mercredi).

---

## 3. Identité des élèves et minimisation

- **Clé élève** : `prenom + " " + initiale_nom + "." | classe | etablissement`, normalisée (casse, accents, espaces). Exemple : `lucas m.|5b|college paul gauthier`. C'est le même format que `nomTransmission()` dans l'application AESH, ce qui permet de rapprocher les rapports.
- **Minimisation** : à l'import, le nom de famille est réduit à son initiale. Le nom complet n'est jamais stocké. Ce choix est cohérent avec le principe déjà retenu pour les transmissions.
- **Collision** (deux « Lucas M. » en 5B dans le même établissement) : l'import est bloqué pour ces lignes. Le coordonnateur doit les différencier, par exemple en écrivant « Ma. » et « Mo. » dans la colonne `Nom` : une valeur de `Nom` qui se termine par un point est considérée comme une abréviation déjà choisie et conservée telle quelle (« Lucas Ma. »).
- **Changement d'année** : comme la classe change, la clé change aussi. Lors du premier import d'une nouvelle année scolaire, proposer de rattacher chaque nouvel élève à un élève de l'année précédente qui a le même prénom, la même initiale, le même établissement et le niveau N+1. Le coordonnateur confirme chaque rapprochement ; c'est lui qui permet de conserver l'historique.
- **Année scolaire** : chaque élève, chaque affectation et chaque version porte une année scolaire (`2026-2027`). Cela permet de réutiliser la purge par année qui existe déjà.
- **Identifiant de stockage** : la clé élève ne contient pas l'année (un redoublant peut retrouver une classe de même nom). L'enregistrement est donc identifié par `id = annee + "|" + cle` (ex. `2026-2027|lucas m.|5b|college paul gauthier`), la clé seule restant indexée.

---

## 4. Règles de calcul (modèle)

À implémenter sous forme de **fonctions pures** dans `pial/modele.js`, testables séparément (§10).

### 4.1 Unités

- **Créneau** : (établissement, jour, début, fin, semaine ∈ {A, B, toutes}).
- **Durée comptée** : par défaut, la durée d'un cours est **arrondie à l'heure la plus proche, avec un minimum de 1 h** (55 min = 1 h, 1 h 50 = 2 h). Réglage : « Compter la durée réelle ». Les récréations et la pause méridienne comptent toujours pour leur durée réelle.
- **Semaines A/B** : on calcule séparément la semaine A et la semaine B. Une ligne marquée « toutes » compte dans les deux.
  - Pour un élève, la couverture affichée est la **moyenne (A+B)/2**. La valeur A ou B s'affiche au survol si elles diffèrent.
  - Pour une AESH, la **quotité doit être respectée dans chacune des deux semaines** (contrainte dure). La moyenne est affichée en plus.
  - Établissement sans alternance : A = B.
  - Un cours « toutes semaines » peut recevoir une AESH différente en A et en B : l'affectation est alors scindée en deux (semaine A, semaine B).

### 4.2 Couverture d'un élève

- Heures individuelles couvertes : somme des créneaux où une AESH lui est affectée **en individuel**.
- Heures mutualisées couvertes : somme des créneaux où une AESH lui est affectée **en mutualisé**, qu'elle accompagne d'autres élèves ou non.
- Comparaison avec la notification, séparément pour l'individuel et le mutualisé, sur la moyenne (A+B)/2.
- **Temps périscolaire** (récréations, pause méridienne) : compté à part. Il n'est pas imputé sur les heures notifiées individuelles ou mutualisées, mais il entre dans la charge de l'AESH.
- L'état global d'un élève est le plus défavorable des deux (individuel, mutualisé).
- États :
  - **sous-couvert** (rouge) : écart ≥ 1 h ;
  - **partiellement couvert** (orange) : écart < 1 h ;
  - **couvert** (vert) ;
  - **sur-couvert** (bleu, simple information).

### 4.3 Charge d'une AESH

- Une heure de présence compte pour **1 h, qu'elle accompagne 1 ou 4 élèves**.
- États :
  - **dépassement** (rouge) : charge > quotité en semaine A **ou** en semaine B ;
  - sinon, l'état se calcule sur la charge moyenne (A+B)/2 :
  - **charge complète** (vert) : charge entre 90 % et 100 % de la quotité ;
  - **sous-utilisée** (orange) : charge < 90 % de la quotité.

### 4.4 Contraintes dures

Le moteur ne les enfreint jamais. Une saisie manuelle peut les enfreindre, mais elle est alors signalée (§5.4).

1. **Pas de chevauchement** : une AESH n'est jamais à deux endroits en même temps.
2. **Individuel exclusif** : sur un créneau individuel, l'AESH n'accompagne que cet élève.
3. **Mutualisation** : elle n'est possible qu'entre élèves notifiés en mutualisé, qui ont la même classe, le même cours et le même groupe (§2.4). Pas de mutualisation entre classes différentes. Exception : sur les temps périscolaires (récréation, pause méridienne), une AESH peut accompagner ensemble tous les élèves concernés d'un même établissement, quelle que soit leur classe.
4. **Changement d'établissement** : il faut au moins **1 h** entre la fin d'un créneau dans l'établissement X et le début d'un créneau dans l'établissement Y. Le temps de trajet n'est pas compté dans la charge.
5. **Quotité** : elle n'est jamais dépassée, ni en semaine A ni en semaine B.
6. **Pause repas de l'AESH** : sur une journée de plus de 6 h de **présence** (somme des créneaux, trajets exclus), l'AESH garde une plage libre continue d'au moins 45 min dans la plage de pause repas. La durée est réglable. La plage (11 h 30 – 14 h par défaut) est réglable **par établissement** (§2.5) ; pour une journée sur plusieurs établissements, on retient la plage de l'établissement du premier créneau de la journée. Si l'AESH est affectée à la pause méridienne d'un élève ce jour-là, sa pause peut se situer en dehors de la plage : on vérifie alors seulement qu'il existe 45 min libres continues dans la journée, et le cas est **signalé** (information) sans être bloqué.
7. **Indisponibilités et établissements possibles** : respectés si le réglage « Respecter les indisponibilités » est activé (activé par défaut). Ce réglage se désactive globalement, et aussi AESH par AESH.

### 4.5 Ce qui n'est pas une contrainte

Une heure non couverte est **seulement signalée**. Il n'y a ni liste d'attente ni classement des élèves entre eux.

---

## 5. Moteur de proposition

Fichier `pial/moteur.js`. L'algorithme est **glouton, déterministe et explicable**. Il ne cherche pas la solution optimale : il doit rester rapide, compréhensible et prévisible.

### 5.1 Contraintes techniques

- Il tourne sur le thread principal : **pas de Web Worker**, car les workers ne fonctionnent pas sous `file://` dans Chrome.
- Durée cible : moins de 2 s pour 150 élèves et 40 AESH. Si besoin, découper le calcul en tranches avec `setTimeout(…, 0)` et afficher une barre de progression.
- Il est **déterministe** : mêmes données, même résultat. Tous les tris sont stables et les égalités sont départagées par clé alphabétique. Aucune utilisation de `Math.random`.

### 5.2 Entrées

- Pour chaque élève : ses cours (EDT) et l'état de chaque créneau parmi **prioritaire / normal / exclu**.
  - Prioritaire : à couvrir en premier.
  - Exclu : ne jamais affecter, par exemple un cours où l'élève n'a pas besoin d'aide.
- Récréations et pause méridienne : seulement si le réglage global **« Gérer les temps périscolaires »** est coché (Réglages → Règles de calcul ; **décoché par défaut**, car ce besoin concerne une petite minorité d'élèves). Décoché : colonnes ignorées à l'import (§2.2), aucun créneau périscolaire dans la grille, le moteur, le rapport de fin ni le bandeau ; les affectations périscolaires déjà en base y restent, mais sont ignorées partout (charge des AESH, alertes) jusqu'à ce que le réglage soit coché de nouveau. Coché : ajoutées comme créneaux de besoin si l'élève est concerné (§2.2), élève par élève (non concerné par défaut). Elles ont le **même état prioritaire / normal / exclu que les cours**, modifiable dans la grille élève (« normal » par défaut, « prioritaire » si l'import le dit). L'état est stocké dans l'élève (`etatsPeriscolaires`, §9.2) : clé `recreation` / `meridienne` pour l'état par défaut du type, clé `type|jour|debut` pour un créneau précis ; on cherche la clé précise, puis le type, puis « normal ». Un import « oui » ne remet pas à « normal » un état choisi dans l'application (même règle que la colonne `Priorite` de l'EDT). Si l'établissement change l'horaire d'une récréation, l'état posé sur l'ancien horaire n'est plus retrouvé et le créneau reprend l'état par défaut du type.
- Les **affectations épinglées** (modifiées ou verrouillées à la main) sont reprises telles quelles.

### 5.3 Déroulement

1. Retirer de la demande ce que couvrent déjà les affectations épinglées.
2. Pour chaque élève, **choisir les créneaux à couvrir**. Un élève a en général plus de cours que d'heures notifiées. Ordre de choix :
   1. les cours prioritaires ;
   2. une répartition équilibrée sur les jours de la semaine (le jour où l'élève a le moins d'heures déjà couvertes d'abord) ;
   3. les matières mentionnées dans ses besoins, si un lien existe — **aucune table besoin → matière n'est définie : critère inactif** (point d'entrée prévu dans `moteur.js`) ;
   4. l'ordre chronologique.

   C'est un **ordre de préférence**, pas une sélection figée : si aucune AESH ne peut prendre un créneau, le moteur passe au suivant, jusqu'à atteindre les heures notifiées ou épuiser les cours non exclus. Quand le reste à couvrir est inférieur à l'apport d'un cours : cours entier si le reste est au moins égal à l'apport ; sinon, si le reste vaut au moins la moitié de l'apport, le cours en **semaine A seulement** (B si A est impossible), soit 0,5 h en moyenne pour un cours d'1 h ; en dessous, l'élève reste « partiellement couvert ».
3. Constituer les **unités de demande** :
   - une unité individuelle par élève et par créneau ;
   - une unité mutualisée par groupe (classe + cours + groupe + créneau) qui rassemble tous les élèves mutualisés présents qui ont encore des heures mutualisées à couvrir et pour qui ce cours n'est pas exclu ;
   - une unité périscolaire par établissement et par créneau (récréation, pause méridienne), qui rassemble tous les élèves concernés (§4.4, contrainte 3).

   Le moteur cherche d'abord une AESH pour toutes les semaines du créneau ; à défaut, il scinde l'unité en semaine A et semaine B (§4.1).
4. Trier les unités :
   1. prioritaires d'abord (y compris les récréations et pauses méridiennes marquées prioritaires) ;
   2. puis individuelles ;
   3. puis mutualisées : l'unité dont l'élève le moins couvert (en proportion de ses heures mutualisées) l'est le moins passe d'abord ; la taille du groupe (la plus nombreuse d'abord) ne fait que départager ;
   4. puis récréations et pause méridienne ;
   5. à égalité, l'élève le moins couvert en proportion passe d'abord (proportion recalculée après chaque affectation, dans la modalité de l'unité) ; puis la clé de l'élève, puis l'ordre chronologique.
5. Pour chaque unité, écarter les AESH qui violent une contrainte dure. Parmi les autres, choisir celle qui obtient le **meilleur score** :

| Critère | Effet |
|---|---|
| Continuité : déjà affectée à cet élève | +40 |
| Même établissement que ses créneaux adjacents du jour | +20 |
| Créneau collé à un autre créneau déjà affecté (journée compacte) | +10 |
| Expérience correspondant aux besoins de l'élève (§7.2) | +5 par besoin correspondant, plafonné à +15 |
| Formation déclarée correspondant aux besoins (§7.3) | +10 |
| Équilibrage : part de quotité restante | +0 à +15, proportionnel |
| Créneau isolé (laisse un trou de plus de 2 h dans sa journée) | −10 |
| Nombre d'AESH différentes pour l'élève dépasse 3 | −25 par AESH au-delà de 3, cumulable |

Les poids sont regroupés dans **un seul objet de configuration** (`POIDS` dans `moteur.js`) pour pouvoir les ajuster. Lecture retenue :
- continuité : l'AESH accompagne déjà au moins un élève de l'unité (affectations épinglées comprises) ;
- même établissement : le créneau précédent ou suivant de l'AESH ce jour-là est dans le même établissement ;
- créneau collé : écart d'au plus 15 min avec un autre créneau de l'AESH (intercours, récréation) ;
- créneau isolé : l'AESH a d'autres créneaux ce jour-là et le plus proche est à plus de 2 h (un créneau seul dans la journée ne crée pas de trou) ;
- équilibrage : 15 × quotité restante ÷ quotité, dans la semaine la plus chargée parmi celles du créneau ;
- plus de 3 AESH : pour chaque élève de l'unité qui n'a pas encore cette AESH, rang qu'elle aurait parmi ses AESH différentes ; −25 pour la 4e, −50 pour la 5e, etc., cumulé sur les élèves de l'unité ;
- expérience et formation : poids présents, mais **sans effet jusqu'à la phase 4** (l'expérience dépend du rapprochement des rapports ; une table formation → besoins est un choix de conformité à valider, §7.3) ;
- égalité de score : identifiant de l'AESH, ordre alphabétique.

Les affectations proposées ont un identifiant déterministe (`mo|aeshId|creneauCle`) : deux exécutions sur les mêmes données donnent un résultat identique.

6. Pour chaque affectation proposée, enregistrer les **raisons** : critères retenus et nombre d'AESH écartées par contrainte. Exemple : « Sophie D. : déjà avec Lucas, même établissement le lundi ».
7. Produire un rapport de fin : heures couvertes / heures demandées, élèves sous-couverts, AESH sous-utilisées, et pour chaque heure non couverte la contrainte qui a bloqué (quotités épuisées, AESH déjà occupées, déplacement impossible…). Le motif d'un élève sous-couvert est le **motif principal** : la contrainte qui a écarté le plus d'AESH sur ses créneaux tentés (d'autres AESH ont pu être écartées pour un autre motif) ; « pas assez de cours » si ses cours non exclus ne suffisent pas. Les AESH qui n'interviennent pas dans l'établissement ne sont comptées ni dans ce motif ni dans les raisons (« 3 AESH écartées (2 quotité, 1 indisponible) ») : elles n'auraient jamais pu prendre le créneau. Le motif « aucune AESH n'intervient dans l'établissement » n'apparaît que si c'est le seul obstacle.

### 5.4 Saisie manuelle

- Toute modification manuelle **épingle** l'affectation concernée.
- Une affectation manuelle peut enfreindre une contrainte. Elle est alors marquée ⚠, avec le motif, et listée dans le panneau d'alertes. Le coordonnateur garde la main.
- « Relancer la proposition » ne recalcule que ce qui n'est pas épinglé.
- « Tout désépingler » existe, derrière une confirmation.

---

## 6. Brouillon, versions, historique

- L'affectation en cours d'édition est un **brouillon**.
- « **Valider** » fige une **version** datée : date d'effet (aujourd'hui par défaut) + commentaire libre facultatif (ex. « Arrivée de Inès B. en 4A »). La validation reste possible s'il reste des conflits, après une confirmation qui en donne le nombre. La version est une copie du brouillon, qui continue d'exister ; elle garde aussi les noms courts, classes et noms des AESH, pour rester lisible si un élève est supprimé ensuite. Une version validée ne se modifie pas et ne s'annule pas.
- L'**historique** liste les versions et offre :
  - la consultation d'une version en lecture seule ;
  - un **comparatif** entre deux versions (créneaux ajoutés, retirés ou changés d'AESH) ;
  - la restauration d'une version comme nouveau brouillon.
- Les exports (§8) portent toujours un numéro de version et une date d'effet.
- Le comparatif se fait par élève × créneau × semaine (A, B) : un créneau scindé en A et B se compare donc correctement à un créneau « toutes semaines ». Une ligne par différence : ajout, retrait, ou changement (AESH ou modalité) ; les semaines A et B sont regroupées quand la différence est la même (`comparerAffectations` dans `modele.js`).
- Fin de notification proche (moins de 30 jours) ou dépassée : l'élève est signalé dans le panneau d'alertes.
- **Annulation** (§7.1) : pile de 20 actions en mémoire, perdue au rechargement de la page. Sont annulables : affecter, retirer, épingler / désépingler, changer l'état d'un créneau, « Proposer » (une seule action), « Tout désépingler », restaurer une version, l'interrupteur « ignorer les indisponibilités ». Les imports et la validation d'une version ne s'annulent pas. La pile est vidée après un import ou la restauration d'une sauvegarde, qui changent les données sous-jacentes. Bouton « ↶ Annuler » du bandeau (son infobulle nomme l'action) et raccourci Ctrl+Z dans l'onglet Affectations. Chaque action mémorise les opérations inverses calculées avant l'écriture (`operationsInverses` dans `modele.js`).

---

## 7. Onglets

Onglets existants : Importer, Rapports, Indicateurs, Statistiques, Réglages. Ajouts :

### 7.1 Onglet « Affectations » (cœur de l'outil)

**Bandeau de synthèse**, toujours visible :
- heures couvertes / heures demandées (individuel et mutualisé séparés) ;
- nombre d'élèves sous-couverts ;
- nombre d'AESH en dépassement ou sous-utilisées ;
- nombre d'alertes ;
- boutons « Proposer », « Valider la version » et sélecteur de semaine A/B.

**Trois vues**, avec des filtres communs (établissement, niveau, classe, AESH, état) :

1. **Vue d'ensemble** : deux colonnes.
   - À gauche, les élèves, chacun avec une jauge notifié/couvert colorée selon §4.2.
   - À droite, les AESH, chacune avec une jauge quotité/charge colorée selon §4.3.
   - Un clic sur un élève ou une AESH ouvre sa grille.
2. **Grille élève** : emploi du temps hebdomadaire de l'élève, cours en lignes horaires.
   - Chaque créneau affiche l'état prioritaire / normal / exclu et l'AESH affectée (couleur propre à chaque AESH, initiales, icône 🔒 si épinglé).
   - Un clic sur un créneau ouvre un menu :
     - changer l'état ;
     - choisir une AESH dans la liste des disponibles, **triée par score**, avec le score et les raisons ;
     - voir les AESH indisponibles **grisées avec le motif** (« déjà en 4C », « déplacement < 1 h », « quotité atteinte ») ;
     - retirer l'affectation ;
     - épingler ou désépingler.
3. **Grille AESH** : semaine de l'AESH, avec pour chaque créneau l'élève (ou les élèves), la classe et l'établissement.
   - Les trous et les changements d'établissement sont visibles d'un coup d'œil.
   - Même menu au clic pour réaffecter.

**Panneau d'alertes** latéral et repliable : conflits, sous-couvertures, dépassements, notifications qui arrivent à échéance. Un clic sur une alerte mène au créneau concerné.

**Ergonomie** :
- interface pensée pour un ordinateur, utilisable sur tablette ;
- **clic plutôt que glisser-déposer** (fiable sur tablette) ;
- annulation de la dernière action (pile d'annulation de 20 actions minimum).

### 7.2 Onglet « AESH »

Liste des AESH, puis une fiche par AESH :

- **Identité et paramètres** : quotité, e-mail, établissements possibles, indisponibilités, interrupteur « ignorer les indisponibilités » pour cette AESH.
- **Affectation actuelle** : élèves, heures par établissement, mini-grille.
- **Expérience tirée des rapports importés** :
  - **types d'accompagnement réalisés**, avec leur fréquence (champ `accomp` des rapports, qui reprend la liste ACCOMP de l'application AESH : « Secrétaire, scripteur », « Aide aux déplacements », etc.) ;
  - **niveaux accompagnés** (déduits de la classe : 6e, 5e…) ;
  - établissements ;
  - modalités (individuel / mutualisé) ;
  - nombre d'élèves suivis et périodes.
- **Rapprochement rapport → AESH** : le champ `aesh` des rapports est un texte libre. Il est rapproché automatiquement de la fiche par nom normalisé. Les cas ambigus sont listés pour une **liaison manuelle**, mémorisée pour la suite.

### 7.3 Compétences : choix de conformité

- L'expérience est décrite par des **besoins fonctionnels** (liste ACCOMP), pas par des diagnostics d'élèves. On n'infère jamais « a accompagné un élève TSA » à partir des données des élèves : ce serait une donnée de santé de l'élève reportée dans le profil de l'AESH.
- Les **formations ou compétences déclarées** (TSA, LSF, braille…) sont saisies par le coordonnateur sur la fiche AESH, ou importées par la colonne `Formations`. C'est une information sur l'AESH, pas sur un élève.
- La colonne `Besoins` des élèves utilise la même liste ACCOMP. Le moteur peut ainsi rapprocher besoins et expérience sans manipuler de diagnostic.
- Point à présenter au DPO avant toute utilisation réelle.

### 7.4 Onglet « Statistiques » (extension)

L'onglet existant est étendu avec une section « Affectations ».

- **Filtres** : année scolaire, version, établissement, niveau, classe, AESH, modalité, semaine A/B.
- **Indicateurs** :
  - taux de couverture global, par établissement, par niveau et par classe (individuel et mutualisé) ;
  - heures notifiées / couvertes / non couvertes ;
  - nombre d'élèves par état de couverture ;
  - charge des AESH (répartition, moyenne, nombre en sous-utilisation) ;
  - nombre moyen d'AESH par élève ;
  - nombre de changements d'établissement par AESH et par semaine ;
  - part d'heures sur les cours prioritaires ;
  - heures de récréation et de pause méridienne ;
  - évolution de la couverture d'une version à l'autre.
- Réutiliser `graphiques.js` (SVG fait main), sans aucune bibliothèque.
- Chaque tableau est exportable en CSV et imprimable.

---

## 8. Sorties

### 8.1 Dossier par AESH (export ZIP)

- Un ZIP **non compressé** (méthode « store » + CRC32, écrit à la main, environ 80 lignes) contient un dossier par AESH :
  - `message.txt` : objet et corps du mail, prêts à copier ;
  - `message.eml` : brouillon de mail avec en-tête `X-Unsent: 1`. Un double-clic l'ouvre en brouillon dans Outlook ou Thunderbird, avec destinataire, objet, corps et l'EDT en pièce jointe HTML. Indiquer dans l'interface que cela ne fonctionne pas avec une messagerie web ; dans ce cas, utiliser `message.txt` ;
  - `emploi-du-temps.html` : EDT autonome et imprimable (CSS intégré, aucune ressource externe), avec semaines A et B ;
  - `affectation.json` : format `pial-affectation/1` (§8.3), pour pré-remplir l'application AESH.
- Fichier racine `recapitulatif.csv` : une ligne par AESH (heures, établissements, nombre d'élèves).
- Choix possible : toutes les AESH, ou seulement celles **dont l'affectation a changé** depuis la version précédente.

### 8.2 Impression PDF

`window.print()` avec des feuilles `@media print` dédiées pour :
- la grille d'une AESH ;
- la grille d'un élève ;
- le tableau de couverture par établissement ;
- les statistiques.

En-tête : version, date d'effet, date d'impression. Pas de nom complet (il n'est pas stocké).

### 8.3 Format `pial-affectation/1` (PIAL → AESH)

```json
{
  "format": "pial-affectation/1",
  "genere_le": "2026-11-18",
  "annee": "2026-2027",
  "version": 3,
  "date_effet": "2026-11-23",
  "aesh": "Sophie D.",
  "eleves": [
    {
      "cle": "lucas m.|5b|college paul gauthier",
      "eleveNom": "Lucas M.",
      "classe": "5B",
      "etablissement": "Collège Paul Gauthier",
      "modalite": "individuel",
      "heures": 6,
      "creneaux": [
        {"jour": "lundi", "debut": "08:00", "fin": "08:55", "semaine": "toutes", "matiere": "Mathématiques"}
      ]
    }
  ]
}
```

**Côté application AESH** (phase 4) : ajouter « Importer mon affectation ». Cette action crée ou met à jour les fiches élèves (prénom, initiale, classe, établissement, modalité, heures, matières) **sans jamais écraser** les notes ni les rapports existants. Elle affiche un aperçu des changements avant d'appliquer.

### 8.4 Sauvegarde sur clé USB

- La sauvegarde existante (`pial-suivi/N`) est étendue aux nouveaux magasins. Le format passe à `pial-suivi/2`, et les fichiers `pial-suivi/1` restent restaurables.
- Le fichier est téléchargé, puis le coordonnateur l'enregistre sur sa clé.
- **Chiffrement optionnel par mot de passe** (recommandé pour une clé USB, qui peut se perdre) : PBKDF2 (≥ 200 000 itérations) puis AES-GCM via `crypto.subtle`. Format `pial-suivi-chiffre/1` = `{format, sel, iv, iterations, donnees_b64}`. Mot de passe perdu = sauvegarde illisible : le dire clairement à l'écran.
- Rappel de sauvegarde après 30 jours, comme dans l'application AESH.

---

## 9. Architecture

### 9.1 Fichiers

Nouveaux fichiers dans `/pial/` :

```
pial/import-fichiers.js   lecture CSV/XLSX, détection encodage/séparateur, correspondance colonnes
pial/zip.js               lecture ZIP (XLSX) + écriture ZIP « store » (exports) + CRC32
pial/modele.js            fonctions pures : clés, durées, couverture, charge, contraintes
pial/moteur.js            proposition d'affectations (glouton), raisons, rapport
pial/affectations.js      onglet Affectations (vues, menus, annulation, alertes)
pial/aesh.js              onglet AESH (fiches, rapprochement rapports)
pial/exports.js           ZIP par AESH, .eml, EDT HTML, pial-affectation/1, impressions
pial/tests.js             assertions communes (navigateur et Node)
pial/tests.html           lanceur navigateur des tests de modele.js, zip.js, import-fichiers.js et moteur.js
exemples/                 jeux de données fictifs (§10), hors cache du service worker
outils/generer-exemples.js  script de génération des exemples (outil de dev, non publié dans l'app)
outils/tests-node.js      lanceur des mêmes tests en ligne de commande (Node sans npm)
outils/rapport-moteur.js  rapport de fin du moteur sur exemples/ et temps de calcul (outil de dev)
```

Ajouter **tous** les fichiers de `/pial/` nécessaires à l'application (existants compris : ils n'y figuraient pas) à `FICHIERS` dans `service-worker.js`, et incrémenter `CACHE_VERSION`. Le gestionnaire `fetch` ne met jamais en cache `exemples/` ni `outils/`, et le repli hors ligne d'une navigation sous `/pial/` renvoie `pial/index.html` (et non le `index.html` racine).

### 9.2 IndexedDB : base `pial-suivi`, schéma v3

Migration additive : ne jamais toucher aux magasins `rapports` et `imports`.

| Magasin | keyPath | Index | Contenu |
|---|---|---|---|
| `etablissements` | `id` | | paramètres §2.5 |
| `eleves` | `id` (= `annee\|cle`, §3) | cle, annee, etablissement, classe | élève + notification + options récré/méridienne + `etatsPeriscolaires` (§5.2) + besoins |
| `aesh` | `id` (= `nom\|prenom` normalisé, §2.3) | annee | AESH + paramètres + formations + alias de rapprochement |
| `cours` | `id` | eleveCle, etablissement | lignes d'EDT élève + état prioritaire/normal/exclu |
| `affectations` | `id` | version, aeshId, creneauCle | brouillon (version = 0) et versions validées |
| `versions` | `numero` | annee | date d'effet, commentaire, compteurs, libellés des élèves et AESH (§6) ; numérotation globale, jamais remise à zéro d'une année à l'autre |
| `correspondances` | `type` | | correspondances de colonnes mémorisées |
| `parametres` | `cle` | | réglages du module (`{cle:"reglages", valeur:{dureeReelle, respecterIndispos, gererPeriscolaire, pauseRepasMin…}}`) — ajouté au schéma (§13) ; un réglage absent prend sa valeur par défaut, sans migration |

Une affectation contient : `{id, annee, version, aeshId, creneau{etab,jour,debut,fin,semaine}, creneauCle, modalite, eleves:[cle…], epinglee, origine:"moteur"|"manuel", raisons:[…], alertes:[…]}`. `creneauCle` est un champ calculé (`etab|jour|debut|fin|semaine`) qui alimente l'index du même nom ; `eleves` contient les identifiants de stockage (`annee|cle`).

La migration v2 → v3 gère le blocage par un autre onglet ouvert : `onblocked` affiche un message demandant de fermer les autres onglets, `onversionchange` ferme la connexion.

### 9.3 Contraintes rappelées

- Pas de module ES, pas de `let`/`const`/fonctions fléchées. Promesses autorisées (déjà utilisées dans `db.js`).
- Tout texte venant d'un fichier importé est **échappé** avant insertion dans `innerHTML`.
- Le verrou par mot de passe existant (`auth.js`) protège aussi les nouveaux onglets.
- Tout doit fonctionner en ouvrant `pial/index.html` par double-clic.

---

## 10. Données de test fictives

Générées par `outils/generer-exemples.js` (Node sans npm, déterministe, exécuté en développement) et versionnées dans `exemples/`. **Tous les noms sont manifestement fictifs**, et chaque fichier de données se nomme `FICTIF_…` (pas de ligne de commentaire : elle empêcherait l'import des CSV et n'existe pas en JSON). Les adresses e-mail utilisent le domaine réservé `exemple.invalid`, pour qu'aucun brouillon ne puisse partir vers une vraie adresse. Les dates de notification sont calculées depuis une date de référence (par défaut, le jour de génération) : relancer le script avant une démonstration.

**Contenu** : 1 PIAL avec 2 collèges et 1 école élémentaire, environ 45 élèves, 14 AESH, des rapports AESH au format `suivi-aesh/2` pour 8 de ces AESH.

**Cas pièges à inclure obligatoirement** :

1. deux élèves mutualisés de la même classe dans **des groupes de LV2 différents** sur le même créneau (ils ne doivent pas être mutualisés ensemble) ;
2. trois élèves mutualisés dans le même cours et le même groupe (ils doivent être mutualisés ensemble) ;
3. une AESH sur deux établissements, avec un cas où la règle du déplacement d'1 h bloque ;
4. une AESH indisponible le mercredi, une autre le vendredi après-midi ;
5. alternance A/B au collège : un élève qui n'a un cours qu'en semaine B ;
6. école sans alternance et sans classe le mercredi ;
7. **capacité insuffisante** : total des heures notifiées supérieur au total des quotités, pour faire apparaître des sous-couvertures ;
8. un élève avec récréation et pause méridienne accompagnées ;
9. des cours prioritaires et des cours exclus pré-remplis ;
10. une collision de clé (« Lucas M. » ×2 en 5B), pour tester le blocage à l'import — isolée dans `FICTIF_eleves_collision.csv` pour que le jeu principal s'importe sans erreur ;
11. un fichier `FICTIF_aesh_windows1252.csv` encodé en Windows-1252 avec des accents ;
12. un fichier `FICTIF_eleves.xlsx`, pour tester la lecture XLSX ;
13. une notification qui se termine dans moins de 30 jours ;
14. des rapports dont le champ `aesh` est mal orthographié (« sophie durand », « S. Durand »), pour tester le rapprochement manuel ;
15. un renfort `FICTIF_aesh_renfort.csv` (2 AESH, un établissement chacune, 36 h) : importé après une première proposition, il fait remonter la couverture à la relance.

**`pial/tests.html`** et **`outils/tests-node.js`** : les mêmes assertions (fichier commun `pial/tests.js`), exécutables dans le navigateur ou en ligne de commande (`node outils/tests-node.js`, Node sans npm). Elles vérifient au moins :
- clés et collisions ;
- durées et semaines A/B ;
- couverture et charge ;
- chacune des 7 contraintes dures ;
- règle de mutualisation (cas 1 et 2) ;
- déterminisme du moteur (deux exécutions = résultat identique) ;
- respect des épinglages ;
- lecture CSV en UTF-8 et en Windows-1252 ;
- ZIP (aller-retour écriture puis lecture).

**`exemples/SCENARIO-DEMO.md`** : déroulé de démonstration en 10 étapes pour la présentation au coordonnateur.

---

## 11. Phases et critères d'acceptation

**Phase 1 — Imports et couverture**
- Gabarits téléchargeables, import CSV/XLSX, correspondance des colonnes, aperçu.
- Paramètres des établissements.
- Schéma IndexedDB v3, et sauvegarde `pial-suivi/2` **non chiffrée** incluant les nouveaux magasins (pour ne rien perdre d'ici la phase 3).
- Vue d'ensemble avec jauges (sans moteur).
- Affectation manuelle depuis la grille élève (AESH proposées par ordre alphabétique, indisponibles grisées avec le motif ; le tri par score arrive avec le moteur).
- Données d'exemple, `tests.html` et `outils/tests-node.js`.
- ✔ *Acceptation* : les fichiers `exemples/` s'importent sans erreur (sauf le cas 10, bloqué comme prévu) ; une affectation manuelle met à jour les deux jauges ; un conflit manuel apparaît dans les alertes.

**Phase 2 — Moteur et versions**
- `moteur.js`, raisons, rapport de fin.
- Menu de créneau trié par score, avec les raisons.
- Épinglage, relance partielle, « Tout désépingler », annulation.
- État prioritaire / normal / exclu des récréations et pauses méridiennes.
- Interrupteur « ignorer les indisponibilités » par AESH (panneau simple ; la fiche complète vient en phase 4).
- Brouillon, versions, comparatif.
- ✔ *Acceptation* : sur les exemples, aucune contrainte dure n'est violée par le moteur ; les cas 1 à 9 se comportent comme décrit ; deux exécutions donnent le même résultat ; une affectation épinglée n'est jamais modifiée.

**Phase 3 — Sorties et statistiques**
- Grille AESH, impressions PDF.
- ZIP par AESH (txt, eml, html, json).
- Statistiques filtrables.
- Sauvegarde chiffrée.
- Extension de la purge par année aux nouveaux magasins.
- ✔ *Acceptation* : un `.eml` s'ouvre en brouillon dans Thunderbird ; l'EDT HTML s'imprime sur une page A4 paysage ; la restauration d'une sauvegarde chiffrée retrouve exactement les données.

**Phase 4 — Onglet AESH et pont avec l'application AESH**
- Fiches AESH, expérience tirée des rapports, rapprochement manuel.
- Score d'expérience intégré au moteur.
- « Importer mon affectation » dans l'application AESH.
- Rapprochement d'une année à l'autre (§3, changement d'année).
- ✔ *Acceptation* : le cas 14 se rattache manuellement puis automatiquement aux imports suivants ; l'import d'une affectation dans l'application AESH ne modifie aucune note ni aucun rapport existant.

---

## 12. Choix par défaut à valider par Julien

Ils sont appliqués tels quels sauf contre-ordre.

1. Un cours de 55 min compte pour 1 h (réglable).
2. Un créneau individuel est exclusif : l'AESH n'y prend pas d'autre élève.
3. Quotité respectée en semaine A **et** en semaine B ; couverture élève affichée en moyenne A/B.
4. Seuils : sous-utilisation < 90 % de la quotité ; pause repas AESH de 45 min sur les journées de plus de 6 h.
5. Nom de famille réduit à l'initiale dès l'import.
6. Pas de diagnostic d'élève dans l'outil : compétences des AESH = besoins fonctionnels + formations déclarées.

## 13. Décisions du 19/11/2026 (revue du plan de la phase 1)

Reportées dans les sections concernées ; résumé :

1. Stockage élève identifié par `annee|cle` ; numérotation des versions globale (§3, §9.2).
2. `Nom` terminé par un point = abréviation conservée telle quelle, pour résoudre les collisions (§2.2, §3).
3. Durée d'un cours arrondie à l'heure la plus proche, minimum 1 h (§4.1).
4. Temps périscolaire compté à part, inclus dans la charge AESH ; mutualisation périscolaire permise entre tous les élèves d'un même établissement (§4.2, §4.4).
5. Pause repas : seuil de 6 h sur le temps de présence ; plage réglable par établissement ; si l'AESH accompagne une pause méridienne, sa pause peut être hors plage (signalé, non bloqué) (§2.5, §4.4).
6. États avec semaines A/B : dépassement si A ou B dépasse, sinon moyenne ; état élève = le plus défavorable entre individuel et mutualisé (§4.2, §4.3).
7. Un cours « toutes semaines » peut avoir une AESH différente en A et en B (affectation scindée) (§4.1).
8. Identifiant AESH = `nom|prenom` normalisé (§2.3).
9. Données d'exemple : préfixe `FICTIF_`, domaine `exemple.invalid`, collision isolée dans un fichier à part, dates relatives à la génération (§10).
10. Purge par année étendue → phase 3 ; rapprochement d'une année à l'autre → phase 4 (§11).
11. Tests exécutables aussi en ligne de commande (`outils/tests-node.js`) (§10).
12. XLSX analysé sans `DOMParser` (absent de Node), première feuille résolue via le classeur (§2.1).
13. Colonne `Eleve` de l'EDT : un nom complet (« Lucas Martin ») est accepté et réduit à « Lucas M. » s'il correspond à un élève connu ; le nom complet n'est pas conservé (§2.4, §3).
14. Magasin `parametres` ajouté au schéma v3 pour les réglages du module ; la sauvegarde `pial-suivi/2` (non chiffrée) est livrée dès la phase 1 ; restaurer un fichier `pial-suivi/1` ne remplace que les rapports et l'historique des imports (§8.4, §9.2).
15. `pial/index.html` enregistre aussi le service worker commun (`../service-worker.js`, garde `file:`), pour que l'espace PIAL fonctionne hors ligne même si la page AESH n'a jamais été ouverte (§9.1).

## 14. Décisions du 19/11/2026 (revue du plan de la phase 2)

Reportées dans les sections concernées ; résumé :

1. Choix des créneaux d'un élève = ordre de préférence ; reste inférieur à l'apport d'un cours : cours en semaine A seulement si le reste vaut au moins la moitié (§5.3).
2. Récréations et pauses méridiennes : même état prioritaire / normal / exclu que les cours, stocké dans l'élève (`etatsPeriscolaires`), sans migration ; colonnes `Recreation` / `Pause_meridienne` : valeur `prioritaire` acceptée ; pause méridienne de Louis I. (cas 8) prioritaire dans les exemples (§2.2, §5.2, §9.2).
3. Lien matières ↔ besoins : critère inactif faute de table (§5.3).
4. Scores d'expérience et de formation : présents dans `POIDS`, sans effet jusqu'à la phase 4 (§5.3).
5. Lecture détaillée des critères du score ; identifiants d'affectation déterministes (§5.3).
6. Validation d'une version possible malgré des conflits, avec confirmation ; libellés conservés dans la version ; comparatif par élève × créneau × semaine (§6).
7. Pile d'annulation de 20 actions, en mémoire ; imports et validation non annulables (§6).
8. Interrupteur « ignorer les indisponibilités » par AESH livré dès la phase 2 ; il couvre aussi les établissements possibles, comme le réglage global (§4.4, §11).

Revue du rapport du moteur (même jour) :

9. Entre unités mutualisées, la proportion déjà couverte passe avant la taille du groupe (§5.3.4).
10. Pénalité « plus de 3 AESH » progressive : −25 par AESH au-delà de 3, cumulable (§5.3.5). Mesurée sans effet sur les exemples : quand l'élève reçoit une 4e AESH, aucune des précédentes n'est libre sur le créneau ; une passe d'amélioration par échanges est proposée (notes de travail), non codée.
11. Réglage global « Gérer les temps périscolaires », décoché par défaut (§2.2, §5.2) ; les exemples et le scénario le cochent.
12. `FICTIF_aesh_renfort.csv` (2 AESH, un établissement chacune) et étape du scénario : pénurie → import du renfort → relance → la couverture remonte (§10).

Interface du moteur (commit 4) :

13. Le rapport de fin affiche le **motif principal** (« quotités épuisées » plutôt que « quotité épuisée partout », d'autres AESH ayant pu être écartées pour un autre motif) (§5.3.7).
14. « Proposer » remplace toutes les affectations non épinglées du brouillon, sans confirmation (toute saisie manuelle est épinglée, §5.4) ; le rapport s'ouvre dans une fenêtre et reste consultable (bouton « Rapport ») jusqu'au rechargement de la page. « Tout désépingler » demande une confirmation.
15. Menu d'un créneau : les AESH disponibles sont triées par le score du moteur, affiché avec ses raisons ; une affectation proposée affiche ses raisons. L'état d'un créneau périscolaire se change dans le même menu, pour ce créneau seulement (§5.2).

## 15. Sujets ouverts

À étudier après la phase 2.

### 15.1 Source des emplois du temps réels

Les emplois du temps réels sont des PDF Pronote « Emploi du temps annuel de l'élève » : une grille par élève, avec les semaines A/B, chiffrée, sans la classe. Le gabarit `edt_eleves.csv` (§2.4) suppose une saisie ou une conversion préalable. Pistes, de la plus simple à la dernière à tenter :

1. export « liste des cours » de Pronote (côté établissement), à rapprocher du gabarit ;
2. export EDT au format CSV ou XML (Pronote, ou logiciel d'emploi du temps de l'établissement) ;
3. export iCal (calendrier) de l'élève ou de la classe ;
4. lecture des PDF en dernier recours (mise en page variable, chiffrement, absence de la classe).

Pour chaque piste : qui peut produire le fichier (coordonnateur, secrétariat, famille), ce qu'il contient (classe, groupes, semaines A/B), et les données personnelles qu'il transporte en plus de celles dont le module a besoin (§3).
