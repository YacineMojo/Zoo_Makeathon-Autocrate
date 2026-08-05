/**
 * Compactage d'un OBJ avant import dans l'Engine API.
 *
 * L'Engine API transporte ses commandes en BSON, dont la taille de document est
 * plafonnée à 16 Mio. Au-delà, le sérialiseur du SDK échoue côté client sur
 * « offset is out of bounds », sans que rien n'indique la vraie cause. Voir
 * FEEDBACK.md #6.
 *
 * L'OBJ rendu par la File Format API pour le KUKA pèse 23 Mo, dont :
 *
 *     sommets   5,4 Mo   174 043 lignes
 *     faces    14,6 Mo   350 484 lignes, au format `f 1//1 2//1 3//1`
 *     reste     4,7 Mo   normales et noms d'objets
 *
 * Les deux tiers du fichier sont donc des **normales**, que le moteur recalcule
 * à l'import et dont nous n'avons aucun usage : on ne veut que des sommets pour
 * une enveloppe. Les retirer emporte aussi les `//n` des
 * faces, qui font la moitié de leur poids.
 *
 * Aucune géométrie n'est perdue : mêmes sommets, mêmes faces, même
 * connectivité. Seule la précision décimale est bornée, à 0,01 mm — soit dix
 * microns sur une caisse dimensionnée au millimètre.
 */

/** Nombre de décimales conservées. 0,01 mm est déjà cent fois plus fin que nécessaire. */
const DECIMALS = 2;

export interface CompactionResult {
  obj: string;
  beforeBytes: number;
  afterBytes: number;
  vertices: number;
  faces: number;
}

export function compactObj(source: string): CompactionResult {
  const out: string[] = [];
  let vertices = 0;
  let faces = 0;

  let start = 0;
  const len = source.length;

  while (start < len) {
    let end = source.indexOf('\n', start);
    if (end === -1) end = len;

    const c0 = source.charCodeAt(start);
    const c1 = source.charCodeAt(start + 1);

    if (c0 === 118 /* v */ && (c1 === 32 || c1 === 9)) {
      const parts = source.slice(start + 2, end).trim().split(/\s+/);
      if (parts.length >= 3) {
        vertices++;
        out.push(
          `v ${Number(parts[0]).toFixed(DECIMALS)} ${Number(parts[1]).toFixed(DECIMALS)} ${Number(parts[2]).toFixed(DECIMALS)}`
        );
      }
    } else if (c0 === 102 /* f */ && (c1 === 32 || c1 === 9)) {
      // `f 1//1 2//1 3//1` → `f 1 2 3`. L'indice de sommet est toujours le
      // premier champ, avant le premier `/`.
      const parts = source.slice(start + 2, end).trim().split(/\s+/);
      if (parts.length >= 3) {
        faces++;
        out.push(`f ${parts.map((p) => p.split('/')[0]).join(' ')}`);
      }
    }
    // Tout le reste — `vn`, `vt`, `o`, `g`, `usemtl`, commentaires — est écarté.

    start = end + 1;
  }

  const obj = out.join('\n') + '\n';
  return {
    obj,
    beforeBytes: Buffer.byteLength(source),
    afterBytes: Buffer.byteLength(obj),
    vertices,
    faces,
  };
}

/** Limite de document BSON, au-delà de laquelle l'envoi échoue côté client. */
export const BSON_MAX_BYTES = 16 * 1024 * 1024;
