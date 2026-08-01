# FEEDBACK.md

Retour d'expérience sur les APIs Zoo, tenu au fil de l'eau pendant le Zoo API
Makeathon (22 juillet → 5 août 2026), sur le projet **Caisse**.

Chaque entrée est écrite **au moment où la friction est rencontrée**, pas
reconstituée après coup. Sévérité :

- 🔴 **bloquant** — empêche d'avancer sans contournement
- 🟠 **friction** — coûte du temps, contournable
- 🟡 **doc** — l'API se comporte bien, la documentation ou le nommage induit en erreur

Environnement de référence : `@kittycad/lib@4.3.15`, `@msgpack/msgpack@3.1.3`,
`ws@8.21.1`, Node 20.19.6, Linux (WSL2).

**Périmètre.** Ce projet réutilise le transport WebSocket écrit pour un premier
projet du même makeathon (configurateur BESS). Les frictions rencontrées lors de
l'écriture de ce transport — battement de cœur non documenté, encodage MsgPack
des exports, variable d'environnement du SDK — sont documentées dans le
`FEEDBACK.md` de ce premier projet et ne sont pas répétées ici. Ce fichier ne
couvre que ce qui est **nouveau pour Caisse** : l'import de STEP client, la
mesure de géométrie importée, et la File Format API.

---

## #1 — 🟡 `ImportFile.data` est typé `number[]`, ce qui est intenable à l'échelle d'un vrai STEP

**Date :** 2026-08-01
**Surface :** Engine API, commande `import_files` ; SDK TypeScript

Le type généré déclare :

```ts
export interface ImportFile {
  data: number[];        // format: uint8
  path: string;
}
```

Un STEP de machine industrielle pèse couramment 10 à 30 Mo. Suivre le type à la
lettre — `Array.from(buffer)` — construit un tableau JavaScript de treize
millions d'entiers boxés, avant de le sérialiser élément par élément. Sur notre
fichier de test de 12,6 Mo, c'est plusieurs centaines de mégaoctets d'allocation
pour transmettre 12,6 Mo de données.

Passer directement un `Buffer` fonctionne et laisse le sérialiseur encoder la
charge en binaire :

```ts
files: [{ path: basename(path), data: bytes as unknown as number[] }]
```

Le cast est obligatoire pour satisfaire le compilateur, alors que c'est le seul
usage viable. Le type devrait accepter `Uint8Array`, comme le fait déjà
`RawFile.contents` en sortie — où le même écart existe, en miroir : le type dit
`string`, la trame contient des octets.

---

## #2 — 🟡 Les réponses de commande sont enveloppées, sauf `export`, et rien ne le signale

**Date :** 2026-08-01
**Surface :** Engine API, WebSocket ; SDK TypeScript

`import_files` et `bounding_box` répondent dans une enveloppe :

```
resp.type === 'modeling'  →  resp.data.modeling_response.type === 'import_files'
```

`export`, lui, arrive à plat :

```
resp.type === 'export'  →  resp.data.files
```

Les deux formes existent dans le même type union `OkWebSocketResponseData`, sans
qu'aucune règle ne permette de savoir *a priori* dans laquelle une commande
donnée va tomber. On l'apprend en écrivant un test de type qui échoue :

```
TS2367: This comparison appears to be unintentional because the types
'"debug" | "export" | … | "modeling"' and '"import_files"' have no overlap.
```

Le compilateur finit par le dire, ce qui limite les dégâts, mais la
documentation des commandes gagnerait à indiquer la forme de réponse attendue.
La règle réelle semble être : tout passe par `modeling`, sauf les réponses
volumineuses transportées en MsgPack. Elle n'est écrite nulle part.

---

## #3 — 🟠 « modeling connection interrupted » peut tomber au handshake, avant toute commande

**Date :** 2026-08-01
**Surface :** Engine API, ouverture de session WebSocket

Deuxième session de la journée, ouverte quelques minutes après une session
close proprement. Le WebSocket s'ouvre, puis le moteur émet immédiatement :

```
[internal_api] modeling connection interrupted; please reconnect and retry
```

Deux choses rendent ce message coûteux à interpréter :

1. **Il arrive sans `request_id`.** Il ne peut donc être rattaché à aucune
   commande en attente. Notre première commande — `set_scene_units`, envoyée
   pour attendre que la scène soit prête — est restée en attente jusqu'à son
   timeout de 60 s. Sans une trace explicite des erreurs non corrélées, le
   symptôme observé est « le moteur ne répond pas », et non « le moteur a
   refusé la connexion ».
2. **Le mot « interrupted » suggère une coupure en cours de travail**, alors
   qu'ici rien n'a encore été envoyé. Nous avons d'abord attribué l'échec à
   l'import d'un STEP de 12 Mo lancé dans la même passe — mauvaise conclusion,
   et une heure de piste fausse si le message avait été cru sur parole.

Le message dit lui-même quoi faire, et il a raison : une reconnexion trois
secondes plus tard réussit sans rien changer d'autre. La conduite à tenir est
donc de **toujours réessayer l'ouverture**, ce que ne fait aucun exemple de la
documentation.

Suggestion : corréler ce message à la requête d'ouverture, ou le distinguer de
la vraie coupure en cours de session — par exemple `connection rejected, please
retry`.

---

## #4 — 🔴 La bascule en asynchrone est indexée sur la taille du fichier, la passerelle sur le temps de conversion

**Date :** 2026-08-01
**Surface :** File Format API, `PUT /file/conversion/{src}/{output}`
(`create_file_conversion`)

La documentation de l'endpoint dit :

> If the file being converted is larger than 25MB, it will be performed
> asynchronously.

Le seuil porte sur la **taille**. Or ce qui fait échouer l'appel, c'est le
**temps de conversion**, et les deux ne sont pas corrélés. Mesures sur cinq
fichiers STEP réels, même endpoint, même sortie OBJ :

| Fichier | Taille | Résultat |
|---|---|---|
| `as1_pe_203.stp` | 0,13 Mo | ✅ 3,2 s — 1 580 sommets |
| `as1-oc-214.stp` | 0,42 Mo | ✅ 7,8 s — 4 388 sommets |
| `11752.stp` | **1,51 Mo** | ❌ **HTTP 504 à 61,4 s** |
| `Ventilator.stp` | **2,15 Mo** | ✅ 50,5 s — 13 054 sommets |
| `KR600_R2830-4.stp` | 12,59 Mo | ❌ HTTP 504 à 61,9 s |

**Le fichier de 1,51 Mo échoue et celui de 2,15 Mo passe.** Le facteur n'est pas
le poids, c'est la complexité géométrique : la passerelle coupe à ~60 s, et le
seuil des 25 Mo ne protège de rien puisqu'un fichier de 1,5 Mo peut demander
davantage. Tout le domaine « sous 25 Mo mais au-delà d'une minute de
tessellation » tombe en 504, sans qu'aucun message n'oriente vers l'asynchrone.

**Le 504 est nu :** pas de corps JSON, pas de code d'erreur Zoo, pas d'id
d'opération. Rien ne dit si la conversion continue côté serveur ni comment aller
chercher son résultat. Et `GET /user/api-calls` n'a listé, plusieurs minutes
après, aucune de nos conversions — seulement les ouvertures de WebSocket : il
n'y a donc pas non plus de voie détournée pour retrouver le job.

**Contournement, qui marche.** `POST /file/conversion`
(`create_file_conversion_options`) démarre un job et rend un id, sans horloge de
passerelle. Le même fichier de 1,51 Mo qui tombait en 504 :

```
job démarré en 1,5 s — uploaded, id 099a6a0b-…
statut final : completed après 107,4 s
19 702 sommets, emprise 1280 × 144 × 133 mm
```

107 s de conversion réelle contre 61 s de budget de passerelle : l'appel
synchrone ne pouvait pas aboutir.

**Suggestions**, par ordre d'utilité décroissante :

1. basculer en asynchrone sur un **temps écoulé** plutôt que sur une taille —
   au-delà de ~45 s, rendre l'id d'opération au lieu d'attendre le 504 ;
2. à défaut, renvoyer un 202 avec l'id d'opération quand la conversion dépasse
   le budget, plutôt qu'un 504 sans corps ;
3. à défaut encore, mentionner dans la doc de l'endpoint synchrone que la
   variante `POST /file/conversion` existe et n'a pas cette limite. Aujourd'hui
   la relation entre les deux endpoints ne se découvre qu'en lisant les types
   générés.

---

## #5 — 🟠 `import_files` est vingt fois plus lent que la File Format API sur le même fichier, et échoue sans diagnostic sur un STEP réel

**Date :** 2026-08-01
**Surface :** Engine API, commande `import_files` en session

Même fichier, même sortie, deux chemins :

| | `as1_pe_203.stp` (0,13 Mo) | `KR600_R2830-4.stp` (12,59 Mo) |
|---|---|---|
| Engine `import_files` | 56,2 s | ❌ `[internal_engine] import failed` après 457 s |
| Engine `export` OBJ ensuite | 33,0 s | — |
| **Total session facturée** | **91,4 s** | **457,8 s, pour rien** |
| File Format API (asynchrone) | 3,2 s | *voir mesure ci-dessous* |

Deux points distincts, le second étant le plus coûteux :

**Le temps.** 56 s pour importer 137 Ko dans le moteur quand la conversion du
même fichier en prend 3. Comme la facturation Zoo se compte au temps de session,
l'écart n'est pas seulement de la latence, il est facturé.

**L'échec.** Sur un STEP de robot industriel du commerce, `import_files` répond
`[internal_engine] import failed`. Rien d'autre : pas d'entité fautive, pas
d'étape, pas de distinction entre « fichier refusé », « tessellation trop
lourde » et « délai dépassé côté moteur ». Le même fichier est accepté par la
File Format API, donc il n'est pas malformé. Sept minutes de session facturées
pour un message de six mots.

Une session interactive n'a par ailleurs aucun moyen de savoir que l'import
progresse : pas d'événement d'avancement, pas d'estimation. Pour un outil qui
promet un résultat en trente secondes, l'écart entre « c'est en train de
travailler » et « c'est mort » n'est pas observable.

**Suggestions :** un code d'erreur distinguant refus / dépassement / erreur
interne ; un événement d'avancement pendant l'import ; et, si l'import moteur
doit rester lent, le dire dans la documentation — le choix d'architecture en
dépend entièrement.

**Conséquence pour ce projet.** L'emprise de la machine est mesurée par la File
Format API, pas par le moteur. L'Engine API reste utilisée pour ce qu'elle fait
bien et qu'elle seule fait : construire la caisse en b-rep et réexporter un STEP
qui contient machine et caisse dans la même scène.

---
