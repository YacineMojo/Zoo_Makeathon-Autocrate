# fixtures/

## Le fichier de démonstration : `machine-demo.step`

**Généré par Zoo Text-to-CAD**, versionné ici, reproductible par
`npm run machine-demo`. Le prompt et le KCL rendu par Zoo sont dans
`../src/machine-demo.ts` et `machine-demo.kcl`.

C'est le seul fichier de ce répertoire dont nous puissions garantir les droits,
et c'est la raison pour laquelle il existe.

| | |
|---|---|
| Emprise | 2000 × 1900 × **3100** mm |
| Sommets | 117 |
| Poids | 106 Ko |
| Conversion STEP → maillage | 3,4 s |
| Chaîne complète, STEP entrant → STEP sortant | **4,55 s**, dont 99 % chez Zoo |

Il joue la démonstration du §16 en entier :

```
Repère CAO (naïf)   2.23 × 2.13 × 3.31 m   hors gabarit             13 545 €   21 j
Pose C — couchée    3.33 × 2.23 × 2.11 m   Conteneur 40' standard    6 776 €    5 j
→ 6 769 € et 16 jours économisés
```

Et le moteur sait l'importer en b-rep, ce qui rend possible l'artefact du §7.3 :
un **STEP unique contenant la machine et la caisse** (`out/bout-en-bout.step`).

## Pourquoi pas un vrai modèle constructeur

PROJECT.md §14 impose deux vérifications avant de s'attacher à un fichier : la
licence, parce que la soumission et la vidéo sont publiques, et le poids, parce
que la promesse des trente secondes en dépend. Les deux ont été faites, et elles
éliminent tous les candidats testés.

| Dépôt | Licence | Verdict |
|---|---|---|
| `tpaviot/pythonocc-demos` | **aucune** — pas de fichier LICENSE, rien dans le README | écarté pour la diffusion |
| `NTNU-manulab/Cobots-RoboDK-Isaac-Sim` | **aucune** | écarté |
| `Nhsrico/gltf-models` | **aucune** | écarté |
| `qunat/Pythonocc-vericut` | LGPL-3.0 | pièces < 40 cm, aucun seuil franchi |
| `csbebetter/OCC_Qt_Robot` | **MIT** | KUKA KR 6 — 88 cm, aucun seuil franchi |

Le constat général : **une machine assez grande pour franchir un seuil de
gabarit est une machine dont le modèle appartient à son constructeur.** Les
modèles librement licenciés que nous avons trouvés font tous moins d'un mètre,
et une caisse d'un mètre passe partout — il n'y a alors plus rien à démontrer.

Le STEP du KUKA KR 600 porte d'ailleurs un en-tête sans ambiguïté : produit sous
Siemens NX 7.5 en 2014, auteur et organisation vides, redistribué sans mention.

## Fichiers de mesure, non redistribués

Ces fichiers ont servi à mesurer les APIs Zoo — tout `FEEDBACK.md` en vient. Ils
ne sont **ni versionnés, ni montrés dans la vidéo**, et ne sont pas nécessaires
pour faire tourner la démonstration.

| Fichier | Taille | Conversion | Emprise |
|---|---|---|---|
| `as1_pe_203.stp` → `as1_assembly.stp` | 137 Ko | 3,2 s | 8,6 × 2,0 × 3,8 m |
| `as1-oc-214.stp` | 432 Ko | 7,8 s | 0,19 × 0,16 × 0,20 m |
| `11752.stp` | 1,5 Mo | 504 en synchrone, 107 s en asynchrone | 1,28 × 0,14 × 0,13 m |
| `Ventilator.stp` | 2,2 Mo | 50,5 s | 0,08 × 0,08 × 0,02 m |
| `kuka_kr600_r2830.stp` | 12,6 Mo | 365 s | 2,52 × 1,30 × 2,94 m |
| `kuka_kr6_with_tool.step` | 5,4 Mo | 273 s | 0,88 × 0,28 × 0,96 m |
| `cellule_ur10_ur5.stp` | 206 Ko | 3,6 s | 0,85 × 1,25 × 0,80 m |
| `machine1..4.stp`, `spindle.stp` | 0,1–0,7 Mo | 3–8 s | < 0,4 m |

Pour les récupérer :

```bash
B=https://raw.githubusercontent.com
curl -sL -o fixtures/as1_assembly.stp        $B/tpaviot/pythonocc-demos/master/assets/models/as1_pe_203.stp
curl -sL -o fixtures/as1-oc-214.stp          $B/tpaviot/pythonocc-demos/master/assets/models/as1-oc-214.stp
curl -sL -o fixtures/11752.stp               $B/tpaviot/pythonocc-demos/master/assets/models/11752.stp
curl -sL -o fixtures/Ventilator.stp          $B/tpaviot/pythonocc-demos/master/assets/models/Ventilator.stp
curl -sL -o fixtures/kuka_kr600_r2830.stp    $B/tpaviot/pythonocc-demos/master/assets/models/KR600_R2830-4.stp
curl -sL -o fixtures/kuka_kr6_with_tool.step $B/csbebetter/OCC_Qt_Robot/master/robot/KR6/KR6withTool.STEP
```

Le KR 600 reste le fichier de référence pour tout ce qui est **mesure d'API** :
c'est sur lui qu'on sait que l'Engine API refuse un STEP de robot réel, que la
conversion demande 365 s, et qu'un maillage de 174 043 sommets dépasse la limite
de trame BSON.
