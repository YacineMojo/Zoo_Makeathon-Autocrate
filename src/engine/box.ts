import type { EngineSession } from './session.js';

/** Pavé droit posé sur le plan XY, décrit par son coin inférieur et ses dimensions (mm). */
export interface Box {
  name: string;
  x: number;
  y: number;
  z: number;
  width: number; // suivant X
  depth: number; // suivant Y
  height: number; // suivant Z
}

/**
 * Matérialise un pavé dans la scène et retourne l'id du solide.
 *
 * Le rectangle est esquissé directement aux bonnes coordonnées X/Y plutôt que
 * dessiné à l'origine puis translaté : une commande de moins par pavé, et la
 * position reste lisible dans les logs.
 */
export async function createBox(session: EngineSession, box: Box): Promise<string> {
  const { x, y, z, width: w, depth: d, height: h } = box;

  const { id: pathId } = await session.send({ type: 'start_path' });

  await session.send({
    type: 'move_path_pen',
    path: pathId,
    to: { x, y, z },
  });

  // Trois segments seulement : `close_path` fournit le quatrième. Ajouter une
  // ligne de retour vers le point de départ *puis* fermer crée un segment de
  // longueur nulle, et l'extrusion ne produit alors aucun corps.
  const corners = [
    { x: x + w, y, z },
    { x: x + w, y: y + d, z },
    { x, y: y + d, z },
  ];
  for (const end of corners) {
    await session.send({
      type: 'extend_path',
      path: pathId,
      segment: { type: 'line', end, relative: false },
    });
  }

  await session.send({ type: 'close_path', path_id: pathId });

  await session.send({ type: 'extrude', target: pathId, distance: h });

  // L'extrusion transforme le chemin en solide *en place* : l'entité `solid3d`
  // de la scène porte l'id du `start_path`, et non celui de l'`extrude`.
  // `extrude` répond `{}` et n'indique donc aucun id. Voir FEEDBACK.md #6.
  const solidId = pathId;

  await session.send({
    type: 'object_set_name',
    object_id: solidId,
    name: box.name,
  });

  return solidId;
}
