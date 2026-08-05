/**
 * Lecture des sommets d'un OBJ.
 *
 * On ne veut que des sommets : l'emprise orientée se calcule
 * sur un nuage de points, jamais sur des faces. Les lignes `f`, `vn`, `vt`, les
 * groupes et les matériaux sont donc ignorés — c'est ce qui rend ce parseur
 * court et insensible aux variantes de dialecte OBJ.
 */

/** Nuage de sommets, à plat : `xyz[3i]`, `xyz[3i+1]`, `xyz[3i+2]`. */
export interface VertexCloud {
  count: number;
  xyz: Float64Array;
}

/** Boîte englobante alignée sur les axes du fichier — la « boîte naïve » du §6.2. */
export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

/**
 * Extrait les sommets d'un OBJ.
 *
 * Un OBJ de machine réelle pèse des dizaines de mégaoctets : on parcourt le
 * texte une seule fois, sans `split('\n')` sur la chaîne entière, et on écrit
 * dans un tableau typé qui grandit par doublement. Un `Array<number[]>` de
 * plusieurs centaines de milliers de triplets coûterait plusieurs fois la
 * mémoire du fichier.
 */
export function parseObjVertices(text: string): VertexCloud {
  let capacity = 3 * 4096;
  let xyz = new Float64Array(capacity);
  let n = 0; // nombre de flottants écrits

  let lineStart = 0;
  const len = text.length;

  while (lineStart < len) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = len;

    // Seules les lignes `v ` portent un sommet. `vn`/`vt` commencent aussi par
    // `v` : le test sur le séparateur est ce qui les écarte.
    if (
      text.charCodeAt(lineStart) === 118 /* v */ &&
      (text.charCodeAt(lineStart + 1) === 32 || text.charCodeAt(lineStart + 1) === 9)
    ) {
      const parts = text.slice(lineStart + 2, lineEnd).trim().split(/\s+/);
      if (parts.length >= 3) {
        if (n + 3 > capacity) {
          capacity *= 2;
          const grown = new Float64Array(capacity);
          grown.set(xyz.subarray(0, n));
          xyz = grown;
        }
        xyz[n] = Number(parts[0]);
        xyz[n + 1] = Number(parts[1]);
        xyz[n + 2] = Number(parts[2]);
        n += 3;
      }
    }

    lineStart = lineEnd + 1;
  }

  return { count: n / 3, xyz: xyz.subarray(0, n) };
}

/** Boîte englobante du nuage, dans le repère du fichier. */
export function axisAlignedBounds(cloud: VertexCloud): Bounds {
  if (cloud.count === 0) {
    throw new Error('Nuage de sommets vide : aucune emprise calculable.');
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < cloud.xyz.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = cloud.xyz[i + a] as number;
      if (v < (min[a] as number)) min[a] = v;
      if (v > (max[a] as number)) max[a] = v;
    }
  }

  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}
