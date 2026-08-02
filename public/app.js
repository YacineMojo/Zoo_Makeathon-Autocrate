import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/**
 * L'atelier.
 *
 * Deux écrans comptent, et deux seulement (PROJECT.md §13) : le tableau des
 * poses, et la machine à l'intérieur de sa caisse. Tout le reste est du texte.
 *
 * La caisse est d'abord dessinée localement à partir des pavés rendus par
 * l'étude — instantané, aucune session Zoo. Le bouton « Générer » la remplace
 * par la vraie géométrie b-rep du moteur. La distinction est visible à l'écran :
 * ce qui est gratuit et ce qui coûte une session ne se confondent pas.
 */

const MM = 0.001;

const $ = (id) => document.getElementById(id);
const eur = (v) => `${v.toLocaleString('fr-FR')} €`;
const m = (v) => `${(v / 1000).toFixed(2)} m`;

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

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa6b2, 2.1));
const soleil = new THREE.DirectionalLight(0xffffff, 1.5);
soleil.position.set(4, -6, 8);
scene.add(soleil);

const grille = new THREE.GridHelper(30, 30, 0xc2ccd5, 0xdbe1e7);
grille.rotation.x = Math.PI / 2;
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

function redimensionner() {
  const r = canvas.getBoundingClientRect();
  if (r.width < 2) return;
  renderer.setSize(r.width, Math.round(r.width * 0.58), false);
  camera.aspect = r.width / Math.round(r.width * 0.58);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', redimensionner);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

/* -------------------------------------------------------------- matériaux */

// Le bois massif et les panneaux se distinguent : c'est la mention NIMP-15 qui
// ne porte que sur le premier, et un lecteur doit pouvoir la vérifier à l'œil.
const MATIERES = {
  patin: { color: 0xb98b4e, opacity: 1 },
  plancher: { color: 0xc9a06a, opacity: 1 },
  montant: { color: 0xd8b483, opacity: 1 },
  panneau: { color: 0xe6d3b3, opacity: 0.22 },
  chapeau: { color: 0xe6d3b3, opacity: 0.16 },
  // Le calage se distingue de la caisse : c'est ce qui tient la machine, et le
  // lecteur doit pouvoir le lire d'un coup d'œil.
  calage: { color: 0x9c6b3f, opacity: 1 },
};

function matiere(nomComplet) {
  // Dans la scène du découpage, les pavés sont préfixés par leur caisse.
  const nom = nomComplet.replace(/^(principale|seconde)_/, '');
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

    if (!b.name.startsWith('panneau') && b.name !== 'chapeau') {
      groupe.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x6b5636 })
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
      o.material = new THREE.MeshStandardMaterial({ color: 0xb2b400, roughness: 0.55, metalness: 0.15 });
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
      const c = o.material.color;
      const clair = c ? (c.r + c.g + c.b) / 3 > 0.6 : true;
      o.material.transparent = clair;
      o.material.opacity = clair ? 0.3 : 1;
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
  // caisse entière est la même contradiction que celle du tableau.
  const d = etude.study.decoupe;
  if (d && poseId === (etude.study.poses.find((p) => !p.forbidden && p.pose !== 'reference') ?? {}).pose) {
    dessinerDecoupe(d, etude.study.poses.find((p) => p.pose === poseId));
  }

  cadrer();
  redimensionner();

  const pose = etude.study.poses.find((p) => p.pose === poseId);
  $('legende').textContent = pose
    ? `${pose.label} — caisse ${m(pose.crate.outer.lengthMm)} × ${m(pose.crate.outer.widthMm)} × ` +
      `${m(pose.crate.outer.heightMm)}, tare ${pose.crate.tareKg} kg.`
    : '';
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

  // Le plan de coupe, en travers de la caisse.
  const plan = new THREE.Mesh(
    new THREE.PlaneGeometry(L * 1.15, l * 1.15),
    new THREE.MeshBasicMaterial({ color: 0xc0392b, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
  );
  for (const niveau of d.plansMm) {
    const p = plan.clone();
    p.position.set(0, 0, niveau * MM);
    groupe.add(p);
  }

  // Les corps qui dépassent, cerclés de rouge.
  for (const b of d.caisses.slice(1).flatMap((c) => c.boites)) {
    const taille = [0, 1, 2].map((a) => Math.max(1, b.max[a] - b.min[a]) * MM);
    const geo = new THREE.BoxGeometry(...taille);
    const arete = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xc0392b, linewidth: 2 })
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
 * Les deux caisses du découpage, garnies.
 *
 * Les pièces arrivent **déjà placées** dans les fichiers rendus par le serveur :
 * on charge et on affiche, sans rejouer la moindre transformation. C'est
 * volontaire — chaque transformation rejouée est une occasion de la rejouer de
 * travers, et on en a déjà corrigé trois.
 */
async function afficherDecoupe(r, gltfNom) {
  viderGroupe();

  if (gltfNom) {
    // Géométrie b-rep réelle, sortie du moteur Zoo.
    const gltf = await chargeurGltf.loadAsync(`/out/${gltfNom}`);
    gltf.scene.rotation.x = Math.PI / 2;
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const c = o.material.color;
      const clair = c ? (c.r + c.g + c.b) / 3 > 0.6 : true;
      o.material.transparent = clair;
      o.material.opacity = clair ? 0.3 : 1;
      o.material.depthWrite = !clair;
      o.material.side = THREE.DoubleSide;
    });
    groupe.add(gltf.scene);
  } else {
    dessinerCaisse(r.boxes);
  }

  // Une couleur par caisse : la première garde le jaune machine, les suivantes
  // s'en détachent — c'est ce qui rend la répartition lisible d'un coup d'œil.
  const teintes = [0xb2b400, 0xc0392b, 0x2e86c1, 0x8e44ad];

  for (const [i, fichier] of r.fichiers.entries()) {
    const texte = await fetch(`/out/${fichier}`).then((x) => x.text());
    const objet = chargeurObj.parse(texte);
    objet.scale.setScalar(MM);
    objet.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshStandardMaterial({
          color: teintes[i % teintes.length],
          roughness: 0.55,
          metalness: 0.15,
        });
      }
    });
    groupe.add(objet);
  }

  cadrer();
  redimensionner();

  const d = r.decoupe;
  $('legende').textContent =
    d.caisses
      .map((c, i) => `Caisse ${i + 1} : ${m(c.crate.outer.lengthMm)} × ${m(c.crate.outer.widthMm)} × ${m(c.crate.outer.heightMm)}`)
      .join('  ·  ');
}

/* ---------------------------------------------------------------- tableau */

function rendreTableau() {
  const s = etude.study;

  const lignes = s.poses
    .map((p) => {
      const passe = Boolean(p.retained);
      // Le badge « retenue » ne s'affiche que s'il y a réellement quelque chose
      // à arbitrer. Le poser pour 38 € de contreplaqué apprend au lecteur à
      // ignorer nos recommandations, y compris le jour où elles comptent.
      const meilleure = s.best && s.best.pose === p.pose && s.arbitrage === 'gabarit';
      // Une pose qui ne passe pas dans le mode demandé mais passe dans l'autre
      // n'est pas « hors gabarit » : elle est hors **de ce mode-ci**. La
      // nuance vaut plusieurs milliers d'euros, et le tableau doit la porter.
      const autre = !passe && !p.forbidden && p.otherMode;
      const classe = p.forbidden ? 'ligne-ecartee' : passe ? 'ligne-verte' : autre ? 'ligne-autre' : 'ligne-rouge';
      const serre = passe && p.retained.confidence === 'juste';
      return `
        <tr class="${classe} ${meilleure ? 'ligne-retenue' : ''}" data-pose="${p.pose}" title="Cliquer pour voir cette pose en 3D">
          <td>${p.label}${meilleure ? ' <span class="cran">retenue</span>' : ''}</td>
          <td>${m(p.crate.outer.lengthMm)} × ${m(p.crate.outer.widthMm)} × ${m(p.crate.outer.heightMm)}</td>
          <td>${
            p.forbidden
              ? 'écartée'
              : passe
                ? p.retained.gabarit.label
                : autre
                  ? `${p.otherMode.gabarit.gabarit.label} <span class="cran">autre mode</span>`
                  : 'hors gabarit'
          }${serre ? ` <span class="cran cran-juste">${p.retained.tightestMarginMm} mm</span>` : ''}</td>
          <td class="nombre">${p.forbidden ? '—' : eur(autre ? p.otherMode.costing.totalEur : p.costing.totalEur)}</td>
          <td class="nombre">${
            p.forbidden ? '—' : `${(autre ? p.otherMode.costing : p.costing).leadTimeDays} j`
          }</td>
        </tr>`;
    })
    .join('');

  $('tableau').innerHTML = `
    <table class="tableau-poses">
      <thead>
        <tr><th>Pose</th><th>Caisse L × l × h</th><th>Gabarit</th><th>Coût</th><th>Délai</th></tr>
      </thead>
      <tbody>${lignes}</tbody>
    </table>`;

  for (const tr of $('tableau').querySelectorAll('tr[data-pose]')) {
    tr.addEventListener('click', () => afficherPose(tr.dataset.pose === 'reference' ? 'A' : tr.dataset.pose, null));
  }

  // Le delta, qui est le produit : « ça ne passe pas » vaut zéro, « couchée ça
  // passe, et voilà ce que ça économise » vaut le déplacement (§15).
  const ref = s.poses.find((p) => p.pose === 'reference');
  let verdict;
  if (s.overloaded) {
    // Un refus par charge utile est invariant par orientation. Afficher un
    // tableau de poses laisserait croire qu'une orientation sauverait la mise.
    verdict = `<strong>Refus par charge utile.</strong> ${s.overloaded.grossKg.toLocaleString('fr-FR')} kg brut
      pour ${s.overloaded.maxPayloadKg.toLocaleString('fr-FR')} kg admissibles sur le gabarit le plus capable
      (${s.overloaded.gabaritLabel}). Aucune orientation ne change cela, et le hors gabarit non plus :
      c'est un problème de masse, pas d'encombrement.`;
  } else if (s.best && s.arbitrage === 'aucun') {
    // Rien à arbitrer : autant le dire en une ligne et laisser le tableau parler.
    verdict = `Toutes les poses passent en <strong>${s.best.retained.gabarit.label}</strong>
      — ${eur(s.best.costing.totalEur)}, ${s.best.costing.leadTimeDays} j.`;
  } else if (s.best) {
    const eco = ref.costing.totalEur - s.best.costing.totalEur;
    const jours = ref.costing.leadTimeDays - s.best.costing.leadTimeDays;
    // Une phrase. Le tableau porte le détail, le bandeau porte la conclusion.
    const serre = s.best.retained.confidence === 'juste';
    verdict = `<strong>${eur(eco)}</strong> et <strong>${jours} jours</strong> économisés —
      ${s.best.label.toLowerCase()}, ${s.best.retained.gabarit.label}` +
      (serre
        ? `, <strong>de justesse</strong> : ${s.best.retained.tightestMarginMm} mm en ${s.best.retained.tightestOn}.`
        : '.');

    // Le groupage est presque toujours le moins cher et presque toujours le
    // plus lent. Trancher en silence sur le prix contredirait la thèse : pour
    // un constructeur, rater une fenêtre d'expédition coûte plus que le fret.
    if (s.decoupe) {
      // Découpage demandé alors qu'une caisse unique suffit : la comparaison
      // est justement ce qui a été demandé, on la donne.
      const ecart = s.decoupe.totalEur - s.best.costing.totalEur;
      verdict += `<br /><span class="verdict-second">En ${s.decoupe.caisses.length} caisses :
        ${eur(s.decoupe.totalEur)} en ${s.decoupe.leadTimeDays} j,
        ${ecart >= 0 ? eur(ecart) + ' de plus' : eur(-ecart) + ' de moins'} qu'en une seule.</span>`;
    }

    if (s.faster) {
      const jours = s.best.costing.leadTimeDays - s.faster.costing.leadTimeDays;
      const surcout = s.faster.costing.totalEur - s.best.costing.totalEur;
      verdict += `<br /><span class="verdict-second">Plus rapide : ${s.faster.gabaritLabel},
        ${eur(s.faster.costing.totalEur)} en ${s.faster.costing.leadTimeDays} j —
        ${jours} jours de moins pour ${eur(surcout)}.</span>`;
    }
  } else if (s.otherMode) {
    verdict = `Aucun gabarit ${$('mode').value === 'maritime' ? 'maritime' : 'routier'}.
      En revanche « ${s.otherMode.label} » passe en ${s.otherMode.gabaritLabel} avec
      ${s.otherMode.marginMm} mm de marge : <strong>${eur(s.otherMode.costing.totalEur)}</strong>,
      ${s.otherMode.costing.leadTimeDays} j. Changer de mode est votre décision, pas celle de l'outil.`;
  } else if (s.decoupe) {
    // Le §6.5 dit « l'outil ne découpe pas ». Il ne découpe toujours pas : il
    // désigne les corps qui portent le dépassement et chiffre l'hypothèse.
    const d = s.decoupe;
    verdict = `Aucune pose ne passe. Mais en <strong>${d.caisses.length} caisses</strong>, coupées
      ${d.axe === 2 ? 'en hauteur' : 'en largeur'} à
      ${d.plansMm.map((v) => (v / 1000).toFixed(2) + ' m').join(' et ')}, l'ensemble passe en
      <strong>${eur(d.totalEur)}</strong> et ${d.leadTimeDays} j — contre
      ${eur(s.fallbacks.oversize.totalEur)} en ${s.fallbacks.oversize.leadTimeDays} j hors gabarit.
      <span class="verdict-second">L'outil ne découpe pas : un corps distinct dans un maillage n'est pas
      une pièce démontable. Il dit lesquels coûtent, l'ingénierie tranche.</span>`;
  } else {
    verdict = `Aucune pose ne passe. Les deux issues, chiffrées :
      ${s.fallbacks.oversize.label} <strong>${eur(s.fallbacks.oversize.totalEur)}</strong> en
      ${s.fallbacks.oversize.leadTimeDays} j, ou démontage en deux caisses
      <strong>${eur(s.fallbacks.split.totalEur)}</strong> en ${s.fallbacks.split.leadTimeDays} j.
      L'outil ne découpe pas : il chiffre les deux et laisse choisir.`;
  }
  $('verdict').innerHTML = verdict;


  // Valeurs en texte, pas dans un cadre qui ressemble à un champ de saisie :
  // la table est en lecture seule (§10), autant que ça se voie. Une fausse
  // affordance est pire qu'une absence d'affordance.
  $('hypotheses').innerHTML = s.assumptions
    .map(
      (a) =>
        `<div class="fiche"><strong>${a.label}</strong><span class="valeur-hypothese">${a.value}</span><p>${a.rationale}</p></div>`
    )
    .join('');

  $('mentions').innerHTML = s.notices.map((n) => `<p>${n}</p>`).join('');
}

/* --------------------------------------------------------------- chargement */

/**
 * Déroulé des étapes pendant un calcul.
 *
 * Les étapes affichées sont celles qui ont réellement lieu — lecture du
 * maillage, balayage du lacet, verdicts, calage, rendu. La seule chose ajoutée
 * est une **durée plancher** : sans elle, l'étude finit en quarante
 * millisecondes et l'écran change si vite qu'on ne voit pas ce qui s'est passé.
 * Montrer le travail n'est pas l'inventer.
 */
const ETAPES_ETUDE = [
  'lecture du maillage',
  'enveloppe convexe et balayage du lacet',
  'trois poses, cinq gabarits',
  'structure de caisse et calage',
  'rendu',
];

const ETAPES_ZOO = [
  'ouverture de la session Zoo',
  'import de la machine en b-rep',
  'construction de la caisse',
  'export STEP et glTF',
];

/**
 * Une seule exécution à la fois, et elle seule commande l'animation.
 *
 * Sans ce jeton, deux calculs qui se croisent se marchent dessus : le premier
 * termine sa temporisation et éteint l'animation du second, dont la minuterie
 * continue de tourner sur un élément caché. L'animation ne s'arrêtait plus.
 */
let execution = 0;
let minuterie;

function demarrerChargement(etapes, dureeMs = 3000) {
  const id = ++execution;
  const zone = $('chargement');
  const debut = performance.now();
  let i = 0;

  const afficher = () => {
    if (id !== execution) return;
    zone.innerHTML =
      `<span class="fusee"></span><span class="chargement-etape">${etapes[Math.min(i, etapes.length - 1)]}</span>`;
  };

  clearInterval(minuterie);
  zone.hidden = false;
  afficher();

  minuterie = setInterval(() => {
    if (id !== execution) return;
    i += 1;
    if (i < etapes.length) afficher();
  }, dureeMs / etapes.length);

  return async () => {
    const reste = dureeMs - (performance.now() - debut);
    if (reste > 0) await new Promise((r) => setTimeout(r, reste));
    // Une exécution plus récente a pris la main : ce n'est pas à celle-ci
    // d'éteindre son animation.
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

async function etudier() {
  const fini = demarrerChargement(ETAPES_ETUDE);
  try {
    etude = await poster('/api/etude', saisie());

    $('panneau-verdict').hidden = false;
    $('panneau-vue').hidden = false;
    $('panneau-hypotheses').hidden = false;
    $('generer').disabled = false;
    $('generer').textContent = etude.study.decoupe
      ? `Générer les ${etude.study.decoupe.caisses.length} caisses (Zoo)`
      : 'Générer la caisse (Zoo)';

    rendreTableau();
    // La vue montre ce que l'outil recommande. Si un découpage est proposé,
    // c'est **lui** la recommandation : afficher une caisse unique pendant que
    // le bandeau parle de trois caisses laisse croire que rien ne se passe.
    if (etude.study.decoupe) {
      const r = await poster('/api/decoupe', saisie());
      await afficherDecoupe(r);
    } else {
      await afficherPose(etude.study.best?.pose ?? etude.study.otherMode?.pose ?? 'A', null);
    }

    // Une ligne. Le détail vit dans les hypothèses, pas sous le formulaire.
    $('etat-calcul').textContent =
      `${etude.vertices.toLocaleString('fr-FR')} sommets · ${etude.ms} ms · ${etude.unit.unit}` +
      (etude.unit.plausible ? '' : ' ⚠ unité douteuse');
    $('vue-etat').textContent = 'aperçu local';
  } catch (err) {
    $('etat-calcul').textContent = `échec : ${err.message}`;
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
  $('vue-etat').textContent = 'session Zoo en cours…';
  const fini = demarrerChargement(ETAPES_ZOO, 2500);

  // Un découpage proposé, ce sont N caisses à construire — pas une.
  if (etude?.study.decoupe) {
    try {
      const r = await poster('/api/scene-decoupe', saisie());
      const local = await poster('/api/decoupe', saisie());
      await afficherDecoupe(local, r.gltf);
      $('vue-etat').textContent =
        `${r.caisses} caisses, ${r.solides} solides b-rep, session ${(r.sessionMs / 1000).toFixed(1)} s`;
      $('telechargements').innerHTML = [
        r.step ? `<a class="bouton" href="/out/${r.step}" download>STEP — les ${r.caisses} caisses</a>` : '',
        r.gltf ? `<a class="bouton" href="/out/${r.gltf}" download>glTF — la scène</a>` : '',
      ].join(' ');
    } catch (err) {
      $('vue-etat').textContent = `échec : ${err.message}`;
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
      `${r.solides} solides b-rep, session ${(r.sessionMs / 1000).toFixed(1)} s — ` +
      (ok
        ? `encombrement conforme au verdict${r.machineIncluse ? ', machine comprise' : ''}`
        : `⚠ écart de ${Math.round(r.controle.ecartMm)} mm avec le verdict`) +
      (r.note ? ` — ${r.note}` : '');

    // Un caissier ne peut rien faire d'une scène qu'il ne peut pas ouvrir : le
    // STEP est l'artefact qui sort de l'outil et rentre dans son PLM.
    $('telechargements').innerHTML = [
      r.step
        ? `<a class="bouton" href="/out/${r.step}" download>STEP — ${r.machineIncluse ? 'machine + caisse' : 'caisse seule'}</a>`
        : '',
      r.gltf ? `<a class="bouton" href="/out/${r.gltf}" download>glTF — la scène</a>` : '',
    ].join(' ');
  } catch (err) {
    $('vue-etat').textContent = `échec : ${err.message}`;
  } finally {
    await fini();
  }
});

$('fichier').addEventListener('change', async (e) => {
  const fichier = e.target.files?.[0];
  if (!fichier) return;

  const estObj = /\.obj$/i.test(fichier.name);
  $('etat-calcul').textContent = estObj
    ? `lecture de ${fichier.name}…`
    : `${fichier.name} — conversion par Zoo, cela peut prendre plusieurs minutes…`;
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
    if (!r.direct) $('etat-calcul').textContent = `converti par Zoo en ${(r.ms / 1000).toFixed(1)} s`;
  } catch (err) {
    $('etat-calcul').textContent = `conversion refusée : ${err.message}`;
  }
});

async function remplirMaillages(selection) {
  const { meshes } = await fetch('/api/maillages').then((r) => r.json());
  $('mesh').innerHTML = meshes.map((f) => `<option value="${f}">${f}</option>`).join('');
  // Par défaut, la machine de démonstration : c'est la seule dont la licence
  // est nôtre, et la seule qui joue la démonstration du §16 en entier.
  if (selection && meshes.includes(selection)) $('mesh').value = selection;
  else if (meshes.some((f) => f.includes('machine-demo'))) $('mesh').value = meshes.find((f) => f.includes('machine-demo'));
  return meshes;
}

const disponibles = await remplirMaillages();
redimensionner();

// Une étude au chargement : sans elle, l'exemple déjà sélectionné ne déclenche
// aucun `change`, et l'écran reste vide tant qu'on n'a pas changé de fichier.
// « Ça ne marche qu'avec un import » venait de là.
//
// Et s'il n'y a aucun exemple, on le dit. Un menu vide au-dessus d'une page
// vide laisse croire que l'outil est cassé, alors qu'il attend un fichier.
if (disponibles.length) void etudier();
else $('etat-calcul').textContent = 'Aucun exemple disponible : déposez un STEP ou un OBJ pour commencer.';
