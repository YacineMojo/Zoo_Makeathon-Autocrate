import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { EngineSession } from './engine/session.js';
import { gltfSizeMm } from './mesh/gltf.js';

/**
 * Rouvre un STEP que nous avons produit, dans le moteur qui l'a produit.
 *
 * C'est la boucle fermée, et la seule vérification qui vaille : un fichier
 * n'est pas valide parce qu'il pèse le bon nombre d'octets, il est valide
 * parce qu'un autre logiciel le relit. Ici le relecteur est Zoo, sur une
 * session neuve, sans rien savoir de la scène d'origine.
 *
 * Trois choses en ressortent :
 *
 *   - le nombre de solides relus, à comparer à ce qu'on a écrit ;
 *   - l'encombrement mesuré, à comparer au verdict ;
 *   - une image, qui montre que la machine est bien dans sa caisse.
 *
 * Usage : tsx src/relire-step.ts [out/caisse-web.step]
 */

const path = process.argv[2] ?? 'out/caisse-web.step';
const bytes = await readFile(path);

console.log(`${path} — ${(bytes.length / 1024 / 1024).toFixed(2)} Mo`);

const session = await EngineSession.open();
const t0 = performance.now();

try {
  const { resp } = await session.send(
    {
      type: 'import_files',
      files: [{ path: basename(path), data: bytes as unknown as number[] }],
      format: { type: 'step', split_closed_faces: false },
    },
    300_000
  );

  if (resp.type !== 'modeling' || resp.data.modeling_response.type !== 'import_files') {
    throw new Error(`Zoo refuses its own export : ${resp.type}`);
  }

  const objectId = resp.data.modeling_response.data.object_id;
  console.log(`✅ read back by Zoo in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  // Combien de solides, et de quelle taille ? On ressort en glTF, dont on sait
  // relire l'encombrement, plutôt que de refaire un parseur de STEP.
  const { resp: exp } = await session.send(
    {
      type: 'export',
      entity_ids: [objectId],
      format: { type: 'gltf', storage: 'embedded', presentation: 'compact' },
    },
    300_000
  );

  if (exp.type === 'export' && exp.data.files[0]) {
    const gltf = JSON.parse(Buffer.from(exp.data.files[0].contents as unknown as Uint8Array).toString('utf8'));
    const size = gltfSizeMm(gltf);
    console.log(`   ${gltf.meshes?.length ?? 0} solids relus`);
    if (size) console.log(`   encombrement ${size.map((v) => Math.round(v)).join(' × ')} mm`);
  }

  await session.send({ type: 'view_isometric', padding: 0.15 });
  await session.send({ type: 'zoom_to_fit', padding: 0.15 });
  const { resp: snap } = await session.send({ type: 'take_snapshot', format: 'png' }, 120_000);

  if (snap.type === 'modeling' && snap.data.modeling_response.type === 'take_snapshot') {
    const raw = snap.data.modeling_response.data.contents as unknown;
    const png = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.from(raw as Uint8Array);
    await mkdir('out', { recursive: true });
    await writeFile('out/step-relu.png', png);
    console.log(`   out/step-relu.png (${(png.length / 1024).toFixed(0)} Ko)`);
  }
} finally {
  await session.close();
  console.log(`   session ${(session.elapsedMs() / 1000).toFixed(1)} s`);
}
