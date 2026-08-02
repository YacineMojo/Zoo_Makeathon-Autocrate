/**
 * Les corps distincts d'un maillage.
 *
 * PROJECT.md §8 appelle l'arbre d'assemblage « le piège du projet » : la
 * hiérarchie produit ne survit pas au chemin d'import, et les noms sortent
 * illisibles. C'est vrai — mais **le regroupement, lui, survit**. L'OBJ rendu
 * par la File Format API porte des sections `o Unnamed-0`, `o Unnamed-1` … :
 * seize pour notre machine de démonstration, soixante pour un robot KUKA.
 *
 * Les noms sont perdus, les corps sont là. Et pour dire quelles pièces portent
 * un dépassement de gabarit, on n'a pas besoin de noms : on a besoin de
 * géométrie.
 *
 * **Un corps distinct n'est pas une pièce démontable.** Ça peut être une
 * soudure, une pièce d'un ensemble monobloc, ou un artefact du convertisseur —
 * notre machine de démonstration contient un corps de 1 × 1 × 1 mm. L'outil ne
 * dira donc jamais « démontez ceci » : il dira « ces corps portent le
 * dépassement, voilà ce que leur retrait rapporterait », et l'ingénierie
 * tranche.
 */

/** Un corps du maillage, avec sa boîte dans le repère du fichier. */
export interface Body {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
  /** Nombre de sommets référencés par ses faces. */
  count: number;
}

/** En deçà, ce n'est pas un corps mais un résidu de conversion. */
const VOLUME_MINIMAL_MM3 = 1_000_000; // 10 × 10 × 10 cm

/**
 * Découpe un OBJ en corps.
 *
 * Subtilité du format : les sommets sont déclarés **avant** les sections `o`,
 * et les indices de face sont globaux. Un corps ne se définit donc pas par les
 * sommets qu'il déclare — il n'en déclare aucun — mais par ceux que ses faces
 * référencent.
 */
export function parseObjBodies(text: string): Body[] {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];

  const bodies = new Map<string, { min: [number, number, number]; max: [number, number, number]; count: number }>();
  let courant: string | undefined;

  let start = 0;
  const len = text.length;

  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;

    const c0 = text.charCodeAt(start);
    const c1 = text.charCodeAt(start + 1);

    if (c0 === 118 /* v */ && (c1 === 32 || c1 === 9)) {
      const p = text.slice(start + 2, end).trim().split(/\s+/);
      if (p.length >= 3) {
        xs.push(Number(p[0]));
        ys.push(Number(p[1]));
        zs.push(Number(p[2]));
      }
    } else if (c0 === 111 /* o */ && (c1 === 32 || c1 === 9)) {
      courant = text.slice(start + 2, end).trim();
    } else if (c0 === 102 /* f */ && (c1 === 32 || c1 === 9) && courant !== undefined) {
      let body = bodies.get(courant);
      if (!body) {
        body = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], count: 0 };
        bodies.set(courant, body);
      }

      for (const tok of text.slice(start + 2, end).trim().split(/\s+/)) {
        const slash = tok.indexOf('/');
        const i = Number(slash === -1 ? tok : tok.slice(0, slash)) - 1;
        if (!Number.isInteger(i) || i < 0 || i >= xs.length) continue;

        const v: [number, number, number] = [xs[i] as number, ys[i] as number, zs[i] as number];
        for (let a = 0; a < 3; a++) {
          if (v[a]! < body.min[a]!) body.min[a] = v[a]!;
          if (v[a]! > body.max[a]!) body.max[a] = v[a]!;
        }
        body.count++;
      }
    }

    start = end + 1;
  }

  return [...bodies.entries()]
    .map(([name, b]) => ({ name, min: b.min, max: b.max, count: b.count }))
    .filter((b) => volumeMm3(b) >= VOLUME_MINIMAL_MM3);
}

/** Volume de la boîte d'un corps. Sert à répartir la masse, faute de mieux. */
export function volumeMm3(b: Body): number {
  return (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
}
