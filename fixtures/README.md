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

| Fichier | Taille | Rôle |
|---|---|---|
| `as1_assembly.stp` | 137 Ko | itération rapide. Assemblage de référence, géométrie simple. |
| `kuka_kr600_r2830.stp` | 12,6 Mo | **candidat fichier de démo** (PROJECT.md §14). Robot KUKA KR 600 R2830 : machine réelle, géométrie irrégulière, bras déployé qui donne une dimension naturellement problématique, vides internes évidents. C'est aussi le fichier lourd sur lequel se mesure la promesse des trente secondes. |

Provenance : dépôt `tpaviot/pythonocc-demos`, répertoire `assets/models`.
**À vérifier avant l'étape 6** : sous quelle licence ces modèles y sont
redistribués, et si le modèle KUKA provient du catalogue constructeur.
