import { study, savings, type PoseInput } from './moteur/etude.js';
import { explain } from './moteur/verdict.js';
import type { Study } from './domain/types.js';

/**
 * Le tableau des poses (PROJECT.md §7.1), en texte.
 *
 * Version console du seul écran qui compte avec la vue 3D (§13). L'écrire
 * maintenant coûte dix minutes et dérisque l'étape 5 : la mise en forme HTML
 * n'aura plus qu'à habiller une sortie dont on sait déjà qu'elle est juste.
 *
 * Les emprises utilisées ici sont celles mesurées sur le vrai STEP pendant le
 * spike, **avant** orientation. C'est délibéré : le tableau doit montrer d'abord
 * le mauvais chiffre, celui d'aujourd'hui.
 */

const eur = (v: number) => `${v.toLocaleString('fr-FR')} €`;
const mm = (v: number) => `${(v / 1000).toFixed(2)} m`;

function render(title: string, result: Study): void {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
  console.log(`Masse machine : ${result.massKg.toLocaleString('fr-FR')} kg\n`);

  const header = ['Pose', 'Caisse L×l×h', 'Gabarit', 'Coût', 'Délai'];
  const rows = result.poses.map((p) => [
    p.forbidden ? `${p.label} ✕` : p.label,
    `${mm(p.crate.outer.lengthMm)} × ${mm(p.crate.outer.widthMm)} × ${mm(p.crate.outer.heightMm)}`,
    p.forbidden ? 'écartée' : p.retained ? p.retained.gabarit.label : 'hors gabarit',
    eur(p.costing.totalEur),
    `${p.costing.leadTimeDays} j`,
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');

  console.log(line(header));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));

  console.log();
  for (const p of result.poses) {
    const verdicts = p.checks.map((c) => `${c.gabarit.label} : ${explain(c)}`);
    console.log(`  ${p.label}`);
    for (const v of verdicts) console.log(`    ${v}`);
  }

  const delta = savings(result);
  if (delta) {
    console.log(
      `\n→ ${eur(delta.eur)} et ${delta.days} jours économisés par rapport au repère CAO.`
    );
  } else if (result.fallbacks) {
    if (result.otherMode) {
      const o = result.otherMode;
      console.log(
        `\n→ Aucun gabarit maritime. En revanche, « ${o.label} » passe en ` +
          `${o.gabaritLabel} avec ${o.marginMm} mm de marge : ${eur(o.costing.totalEur)}, ` +
          `${o.costing.leadTimeDays} j. Changer de mode est votre décision, pas celle de l’outil.`
      );
    }
    console.log('\n→ Sinon, les deux issues du hors gabarit, chiffrées :');
    console.log(
      `    ${result.fallbacks.oversize.label.padEnd(30)} ${eur(result.fallbacks.oversize.totalEur).padStart(10)}  ${result.fallbacks.oversize.leadTimeDays} j`
    );
    console.log(
      `    ${result.fallbacks.split.label.padEnd(30)} ${eur(result.fallbacks.split.totalEur).padStart(10)}  ${result.fallbacks.split.leadTimeDays} j`
    );
    console.log(
      `    hypothèse de partage : deux caisses de ${mm(result.fallbacks.split.assumedHalves.lengthMm)} × ${mm(result.fallbacks.split.assumedHalves.widthMm)} × ${mm(result.fallbacks.split.assumedHalves.heightMm)}`
    );
    console.log('    L’outil ne découpe pas : il chiffre les deux issues et laisse choisir.');
  }

  console.log('\nHypothèses');
  for (const a of result.assumptions) console.log(`  ${a.label.padEnd(28)} ${a.value}`);

  console.log();
  for (const n of result.notices) console.log(`  ⚠ ${n}`);
}

// Emprise naïve du KUKA KR 600 R2830, mesurée sur le STEP pendant le spike.
const kuka = { l: 2517, w: 1303, h: 2941 };

const poses: PoseInput[] = [
  {
    pose: 'reference',
    label: 'Repère CAO (naïf)',
    footprint: { lengthMm: kuka.l, widthMm: kuka.w, heightMm: kuka.h },
    lying: false,
  },
  {
    pose: 'A',
    label: 'Pose A — debout',
    footprint: { lengthMm: kuka.l, widthMm: kuka.w, heightMm: kuka.h },
    lying: false,
  },
  {
    pose: 'B',
    label: 'Pose B — couchée',
    footprint: { lengthMm: kuka.h, widthMm: kuka.l, heightMm: kuka.w },
    lying: true,
  },
  {
    pose: 'C',
    label: 'Pose C — sur le flanc',
    footprint: { lengthMm: kuka.h, widthMm: kuka.w, heightMm: kuka.l },
    lying: true,
  },
];

render('KUKA KR 600 R2830 — emprise naïve, avant orientation', study({ poses, massKg: 2_350 }));
