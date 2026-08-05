# fixtures/

## Le fichier de démonstration : `machine-demo.step`

**Généré par Zoo Text-to-CAD**, versionné ici, reproductible par
`npm run machine-demo`. Le prompt et le KCL rendu par Zoo sont dans
`../src/machine-demo.ts` et `machine-demo.kcl`.

C'est le seul fichier de ce répertoire que nous produisons nous-mêmes, donc le
seul dont nous puissions garantir les droits sans dépendre d'un tiers. C'est la
raison pour laquelle il existe.

| | |
|---|---|
| Emprise | 2000 × 1900 × **3100** mm |
| Sommets | 117 |
| Poids | 106 Ko |
| Conversion STEP → maillage | 3,4 s |
| Chaîne complète, STEP entrant → STEP sortant | **4,55 s**, dont 99 % chez Zoo |

C'est lui qui porte les chiffres du README, parce qu'il est le seul fichier
publiable qui franchisse réellement un seuil de gabarit. `./script.sh demo`
rejoue la chaîne entière dessus :

```
Repère CAO (naïf)   2.25 × 2.15 × 3.33 m   hors gabarit             13 639 €   21 j
Pose C — couchée    3.35 × 2.25 × 2.13 m   Groupage maritime (LCL)   3 766 €   12 j
→ 9 873 € et 9 jours économisés
```

Et le moteur sait l'importer en b-rep, ce qui rend possible un **STEP unique
contenant la machine et la caisse** (`out/bout-en-bout.step`).

## La machine de l'atelier : `kuka_kr6_with_tool.step`

Deux vérifications avant de s'attacher à un fichier : la licence, parce que la
soumission est publique, et le poids, parce que la promesse des quatre secondes
en dépend. Un seul candidat les passe toutes les deux.

| Dépôt | Licence | Verdict |
|---|---|---|
| `tpaviot/pythonocc-demos` | **aucune** — pas de fichier LICENSE, rien dans le README | écarté pour la diffusion |
| `NTNU-manulab/Cobots-RoboDK-Isaac-Sim` | **aucune** | écarté |
| `Nhsrico/gltf-models` | **aucune** | écarté |
| `qunat/Pythonocc-vericut` | LGPL-3.0 | pièces < 40 cm, aucun seuil franchi |
| `csbebetter/OCC_Qt_Robot` | **MIT** | **retenu** — KUKA KR 6 outillé, 88 cm |

C'est donc le **KUKA KR 6 outillé** que l'atelier ouvre par défaut : de la CAO
constructeur réelle, 10 corps, sous licence MIT. Son STEP n'est pas versionné
ici — on ne redistribue pas le fichier d'un tiers quand on peut pointer sa
source. `./script.sh` va le chercher au premier lancement et le fait convertir
par Zoo, ce qui demande quatre à cinq minutes une fois pour toutes.

Il ne franchit aucun seuil de gabarit, et c'est assumé : à 88 cm, les quatre
poses tombent dans le même gabarit, et l'outil le dit plutôt que de recommander
une pose pour quarante euros d'écart.

| | |
|---|---|
| Emprise | 880 × 280 × 960 mm |
| Corps | 10 |
| Poids du STEP | 5,4 Mo |
| Conversion STEP → maillage | 273 s, par la route asynchrone |
| Sommets du maillage | 42 216 |

Le constat général derrière ce tableau : **une machine assez grande pour
franchir un seuil de gabarit est une machine dont le modèle appartient à son
constructeur.** Les modèles librement licenciés que nous avons trouvés font tous
moins d'un mètre, et une caisse d'un mètre passe partout. C'est pourquoi les
chiffres de la démonstration viennent de la machine générée ci-dessus, et la
preuve qu'on lit de la CAO industrielle vient du KR 6.

## Fichiers de mesure, non redistribués

Ces fichiers ont servi à mesurer les APIs Zoo — tout `FEEDBACK.md` en vient. Ils
ne sont **pas versionnés** et ne sont pas nécessaires pour faire tourner la
démonstration.

| Fichier | Taille | Conversion | Emprise |
|---|---|---|---|
| `as1_pe_203.stp` → `as1_assembly.stp` | 137 Ko | 3,2 s | 8,6 × 2,0 × 3,8 m |
| `as1-oc-214.stp` | 432 Ko | 7,8 s | 0,19 × 0,16 × 0,20 m |
| `11752.stp` | 1,5 Mo | 504 en synchrone, 107 s en asynchrone | 1,28 × 0,14 × 0,13 m |
| `Ventilator.stp` | 2,2 Mo | 50,5 s | 0,08 × 0,08 × 0,02 m |
| `kuka_kr600_r2830.stp` | 12,6 Mo | 365 s | 2,52 × 1,30 × 2,94 m |
| `cellule_ur10_ur5.stp` | 206 Ko | 3,6 s | 0,85 × 1,25 × 0,80 m |
| `machine1..4.stp`, `spindle.stp` | 0,1–0,7 Mo | 3–8 s | < 0,4 m |

Pour les récupérer — la dernière ligne est celle que `script.sh` joue tout seul
au premier lancement :

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
