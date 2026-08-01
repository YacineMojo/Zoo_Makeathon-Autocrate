/**
 * Relecture d'un glTF exporté, pour vérifier ce que Zoo a réellement produit.
 *
 * Ce n'est pas de la curiosité : la cote Z d'une esquisse est ignorée par le
 * moteur (FEEDBACK.md #9), et une caisse dont tous les volumes sont empilés à
 * z = 0 **ressemble encore à une caisse**. Le défaut ne se voit pas à l'image ;
 * il se voit en mesurant. On mesure donc, à chaque exécution.
 *
 * Conventions du glTF rendu par Zoo, constatées : longueurs en **mètres**, et
 * repère **Y en haut**. Notre Z devient donc son Y, et notre Y son Z.
 */

interface GltfLike {
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  accessors?: Array<{ min?: number[]; max?: number[] }>;
}

/** Encombrement d'un glTF, ramené à nos conventions : longueur, largeur, hauteur, en mm. */
export function gltfSizeMm(json: unknown): [number, number, number] | undefined {
  const doc = json as GltfLike;
  if (!doc.meshes || !doc.accessors) return undefined;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const mesh of doc.meshes) {
    for (const primitive of mesh.primitives) {
      // Seul l'accesseur de positions porte des bornes géométriques. Prendre
      // tous les accesseurs mêlerait les normales, bornées à ±1, et la mesure
      // serait silencieusement fausse.
      const index = primitive.attributes['POSITION'];
      if (index === undefined) continue;

      const accessor = doc.accessors[index];
      if (!accessor?.min || !accessor.max) continue;

      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a] as number, accessor.min[a] as number);
        max[a] = Math.max(max[a] as number, accessor.max[a] as number);
      }
    }
  }

  if (!Number.isFinite(min[0])) return undefined;

  const m = (a: number) => ((max[a] as number) - (min[a] as number)) * 1000;
  return [m(0), m(2), m(1)];
}
