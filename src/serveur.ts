import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, basename } from 'node:path';
import { parseObjVertices } from './mesh/obj.js';
import { compactObj } from './mesh/compacter.js';
import { buildPoses } from './geometrie/poses.js';
import { placeForPose } from './geometrie/placement.js';
import type { Axis } from './geometrie/emprise.js';
import type { UnitChoice } from './geometrie/unites.js';
import { study } from './moteur/etude.js';
import { crateBoxes } from './engine/caisse.js';
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
}

/** Maillages disponibles, servis depuis `out/`. Le dépôt d'un STEP passe par /api/conversion. */
async function meshes(): Promise<string[]> {
  try {
    return (await readdir('out')).filter((f) => f.endsWith('.obj')).sort();
  } catch {
    return [];
  }
}

async function etude(body: EtudeBody) {
  const name = body.mesh ?? 'async-kuka_kr600_r2830.obj';
  if (basename(name) !== name) throw new Error('Nom de maillage invalide.');

  const massKg = Number(body.massKg);
  if (!Number.isFinite(massKg) || massKg <= 0) {
    // Un STEP ne porte pas de matériau. Le demander montre qu'on le sait (§5).
    throw new Error('Masse invalide : un STEP ne porte pas de matériau, elle doit être saisie.');
  }

  const t0 = performance.now();
  const cloud = parseObjVertices(await readFile(join('out', name), 'utf8'));
  const geometry = buildPoses(cloud, body.up ?? 'z', body.unit ?? 'auto');
  const result = study({
    poses: geometry.poses,
    massKg,
    mode: body.mode ?? 'maritime',
    forbidLying: body.forbidLying === true,
  });

  // Le placement de chaque pose part avec l'étude : le viewer en a besoin pour
  // poser le maillage de la machine dans la caisse sans refaire le calcul.
  const placements = result.poses
    .filter((p) => p.pose !== 'reference')
    .map((p, i) => {
      const axis = geometry.oriented[i]!;
      const floorTop = p.crate.skid.heightMm + p.crate.floorThicknessMm;
      return {
        pose: p.pose,
        axis: axis.axis,
        placement: placeForPose(cloud, axis.axis, axis.footprint.yawDeg, geometry.unit.scale, floorTop),
      };
    });

  return {
    ms: Math.round(performance.now() - t0),
    vertices: cloud.count,
    unit: geometry.unit,
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
    boxes: Object.fromEntries(result.poses.filter((p) => p.pose !== 'reference').map((p) => [p.pose, crateBoxes(p.crate)])),
  };
}

/* ------------------------------------------------------------------ scène */

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

  const boxes = crateBoxes(pose.crate);
  const t0 = performance.now();

  const session = await EngineSession.open();
  try {
    const ids = await createBoxesBatched(session, boxes);
    const { resp } = await session.send(
      {
        type: 'export',
        entity_ids: ids,
        format: { type: 'gltf', storage: 'embedded', presentation: 'compact' },
      },
      600_000
    );
    if (resp.type !== 'export') throw new Error(`réponse inattendue : ${resp.type}`);

    const file = resp.data.files[0];
    if (!file) throw new Error('Export vide.');

    const buf = Buffer.from(file.contents as unknown as Uint8Array);
    await mkdir('out', { recursive: true });
    await writeFile(join('out', 'caisse-web.gltf'), buf);

    // Contrôle systématique : la caisse produite par Zoo doit avoir
    // l'encombrement qui a reçu le verdict. Voir FEEDBACK.md #9.
    const size = gltfSizeMm(JSON.parse(buf.toString('utf8')));
    const attendu = [pose.crate.outer.lengthMm, pose.crate.outer.widthMm, pose.crate.outer.heightMm];
    const ecartMm = size ? Math.max(...size.map((v, i) => Math.abs(v - attendu[i]!))) : undefined;

    return {
      gltf: 'caisse-web.gltf',
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
  const name = `web-${basename(body.name).replace(/\.[^.]+$/, '')}.obj`;
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
    res.writeHead(200, { 'content-type': MIME[extname(safe)] ?? 'application/octet-stream' });
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
