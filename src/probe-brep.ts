import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { EngineSession } from './engine/session.js';

/**
 * Le moteur sait-il importer le STEP du KUKA en b-rep ?
 *
 * C'est la question qui décide du §7.3 : un maillage importé ne peut pas être
 * réexporté (FEEDBACK #8), donc le STEP contenant machine **et** caisse n'existe
 * que si la machine entre en b-rep. Le premier essai a échoué après 458 s sur
 * `[internal_engine] import failed`. On refait un essai, avec l'option de
 * découpage des faces fermées inversée, avant de conclure.
 */

const path = process.argv[2] ?? 'fixtures/kuka_kr600_r2830.stp';
const split = process.argv.includes('--split');
const bytes = await readFile(path);

console.log(`${path} — ${(bytes.length / 1024 / 1024).toFixed(1)} Mo, split_closed_faces=${split}`);

const session = await EngineSession.open();
const t = performance.now();
try {
  const { resp } = await session.send(
    {
      type: 'import_files',
      files: [{ path: basename(path), data: bytes as unknown as number[] }],
      format: { type: 'step', split_closed_faces: split },
    },
    900_000
  );
  const ok = resp.type === 'modeling' && resp.data.modeling_response.type === 'import_files';
  console.log(`✅ imported in ${((performance.now() - t) / 1000).toFixed(1)} s — ${ok ? 'b-rep in scene' : resp.type}`);
} catch (err) {
  console.log(`❌ ${((performance.now() - t) / 1000).toFixed(1)} s — ${err instanceof Error ? err.message : err}`);
} finally {
  await session.close();
  console.log(`session : ${(session.elapsedMs() / 1000).toFixed(1)} s billed`);
}
