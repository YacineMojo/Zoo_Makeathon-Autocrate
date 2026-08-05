import { writeFile, mkdir } from 'node:fs/promises';
import { ml, api_calls } from '@kittycad/lib';
import { createZooClient } from './zoo-client.js';

/**
 * La machine de démonstration, générée par Zoo Text-to-CAD.
 *
 * **Pourquoi ne pas prendre un vrai modèle constructeur ?** Parce que la
 * soumission et la vidéo sont publiques, et que le §14 impose de vérifier la
 * licence avant de s'attacher à un fichier. Vérification faite :
 *
 *   pythonocc-demos          aucune licence, aucun fichier LICENSE
 *   Cobots-RoboDK-Isaac-Sim  aucune licence
 *   gltf-models              aucune licence
 *   OCC_Qt_Robot             MIT — mais son robot fait 88 cm, il ne franchit
 *                            aucun seuil de gabarit, donc il ne démontre rien
 *
 * Le modèle KUKA KR 600 utilisé pour mesurer les APIs vient d'un dépôt sans
 * licence et porte un en-tête constructeur de 2014 : il reste un **fichier de
 * mesure local**, non redistribué et hors de la vidéo.
 *
 * La machine de démonstration est donc générée ici, par une troisième API phare
 * de Zoo. Trois conséquences, toutes bonnes :
 *
 *   - aucune question de licence : le STEP est produit par notre prompt ;
 *   - une API phare de plus dans le projet, donc une veine neuve de FEEDBACK ;
 *   - la géométrie est choisie pour ce qu'elle doit démontrer — haute debout,
 *     basse couchée, avec un vide interne qui rend la boîte naïve stupide.
 *
 * L'outil, lui, ne sait rien de tout ça : il reçoit un STEP et le mesure. Que
 * ce STEP ait été dessiné par un bureau d'études ou généré par Zoo ne change
 * pas une ligne du chemin qui suit.
 *
 * Usage : tsx src/machine-demo.ts ["prompt"]
 */

const PROMPT =
  process.argv[2] ??
  [
    'An industrial robotic work cell on a rectangular steel base frame,',
    '2.4 m long, 1.2 m wide and 3.1 m tall.',
    'A vertical column rises from one end of the base to the full height.',
    'A horizontal gantry beam runs from the top of the column along the length,',
    'supported at the far end by a slender diagonal brace, leaving a large open',
    'space underneath. A boxy control cabinet stands on the base beside the column.',
    'Simple prismatic shapes, no fillets, no fasteners.',
  ].join(' ');

const client = createZooClient();

console.log(`Prompt :\n  ${PROMPT}\n`);

const t0 = performance.now();
const started = await ml.create_text_to_cad({
  client,
  output_format: 'step',
  body: { prompt: PROMPT, project_name: 'caisse-makeathon' },
});

if ('error_code' in (started as object)) {
  console.error(`❌ refused: ${JSON.stringify(started).slice(0, 400)}`);
  process.exit(1);
}

console.log(`job ${started.id} — ${started.status}`);

let operation: { status: string; outputs?: Record<string, string>; error?: string; code?: string } =
  started as never;
let polls = 0;

while (['queued', 'uploaded', 'in_progress'].includes(operation.status)) {
  await new Promise((r) => setTimeout(r, 3000));
  polls++;
  operation = (await api_calls.get_async_operation({ client, id: started.id })) as never;
  if (polls % 5 === 0) console.log(`  … ${operation.status} after ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

console.log(`final status : ${operation.status} after ${((performance.now() - t0) / 1000).toFixed(1)} s`);

if (operation.status !== 'completed' || !operation.outputs) {
  console.error(`❌ ${operation.error ?? 'failure with no detail'}`);
  process.exit(1);
}

await mkdir('fixtures', { recursive: true });
for (const [name, b64] of Object.entries(operation.outputs)) {
  const buf = Buffer.from(b64, 'base64');
  const path = `fixtures/machine-demo${name.slice(name.lastIndexOf('.'))}`;
  await writeFile(path, buf);
  console.log(`✅ ${path} — ${(buf.length / 1024).toFixed(0)} Ko`);
}

// Le KCL est rendu avec le modèle : on le garde, il documente ce qui a été
// généré bien mieux qu'une capture d'écran.
if (operation.code) {
  await writeFile('fixtures/machine-demo.kcl', operation.code);
  console.log(`✅ fixtures/machine-demo.kcl — ${operation.code.split('\n').length} lignes`);
}
