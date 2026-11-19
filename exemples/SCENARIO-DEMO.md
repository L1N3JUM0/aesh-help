# Scénario de démonstration — module Affectations (phases 1 et 2)

Toutes les données de ce dossier sont **fictives** (préfixe `FICTIF_`, e-mails en
`exemple.invalid`). Avant une démonstration, régénérez-les pour que les dates de
notification restent pertinentes :

```
node outils/generer-exemples.js
```

Jeu fourni : 1 PIAL, 2 collèges (Collège Fictif des Tilleuls, Collège Fictif du
Port) et 1 école (École Fictive des Lilas), 45 élèves, 14 AESH, 10 transmissions
de rapports. Total notifié : 327,5 h pour 274 h de quotités cumulées (capacité
volontairement insuffisante).

Ouvrez `pial/index.html` (double-clic ou serveur local), créez un mot de passe
de démonstration, puis suivez les étapes.

## 1. Les gabarits

Onglet **Importer**, carte « Importer élèves, AESH et emplois du temps ».
Téléchargez le gabarit élèves : il s'ouvre directement dans Excel (UTF-8 avec
BOM, séparateur « ; »), avec deux lignes d'exemple.

## 2. Import des élèves (XLSX)

Le jeu d'exemple accompagne quelques élèves sur les récréations et la pause
méridienne (cas 8) : avant l'import, cochez **Réglages → Règles de calcul →
« Gérer les temps périscolaires »** puis « Enregistrer ». Ce réglage est décoché
par défaut ; sans lui, l'aperçu d'import signale que les colonnes Récréation et
Pause méridienne sont ignorées.

Choisissez `FICTIF_eleves.xlsx`. Les colonnes sont reconnues automatiquement ;
« Vérifier le fichier » affiche 45 lignes reconnues, 0 erreur, et la création des
3 établissements. Cliquez sur « Mettre à jour ». À montrer : seule l'initiale du
nom est conservée (« Emma E. »).

## 3. Collision de clé (cas 10)

Choisissez `FICTIF_eleves_collision.csv` puis « Vérifier » : les deux « Lucas M. »
de 5B sont **bloqués**, avec la marche à suivre (« Ma. » / « Mo. » dans la colonne
Nom). Annulez.

## 4. Import des AESH en Windows-1252 (cas 11)

Choisissez `FICTIF_aesh_windows1252.csv` (export Excel français) : l'encodage est
détecté, les accents sont corrects (Nadia Démonstration, Sarah Échantillon).
« Mettre à jour ». Réimporter ensuite `FICTIF_aesh.csv` (UTF-8) donne
« 0 ajout, 0 modification, 14 inchangés ».

## 5. Import des emplois du temps

Choisissez `FICTIF_edt_eleves.csv` (séparateur virgule, détecté) : 1 158 cours,
0 erreur. « Mettre à jour ».

## 6. Paramètres des établissements

**Réglages → Établissements**. Pour les deux collèges, saisissez les horaires
réels du jeu d'exemple : récréations 09:50–10:05 et 15:20–15:35, pause
méridienne 11:55–13:30. L'école garde ses valeurs par défaut (pas d'alternance
A/B, pas de classe le mercredi — cas 6).

## 7. Vue d'ensemble

Onglet **Affectations** : le bandeau montre 0 h couverte sur 221 h individuelles
et 106,5 h mutualisées, 45 élèves sous-couverts, 14 AESH sous-utilisées. Le
panneau d'alertes signale déjà la notification de Jules É. qui finit dans moins de
30 jours (cas 13) et celle d'Inès D., échue. Filtrez par établissement ou par
état.

## 8. Affectation manuelle et jauges

Cliquez sur **Emma E.** (6A, Tilleuls), puis sur un cours : le menu liste les
AESH disponibles, puis les indisponibles grisées avec leur motif (« N'intervient
pas dans cet établissement », « Indisponible (lun-am) »). Affectez **Léa
Exemplaire** : la jauge d'Emma passe à 1 h / 8 h et celle de Léa à 1 h / 24 h.
Marquez un autre cours « prioritaire » ou « exclu » (cas 9 : voir aussi Nathan C.).

## 9. Mutualisation : cas 1 et 2

- Cas 2 : ouvrez **Hugo M.** (5A), affectez Bruno Gabarit en mutualisé sur un
  cours ; ouvrez **Léna M.**, même créneau : Bruno est proposé avec « rejoint le
  groupe de Hugo M. ».
- Cas 1 : affectez Julie Simulée à **Rose É.** (4A) sur un créneau de LV2
  (espagnol) ; chez **Arthur S.** (LV2 allemand, même créneau), Julie apparaît
  comme occupée : groupes différents, pas de mutualisation.

## 10. Conflits signalés, pas bloqués

- Chez **Noah F.** (6A), sur le créneau où Léa accompagne Emma, choisissez
  « Affecter quand même » pour Léa : l'affectation est marquée ⚠ et le
  chevauchement apparaît dans le panneau d'alertes ; un clic sur l'alerte ramène
  au créneau.
- Cas 3 : affectez Sophie Durand à un cours d'Emma (Tilleuls) puis regardez un
  cours de Léo E. (Port) le même jour, à moins d'1 h d'écart : « Déplacement < 1 h ».
- Cas 4 : un mercredi, Hugo Fictif apparaît « Indisponible (mer) » ; un vendredi
  après-midi, Nadia Démonstration « Indisponible (ven-pm) ».

## 11. Proposition automatique : pénurie, puis renfort

- Onglet **Affectations**, bouton **Proposer**. Les affectations faites à la main
  aux étapes 8 à 10 sont épinglées (🔒) et conservées ; le reste est proposé en
  une fraction de seconde. Le rapport s'ouvre : individuel 100 %, mutualisé
  environ 77 %, une douzaine d'élèves sous-couverts, tous en mutualisé, motif
  principal « quotités épuisées » (cas 7 : 327,5 h notifiées pour 274 h de
  quotités). Un clic sur un élève du rapport ouvre sa grille.
- Ouvrez un créneau proposé : la ligne « Proposée par le moteur » donne les
  raisons (par exemple « déjà avec Emma E. · 6 AESH écartées… ») ; la
  liste des AESH disponibles est triée par score.
- **Louis I.** (cas 8) : sa pause méridienne, prioritaire, est couverte chaque
  jour ; ses récréations, « normal », passent en dernier. Cliquez sur une
  récréation et marquez-la « Prioritaire » : seul ce créneau change.
- Onglet **Importer** : importez `FICTIF_aesh_renfort.csv` (Camille Renfort,
  24 h aux Tilleuls ; Alix Appoint, 12 h aux Lilas), puis revenez sur
  **Affectations** et relancez **Proposer**. Les épinglées sont gardées, le reste
  est recalculé : la couverture remonte à 100 % ou presque, et le rapport ne
  liste plus que quelques temps périscolaires.
- **Tout désépingler** rend toutes les affectations au moteur (après
  confirmation) : la prochaine proposition pourra les remplacer.
- **↶ Annuler** (ou Ctrl+Z) défait les dernières actions, jusqu'à 20 : une
  affectation, un changement d'état, une proposition entière.
- Cliquez sur **Hugo Fictif** dans la liste des AESH : sa fiche s'affiche, avec
  l'interrupteur « Ignorer ses indisponibilités et ses établissements
  possibles » (cas 4 : le mercredi redevient possible pour lui).

## 12. Versions et comparatif

- **Valider la version** : date d'effet (aujourd'hui), commentaire « Rentrée ».
  S'il reste des conflits (étape 10), l'application en donne le nombre et
  demande confirmation.
- Modifiez le brouillon : retirez une affectation, changez l'AESH d'un créneau.
- **Historique** → « Comparer au brouillon » : une ligne par élève et par
  créneau ajouté, retiré ou changé d'AESH ; un créneau scindé en semaines A et B
  se compare correctement à un créneau « toutes semaines ».
- « Consulter » affiche la version en lecture seule ; « Restaurer » en refait le
  brouillon (annulable).

Pour finir : **Réglages → Sauvegarde** exporte tout (format `pial-suivi/2`).

> À venir (phases 3 et 4) : grille AESH, impressions et exports ZIP par AESH,
> statistiques d'affectation, fiches AESH et rapprochement des rapports (cas 14 :
> transmissions signées « sophie durand » et « S. Durand »).
