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
};

function matiere(nom) {
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
    gltf.scene.traverse((o) => {
      if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xd8b483, roughness: 0.85, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
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

  cadrer();
  redimensionner();

  const pose = etude.study.poses.find((p) => p.pose === poseId);
  $('legende').textContent = pose
    ? `${pose.label} — caisse ${m(pose.crate.outer.lengthMm)} × ${m(pose.crate.outer.widthMm)} × ${m(pose.crate.outer.heightMm)}, ` +
      `tare ${pose.crate.tareKg} kg, ${pose.crate.skidCount} patins de ${pose.crate.skid.heightMm} mm, ` +
      `${pose.stackable ? 'gerbable' : 'non gerbable'}.` +
      (gltfNom ? ' Géométrie b-rep générée par Zoo.' : ' Aperçu local — cliquez « Générer la caisse » pour la géométrie Zoo.')
    : '';
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
    verdict = `Toutes les poses tombent dans le même gabarit — <strong>${s.best.retained.gabarit.label}</strong>,
      ${s.best.costing.leadTimeDays} j. L'écart entre elles n'est que du contreplaqué :
      gardez le repère CAO, il n'y a rien à arbitrer.`;
  } else if (s.best) {
    const eco = ref.costing.totalEur - s.best.costing.totalEur;
    const jours = ref.costing.leadTimeDays - s.best.costing.leadTimeDays;
    const serre = s.best.retained.confidence === 'juste';
    verdict = `<strong>${eur(eco)}</strong> et <strong>${jours} jours</strong> économisés sur le repère CAO —
      ${s.best.label.toLowerCase()}, ${s.best.retained.gabarit.label},
      ${serre ? 'et ça passe <strong>de justesse</strong> :' : 'marge la plus faible'}
      ${s.best.retained.tightestMarginMm} mm en ${s.best.retained.tightestOn}${
        serre ? ', à confirmer avec la caisserie' : ''
      }.`;

    // Le groupage est presque toujours le moins cher et presque toujours le
    // plus lent. Trancher en silence sur le prix contredirait la thèse : pour
    // un constructeur, rater une fenêtre d'expédition coûte plus que le fret.
    if (s.faster) {
      const jours = s.best.costing.leadTimeDays - s.faster.costing.leadTimeDays;
      const surcout = s.faster.costing.totalEur - s.best.costing.totalEur;
      verdict += `<br /><span class="verdict-second">Plus rapide : ${s.faster.gabaritLabel},
        <strong>${eur(s.faster.costing.totalEur)}</strong> en ${s.faster.costing.leadTimeDays} j —
        ${jours} jours de moins pour ${eur(surcout)} de plus.
        À vous de voir ce que vaut la fenêtre d'expédition.</span>`;
    }
  } else if (s.otherMode) {
    verdict = `Aucun gabarit ${$('mode').value === 'maritime' ? 'maritime' : 'routier'}.
      En revanche « ${s.otherMode.label} » passe en ${s.otherMode.gabaritLabel} avec
      ${s.otherMode.marginMm} mm de marge : <strong>${eur(s.otherMode.costing.totalEur)}</strong>,
      ${s.otherMode.costing.leadTimeDays} j. Changer de mode est votre décision, pas celle de l'outil.`;
  } else {
    verdict = `Aucune pose ne passe. Les deux issues, chiffrées :
      ${s.fallbacks.oversize.label} <strong>${eur(s.fallbacks.oversize.totalEur)}</strong> en
      ${s.fallbacks.oversize.leadTimeDays} j, ou démontage en deux caisses
      <strong>${eur(s.fallbacks.split.totalEur)}</strong> en ${s.fallbacks.split.leadTimeDays} j.
      L'outil ne découpe pas : il chiffre les deux et laisse choisir.`;
  }
  $('verdict').innerHTML = verdict;

  $('detail').innerHTML = s.poses
    .map(
      (p) => `
      <div class="alerte">
        <span class="alerte-code">${p.pose === 'reference' ? 'réf.' : p.pose}</span>
        <span class="alerte-message">
          ${p.checksText.map((c) => `<em>${c.label}</em> : ${c.text}`).join('<br />')}
          ${p.forbidden ? `<br /><strong>${p.forbidden}</strong>` : ''}
        </span>
      </div>`
    )
    .join('');

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
  };
}

$('formulaire').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('etat-calcul').textContent = 'calcul…';
  try {
    etude = await poster('/api/etude', saisie());

    $('panneau-verdict').hidden = false;
    $('panneau-vue').hidden = false;
    $('panneau-hypotheses').hidden = false;
    $('generer').disabled = false;

    rendreTableau();
    // La pose montrée est celle qu'on recommande. Afficher la machine debout
    // pendant qu'on explique qu'il faut la coucher vide le propos.
    await afficherPose(etude.study.best?.pose ?? etude.study.otherMode?.pose ?? 'A', null);

    $('etat-calcul').textContent =
      `${etude.vertices.toLocaleString('fr-FR')} sommets, emprises et verdicts en ${etude.ms} ms. ` +
      `${etude.unit.note} Emprise orientée : ${etude.areaGainPct.toFixed(1)} % d'emprise au sol gagnés (lacet ${etude.yawDeg.toFixed(1)}°).`;
    $('vue-etat').textContent = 'aperçu local';
  } catch (err) {
    $('etat-calcul').textContent = `échec : ${err.message}`;
  }
});

$('generer').addEventListener('click', async () => {
  $('vue-etat').textContent = 'session Zoo en cours…';
  try {
    const r = await poster('/api/scene', { ...saisie(), pose: poseCourante });
    await afficherPose(r.pose, r.gltf);
    const ok = r.controle.ecartMm !== undefined && r.controle.ecartMm < 1;
    $('vue-etat').textContent =
      `${r.solides} solides b-rep, session ${(r.sessionMs / 1000).toFixed(1)} s — ` +
      (ok
        ? `encombrement conforme au verdict${r.machineIncluse ? ', machine comprise' : ''}`
        : `⚠ écart de ${Math.round(r.controle.ecartMm)} mm avec le verdict`);

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
  }
});

$('fichier').addEventListener('change', async (e) => {
  const fichier = e.target.files?.[0];
  if (!fichier) return;

  $('note-conversion').textContent = `conversion de ${fichier.name} par Zoo…`;
  try {
    const base64 = await new Promise((resolve, reject) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(String(lecteur.result).split(',')[1]);
      lecteur.onerror = reject;
      lecteur.readAsDataURL(fichier);
    });

    const r = await poster('/api/conversion', { name: fichier.name, base64 });
    await remplirMaillages(r.mesh);
    $('note-conversion').textContent =
      `${fichier.name} converti par Zoo en ${(r.ms / 1000).toFixed(1)} s — ${r.vertices.toLocaleString('fr-FR')} sommets.`;
  } catch (err) {
    $('note-conversion').textContent = `conversion refusée : ${err.message}`;
  }
});

async function remplirMaillages(selection) {
  const { meshes } = await fetch('/api/maillages').then((r) => r.json());
  $('mesh').innerHTML = meshes.map((f) => `<option value="${f}">${f}</option>`).join('');
  // Par défaut, la machine de démonstration : c'est la seule dont la licence
  // est nôtre, et la seule qui joue la démonstration du §16 en entier.
  if (selection && meshes.includes(selection)) $('mesh').value = selection;
  else if (meshes.some((f) => f.includes('machine-demo'))) $('mesh').value = meshes.find((f) => f.includes('machine-demo'));
}

await remplirMaillages();
redimensionner();
