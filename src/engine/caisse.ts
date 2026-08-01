import type { Box } from './box.js';
import type { Crate } from '../domain/types.js';
import { STUD_SECTION_MM } from '../domain/assumptions.js';

/**
 * La caisse, en pavés (PROJECT.md §6.3).
 *
 * Que des boîtes. Aucun booléen, aucun congé, aucun assemblage réel — ni vis,
 * ni feuillure, ni équerre. Personne ne le remarquera sur un avant-projet, et
 * c'est ce qui rend la caisse générable en une session Zoo.
 *
 * Repère : origine au centre de la caisse en X/Y, `z = 0` sous les patins. La
 * machine est placée dans le même repère par `placeForPose`, ce qui garantit
 * qu'elle apparaît **à l'intérieur** — le seul plan qui compte pour le jury
 * (§13).
 *
 * L'empilement en Z suit exactement le calcul du verdict :
 *
 *     0 ── patins ── plancher ── volume intérieur ── panneau de toit ── hors tout
 *
 * Si les deux divergeaient, la caisse dessinée ne serait plus celle qui a été
 * confrontée au gabarit, et la démonstration serait fausse en silence.
 */
export function crateBoxes(crate: Crate): Box[] {
  const { outer, inner, skid, panelThicknessMm: t, floorThicknessMm: floor } = crate;

  const L = outer.lengthMm;
  const W = outer.widthMm;

  const x0 = -L / 2;
  const y0 = -W / 2;

  const zFloor = skid.heightMm;
  const zFloorTop = zFloor + floor;
  const zRoof = zFloorTop + inner.heightMm;

  const boxes: Box[] = [];

  // Patins transversaux : chacun traverse toute la largeur, ce qui laisse les
  // fourches entrer par les longs côtés. Répartis sur la longueur.
  const n = crate.skidCount;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? -skid.widthMm / 2 : x0 + (i * (L - skid.widthMm)) / (n - 1);
    boxes.push({
      name: `patin_${i + 1}`,
      x,
      y: y0,
      z: 0,
      width: skid.widthMm,
      depth: W,
      height: skid.heightMm,
    });
  }

  boxes.push({
    name: 'plancher',
    x: x0,
    y: y0,
    z: zFloor,
    width: L,
    depth: W,
    height: floor,
  });

  // Montants, à l'intérieur des panneaux. Ils portent le chapeau et donnent son
  // épaisseur à la paroi — les 45 mm comptés dans l'encombrement.
  const st = STUD_SECTION_MM.thicknessMm;
  const sd = STUD_SECTION_MM.depthMm;
  const spacing = crate.studSpacingMm;

  const alongX = Math.max(2, Math.round((L - 2 * t) / spacing) + 1);
  const alongY = Math.max(2, Math.round((W - 2 * t) / spacing) + 1);

  for (let i = 0; i < alongX; i++) {
    const x = x0 + t + (i * (L - 2 * t - sd)) / (alongX - 1);
    for (const y of [y0 + t, y0 + W - t - st]) {
      boxes.push({
        name: `montant_long_${i + 1}_${y > 0 ? 'b' : 'a'}`,
        x,
        y,
        z: zFloorTop,
        width: sd,
        depth: st,
        height: inner.heightMm,
      });
    }
  }

  // Sur les petits côtés on saute les extrémités : les coins sont déjà tenus
  // par les montants ci-dessus, et deux montants au même endroit ne se voient
  // pas mais coûtent deux volumes dans la scène.
  for (let i = 1; i < alongY - 1; i++) {
    const y = y0 + t + (i * (W - 2 * t - sd)) / (alongY - 1);
    for (const x of [x0 + t, x0 + L - t - st]) {
      boxes.push({
        name: `montant_pignon_${i}_${x > 0 ? 'b' : 'a'}`,
        x,
        y,
        z: zFloorTop,
        width: st,
        depth: sd,
        height: inner.heightMm,
      });
    }
  }

  // Panneaux : cloués sur la face extérieure des montants. Les deux pignons
  // sont réduits pour ne pas recouvrir les longs pans — sinon les volumes se
  // chevauchent et le STEP exporté contient de la matière en double.
  const wallHeight = zRoof - zFloorTop;

  boxes.push(
    { name: 'panneau_long_a', x: x0, y: y0, z: zFloorTop, width: L, depth: t, height: wallHeight },
    { name: 'panneau_long_b', x: x0, y: y0 + W - t, z: zFloorTop, width: L, depth: t, height: wallHeight },
    { name: 'panneau_pignon_a', x: x0, y: y0 + t, z: zFloorTop, width: t, depth: W - 2 * t, height: wallHeight },
    {
      name: 'panneau_pignon_b',
      x: x0 + L - t,
      y: y0 + t,
      z: zFloorTop,
      width: t,
      depth: W - 2 * t,
      height: wallHeight,
    },
    { name: 'chapeau', x: x0, y: y0, z: zRoof, width: L, depth: W, height: t }
  );

  return boxes;
}

/** Encombrement réel des pavés produits. Sert à vérifier qu'il colle au verdict. */
export function boxesEnvelope(boxes: Box[]): {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const b of boxes) {
    min[0] = Math.min(min[0], b.x);
    min[1] = Math.min(min[1], b.y);
    min[2] = Math.min(min[2], b.z);
    max[0] = Math.max(max[0], b.x + b.width);
    max[1] = Math.max(max[1], b.y + b.depth);
    max[2] = Math.max(max[2], b.z + b.height);
  }

  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
