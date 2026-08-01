# fixtures/

Les fichiers STEP ne sont pas versionnés : 13 Mo pour le seul KUKA, et surtout
**leur licence n'est pas encore vérifiée**. La soumission et la vidéo sont
publiques : la vérification de licence et la citation de provenance sont un
livrable de l'étape 6, pas une formalité.

Pour les récupérer :

```bash
curl -sL -o fixtures/kuka_kr600_r2830.stp \
  https://raw.githubusercontent.com/tpaviot/pythonocc-demos/master/assets/models/KR600_R2830-4.stp
curl -sL -o fixtures/as1_assembly.stp \
  https://raw.githubusercontent.com/tpaviot/pythonocc-demos/master/assets/models/as1_pe_203.stp
```

| Fichier | Taille | Conversion | Emprise | Rôle |
|---|---|---|---|---|
| `as1_assembly.stp` | 137 Ko | 3,2 s | 8,6 × 2,0 × 3,8 m | itération rapide |
| `as1-oc-214.stp` | 432 Ko | 7,8 s | 0,19 × 0,16 × 0,20 m | palier de mesure |
| `11752.stp` | 1,5 Mo | 504 sync / 107 s async | 1,28 × 0,14 × 0,13 m | palier de mesure |
| `Ventilator.stp` | 2,2 Mo | 50,5 s | 0,08 × 0,08 × 0,02 m | palier de mesure |
| **`kuka_kr600_r2830.stp`** | **12,6 Mo** | **365 s** | **2,52 × 1,30 × 2,94 m** | **fichier de démo retenu** |
| `kuka_kr6_with_tool.step` | 5,4 Mo | 273 s | 0,88 × 0,28 × 0,96 m | écarté — trop petit |
| `cellule_ur10_ur5.stp` | 206 Ko | 3,6 s | 0,85 × 1,25 × 0,80 m | écarté — trop petit |
| `machine1..4.stp`, `spindle.stp` | 0,1–0,7 Mo | 3–8 s | < 0,4 m | écartés — trop petits |

## Pourquoi le KR 600 est retenu malgré ses 365 s

Une machine assez grande pour franchir un seuil de gabarit est une machine dont
le STEP est lourd. Les deux critères tirent en sens inverse, et tous les
fichiers légers essayés font moins d'un mètre : leur caisse passe partout, donc
il n'y a plus rien à démontrer.

Le KR 600 donne la démonstration en entier : 2,94 m debout, 1,30 m couché,
8 820 € et 18 jours d'écart entre les deux. Le prix à payer est une conversion
de 365 s, qui est un temps **Zoo**, mesuré et documenté dans `FEEDBACK.md`, pas
un temps de notre code — l'étude complète tourne en 0,4 s une fois le maillage
lu.

Le KR 6, plus léger de moitié, convertit encore en 273 s : le temps de
conversion ne suit pas la taille du fichier. Changer de fichier n'aurait donc
même pas résolu le problème de temps.

## Provenance et licence

| Fichier | Source |
|---|---|
| `as1*`, `11752`, `Ventilator`, `kuka_kr600_r2830` | `tpaviot/pythonocc-demos`, `assets/models` |
| `kuka_kr6_with_tool` | `csbebetter/OCC_Qt_Robot`, `robot/KR6` |
| `cellule_ur10_ur5` | `NTNU-manulab/Cobots-RoboDK-Isaac-Sim` |
| `machine1..4` | `Nhsrico/gltf-models` |
| `spindle` | `qunat/Pythonocc-vericut` |

**Reste à vérifier avant l'étape 7** : la licence de redistribution du modèle
KUKA KR 600 dans `pythonocc-demos`, et s'il provient du catalogue constructeur.
La soumission et la vidéo étant publiques, la citation de provenance dans le
README n'est pas optionnelle.
