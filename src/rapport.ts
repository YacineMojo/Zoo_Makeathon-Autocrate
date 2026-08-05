import { savings } from './moteur/etude.js';
import { explain } from './moteur/verdict.js';
import type { Study } from './domain/types.js';

/**
 * Le tableau des poses, en texte.
 *
 * Version console du seul écran qui compte avec la vue 3D. L'écrire
 * maintenant coûte dix minutes et dérisque l'étape 5 : la mise en forme HTML
 * n'aura plus qu'à habiller une sortie dont on sait déjà qu'elle est juste.
 *
 * La première ligne du tableau est toujours la référence naïve. Le tableau doit
 * montrer d'abord le mauvais chiffre, celui d'aujourd'hui — c'est le delta qui
 * est le produit, pas la valeur absolue.
 */

const eur = (v: number) => `${v.toLocaleString('en-GB')} €`;
const mm = (v: number) => `${(v / 1000).toFixed(2)} m`;

export function render(title: string, result: Study): void {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
  console.log(`Machine mass: ${result.massKg.toLocaleString('en-GB')} kg\n`);

  const header = ['Pose', 'Crate L × W × H', 'Gauge', 'Cost', 'Lead time'];
  const rows = result.poses.map((p) => [
    p.forbidden ? `${p.label} ✕` : result.best?.pose === p.pose && result.arbitrage === 'gabarit' ? `${p.label} ★` : p.label,
    `${mm(p.crate.outer.lengthMm)} × ${mm(p.crate.outer.widthMm)} × ${mm(p.crate.outer.heightMm)}`,
    p.forbidden ? 'ruled out' : p.retained ? p.retained.gabarit.label : 'out of gauge',
    // Une pose écartée n'a pas de prix : afficher un montant inviterait à
    // comparer, alors qu'elle est interdite, pas chère.
    p.forbidden ? '—' : eur(p.costing.totalEur),
    p.forbidden ? '—' : `${p.costing.leadTimeDays} days`,
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
  if (result.overloaded) {
    // Un refus par masse ne se règle par aucune orientation : on le dit d'une
    // phrase au lieu d'afficher un tableau de poses qui suggérerait le contraire.
    const o = result.overloaded;
    console.log(
      `\n→ Rejected on payload: ${o.grossKg.toLocaleString('en-GB')} kg gross against ` +
        `${o.maxPayloadKg.toLocaleString('en-GB')} kg allowed on the most capable gauge ` +
        `(${o.gabaritLabel}). No orientation changes that, and neither does going out of gauge: ` +
        `this is a mass problem, not a size problem.`
    );
  } else if (result.arbitrage === 'aucun') {
    console.log(
      `\n→ All poses fall in the same gauge — ${result.best!.retained!.gabarit.label}, ` +
        `${result.best!.costing.leadTimeDays} days. The gap between them is plywood: ` +
        `keep the CAD frame, there is nothing to arbitrate.`
    );
  } else if (delta) {
    console.log(
      `\n→ ${eur(delta.eur)} and ${delta.days} days saved against the CAD frame.`
    );
    if (result.faster) {
      const f = result.faster;
      const jours = result.best!.costing.leadTimeDays - f.costing.leadTimeDays;
      const surcout = f.costing.totalEur - result.best!.costing.totalEur;
      console.log(
        `  Faster: ${f.gabaritLabel}, ${eur(f.costing.totalEur)} in ${f.costing.leadTimeDays} days — ` +
          `${jours} days less for ${eur(surcout)} more. Up to you what the shipping window is worth.`
      );
    }
  } else if (result.fallbacks) {
    if (result.otherMode) {
      const o = result.otherMode;
      console.log(
        `\n→ No ocean gauge fits. “${o.label}” does fit ` +
          `${o.gabaritLabel} with ${o.marginMm} mm of margin: ${eur(o.costing.totalEur)}, ` +
          `${o.costing.leadTimeDays} days. Changing mode is your decision, not the tool's.`
      );
    }
    if (result.decoupe) {
      const d = result.decoupe;
      const axe = d.axe === 2 ? 'in height' : 'in width';
      console.log(
        `\n→ ${d.caisses.length} crates. Cuts ${axe} at ` +
          `${d.plansMm.map((v) => (v / 1000).toFixed(2) + ' m').join(' and ')}:`
      );
      for (const c of d.caisses) {
        console.log(
          `    crate ${c.rang + 1}  ${mm(c.crate.outer.lengthMm)} × ${mm(c.crate.outer.widthMm)} × ${mm(c.crate.outer.heightMm)}   ` +
            `${(c.retained?.gabarit.label ?? 'out of gauge').padEnd(24)} ${eur(c.costing.totalEur).padStart(9)}   ` +
            `${c.corps.length} bodies`
        );
      }
      console.log(`    total ${eur(d.totalEur)} in ${d.leadTimeDays} days, study and disassembly included.`);
      console.log(
        `    The tool does not cut: a distinct body in a mesh is not a removable part. It says which ones cost.`
      );
    }

    console.log('\n→ Otherwise, the two out-of-gauge outcomes, priced:');
    console.log(
      `    ${result.fallbacks.oversize.label.padEnd(30)} ${eur(result.fallbacks.oversize.totalEur).padStart(10)}  ${result.fallbacks.oversize.leadTimeDays} j`
    );
    console.log(
      `    ${result.fallbacks.split.label.padEnd(30)} ${eur(result.fallbacks.split.totalEur).padStart(10)}  ${result.fallbacks.split.leadTimeDays} j`
    );
    console.log(
      `    split assumption: two crates of ${mm(result.fallbacks.split.assumedHalves.lengthMm)} × ${mm(result.fallbacks.split.assumedHalves.widthMm)} × ${mm(result.fallbacks.split.assumedHalves.heightMm)}`
    );
    console.log('    The tool does not cut: it prices both outcomes and lets you choose.');
  }

  console.log('\nAssumptions');
  for (const a of result.assumptions) console.log(`  ${a.label.padEnd(28)} ${a.value}`);

  console.log();
  for (const n of result.notices) console.log(`  ⚠ ${n}`);
}

