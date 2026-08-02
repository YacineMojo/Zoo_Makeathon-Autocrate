import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/**
 * L'atelier.
 *
 * Trois écrans comptent, et trois seulement : la coupe au gabarit, le tableau
 * des poses, et la machine à l'intérieur de sa caisse. Tout le reste est du
 * texte.
 *
 * La coupe est l'écran de tête. Elle répond à la seule question posée — est-ce
 * que ça rentre — sans qu'on ait à lire un nombre : la section du conteneur et
 * celle de la caisse sont dessinées à la même échelle, et ou la seconde tient
 * dans la première, ou elle en sort.
 *
 * La caisse est d'abord dessinée localement à partir des pavés rendus par
 * l'étude — instantané, aucune session Zoo. Le bouton « Générer » la remplace
 * par la vraie géométrie b-rep du moteur. La distinction est visible à l'écran :
 * ce qui est gratuit et ce qui coûte une session ne se confondent pas.
 */

const MM = 0.001;

const $ = (id) => document.getElementById(id);
const eur = (v) => `${Math.round(v).toLocaleString('fr-FR')} €`;
const m = (v) => `${(v / 1000).toFixed(2)} m`;
const mm = (v) => `${Math.round(v).toLocaleString('fr-FR')} mm`;

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
  renderer.setSize(r.width, Math.round(r.width * 0.5625), false);
  camera.aspect = 16 / 9;
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
  marquerLigne(poseId);

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
    ? `${pose.label} · caisse ${m(pose.crate.outer.lengthMm)} × ${m(pose.crate.outer.widthMm)} × ` +
      `${m(pose.crate.outer.heightMm)} · tare ${pose.crate.tareKg} kg`
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
    new THREE.MeshBasicMaterial({ color: 0xaf3a21, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
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
      new THREE.LineBasicMaterial({ color: 0xaf3a21 })
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
  marquerLigne(null);

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
  const teintes = [0xb2b400, 0xaf3a21, 0x2a6f9e, 0x7c4f96];

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

  $('legende').textContent = r.decoupe.caisses
    .map((c, i) => `Caisse ${i + 1} ${m(c.crate.outer.lengthMm)} × ${m(c.crate.outer.widthMm)} × ${m(c.crate.outer.heightMm)}`)
    .join('  ·  ');
}

/* ─────────────────────────────── la coupe au gabarit ──────────────────────
 *
 * L'élément de tête. Deux rectangles à la même échelle : la section utile du
 * gabarit, et celle de la caisse posée sur son plancher. Ou la seconde tient
 * dans la première, ou elle en sort — et ce qui sort est hachuré, parce que ce
 * n'est pas une pièce de plus, c'est une part de caisse qui n'a nulle part où
 * aller.
 *
 * La cote portée sur le dessin n'est jamais choisie pour faire joli : c'est
 * **la contrainte qui décide**, celle que le moteur a désignée comme la plus
 * serrée. Sur une caisse trop haute elle est verticale ; sur une caisse trop
 * large elle est horizontale. Coter la hauteur d'une caisse refusée en largeur
 * serait un dessin exact et un mensonge.
 */

/** Hauteur de dessin visée, en unités du viewBox. */
const COUPE_HAUTEUR = 250;
const MARGE = { gauche: 22, droite: 82, haut: 18, bas: 46 };

const echapper = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** La contrainte se joue-t-elle sur une hauteur, une largeur, autre chose ? */
function axeDeLaCote(on) {
  if (on === 'hauteur' || on === 'porte-hauteur') return 'vertical';
  if (on === 'largeur' || on === 'porte-largeur') return 'horizontal';
  return 'ailleurs';
}

const NOM_CONTRAINTE = {
  hauteur: 'hauteur',
  largeur: 'largeur',
  longueur: 'longueur',
  'porte-hauteur': 'hauteur de porte',
  'porte-largeur': 'largeur de porte',
  charge: 'charge utile',
};

/**
 * Une coupe. `echelle` et le cadre sont imposés du dehors : deux coupes côte à
 * côte qui ne partagent pas leur échelle ne se comparent pas, elles se
 * ressemblent — c'est exactement l'erreur que ce dessin existe pour éviter.
 */
function coupeSvg(panneau, cadre, indice) {
  const { crate, check } = panneau;
  const { k, largeurDessin, hauteurDessin } = cadre;
  const g = check.gabarit;

  const W = MARGE.gauche + largeurDessin + MARGE.droite;
  const H = MARGE.haut + hauteurDessin + MARGE.bas;
  const sol = MARGE.haut + hauteurDessin;
  const cx = MARGE.gauche + largeurDessin / 2;

  const gW = g.maxWidthMm * k;
  const gH = g.maxHeightMm * k;
  const cW = crate.outer.widthMm * k;
  const cH = crate.outer.heightMm * k;

  const gX = cx - gW / 2;
  const gY = sol - gH;
  const cX = cx - cW / 2;
  const cY = sol - cH;

  const id = `coupe${indice}`;
  const morceaux = [];

  morceaux.push(`
    <defs>
      <pattern id="hachure-${id}" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="7" stroke="#e06a4d" stroke-width="2.6" />
      </pattern>
      <mask id="hors-${id}">
        <rect x="${cX}" y="${cY}" width="${cW}" height="${cH}" fill="#fff" />
        <rect x="${gX}" y="${gY}" width="${gW}" height="${gH}" fill="#000" />
      </mask>
    </defs>`);

  // La section utile du gabarit, et l'ouverture de porte quand elle en diffère.
  morceaux.push(`<rect class="trait-gabarit" x="${gX}" y="${gY}" width="${gW}" height="${gH}" />`);
  if (g.doorWidthMm && g.doorHeightMm && (g.doorWidthMm !== g.maxWidthMm || g.doorHeightMm !== g.maxHeightMm)) {
    const dW = g.doorWidthMm * k;
    const dH = g.doorHeightMm * k;
    morceaux.push(
      `<rect class="trait-porte" x="${cx - dW / 2}" y="${sol - dH}" width="${dW}" height="${dH}" />`
    );
  }

  // Le plancher, qui déborde de la section : c'est le quai, pas une arête.
  morceaux.push(
    `<line class="trait-sol" x1="${cx - largeurDessin / 2 - 8}" y1="${sol}" x2="${cx + largeurDessin / 2 + 8}" y2="${sol}" />`
  );

  // La caisse, puis ce qu'elle laisse dehors.
  morceaux.push(`<rect class="trait-caisse" x="${cX}" y="${cY}" width="${cW}" height="${cH}" />`);
  if (cH > gH + 0.5 || cW > gW + 0.5) {
    morceaux.push(
      `<rect class="trait-depassement" x="${cX}" y="${cY}" width="${cW}" height="${cH}" mask="url(#hors-${id})" fill="url(#hachure-${id})" />`
    );
  }

  // La cote : celle de la contrainte qui décide, et elle seule. Une marge de
  // charge utile se compte en kilos — la coter en millimètres serait un dessin
  // exact et une légende fausse.
  const axe = axeDeLaCote(check.tightestOn);
  const signe = check.tightestMarginMm >= 0 ? '+' : '−';
  const ampleur = Math.abs(check.tightestMarginMm);
  const texte =
    check.tightestOn === 'charge'
      ? `${signe}${Math.round(ampleur).toLocaleString('fr-FR')} kg`
      : `${signe}${mm(ampleur)}`;

  // La valeur se lit toujours dans la même colonne, à droite du dessin. Une
  // marge de cinquante millimètres à cette échelle mesure trois pixels : posée
  // contre son propre crochet, elle passe pour un défaut d'impression.
  const xTexte = cx + largeurDessin / 2 + 18;

  if (axe === 'vertical') {
    const limite = check.tightestOn === 'porte-hauteur' && g.doorHeightMm ? sol - g.doorHeightMm * k : gY;
    const [y1, y2] = [Math.min(limite, cY), Math.max(limite, cY)];
    morceaux.push(`
      <line class="cote-trait" x1="${xTexte}" y1="${y1}" x2="${xTexte}" y2="${y2}" />
      <line class="cote-trait" x1="${xTexte - 5}" y1="${y1}" x2="${xTexte + 5}" y2="${y1}" />
      <line class="cote-trait" x1="${xTexte - 5}" y1="${y2}" x2="${xTexte + 5}" y2="${y2}" />
      <line class="cote-trait" x1="${cX + cW}" y1="${cY}" x2="${xTexte}" y2="${cY}" stroke-dasharray="3 3" />
      <text class="cote-texte" x="${xTexte + 9}" y="${(y1 + y2) / 2 + 4}">${texte}</text>`);
  } else if (axe === 'horizontal') {
    const limite = check.tightestOn === 'porte-largeur' && g.doorWidthMm ? (g.doorWidthMm * k) / 2 : gW / 2;
    const y = sol + 15;
    const [x1, x2] = [cx + Math.min(limite, cW / 2), cx + Math.max(limite, cW / 2)];
    morceaux.push(`
      <line class="cote-trait" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" />
      <line class="cote-trait" x1="${x1}" y1="${y - 5}" x2="${x1}" y2="${y + 5}" />
      <line class="cote-trait" x1="${x2}" y1="${y - 5}" x2="${x2}" y2="${y + 5}" />
      <line class="cote-trait" x1="${x2}" y1="${y}" x2="${xTexte}" y2="${y}" stroke-dasharray="3 3" />
      <text class="cote-texte" x="${xTexte + 9}" y="${y + 4}">${texte}</text>`);
  } else {
    morceaux.push(`<text class="cote-texte" x="${xTexte + 9}" y="${sol - 6}">${texte}</text>`);
  }

  // La section de la caisse, sous le plancher. Le nom du gabarit n'est pas
  // répété ici : l'étiquette du panneau le porte déjà, et un dessin qui redit
  // son propre titre a moins de place pour ce qu'il est seul à montrer.
  morceaux.push(
    `<text class="repere-texte" x="${cx}" y="${sol + 34}" text-anchor="middle">${Math.round(
      crate.outer.widthMm
    ).toLocaleString('fr-FR')} × ${mm(crate.outer.heightMm)}</text>`
  );

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${echapper(panneau.titre)} : caisse ${mm(
    crate.outer.widthMm
  )} de large sur ${mm(crate.outer.heightMm)} de haut, dans ${echapper(g.label)} — ${
    check.fits ? 'elle passe' : 'elle ne passe pas'
  }, ${NOM_CONTRAINTE[check.tightestOn] ?? check.tightestOn} ${texte}">${morceaux.join('')}</svg>`;
}

/** La longueur ne tient pas dans une coupe : elle se lit sur une règle. */
function longueurHtml(crate, gabarit) {
  const part = Math.min(100, (crate.outer.lengthMm / gabarit.maxLengthMm) * 100);
  return `
    <div class="coupe-longueur">
      <div class="longueur-rule"><div class="longueur-part" style="width:${part.toFixed(1)}%"></div></div>
      <div class="longueur-legende">
        <span>Longueur ${m(crate.outer.lengthMm)}</span>
        <span>Utile ${m(gabarit.maxLengthMm)}</span>
      </div>
    </div>`;
}

function coupeHtml(panneau, cadre, indice) {
  const { titre, etiquette, check, costing } = panneau;
  const verdict = check.fits ? 'passe' : 'bloque';
  return `
    <article class="coupe" data-verdict="${verdict}">
      <div class="coupe-tete">
        <p class="coupe-pose">${echapper(titre)}</p>
        <span class="coupe-etiquette">${echapper(etiquette)}</span>
      </div>
      ${coupeSvg(panneau, cadre, indice)}
      ${longueurHtml(panneau.crate, check.gabarit)}
      ${
        costing
          ? `<div class="coupe-prix">
               <span class="coupe-prix-montant">${eur(costing.totalEur)}</span>
               <span class="coupe-prix-delai">${costing.leadTimeDays} jours</span>
             </div>`
          : ''
      }
    </article>`;
}

function rendreCoupes({ panneaux, appoint }) {
  const rang = $('coupes-rang');
  const somme = $('coupes-somme');
  if (!panneaux.length) {
    rang.innerHTML = '';
    somme.innerHTML = '';
    $('coupes').hidden = true;
    return;
  }
  $('coupes').hidden = false;

  // La somme des cartes n'est pas le total, et l'écart doit se voir. Un lecteur
  // qui additionne deux prix affichés et tombe à côté du chiffre du bandeau
  // cesse de croire les deux.
  somme.innerHTML = appoint
    ? `<span>${echapper(appoint.label)}</span><span>${eur(appoint.montantEur)}</span>
       <span class="coupes-somme-total">Total ${eur(appoint.totalEur)}</span>`
    : '';

  // Une seule échelle et un seul cadre pour toute la rangée. C'est la condition
  // pour que deux coupes se comparent au lieu de se ressembler.
  const hauteurMax = Math.max(
    ...panneaux.map((p) => Math.max(p.check.gabarit.maxHeightMm, p.crate.outer.heightMm))
  );
  const largeurMax = Math.max(
    ...panneaux.map((p) => Math.max(p.check.gabarit.maxWidthMm, p.crate.outer.widthMm))
  );
  const k = COUPE_HAUTEUR / hauteurMax;
  const cadre = { k, hauteurDessin: COUPE_HAUTEUR, largeurDessin: largeurMax * k };

  rang.classList.toggle('coupes-rang--seule', panneaux.length === 1);
  rang.innerHTML = panneaux.map((p, i) => coupeHtml(p, cadre, i)).join('');
}

/**
 * Quelles coupes montrer, et contre quel gabarit.
 *
 * Quand il y a un arbitrage, les deux coupes sont confrontées au **même**
 * gabarit : c'est ce qui rend le dessin démonstratif. Deux conteneurs
 * différents côte à côte, et le lecteur ne sait plus si c'est la machine qui a
 * tourné ou la boîte qui a grandi.
 */
function panneauxCoupe(s) {
  const gabaritParLabel = (label) =>
    s.poses.flatMap((p) => p.checks).find((c) => c.gabarit.label === label)?.gabarit;
  const checkPour = (pose, id) => pose.checks.find((c) => c.gabarit.id === id);
  const ref = s.poses.find((p) => p.pose === 'reference');

  // Découpage : une coupe par caisse, chacune dans le gabarit qui la porte.
  if (s.decoupe) {
    const panneaux = s.decoupe.caisses
      .map((c, i) => {
        const check = c.retained ?? c.checks[0];
        if (!check) return null;
        return {
          titre: `Caisse ${i + 1}`,
          etiquette: check.fits ? check.gabarit.label : 'hors gabarit',
          crate: c.crate,
          check,
          costing: c.costing,
        };
      })
      .filter(Boolean);
    const caisses = panneaux.reduce((a, p) => a + p.costing.totalEur, 0);
    return {
      panneaux,
      appoint: {
        label: 'Ingénierie de démontage et reconditionnement',
        montantEur: s.decoupe.totalEur - caisses,
        totalEur: s.decoupe.totalEur,
      },
    };
  }

  // Refus par charge utile : l'encombrement n'est pas en cause, et le dessin ne
  // doit pas laisser croire le contraire. Une seule coupe, celle du gabarit le
  // plus capable, et la cote porte sur la masse.
  if (s.overloaded) {
    const gabarit = gabaritParLabel(s.overloaded.gabaritLabel);
    const pose = s.best ?? ref;
    const check = gabarit ? checkPour(pose, gabarit.id) : undefined;
    if (!check) return { panneaux: [] };
    return {
      panneaux: [
      {
        titre: pose.label,
        etiquette: 'charge utile dépassée',
        crate: pose.crate,
        check: { ...check, fits: false, tightestOn: 'charge', tightestMarginMm: s.overloaded.maxPayloadKg - s.overloaded.grossKg },
        costing: pose.costing,
      },
      ],
    };
  }

  // L'arbitrage : la même boîte, deux orientations. C'est la démonstration.
  if (s.best && s.arbitrage === 'gabarit' && ref) {
    const gabarit = s.best.retained.gabarit;
    const checkRef = checkPour(ref, gabarit.id);
    const panneaux = [];
    if (checkRef) {
      panneaux.push({
        titre: ref.label,
        etiquette: checkRef.fits ? gabarit.label : 'hors gabarit',
        crate: ref.crate,
        check: checkRef,
        costing: ref.costing,
      });
    }
    panneaux.push({
      titre: s.best.label,
      etiquette: gabarit.label,
      crate: s.best.crate,
      check: s.best.retained,
      costing: s.best.costing,
    });
    return { panneaux };
  }

  // Rien à arbitrer : une coupe, celle qu'on retient.
  if (s.best) {
    return {
      panneaux: [
        {
          titre: s.best.label,
          etiquette: s.best.retained.gabarit.label,
          crate: s.best.crate,
          check: s.best.retained,
          costing: s.best.costing,
        },
      ],
    };
  }

  // Aucun gabarit dans ce mode, mais un dans l'autre : les deux, côte à côte.
  if (s.otherMode) {
    const pose = s.poses.find((p) => p.pose === s.otherMode.pose) ?? ref;
    const gabarit = gabaritParLabel(s.otherMode.gabaritLabel);
    const check = gabarit ? checkPour(pose, gabarit.id) : undefined;
    const panneaux = [];
    if (ref && ref.checks[0]) {
      panneaux.push({
        titre: `${ref.label} — mode demandé`,
        etiquette: 'hors gabarit',
        crate: ref.crate,
        check: ref.checks[0],
        costing: ref.costing,
      });
    }
    if (check) {
      panneaux.push({
        titre: `${pose.label} — autre mode`,
        etiquette: gabarit.label,
        crate: pose.crate,
        check,
        costing: s.otherMode.costing,
      });
    }
    return { panneaux };
  }

  // Rien ne passe : on montre la pose la moins mauvaise contre le gabarit
  // qu'elle rate de moins. Le dessin dit de combien, et c'est l'information.
  const candidats = s.poses
    .filter((p) => !p.forbidden)
    .flatMap((p) => p.checks.map((c) => ({ pose: p, check: c })));
  if (!candidats.length) return { panneaux: [] };
  const moinsPire = candidats.reduce((a, b) => (b.check.tightestMarginMm > a.check.tightestMarginMm ? b : a));
  return {
    panneaux: [
      {
        titre: moinsPire.pose.label,
        etiquette: 'hors gabarit',
        crate: moinsPire.pose.crate,
        check: moinsPire.check,
        costing: moinsPire.pose.costing,
      },
    ],
  };
}

/* ---------------------------------------------------------------- verdict */

/**
 * Le chiffre, puis la phrase.
 *
 * Le delta est le produit : « ça ne passe pas » vaut zéro, « couchée ça passe,
 * et voilà ce que ça économise » vaut le déplacement (§15). Le chiffre porte la
 * conclusion, la phrase porte la raison, le tableau porte le détail.
 */
function rendreVerdict(s) {
  let chiffre = '';
  let ton = '';
  let phrase = '';
  let second = '';

  if (s.overloaded) {
    // Un refus par charge utile est invariant par orientation. Afficher un
    // tableau de poses laisserait croire qu'une orientation sauverait la mise.
    chiffre = `${s.overloaded.grossKg.toLocaleString('fr-FR')} kg`;
    ton = 'bloque';
    phrase =
      `<strong>Refus par charge utile</strong>, pour ${s.overloaded.maxPayloadKg.toLocaleString('fr-FR')} kg ` +
      `admissibles sur le gabarit le plus capable (${s.overloaded.gabaritLabel}). Aucune orientation n'y change rien : ` +
      `c'est un problème de masse, pas d'encombrement.`;
    // Répartir la masse, elle, y change quelque chose — et c'est ce que montrent
    // les coupes. Le dire ici évite qu'un bandeau qui refuse surplombe un dessin
    // où tout passe.
    second = s.decoupe
      ? `Répartie en <strong>${s.decoupe.caisses.length} caisses</strong>, la masse repasse sous la limite : ${eur(
          s.decoupe.totalEur
        )} en ${s.decoupe.leadTimeDays} jours. L'outil ne découpe pas — il désigne les corps qui portent la charge, l'ingénierie tranche.`
      : `Le hors gabarit n'y change rien non plus : un flat rack porte l'encombrement, pas la tonne.`;
  } else if (s.best && s.arbitrage === 'aucun') {
    // Rien à arbitrer : autant le dire en une ligne et laisser le tableau parler.
    chiffre = eur(s.best.costing.totalEur);
    ton = 'passe';
    phrase = `Toutes les poses passent en <strong>${s.best.retained.gabarit.label}</strong>, en ${s.best.costing.leadTimeDays} jours. Il n'y a rien à arbitrer.`;
  } else if (s.best) {
    const ref = s.poses.find((p) => p.pose === 'reference');
    const eco = ref.costing.totalEur - s.best.costing.totalEur;
    const jours = ref.costing.leadTimeDays - s.best.costing.leadTimeDays;
    chiffre = eur(eco);
    ton = 'passe';
    const serre = s.best.retained.confidence === 'juste';
    // « Pose C — couchée sur Y » est le nom de la ligne du tableau. Dans une
    // phrase, c'est le geste qui compte : couchée sur Y.
    const geste = s.best.label.replace(/^Pose\s+[A-Z]\s*—\s*/i, '');
    phrase =
      `et <strong>${jours} jours</strong> économisés en la posant <strong>${geste}</strong> plutôt qu'au repère CAO : ` +
      `<strong>${s.best.retained.gabarit.label}</strong> au lieu du hors gabarit` +
      (serre
        ? `, mais <strong>de justesse</strong> — ${mm(s.best.retained.tightestMarginMm)} en ${
            NOM_CONTRAINTE[s.best.retained.tightestOn] ?? s.best.retained.tightestOn
          }, à confirmer avec la caisserie.`
        : '.');

    const notes = [];
    // Découpage demandé alors qu'une caisse unique suffit : la comparaison est
    // justement ce qui a été demandé, on la donne.
    if (s.decoupe) {
      const ecart = s.decoupe.totalEur - s.best.costing.totalEur;
      notes.push(
        `En ${s.decoupe.caisses.length} caisses : ${eur(s.decoupe.totalEur)} en ${s.decoupe.leadTimeDays} jours, ` +
          `${ecart >= 0 ? eur(ecart) + ' de plus' : eur(-ecart) + ' de moins'} qu'en une seule.`
      );
    }
    // Le groupage est presque toujours le moins cher et presque toujours le
    // plus lent. Trancher en silence sur le prix contredirait la thèse : pour
    // un constructeur, rater une fenêtre d'expédition coûte plus que le fret.
    if (s.faster) {
      const gagnes = s.best.costing.leadTimeDays - s.faster.costing.leadTimeDays;
      const surcout = s.faster.costing.totalEur - s.best.costing.totalEur;
      notes.push(
        `Plus rapide : <strong>${s.faster.gabaritLabel}</strong>, ${eur(s.faster.costing.totalEur)} en ${
          s.faster.costing.leadTimeDays
        } jours — ${gagnes} jours de moins pour ${eur(surcout)}.`
      );
    }
    second = notes.join(' ');
  } else if (s.otherMode) {
    chiffre = eur(s.otherMode.costing.totalEur);
    ton = '';
    phrase = `Aucun gabarit ${$('mode').value === 'maritime' ? 'maritime' : 'routier'} ne porte cette machine. En revanche « ${
      s.otherMode.label
    } » passe en <strong>${s.otherMode.gabaritLabel}</strong> avec ${mm(s.otherMode.marginMm)} de marge, en ${
      s.otherMode.costing.leadTimeDays
    } jours.`;
    second = `Changer de mode d'acheminement est votre décision, pas celle de l'outil : une machine qui part en Asie ne part pas par la route.`;
  } else if (s.decoupe) {
    // Le §6.5 dit « l'outil ne découpe pas ». Il ne découpe toujours pas : il
    // désigne les corps qui portent le dépassement et chiffre l'hypothèse.
    const d = s.decoupe;
    chiffre = eur(d.totalEur);
    ton = '';
    phrase = `en <strong>${d.caisses.length} caisses</strong>, coupées ${
      d.axe === 2 ? 'en hauteur' : 'en largeur'
    } à ${d.plansMm.map((v) => (v / 1000).toFixed(2) + ' m').join(' et ')}, en ${d.leadTimeDays} jours — contre ${eur(
      s.fallbacks.oversize.totalEur
    )} en ${s.fallbacks.oversize.leadTimeDays} jours hors gabarit.`;
    second = `L'outil ne découpe pas : un corps distinct dans un maillage n'est pas une pièce démontable. Il dit lesquels coûtent, l'ingénierie tranche.`;
  } else {
    chiffre = eur(s.fallbacks.oversize.totalEur);
    ton = 'bloque';
    phrase = `Aucune pose ne passe. <strong>${s.fallbacks.oversize.label}</strong>, en ${s.fallbacks.oversize.leadTimeDays} jours.`;
    second = `Ou démontage en deux caisses : <strong>${eur(s.fallbacks.split.totalEur)}</strong> en ${
      s.fallbacks.split.leadTimeDays
    } jours. L'outil ne découpe pas : il chiffre les deux et laisse choisir.`;
  }

  $('verdict-chiffre').textContent = chiffre;
  $('verdict-chiffre').dataset.ton = ton;
  $('verdict').innerHTML = phrase;
  $('verdict-second').innerHTML = second;

  // La mesure dont tout le reste découle. Elle n'est pas décorative : c'est
  // elle qu'un caissier recopiera, et c'est par elle qu'on vérifie le verdict.
  const assise = s.best ?? s.poses.find((p) => p.pose === 'reference');
  $('releve').innerHTML = assise
    ? [
        ['Enveloppe mesurée', `${m(assise.footprint.lengthMm)} × ${m(assise.footprint.widthMm)} × ${m(assise.footprint.heightMm)}`],
        ['Masse machine', `${s.massKg.toLocaleString('fr-FR')} kg`],
        ['Caisse — tare, brut', `${assise.crate.tareKg.toLocaleString('fr-FR')} kg, ${assise.crate.grossKg.toLocaleString('fr-FR')} kg`],
      ]
        .map(([clef, valeur]) => `<div><dt>${clef}</dt><dd>${valeur}</dd></div>`)
        .join('')
    : '';
}

/* ---------------------------------------------------------------- tableau */

function marquerLigne(poseId) {
  for (const tr of document.querySelectorAll('.tableau-poses tr[data-pose]')) {
    tr.setAttribute('aria-selected', String(tr.dataset.pose === poseId));
  }
}

function rendreTableau(s) {
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
        <tr class="${classe} ${meilleure ? 'ligne-retenue' : ''}" data-pose="${p.pose}" tabindex="0"
            title="Voir cette pose en 3D">
          <td>${echapper(p.label)}${meilleure ? ' <span class="cran">retenue</span>' : ''}</td>
          <td class="cote">${m(p.crate.outer.lengthMm)} × ${m(p.crate.outer.widthMm)} × ${m(p.crate.outer.heightMm)}</td>
          <td>${
            p.forbidden
              ? 'écartée'
              : passe
                ? echapper(p.retained.gabarit.label)
                : autre
                  ? `${echapper(p.otherMode.gabarit.gabarit.label)} <span class="cran cran-autre">autre mode</span>`
                  : 'hors gabarit'
          }${serre ? ` <span class="cran cran-juste">${mm(p.retained.tightestMarginMm)}</span>` : ''}</td>
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
    const voir = () => void afficherPose(tr.dataset.pose === 'reference' ? 'A' : tr.dataset.pose, null);
    tr.addEventListener('click', voir);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        voir();
      }
    });
  }
  marquerLigne(poseCourante);
}

function rendreHypotheses(s) {
  // Valeurs en texte, pas dans un cadre qui ressemble à un champ de saisie :
  // la table est en lecture seule (§10), autant que ça se voie. Une fausse
  // affordance est pire qu'une absence d'affordance.
  $('hypotheses').innerHTML = s.assumptions
    .map(
      (a) =>
        `<div class="fiche"><strong>${echapper(a.label)}</strong><span class="valeur-hypothese">${echapper(
          a.value
        )}</span><p>${echapper(a.rationale)}</p></div>`
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
 * Une seule exécution à la fois, et elle seule commande l'affichage.
 *
 * Sans ce jeton, deux calculs qui se croisent se marchent dessus : le premier
 * termine sa temporisation et éteint le voile du second, dont la minuterie
 * continue de tourner sur un élément caché.
 */
let execution = 0;
let minuterie;

function demarrerChargement(etapes, dureeMs = 2400) {
  const id = ++execution;
  const zone = $('chargement');
  const etiquette = zone.querySelector('.chargement-etape');
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

function montrerPanneaux() {
  for (const id of ['panneau-verdict', 'panneau-vue', 'panneau-poses', 'panneau-hypotheses']) {
    $(id).hidden = false;
  }
}

async function etudier() {
  const fini = demarrerChargement(ETAPES_ETUDE);
  const monTour = execution;
  try {
    const recu = await poster('/api/etude', saisie());
    // Une étude plus récente a été lancée pendant celle-ci : la sienne fait
    // foi. Écraser l'écran avec un résultat périmé afficherait le verdict d'un
    // fichier et le nom d'un autre.
    if (monTour !== execution) return;
    etude = recu;

    montrerPanneaux();
    $('generer').disabled = false;
    $('generer').textContent = etude.study.decoupe
      ? `Générer les ${etude.study.decoupe.caisses.length} caisses`
      : 'Générer la caisse';

    rendreVerdict(etude.study);
    rendreCoupes(panneauxCoupe(etude.study));
    rendreTableau(etude.study);
    rendreHypotheses(etude.study);

    // La vue montre ce que l'outil recommande. Si un découpage est proposé,
    // c'est **lui** la recommandation : afficher une caisse unique pendant que
    // le bandeau parle de trois caisses laisse croire que rien ne se passe.
    if (etude.study.decoupe) {
      const r = await poster('/api/decoupe', saisie());
      if (monTour !== execution) return;
      await afficherDecoupe(r);
    } else {
      await afficherPose(etude.study.best?.pose ?? etude.study.otherMode?.pose ?? 'A', null);
    }

    // Une ligne. Le détail vit dans les hypothèses, pas sous la console.
    $('etat-calcul').textContent =
      `${etude.vertices.toLocaleString('fr-FR')} sommets · ${etude.ms} ms · unité ${etude.unit.unit}` +
      (etude.unit.plausible ? '' : ' ⚠ unité douteuse');
    $('vue-etat').textContent = 'aperçu local';
  } catch (err) {
    if (monTour === execution) $('etat-calcul').textContent = `Échec : ${err.message}`;
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

// Le repli de lecture se referme quand on clique ailleurs : un panneau flottant
// laissé ouvert masque la page qu'il commande.
document.addEventListener('click', (e) => {
  const repli = $('repli-lecture');
  if (repli.open && !repli.contains(e.target)) repli.open = false;
});

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
        `${r.caisses} caisses · ${r.solides} solides b-rep · session ${(r.sessionMs / 1000).toFixed(1)} s`;
      $('telechargements').innerHTML = [
        r.step ? `<a class="bouton" href="/out/${r.step}" download>STEP — les ${r.caisses} caisses</a>` : '',
        r.gltf ? `<a class="bouton" href="/out/${r.gltf}" download>glTF — la scène</a>` : '',
      ].join('');
    } catch (err) {
      $('vue-etat').textContent = `Échec : ${err.message}`;
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
      `${r.solides} solides b-rep · session ${(r.sessionMs / 1000).toFixed(1)} s · ` +
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
    ].join('');
  } catch (err) {
    $('vue-etat').textContent = `Échec : ${err.message}`;
  } finally {
    await fini();
  }
});

$('fichier').addEventListener('change', async (e) => {
  const fichier = e.target.files?.[0];
  if (!fichier) return;

  const estObj = /\.obj$/i.test(fichier.name);
  $('etat-calcul').textContent = estObj
    ? `Lecture de ${fichier.name}…`
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
    if (!r.direct) $('etat-calcul').textContent = `Converti par Zoo en ${(r.ms / 1000).toFixed(1)} s`;
  } catch (err) {
    $('etat-calcul').textContent = `Conversion refusée : ${err.message}`;
  }
});

async function remplirMaillages(selection) {
  const { meshes } = await fetch('/api/maillages').then((r) => r.json());
  $('mesh').innerHTML = meshes.map((f) => `<option value="${echapper(f)}">${echapper(f)}</option>`).join('');
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
