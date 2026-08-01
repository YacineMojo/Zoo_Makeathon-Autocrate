import type { ModelingCmd } from '@kittycad/lib';
import type { EngineSession } from './session.js';
import type { Box } from './box.js';

/**
 * Construction de la caisse dans une scène Zoo.
 *
 * `createBox` fait huit allers-retours par pavé. Une caisse en compte une
 * trentaine, soit près de 250 commandes : au temps de session facturé, c'est
 * inacceptable. On envoie donc tout en un seul lot.
 *
 * L'identifiant du solide reste celui du `start_path` : l'extrusion transforme
 * le chemin en solide **en place**, et `extrude` répond `{}` sans indiquer
 * d'identifiant. On retient donc la position de chaque `start_path` dans le lot
 * pour retrouver les identifiants dans l'ordre des pavés.
 */
export async function createBoxesBatched(session: EngineSession, boxes: Box[]): Promise<string[]> {
  const cmds: ModelingCmd[] = [];
  const pathIndexes: number[] = [];

  for (const box of boxes) {
    const { x, y, z, width: w, depth: d, height: h } = box;

    pathIndexes.push(cmds.length);
    cmds.push({ type: 'start_path' });

    // Le chemin est référencé par l'identifiant de son `start_path`, qui n'est
    // connu qu'après l'envoi. On le remplace après coup : les commandes qui
    // suivent pointent vers un identifiant calculé par la session, dans l'ordre.
    // Esquisse à z = 0 : la cote Z est de toute façon ignorée à ce stade, la
    // hauteur est rétablie par la translation en fin de pavé.
    cmds.push({ type: 'move_path_pen', path: '', to: { x, y, z: 0 } });

    for (const end of [
      { x: x + w, y, z: 0 },
      { x: x + w, y: y + d, z: 0 },
      { x, y: y + d, z: 0 },
    ]) {
      cmds.push({ type: 'extend_path', path: '', segment: { type: 'line', end, relative: false } });
    }

    cmds.push({ type: 'close_path', path_id: '' });
    cmds.push({ type: 'extrude', target: '', distance: h });
    cmds.push({ type: 'object_set_name', object_id: '', name: box.name });

    // La cote Z passée à `move_path_pen` est **ignorée** : l'esquisse est créée
    // sur le plan par défaut et l'extrusion part toujours de z = 0. Sans
    // erreur, sans avertissement. Une caisse dessinée ainsi a ses patins, son
    // plancher et son chapeau empilés au même niveau, et l'image reste
    // plausible tant qu'on ne mesure pas. Voir FEEDBACK.md #9.
    //
    // On remonte donc chaque volume après coup. Une commande de plus par pavé,
    // dans le même lot : le coût est nul.
    cmds.push({
      type: 'set_object_transform',
      object_id: '',
      transforms: [{ translate: { property: { x: 0, y: 0, z }, set: false } }],
    });
  }

  // Les identifiants sont attribués séquentiellement : les réserver revient à
  // les connaître d'avance, ce qui permet de remplir les références internes.
  const ids = session.reserveIds(cmds.length);

  for (let b = 0; b < boxes.length; b++) {
    const base = pathIndexes[b]!;
    const pathId = ids[base]!;

    (cmds[base + 1] as { path: string }).path = pathId;
    for (let s = 0; s < 3; s++) (cmds[base + 2 + s] as { path: string }).path = pathId;
    (cmds[base + 5] as { path_id: string }).path_id = pathId;
    (cmds[base + 6] as { target: string }).target = pathId;
    (cmds[base + 7] as { object_id: string }).object_id = pathId;
    (cmds[base + 8] as { object_id: string }).object_id = pathId;
  }

  await session.sendBatch(cmds, 300_000, ids);

  return pathIndexes.map((i) => ids[i]!);
}
