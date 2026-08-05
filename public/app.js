import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/**
 * Le studio.
 *
 * Deux volets : ce qu'on règle, et ce que ça produit. L'étude se relance à
 * chaque changement — quatre millisecondes, aucun appel à Zoo — donc il n'y a
 * pas de bouton « calculer ». Le seul bouton est celui qui coûte réellement
 * quelque chose : la session Zoo qui construit la caisse en b-rep et rend les
 * deux fichiers à télécharger.
 *
 * La caisse est d'abord dessinée localement à partir des pavés rendus par
 * l'étude. « Générer » la remplace par la vraie géométrie du moteur. La
 * distinction reste visible à l'écran : ce qui est gratuit et ce qui coûte une
 * session ne se confondent pas.
 */

const MM = 0.001;

const $ = (id) => document.getElementById(id);
const nb = (v) => Math.round(v).toLocaleString('en-GB');
const eur = (v) => `€${nb(v)}`;
const m = (v) => `${(v / 1000).toFixed(2)} m`;
const mm = (v) => `${nb(v)} mm`;

let etude = null;
let poseCourante = null;

/* ------------------------------------------------------------------ scène */

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();

// Repère Z en haut, comme la CAO et comme nos calculs. Laisser three en Y-up
// obligerait à convertir chaque cote, et c'est exactement le genre de
// conversion tacite qui finit par poser une machine en travers de sa caisse.
const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 500);
camera.up.set(0, 0, 1);
camera.position.set(7, -7, 4.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Sans cela, la molette zoome la scène **et** fait défiler la page : on perd la
// vue en essayant de la regarder.
canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
canvas.style.touchAction = 'none';
controls.target.set(0, 0, 0.8);

scene.add(new THREE.HemisphereLight(0xdff4ff, 0x0a2148, 2.2));
const soleil = new THREE.DirectionalLight(0xffffff, 1.45);
soleil.position.set(4, -6, 8);
scene.add(soleil);
// Une seconde source froide, côté opposé : sur fond bleu nuit, une caisse
// éclairée d'un seul côté perd toutes ses arêtes dans l'ombre.
const contre = new THREE.DirectionalLight(0x4fd8ff, 0.85);
contre.position.set(-6, 5, 3);
scene.add(contre);

const grille = new THREE.GridHelper(30, 30, 0x35e7ff, 0x14407f);
grille.rotation.x = Math.PI / 2;
grille.material.transparent = true;
grille.material.opacity = 0.28;
scene.add(grille);

let groupe = new THREE.Group();
scene.add(groupe);

function viderGroupe() {
  groupe.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => mat.dispose());
  });
  scene.remove(groupe);
  groupe = new THREE.Group();
  scene.add(groupe);
}

function cadrer() {
  const boite = new THREE.Box3().setFromObject(groupe);
  if (boite.isEmpty()) return;
  const taille = boite.getSize(new THREE.Vector3());
  const centre = boite.getCenter(new THREE.Vector3());
  const rayon = Math.max(taille.x, taille.y, taille.z);
  controls.target.copy(centre);
  camera.position.set(centre.x + rayon * 1.1, centre.y - rayon * 1.3, centre.z + rayon * 0.85);
  camera.updateProjectionMatrix();
  controls.update();
}

/**
 * La scène occupe le volet, dont la hauteur est celle de l'écran.
 *
 * On mesure donc les deux côtés au lieu de déduire la hauteur de la largeur :
 * dans un volet à hauteur fixe, une hauteur calculée déborde ou laisse un vide.
 */
function redimensionner() {
  const r = canvas.parentElement.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', redimensionner);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

/* -------------------------------------------------------------- matériaux */

// Le bois massif et les panneaux se distinguent : c'est la mention ISPM-15 qui
// ne porte que sur le premier, et un lecteur doit pouvoir la vérifier à l'œil.
const MATIERES = {
  patin: { color: 0xb98b4e, opacity: 1 },
  plancher: { color: 0xc9a06a, opacity: 1 },
  montant: { color: 0xd8b483, opacity: 1 },
  panneau: { color: 0xe6d3b3, opacity: 0.2 },
  chapeau: { color: 0xe6d3b3, opacity: 0.14 },
  // Le calage se distingue de la caisse : c'est ce qui tient la machine, et le
  // lecteur doit pouvoir le lire d'un coup d'œil.
  calage: { color: 0x9c6b3f, opacity: 1 },
};

function matiere(nomComplet) {
  // Dans la scène du découpage, les pavés sont préfixés par leur caisse.
  const nom = nomComplet.replace(/^(principale|seconde|caisse\d+)_/, '');
  if (/^(butee_|traverse_|cale_|lisse_)/.test(nom)) {
    const { color } = MATIERES.calage;
    return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.02 });
  }
  const clef = nom.startsWith('patin')
    ? 'patin'
    : nom.startsWith('plancher')
      ? 'plancher'
      : nom.startsWith('montant')
        ? 'montant'
        : nom === 'chapeau'
          ? 'chapeau'
          : 'panneau';
  const { color, opacity } = MATIERES[clef];
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.02,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity > 0.9,
    side: THREE.DoubleSide,
  });
}

function dessinerCaisse(boxes) {
  for (const b of boxes) {
    const geo = new THREE.BoxGeometry(b.width * MM, b.depth * MM, b.height * MM);
    const maille = new THREE.Mesh(geo, matiere(b.name));
    maille.position.set((b.x + b.width / 2) * MM, (b.y + b.depth / 2) * MM, (b.z + b.height / 2) * MM);
    maille.name = b.name;
    groupe.add(maille);

    if (!b.name.includes('panneau') && !b.name.endsWith('chapeau')) {
      groupe.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x8a6a3c })
        ).translateX(maille.position.x).translateY(maille.position.y).translateZ(maille.position.z)
      );
    }
  }
}

/* ---------------------------------------------------------------- machine */

const chargeurObj = new OBJLoader();
const chargeurGltf = new GLTFLoader();
let machineCache = { nom: null, objet: null };

async function chargerMachine(nom) {
  if (machineCache.nom === nom) return machineCache.objet.clone();

  const texte = await fetch(`/out/${nom}`).then((r) => r.text());
  const objet = chargeurObj.parse(texte);
  objet.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({ color: 0x35e7ff, roughness: 0.42, metalness: 0.3 });
    }
  });

  machineCache = { nom, objet };
  return objet.clone();
}

/**
 * Pose la machine avec **exactement** la transformation qui a servi au calcul.
 *
 * Le serveur renvoie la rotation en axe-angle et la translation en mm. three
 * compose translation × rotation × échelle, ce qui est l'ordre attendu : le
 * maillage est d'abord mis à l'échelle du fichier, tourné, puis posé.
 */
function poserMachine(objet, placement, scale) {
  const s = scale * MM;
  objet.scale.setScalar(s);
  objet.setRotationFromAxisAngle(
    new THREE.Vector3(...placement.rotationAxis).normalize(),
    (placement.rotationAngleDeg * Math.PI) / 180
  );
  objet.position.set(...placement.translateMm.map((v) => v * MM));
  return objet;
}

async function afficherPose(poseId, gltfNom) {
  if (!etude) return;
  poseCourante = poseId;

  viderGroupe();

  if (gltfNom) {
    // Géométrie b-rep réelle, sortie du moteur Zoo.
    const gltf = await chargeurGltf.loadAsync(`/out/${gltfNom}`);
    // Le glTF est en mètres et en Y-up : on le remet dans notre repère.
    gltf.scene.rotation.x = Math.PI / 2;
    // On garde les matériaux rendus par Zoo — c'est lui qui sait quel solide
    // est du calage, le glTF n'ayant pas de noms de maillage. On se contente de
    // rendre translucide ce qui est clair, c'est-à-dire les panneaux.
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      // Le moteur colorie chaque ouvrage selon sa famille : le seuil ne trie
      // donc plus « coloré ou gris » mais « franchement clair ou non », c'est-à-
      // dire les panneaux et le chapeau, et eux seuls. Avec un seuil plus bas,
      // les patins et les montants passaient translucides avec les panneaux et
      // la caisse rendue par Zoo apparaissait délavée.
      const c = o.material.color;
      const clair = c ? (c.r + c.g + c.b) / 3 > 0.78 : true;
      o.material.transparent = clair;
      o.material.opacity = clair ? 0.26 : 1;
      o.material.depthWrite = !clair;
      o.material.side = THREE.DoubleSide;
    });
    groupe.add(gltf.scene);
  } else {
    dessinerCaisse(etude.boxes[poseId] ?? []);
  }

  const placement = etude.placements.find((p) => p.pose === poseId);
  if (placement) {
    const machine = await chargerMachine($('mesh').value);
    groupe.add(poserMachine(machine, placement.placement, etude.unit.scale));
  }

  // Quand un découpage est proposé, l'image doit le dire aussi : le plan de
  // coupe, et les corps qui partent à part. Annoncer une coupe en montrant une
  // caisse entière est la même contradiction que celle du relevé.
  const d = etude.study.decoupe;
  if (d && poseId === (etude.study.poses.find((p) => !p.forbidden && p.pose !== 'reference') ?? {}).pose) {
    dessinerDecoupe(d, etude.study.poses.find((p) => p.pose === poseId));
  }

  cadrer();
  redimensionner();

  const pose = etude.study.poses.find((p) => p.pose === poseId);
  $('legende').textContent = pose
    ? `${pose.label} · crate ${m(pose.crate.outer.lengthMm)} × ${m(pose.crate.outer.widthMm)} × ${m(
        pose.crate.outer.heightMm
      )}`
    : '3D preview';
}

/**
 * Le plan de coupe et les corps qui partent à part.
 *
 * On ne dessine pas deux caisses : l'outil ne découpe pas, et fabriquer les
 * morceaux laisserait croire qu'il décide. On montre ce qu'il dit — voici le
 * plan, voici ce qui dépasse.
 */
function dessinerDecoupe(d, pose) {
  if (!pose) return;
  const L = pose.crate.outer.lengthMm * MM;
  const l = pose.crate.outer.widthMm * MM;

  const plan = new THREE.Mesh(
    new THREE.PlaneGeometry(L * 1.15, l * 1.15),
    new THREE.MeshBasicMaterial({ color: 0xff2350, transparent: true, opacity: 0.2, side: THREE.DoubleSide })
  );
  for (const niveau of d.plansMm) {
    const p = plan.clone();
    p.position.set(0, 0, niveau * MM);
    groupe.add(p);
  }

  for (const b of d.caisses.slice(1).flatMap((c) => c.boites)) {
    const taille = [0, 1, 2].map((a) => Math.max(1, b.max[a] - b.min[a]) * MM);
    const geo = new THREE.BoxGeometry(...taille);
    const arete = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xff2350 })
    );
    arete.position.set(
      ((b.min[0] + b.max[0]) / 2) * MM,
      ((b.min[1] + b.max[1]) / 2) * MM,
      ((b.min[2] + b.max[2]) / 2) * MM
    );
    groupe.add(arete);
    geo.dispose();
  }
}

/**
 * Les caisses du découpage, garnies.
 *
 * Les pièces arrivent **déjà placées** dans les fichiers rendus par le serveur :
 * on charge et on affiche, sans rejouer la moindre transformation. C'est
 * volontaire — chaque transformation rejouée est une occasion de la rejouer de
 * travers, et on en a déjà corrigé trois.
 */
async function afficherDecoupe(r, gltfNom) {
  viderGroupe();

  if (gltfNom) {
    const gltf = await chargeurGltf.loadAsync(`/out/${gltfNom}`);
    gltf.scene.rotation.x = Math.PI / 2;
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      // Le moteur colorie chaque ouvrage selon sa famille : le seuil ne trie
      // donc plus « coloré ou gris » mais « franchement clair ou non », c'est-à-
      // dire les panneaux et le chapeau, et eux seuls. Avec un seuil plus bas,
      // les patins et les montants passaient translucides avec les panneaux et
      // la caisse rendue par Zoo apparaissait délavée.
      const c = o.material.color;
      const clair = c ? (c.r + c.g + c.b) / 3 > 0.78 : true;
      o.material.transparent = clair;
      o.material.opacity = clair ? 0.26 : 1;
      o.material.depthWrite = !clair;
      o.material.side = THREE.DoubleSide;
    });
    groupe.add(gltf.scene);
  } else {
    dessinerCaisse(r.boxes);
  }

  // Une couleur par caisse : la répartition doit se lire d'un coup d'œil.
  const teintes = [0x35e7ff, 0xff2350, 0x7cff9b, 0xc08cff];

  for (const [i, fichier] of r.fichiers.entries()) {
    const texte = await fetch(`/out/${fichier}`).then((x) => x.text());
    const objet = chargeurObj.parse(texte);
    objet.scale.setScalar(MM);
    objet.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshStandardMaterial({
          color: teintes[i % teintes.length],
          roughness: 0.45,
          metalness: 0.28,
        });
      }
    });
    groupe.add(objet);
  }

  cadrer();
  redimensionner();

  $('legende').textContent = r.decoupe.caisses
    .map((c, i) => `Crate ${i + 1} ${m(c.crate.outer.lengthMm)} × ${m(c.crate.outer.widthMm)} × ${m(c.crate.outer.heightMm)}`)
    .join('  ·  ');
}

/* ----------------------------------------------------------------- relevé */

const echapper = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const CONTRAINTE = {
  hauteur: 'height',
  largeur: 'width',
  longueur: 'length',
  'porte-hauteur': 'door height',
  'porte-largeur': 'door width',
  charge: 'payload',
};

/**
 * Ce que l'étude a trouvé, en quelques lignes.
 *
 * Le studio n'est pas une note de synthèse : il montre la caisse et rend deux
 * fichiers. Le relevé dit le strict nécessaire pour que les deux fichiers
 * veuillent dire quelque chose — quelle caisse, dans quel gabarit, avec quelle
 * marge — et la ligne de note porte le seul cas où l'outil refuse.
 */
function rendreRelevé(s) {
  const lignes = [];
  let note = '';

  if (s.decoupe) {
    const d = s.decoupe;
    lignes.push(['Shipment', `${d.caisses.length} crates`]);
    d.caisses.forEach((c, i) => {
      const check = c.retained ?? c.checks[0];
      lignes.push([
        `Crate ${i + 1}`,
        `${m(c.crate.outer.lengthMm)} × ${m(c.crate.outer.widthMm)} × ${m(c.crate.outer.heightMm)}`,
      ]);
      if (check) lignes.push([`Gauge ${i + 1}`, check.fits ? check.gabarit.label : 'out of gauge', check.fits]);
    });
    lignes.push(['Total', `${eur(d.totalEur)} · ${d.leadTimeDays} days`]);
    note = `Split ${d.axe === 2 ? 'by height' : 'by width'} at ${d.plansMm
      .map((v) => (v / 1000).toFixed(2) + ' m')
      .join(' and ')}. The tool does not decide the breakdown: a separate body in a mesh is not a
      removable part. It names the bodies that carry the overrun and prices the assumption.`;
  } else if (s.overloaded) {
    lignes.push(['Gross mass', `${nb(s.overloaded.grossKg)} kg`, false]);
    lignes.push(['Max payload', `${nb(s.overloaded.maxPayloadKg)} kg`]);
    lignes.push(['Gauge', s.overloaded.gabaritLabel]);
    note = `Rejected on payload, not on size. No orientation changes that, and neither does going
      out of gauge: a flat rack carries the volume, not the tonnage.`;
  } else if (s.best) {
    const p = s.best;
    lignes.push(['Pose', p.label]);
    lignes.push([
      'Crate',
      `${m(p.crate.outer.lengthMm)} × ${m(p.crate.outer.widthMm)} × ${m(p.crate.outer.heightMm)}`,
    ]);
    lignes.push(['Gauge', p.retained.gabarit.label, true]);
    lignes.push([
      'Tightest margin',
      `${mm(p.retained.tightestMarginMm)} on ${CONTRAINTE[p.retained.tightestOn] ?? p.retained.tightestOn}`,
      p.retained.confidence !== 'juste',
    ]);
    lignes.push(['Tare · gross', `${nb(p.crate.tareKg)} kg · ${nb(p.crate.grossKg)} kg`]);
    lignes.push(['Cost · lead time', `${eur(p.costing.totalEur)} · ${p.costing.leadTimeDays} days`]);
    if (p.retained.confidence === 'juste') {
      note = 'This one just fits. Confirm the margin with the crate maker before ordering.';
    }
  } else if (s.otherMode) {
    lignes.push(['Requested mode', 'no gauge fits', false]);
    lignes.push(['Other mode', s.otherMode.gabaritLabel, true]);
    lignes.push(['Pose', s.otherMode.label]);
    lignes.push(['Margin', mm(s.otherMode.marginMm)]);
    lignes.push([
      'Cost · lead time',
      `${eur(s.otherMode.costing.totalEur)} · ${s.otherMode.costing.leadTimeDays} days`,
    ]);
    note = 'Switching routing mode is your call, not the tool’s: a machine bound for Asia does not travel by road.';
  } else if (s.fallbacks) {
    lignes.push(['Verdict', 'no pose fits', false]);
    lignes.push([
      s.fallbacks.oversize.label,
      `${eur(s.fallbacks.oversize.totalEur)} · ${s.fallbacks.oversize.leadTimeDays} days`,
    ]);
    lignes.push([
      s.fallbacks.split.label,
      `${eur(s.fallbacks.split.totalEur)} · ${s.fallbacks.split.leadTimeDays} days`,
    ]);
    note = 'The tool does not choose: it prices both routes out and leaves the decision to you.';
  }

  $('readout').innerHTML = lignes
    .map(
      ([clef, valeur, etat]) =>
        `<div><dt>${echapper(clef)}</dt><dd${
          etat === undefined ? '' : ` data-state="${etat ? 'pass' : 'fail'}"`
        }>${echapper(valeur)}</dd></div>`
    )
    .join('');
  $('readout-note').textContent = note.replace(/\s+/g, ' ').trim();
  $('groupe-resultat').hidden = false;
}

function rendreMentions(s) {
  $('hypotheses').innerHTML = s.assumptions
    .map(
      (a) =>
        `<div><dt>${echapper(a.label)}</dt><dd><span class="value">${echapper(
          a.value
        )}</span>${echapper(a.rationale)}</dd></div>`
    )
    .join('');
  $('mentions').innerHTML = s.notices.map((n) => `<p>${echapper(n)}</p>`).join('');
  $('groupe-mentions').hidden = false;
}

/* --------------------------------------------------------------- chargement */

/**
 * Déroulé des étapes pendant un calcul.
 *
 * Les étapes affichées sont celles qui ont réellement lieu. La seule chose
 * ajoutée est une **durée plancher** : sans elle, l'étude finit en quarante
 * millisecondes et l'écran change si vite qu'on ne voit pas ce qui s'est passé.
 * Montrer le travail n'est pas l'inventer.
 */
const ETAPES_ETUDE = [
  'reading the mesh',
  'convex hull and yaw sweep',
  'three poses, five gauges',
  'crate structure and blocking',
  'rendering',
];

const ETAPES_ZOO = [
  'opening the Zoo session',
  'importing the machine as b-rep',
  'building the crate',
  'exporting STEP and glTF',
];

/**
 * Une seule exécution à la fois, et elle seule commande l'affichage.
 *
 * Sans ce jeton, deux calculs qui se croisent se marchent dessus : le premier
 * termine sa temporisation et éteint le voile du second, dont la minuterie
 * continue de tourner sur un élément caché.
 */
let execution = 0;
let minuterie;

function demarrerChargement(etapes, dureeMs = 2200) {
  const id = ++execution;
  const zone = $('chargement');
  const etiquette = zone.querySelector('.loading-step');
  const debut = performance.now();
  let i = 0;

  const afficher = () => {
    if (id !== execution) return;
    etiquette.textContent = etapes[Math.min(i, etapes.length - 1)];
  };

  clearInterval(minuterie);
  zone.hidden = false;
  afficher();

  minuterie = setInterval(() => {
    if (id !== execution) {
      clearInterval(minuterie);
      return;
    }
    i += 1;
    if (i < etapes.length) afficher();
  }, dureeMs / etapes.length);

  return async () => {
    const reste = dureeMs - (performance.now() - debut);
    if (reste > 0) await new Promise((r) => setTimeout(r, reste));
    // Une exécution plus récente a pris la main : ce n'est pas à celle-ci
    // d'éteindre son voile.
    if (id !== execution) return;
    clearInterval(minuterie);
    zone.hidden = true;
  };
}

/* ------------------------------------------------------------------ appels */

async function poster(url, corps) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

function saisie() {
  return {
    mesh: $('mesh').value,
    massKg: Number($('massKg').value),
    up: $('up').value,
    unit: $('unit').value,
    mode: $('mode').value,
    forbidLying: $('forbidLying').checked,
    caisses: $('caisses').value ? Number($('caisses').value) : undefined,
  };
}

/**
 * Les sorties ne survivent pas à un changement de réglage.
 *
 * Un STEP téléchargeable sous des paramètres qui ne sont plus ceux affichés est
 * pire qu'un bouton grisé : c'est un fichier faux qui part chez le caissier.
 */
function reinitialiserSorties() {
  for (const id of ['dl-step', 'dl-gltf']) {
    const a = $(id);
    a.setAttribute('aria-disabled', 'true');
    a.removeAttribute('href');
  }
}

function armerSortie(id, fichier) {
  const a = $(id);
  if (!fichier) return;
  a.href = `/out/${fichier}`;
  a.setAttribute('aria-disabled', 'false');
}

async function etudier() {
  const fini = demarrerChargement(ETAPES_ETUDE);
  const monTour = execution;
  reinitialiserSorties();
  try {
    const recu = await poster('/api/etude', saisie());
    // Une étude plus récente a été lancée pendant celle-ci : la sienne fait
    // foi. Écraser l'écran avec un résultat périmé afficherait le relevé d'un
    // fichier et le nom d'un autre.
    if (monTour !== execution) return;
    etude = recu;

    $('generer').disabled = false;
    $('generer-texte').textContent = etude.study.decoupe
      ? `Generate ${etude.study.decoupe.caisses.length} crates with Zoo`
      : 'Generate with Zoo';

    rendreRelevé(etude.study);
    rendreMentions(etude.study);

    // La vue montre ce que l'outil recommande. Si un découpage est proposé,
    // c'est **lui** la recommandation : afficher une caisse unique pendant que
    // le relevé parle de trois caisses laisse croire que rien ne se passe.
    if (etude.study.decoupe) {
      const r = await poster('/api/decoupe', saisie());
      if (monTour !== execution) return;
      await afficherDecoupe(r);
    } else {
      await afficherPose(etude.study.best?.pose ?? etude.study.otherMode?.pose ?? 'A', null);
    }

    $('etat-calcul').textContent =
      `${nb(etude.vertices)} vertices · ${etude.ms} ms · unit ${etude.unit.unit}` +
      (etude.unit.plausible ? '' : ' · unit looks wrong');
    $('vue-etat').textContent = 'Local preview';
  } catch (err) {
    if (monTour === execution) $('etat-calcul').textContent = `Failed: ${err.message}`;
  } finally {
    await fini();
  }
}

// Pas de bouton « calculer » : l'étude coûte quatre millisecondes et n'appelle
// pas Zoo. Un bouton pour ça, c'est un clic de plus et une occasion d'oublier.
$('formulaire').addEventListener('submit', (e) => {
  e.preventDefault();
  void etudier();
});

for (const champ of ['mesh', 'massKg', 'up', 'unit', 'mode', 'caisses', 'forbidLying']) {
  $(champ).addEventListener('change', () => void etudier());
}

$('generer').addEventListener('click', async () => {
  $('vue-etat').textContent = 'Zoo session running…';
  const fini = demarrerChargement(ETAPES_ZOO, 2500);
  reinitialiserSorties();

  // Un découpage proposé, ce sont N caisses à construire, pas une.
  if (etude?.study.decoupe) {
    try {
      const r = await poster('/api/scene-decoupe', saisie());
      const local = await poster('/api/decoupe', saisie());
      await afficherDecoupe(local, r.gltf);
      $('vue-etat').textContent =
        `${r.caisses} crates · ${r.solides} b-rep solids · Zoo session ${(r.sessionMs / 1000).toFixed(1)} s`;
      armerSortie('dl-step', r.step);
      armerSortie('dl-gltf', r.gltf);
    } catch (err) {
      $('vue-etat').textContent = `Failed: ${err.message}`;
    } finally {
      await fini();
    }
    return;
  }

  try {
    const r = await poster('/api/scene', { ...saisie(), pose: poseCourante });
    await afficherPose(r.pose, r.gltf);
    const ok = r.controle.ecartMm !== undefined && r.controle.ecartMm < 1;
    $('vue-etat').textContent =
      `${r.solides} b-rep solids · Zoo session ${(r.sessionMs / 1000).toFixed(1)} s · ` +
      (ok
        ? `size matches the verdict${r.machineIncluse ? ', machine included' : ''}`
        : `off by ${Math.round(r.controle.ecartMm)} mm against the verdict`) +
      (r.note ? ` · ${r.note}` : '');

    // Un caissier ne peut rien faire d'une scène qu'il ne peut pas ouvrir : le
    // STEP est l'artefact qui sort de l'outil et rentre dans son PLM.
    armerSortie('dl-step', r.step);
    armerSortie('dl-gltf', r.gltf);
  } catch (err) {
    $('vue-etat').textContent = `Failed: ${err.message}`;
  } finally {
    await fini();
  }
});

$('fichier').addEventListener('change', async (e) => {
  const fichier = e.target.files?.[0];
  if (!fichier) return;

  const estObj = /\.obj$/i.test(fichier.name);
  $('etat-calcul').textContent = estObj
    ? `Reading ${fichier.name}…`
    : `${fichier.name} · converting through Zoo, this can take minutes…`;
  try {
    const base64 = await new Promise((resolve, reject) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(String(lecteur.result).split(',')[1]);
      lecteur.onerror = reject;
      lecteur.readAsDataURL(fichier);
    });

    const r = await poster('/api/conversion', { name: fichier.name, base64 });
    await remplirMaillages(r.mesh);
    void etudier();
    if (!r.direct) $('etat-calcul').textContent = `Converted by Zoo in ${(r.ms / 1000).toFixed(1)} s`;
  } catch (err) {
    $('etat-calcul').textContent = `Conversion refused: ${err.message}`;
  }
});

async function remplirMaillages(selection) {
  const { meshes } = await fetch('/api/maillages').then((r) => r.json());
  $('mesh').innerHTML = meshes.map((f) => `<option value="${echapper(f)}">${echapper(f)}</option>`).join('');
  // Par défaut, le KR6 outillé : un vrai robot industriel, assez grand pour que
  // l'orientation et le découpage aient quelque chose à dire, assez petit pour
  // que l'étude s'affiche tout de suite.
  const defaut = meshes.find((f) => f.includes('kuka_kr6_with_tool'));
  if (selection && meshes.includes(selection)) $('mesh').value = selection;
  else if (defaut) $('mesh').value = defaut;
  return meshes;
}

const disponibles = await remplirMaillages();
redimensionner();

// Une étude au chargement : sans elle, l'exemple déjà sélectionné ne déclenche
// aucun `change`, et l'écran reste vide tant qu'on n'a pas changé de fichier.
//
// Et s'il n'y a aucun exemple, on le dit. Un menu vide au-dessus d'une page
// vide laisse croire que l'outil est cassé, alors qu'il attend un fichier.
if (disponibles.length) void etudier();
else $('etat-calcul').textContent = 'No example available. Upload a STEP or OBJ file to start.';
