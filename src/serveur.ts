import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, basename } from 'node:path';
import { parseObjVertices } from './mesh/obj.js';
import { parseObjBodies, extraireCorps, transformerObj } from './mesh/corps.js';
import { compactObj } from './mesh/compacter.js';
import { buildPoses } from './geometrie/poses.js';
import { placeForPose, placeBodies } from './geometrie/placement.js';
import type { Axis } from './geometrie/emprise.js';
import type { UnitChoice } from './geometrie/unites.js';
import { study } from './moteur/etude.js';
import { crateBoxes } from './engine/caisse.js';
import { buildCrate } from './moteur/structure.js';
import { blockingBoxes, isBlocking } from './engine/calage.js';
import { sceneDecoupe, coucher, centrer, decalerX } from './moteur/scene-decoupe.js';
import { rotate } from './geometrie/placement.js';
import { alignedCloud } from './geometrie/emprise.js';
import { machineProfile, profilDepuisPoints } from './geometrie/tranches.js';
import { explain } from './moteur/verdict.js';
import type { ShippingMode } from './domain/types.js';

/**
 * Serveur de l'atelier.
 *
 * Trois routes de calcul, volontairement séparées — même découpage que le
 * configurateur BESS, et pour la même raison : elles n'ont ni le même coût ni le
 * même délai, et les mélanger ferait payer une session Zoo à chaque frappe.
 *
 *   POST /api/etude     — emprises, poses, verdicts, coûts. Calcul pur, moins
 *                         d'une seconde, aucun appel à Zoo. C'est ce qui permet
 *                         de changer la masse ou l'axe vertical en direct.
 *   POST /api/scene     — matérialisation de la caisse par l'Engine API et rendu
 *                         glTF. Coûte une session, donc bouton explicite.
 *   POST /api/conversion— STEP client → maillage, par la File Format API. Le
 *                         poste le plus lent de la chaîne, et il est chez Zoo.
 *
 * La séparation est aussi honnête : elle montre à l'écran ce qui est instantané
 * et ce qui ne l'est pas.
 */

// 5174 et non 5173 : le premier projet du makeathon, le configurateur BESS,
// occupe déjà 5173. Les deux doivent pouvoir tourner en même temps.
const PORT = Number(process.env.PORT ?? 5174);
const ROOT = resolve(process.cwd());

const ZOO_COORDS = {
  forward: { axis: 'y' as const, direction: 'negative' as const },
  up: { axis: 'z' as const, direction: 'positive' as const },
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.step': 'application/step',
};

function json(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': MIME['.json']!, 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: IncomingMessage, limitBytes = 64 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limitBytes) throw new Error('Corps de requête trop volumineux.');
    chunks.push(chunk as Buffer);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/* ------------------------------------------------------------------ étude */

interface EtudeBody {
  mesh?: string;
  massKg?: number;
  up?: Axis;
  unit?: UnitChoice;
  mode?: ShippingMode;
  forbidLying?: boolean;
  /** Nombre de caisses imposé pour le découpage. Absent : le plus petit qui passe. */
  caisses?: number;
}

/** Maillages disponibles, servis depuis `out/`. Le dépôt d'un STEP passe par /api/conversion. */
async function meshes(): Promise<string[]> {
  try {
    return (await readdir('out')).filter((f) => f.endsWith('.obj')).sort();
  } catch {
    return [];
  }
}

/**
 * Bornes de saisie, alignées sur celles du formulaire.
 *
 * Une API plus permissive que son formulaire n'est pas une API souple, c'est
 * une API dont on ne sait plus ce qu'elle accepte.
 */
const MASSE_MIN_KG = 1;
const MASSE_MAX_KG = 100_000;

function unDe<T extends string>(valeur: unknown, permis: readonly T[], champ: string): T {
  if (typeof valeur === 'string' && (permis as readonly string[]).includes(valeur)) return valeur as T;
  throw new Error(`Champ « ${champ} » invalide : attendu ${permis.join(', ')}.`);
}

async function etude(body: EtudeBody) {
  // Pas de maillage par défaut : une requête sans `mesh` renvoyait une étude
  // complète et parfaitement plausible sur un tout autre fichier. Un résultat
  // faux et crédible est pire qu'une erreur.
  const name = body.mesh;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Champ « mesh » manquant : indiquez le maillage à étudier.');
  }
  if (basename(name) !== name || !name.endsWith('.obj')) {
    throw new Error('Nom de maillage invalide.');
  }

  const massKg = Number(body.massKg);
  if (!Number.isFinite(massKg) || massKg < MASSE_MIN_KG || massKg > MASSE_MAX_KG) {
    // Un STEP ne porte pas de matériau. Le demander montre qu'on le sait (§5).
    throw new Error(
      `Masse invalide : un STEP ne porte pas de matériau, elle doit être saisie, entre ${MASSE_MIN_KG} et ${MASSE_MAX_KG.toLocaleString('fr-FR')} kg.`
    );
  }

  const up = unDe(body.up ?? 'z', ['x', 'y', 'z'] as const, 'up');
  const unit = unDe(body.unit ?? 'auto', ['auto', 'mm', 'm', 'in'] as const, 'unit');
  const mode = unDe(body.mode ?? 'maritime', ['maritime', 'route'] as const, 'mode');

  const t0 = performance.now();
  const objet = await readFile(join('out', name), 'utf8').catch(() => {
    // Jamais l'erreur système : elle expose l'arborescence du serveur et ne dit
    // rien d'utile à qui lit l'écran.
    throw new Error(`Maillage introuvable : « ${name} ». Convertissez d'abord un STEP.`);
  });

  const cloud = parseObjVertices(objet);
  const corps = parseObjBodies(objet);
  const geometry = buildPoses(cloud, up, unit);

  // Les corps sont placés pose par pose, comme la machine : c'est ce qui permet
  // de dire lesquels portent un dépassement dans cette orientation-là.
  const posesAvecCorps = geometry.poses.map((p, i) => {
    if (p.pose === 'reference' || corps.length < 2) return p;
    const axis = geometry.oriented[i - 1]!;
    const crateFloor = buildCrate(p.footprint, massKg);
    const floorTop = crateFloor.skid.heightMm + crateFloor.floorThicknessMm;
    const placement = placeForPose(cloud, axis.axis, axis.footprint.yawDeg, geometry.unit.scale, floorTop);
    return { ...p, bodies: placeBodies(corps, axis.axis, placement, geometry.unit.scale) };
  });

  const result = study({
    poses: posesAvecCorps,
    massKg,
    mode,
    forbidLying: body.forbidLying === true,
    caisses: Number.isInteger(body.caisses) ? body.caisses : undefined,
  });

  // Le placement de chaque pose part avec l'étude : le viewer en a besoin pour
  // poser le maillage de la machine dans la caisse sans refaire le calcul.
  const placements = result.poses
    .filter((p) => p.pose !== 'reference')
    .map((p, i) => {
      const axis = geometry.oriented[i]!;
      const floorTop = p.crate.skid.heightMm + p.crate.floorThicknessMm;
      const placement = placeForPose(cloud, axis.axis, axis.footprint.yawDeg, geometry.unit.scale, floorTop);
      return {
        pose: p.pose,
        axis: axis.axis,
        placement,
        // Les tranches servent au calage : elles disent où la machine occupe
        // réellement l'espace, pas seulement quelle boîte elle remplit.
        profile: machineProfile(cloud, axis.axis, placement, geometry.unit.scale, floorTop),
      };
    });

  return {
    ms: Math.round(performance.now() - t0),
    vertices: cloud.count,
    unit: geometry.unit,
    corps: corps.length,
    areaGainPct: geometry.areaGainPct,
    yawDeg: geometry.oriented[0]!.footprint.yawDeg,
    study: {
      ...result,
      poses: result.poses.map((p) => ({
        ...p,
        checksText: p.checks.map((c) => ({ label: c.gabarit.label, fits: c.fits, text: explain(c) })),
      })),
    },
    placements,
    boxes: Object.fromEntries(
      result.poses
        .filter((p) => p.pose !== 'reference')
        .map((p) => {
          const profile = placements.find((x) => x.pose === p.pose)?.profile;
          return [p.pose, [...crateBoxes(p.crate), ...(profile ? blockingBoxes(p.crate, profile) : [])]];
        })
    ),
  };
}

/* ------------------------------------------------------------------ scène */

/**
 * Retrouve le STEP d'origine d'un maillage, s'il est à portée.
 *
 * Un maillage importé dans le moteur n'est pas réexportable (FEEDBACK #8) : le
 * STEP commun machine + caisse n'existe que si la machine entre en b-rep. Il
 * faut donc son STEP, pas son maillage.
 *
 *   async-machine-demo.obj  →  fixtures/machine-demo.step   (machine de démo)
 *   web-<nom>.obj           →  out/web-<nom>.step           (STEP déposé)
 */
/**
 * Au-delà, on ne tente même pas l'import b-rep dans l'atelier.
 *
 * Le moteur met 56 s pour importer un STEP de 137 Ko et échoue au bout de
 * 458 s sur un robot de 12,6 Mo (FEEDBACK.md #5). Tenter quand même, c'est
 * bloquer l'écran huit minutes pour finir sur un échec connu d'avance, et payer
 * huit minutes de session. On refuse tout de suite, et on dit pourquoi.
 */
const BREP_MAX_OCTETS = 2 * 1024 * 1024;
/** Et même sous cette taille, on ne laisse pas l'import courir indéfiniment. */
const BREP_TIMEOUT_MS = 90_000;

async function sourceBrep(mesh: string): Promise<string | undefined> {
  const base = mesh.replace(/\.obj$/, '');
  // Les deux extensions courantes : un STEP s'écrit .step ou .stp, et ne pas
  // chercher les deux revient à traiter deux fichiers identiques différemment.
  const nu = base.replace(/^async-/, '');
  const candidats = [
    join('fixtures', `${nu}.step`),
    join('fixtures', `${nu}.stp`),
    join('out', `${base}.step`),
  ];

  for (const chemin of candidats) {
    try {
      await readFile(chemin);
      return chemin;
    } catch {
      // candidat suivant
    }
  }
  return undefined;
}

/**
 * Les N caisses du découpage, construites en b-rep par le moteur.
 *
 * Elles sortent en un seul STEP : c'est l'expédition complète, telle qu'elle
 * partirait. La machine n'y est pas — ses pièces sont des maillages, et un
 * maillage importé n'est pas réexportable (FEEDBACK.md #8). On exporte donc les
 * caisses, et le viewer y pose les pièces.
 */
async function sceneDecoupeZoo(body: EtudeBody & { caisses?: number }) {
  const { EngineSession } = await import('./engine/session.js');
  const { createBoxesBatched } = await import('./engine/scene.js');

  const data = await etude(body);
  const d = data.study.decoupe;
  if (!d) throw new Error('Aucun découpage à générer : une pose passe déjà.');

  const boxes = (await construireDecoupe(body)).boxes;
  const t0 = performance.now();
  const session = await EngineSession.open();

  try {
    const ids = await createBoxesBatched(session, boxes);

    await session.sendBatch(
      boxes
        .map((b, i) => (isBlocking(b.name) ? ids[i]! : undefined))
        .filter((id): id is string => id !== undefined)
        .map((object_id) => ({
          type: 'object_set_material_params_pbr' as const,
          object_id,
          color: { r: 0.72, g: 0.45, b: 0.16, a: 1 },
          metalness: 0.02,
          roughness: 0.9,
          ambient_occlusion: 0.5,
        }))
    );

    await mkdir('out', { recursive: true });

    const sortir = async (format: 'step' | 'gltf', nom: string) => {
      const { resp } = await session.send(
        {
          type: 'export',
          entity_ids: ids,
          format:
            format === 'step'
              ? { type: 'step', coords: ZOO_COORDS, created: undefined }
              : { type: 'gltf', storage: 'embedded', presentation: 'compact' },
        },
        600_000
      );
      if (resp.type !== 'export' || !resp.data.files[0]) return undefined;
      await writeFile(join('out', nom), Buffer.from(resp.data.files[0].contents as unknown as Uint8Array));
      return nom;
    };

    return {
      caisses: d.caisses.length,
      solides: ids.length,
      step: await sortir('step', 'decoupe.step'),
      gltf: await sortir('gltf', 'decoupe.gltf'),
      sessionMs: session.elapsedMs(),
      totalMs: Math.round(performance.now() - t0),
    };
  } finally {
    await session.close();
  }
}

async function scene(body: EtudeBody & { pose?: string; brep?: string }) {
  // Import tardif : ouvrir une session coûte, on ne charge le transport que
  // lorsqu'une scène est réellement demandée.
  const { EngineSession } = await import('./engine/session.js');
  const { createBoxesBatched } = await import('./engine/scene.js');
  const { gltfSizeMm } = await import('./mesh/gltf.js');

  const data = await etude(body);
  const poseId = body.pose ?? data.study.best?.pose ?? 'A';
  const pose = data.study.poses.find((p) => p.pose === poseId);
  if (!pose) throw new Error(`Pose inconnue : ${poseId}.`);

  const profile = data.placements.find((p) => p.pose === poseId)?.profile;
  const boxes = [...crateBoxes(pose.crate), ...(profile ? blockingBoxes(pose.crate, profile) : [])];
  const t0 = performance.now();

  const session = await EngineSession.open();
  try {
    const entites: string[] = [];
    let machineIncluse = false;
    let note: string | undefined;

    // La machine, si son STEP est à portée : c'est la seule voie vers le STEP
    // commun du §7.3.
    const brep = await sourceBrep(body.mesh!);
    if (brep) {
      try {
        const bytes = await readFile(brep);
        if (bytes.length > BREP_MAX_OCTETS) {
          throw new Error(
            `STEP de ${(bytes.length / 1024 / 1024).toFixed(1)} Mo : au-delà de ` +
              `${BREP_MAX_OCTETS / 1024 / 1024} Mo le moteur Zoo échoue après plusieurs minutes ` +
              `(voir FEEDBACK.md #5). La caisse est générée seule.`
          );
        }
        const { resp } = await session.send(
          {
            type: 'import_files',
            files: [{ path: basename(brep), data: bytes as unknown as number[] }],
            format: { type: 'step', split_closed_faces: false },
          },
          BREP_TIMEOUT_MS
        );
        if (resp.type === 'modeling' && resp.data.modeling_response.type === 'import_files') {
          const machineId = resp.data.modeling_response.data.object_id;

          // Le placement est celui que l'étude a déjà calculé : la machine est
          // posée exactement là où le verdict la suppose, pas approximativement.
          const prevu = data.placements.find((p) => p.pose === poseId)!.placement;
          await session.send({
            type: 'set_object_transform',
            object_id: machineId,
            transforms: [
              {
                rotate_angle_axis: {
                  property: {
                    x: prevu.rotationAxis[0],
                    y: prevu.rotationAxis[1],
                    z: prevu.rotationAxis[2],
                    w: prevu.rotationAngleDeg,
                  },
                  set: false,
                },
                translate: {
                  property: { x: prevu.translateMm[0], y: prevu.translateMm[1], z: prevu.translateMm[2] },
                  set: false,
                },
              },
            ],
          });
          // Sans cela, machine et caisse sortent du même gris et l'image ne
          // montre plus rien. Voir FEEDBACK.md #12.
          await session.send({
            type: 'object_set_material_params_pbr',
            object_id: machineId,
            color: { r: 0.78, g: 0.72, b: 0.05, a: 1 },
            metalness: 0.15,
            roughness: 0.5,
            ambient_occlusion: 0.4,
          });
          entites.push(machineId);
          machineIncluse = true;
        }
      } catch (err) {
        // Le moteur ne sait pas lire tous les STEP (FEEDBACK #5). On continue
        // avec la caisse seule plutôt que de ne rien rendre — mais on dit
        // pourquoi, au lieu de laisser croire à un oubli.
        note = err instanceof Error ? err.message : String(err);
      }
    }

    const ids = await createBoxesBatched(session, boxes);
    entites.push(...ids);

    // Le glTF rendu par Zoo n'a pas de noms de maillage : le viewer ne peut pas
    // y retrouver le calage pour le colorier. C'est donc le moteur qui le
    // colorie, et le viewer se contente d'utiliser les matériaux reçus.
    await session.sendBatch(
      boxes
        .map((b, i) => (isBlocking(b.name) ? ids[i]! : undefined))
        .filter((id): id is string => id !== undefined)
        .map((object_id) => ({
          type: 'object_set_material_params_pbr' as const,
          object_id,
          color: { r: 0.72, g: 0.45, b: 0.16, a: 1 },
          metalness: 0.02,
          roughness: 0.9,
          ambient_occlusion: 0.5,
        }))
    );

    await mkdir('out', { recursive: true });

    const exporter = async (format: 'gltf' | 'step', nom: string): Promise<string | undefined> => {
      const { resp } = await session.send(
        {
          type: 'export',
          entity_ids: entites,
          format:
            format === 'gltf'
              ? { type: 'gltf', storage: 'embedded', presentation: 'compact' }
              : { type: 'step', coords: ZOO_COORDS, created: undefined },
        },
        600_000
      );
      if (resp.type !== 'export' || !resp.data.files[0]) return undefined;
      const buf = Buffer.from(resp.data.files[0].contents as unknown as Uint8Array);
      await writeFile(join('out', nom), buf);
      return nom;
    };

    const gltf = await exporter('gltf', 'caisse-web.gltf');
    const step = await exporter('step', 'caisse-web.step');

    // Contrôle systématique : la caisse produite par Zoo doit avoir
    // l'encombrement qui a reçu le verdict. Voir FEEDBACK.md #9.
    const rendu = gltf ? JSON.parse(await readFile(join('out', gltf), 'utf8')) : undefined;
    const size = rendu ? gltfSizeMm(rendu) : undefined;
    const attendu = [pose.crate.outer.lengthMm, pose.crate.outer.widthMm, pose.crate.outer.heightMm];
    // Le contrôle vaut aussi — et surtout — avec la machine dans la scène : si
    // elle dépassait de sa caisse, l'encombrement de l'ensemble excéderait
    // l'encombrement attendu, et l'écart le dirait. C'est le seul test qui
    // attrape à la fois une caisse fausse et une machine mal posée.
    const ecartMm = size ? Math.max(...size.map((v, i) => Math.abs(v - attendu[i]!))) : undefined;

    return {
      gltf,
      step,
      machineIncluse,
      note,
      pose: poseId,
      solides: ids.length,
      sessionMs: session.elapsedMs(),
      totalMs: Math.round(performance.now() - t0),
      controle: { mesure: size, attendu, ecartMm },
    };
  } finally {
    await session.close();
  }
}

/* ---------------------------------------------------------------- découpage */

/**
 * Les deux caisses du découpage, garnies de leurs pièces.
 *
 * Chaque groupe de corps est extrait du maillage, **placé** — pose, lacet,
 * translation, et recouchage pour la seconde caisse — puis écrit tel quel. Le
 * viewer n'a qu'à charger : aucune transformation n'est rejouée côté client,
 * donc aucune occasion de la rejouer de travers.
 */
async function construireDecoupe(body: EtudeBody & { caisses?: number }) {
  const data = await etude(body);
  const d = data.study.decoupe;
  if (!d) throw new Error('Aucun découpage à montrer : une pose passe déjà.');

  const scene = sceneDecoupe(d);
  const texte = await readFile(join('out', body.mesh!), 'utf8');

  // La pose sur laquelle le découpage a été calculé, et son placement.
  const base = data.study.poses.find((p) => p.pose !== 'reference' && !p.forbidden)!;
  const place = data.placements.find((p) => p.pose === base.pose)!;
  const axe = place.axis as 'x' | 'y' | 'z';
  const pl = place.placement;

  /** Applique à un point du fichier la pose, le lacet et la translation. */
  const poser = (p: [number, number, number]): [number, number, number] => {
    const a = alignedCloud({ count: 1, xyz: Float64Array.from(p) }, axe, data.unit.scale);
    const r = rotate([a.xyz[0]!, a.xyz[1]!, a.xyz[2]!], [0, 0, 1], pl.yawDeg);
    return [r[0] + pl.translateMm[0], r[1] + pl.translateMm[1], r[2] + pl.translateMm[2]];
  };

  const fichiers: string[] = [];
  const boxes: typeof scene.boxes = [];

  for (const [i, c] of d.caisses.entries()) {
    const brut = extraireCorps(texte, new Set<string>(c.corps));
    const offset = scene.offsets[i]!;
    const floorTop = c.crate.skid.heightMm + c.crate.floorThicknessMm;

    // Transformation **locale** : la caisse est centrée sur l'origine. Le
    // décalage vers sa place dans la scène vient après, sinon le calage serait
    // relevé dans un repère et posé dans un autre.
    let locale: (p: [number, number, number]) => [number, number, number];

    if (i === 0) {
      locale = poser;
    } else {
      const poses: Array<[number, number, number]> = [];
      for (const ligne of brut.split('\n')) {
        if (ligne.startsWith('v ')) {
          const [x, y, z] = ligne.slice(2).trim().split(/\s+/).map(Number) as [number, number, number];
          poses.push(poser([x, y, z]));
        }
      }

      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const p of poses) {
        for (let a = 0; a < 3; a++) {
          if (p[a]! < min[a]!) min[a] = p[a]!;
          if (p[a]! > max[a]!) max[a] = p[a]!;
        }
      }

      const { permuter } = coucher(min, max);
      const recentrer = centrer(poses.map(permuter), 0, floorTop);
      locale = (p) => recentrer(permuter(poser(p)));
    }

    // Les sommets de cette caisse, dans son repère : c'est sur eux que se
    // relève le calage. Repartir du nuage entier donnerait le profil de la
    // mauvaise géométrie, et des cales posées contre du vide.
    const sommets: number[] = [];
    for (const ligne of brut.split('\n')) {
      if (ligne.startsWith('v ')) {
        const [x, y, z] = ligne.slice(2).trim().split(/\s+/).map(Number) as [number, number, number];
        sommets.push(...locale([x, y, z]));
      }
    }

    const hauts = sommets.filter((_, k) => k % 3 === 2);
    const profil = profilDepuisPoints(Float64Array.from(sommets), floorTop, Math.max(floorTop, ...hauts));

    boxes.push(
      ...crateBoxes(c.crate).map((b) => ({ ...b, name: `caisse${i + 1}_${b.name}`, x: b.x + offset })),
      ...blockingBoxes(c.crate, profil).map((b) => ({ ...b, name: `caisse${i + 1}_${b.name}`, x: b.x + offset }))
    );

    const nom = `decoupe-${i + 1}.obj`;
    await writeFile(join('out', nom), transformerObj(brut, (p) => decalerX(offset)(locale(p))));
    fichiers.push(nom);
  }

  return { boxes, offsets: scene.offsets, fichiers, decoupe: d };
}

async function decoupe(body: EtudeBody & { caisses?: number }) {
  return construireDecoupe(body);
}

/* ------------------------------------------------------------- conversion */

async function conversion(body: { name?: string; base64?: string }) {
  const { file } = await import('@kittycad/lib');
  const { createZooClient } = await import('./zoo-client.js');
  const { api_calls } = await import('@kittycad/lib');

  if (!body.base64 || !body.name) throw new Error('Fichier manquant.');
  const bytes = Buffer.from(body.base64, 'base64');

  const client = createZooClient();
  const t0 = performance.now();

  // Voie asynchrone obligatoire : la variante synchrone tombe en 504 dès que la
  // conversion dépasse une minute, quelle que soit la taille. Voir FEEDBACK #4.
  const started = await file.create_file_conversion_options({
    client,
    files: [{ name: basename(body.name), data: new Blob([new Uint8Array(bytes)]) }],
    body: {
      src_format: { type: 'step', split_closed_faces: false },
      output_format: {
        type: 'obj',
        coords: { forward: { axis: 'y', direction: 'negative' }, up: { axis: 'z', direction: 'positive' } },
        units: 'mm',
      },
    },
  });

  if ('error_code' in (started as object)) throw new Error(JSON.stringify(started).slice(0, 300));

  let operation: { status: string; outputs?: Record<string, string>; error?: string } = started as never;
  while (['queued', 'uploaded', 'in_progress'].includes(operation.status)) {
    await new Promise((r) => setTimeout(r, 2000));
    operation = (await api_calls.get_async_operation({ client, id: started.id })) as never;
  }

  if (operation.status !== 'completed' || !operation.outputs) {
    throw new Error(operation.error ?? `conversion ${operation.status}`);
  }

  await mkdir('out', { recursive: true });
  const base = `web-${basename(body.name).replace(/\.[^.]+$/, '')}`;
  const name = `${base}.obj`;
  // Le STEP d'origine est conservé : le maillage ne suffit pas pour produire le
  // STEP commun machine + caisse, il faut la machine en b-rep (FEEDBACK #8).
  await writeFile(join('out', `${base}.step`), bytes);
  const [first] = Object.values(operation.outputs);
  const objText = Buffer.from(first as string, 'base64').toString('utf8');
  await writeFile(join('out', name), objText);

  const compact = compactObj(objText);
  return {
    mesh: name,
    ms: Math.round(performance.now() - t0),
    vertices: compact.vertices,
    faces: compact.faces,
  };
}

/* ----------------------------------------------------------------- static */

async function serveStatic(url: string, res: ServerResponse): Promise<void> {
  // Trois racines seulement, et jamais de chemin qui remonte : `public` pour
  // l'interface, `out` pour les artefacts produits, `node_modules/three` pour
  // le moteur de rendu, servi tel quel plutôt que recopié.
  let file: string;
  if (url.startsWith('/vendor/three/')) {
    file = join(ROOT, 'node_modules', 'three', url.slice('/vendor/three/'.length));
  } else if (url.startsWith('/out/')) {
    file = join(ROOT, 'out', url.slice('/out/'.length));
  } else {
    file = join(ROOT, 'public', url === '/' ? 'index.html' : url);
  }

  const safe = normalize(file);
  if (!safe.startsWith(join(ROOT, 'public')) && !safe.startsWith(join(ROOT, 'out')) && !safe.startsWith(join(ROOT, 'node_modules', 'three'))) {
    res.writeHead(403).end('Interdit');
    return;
  }

  try {
    const body = await readFile(safe);
    res.writeHead(200, {
      'content-type': MIME[extname(safe)] ?? 'application/octet-stream',
      // Un atelier qu'on modifie en continu ne doit jamais servir de version
      // périmée : une correction invisible dans le navigateur se cherche dans
      // le code pendant une heure. Le trafic est local, le coût est nul.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Introuvable');
  }
}

/* ------------------------------------------------------------------ routes */

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]!;

  void (async () => {
    try {
      if (req.method === 'GET' && url === '/api/maillages') return json(res, 200, { meshes: await meshes() });
      if (req.method === 'POST' && url === '/api/etude') return json(res, 200, await etude((await readBody(req)) as EtudeBody));
      if (req.method === 'POST' && url === '/api/scene') return json(res, 200, await scene((await readBody(req)) as never));
      if (req.method === 'POST' && url === '/api/scene-decoupe')
        return json(res, 200, await sceneDecoupeZoo((await readBody(req)) as never));
      if (req.method === 'POST' && url === '/api/decoupe') return json(res, 200, await decoupe((await readBody(req)) as never));
      if (req.method === 'POST' && url === '/api/conversion') return json(res, 200, await conversion((await readBody(req)) as never));
      if (req.method === 'GET') return await serveStatic(url, res);
      res.writeHead(405).end('Méthode non autorisée');
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  })();
});

server.listen(PORT, () => {
  console.log(`Atelier Caisse — http://localhost:${PORT}`);
});
