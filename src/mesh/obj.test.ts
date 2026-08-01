import test from 'node:test';
import assert from 'node:assert/strict';
import { parseObjVertices, axisAlignedBounds } from './obj.js';

/**
 * Le verdict du spike repose sur un compte de sommets. Un parseur qui compterait
 * les normales comme des sommets rendrait « GO » sur une géométrie vide : ces
 * quelques tests protègent la seule mesure sur laquelle la décision est prise.
 */

const SAMPLE = [
  '# un cube minimal, avec du bruit autour',
  'mtllib machine.mtl',
  'v 0 0 0',
  'v 100.5 0 0',
  'vn 0.0 0.0 1.0', // normale : ne doit pas être comptée
  'vt 0.5 0.5', // coordonnée de texture : idem
  'v 100.5 200 -50',
  'g groupe_1',
  'f 1//1 2//1 3//1',
  'v\t0 200 -50', // séparateur tabulation
  '',
].join('\n');

test('ne compte que les lignes de sommet', () => {
  const cloud = parseObjVertices(SAMPLE);
  assert.equal(cloud.count, 4);
  assert.equal(cloud.xyz.length, 12);
});

test('lit les coordonnées dans l’ordre', () => {
  const cloud = parseObjVertices(SAMPLE);
  assert.deepEqual(Array.from(cloud.xyz.subarray(3, 6)), [100.5, 0, 0]);
});

test('tolère une dernière ligne sans retour chariot', () => {
  assert.equal(parseObjVertices('v 1 2 3').count, 1);
});

test('la boîte englobante encadre tous les sommets', () => {
  const bounds = axisAlignedBounds(parseObjVertices(SAMPLE));
  assert.deepEqual(bounds.min, [0, 0, -50]);
  assert.deepEqual(bounds.max, [100.5, 200, 0]);
  assert.deepEqual(bounds.size, [100.5, 200, 50]);
});

test('un nuage vide est une erreur, pas une boîte de taille nulle', () => {
  // Une emprise de 0 × 0 × 0 se propagerait en silence jusqu'au tableau des
  // poses. Mieux vaut échouer à la lecture.
  assert.throws(() => axisAlignedBounds(parseObjVertices('# rien')), /vide/);
});

test('grandit au-delà de la capacité initiale', () => {
  const many = Array.from({ length: 5000 }, (_, i) => `v ${i} ${i} ${i}`).join('\n');
  const cloud = parseObjVertices(many);
  assert.equal(cloud.count, 5000);
  assert.equal(cloud.xyz[3 * 4999], 4999);
});
