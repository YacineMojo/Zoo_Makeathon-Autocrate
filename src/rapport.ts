import { savings } from './moteur/etude.js';
import { explain } from './moteur/verdict.js';
import type { Study } from './domain/types.js';

/**
 * Le tableau des poses (PROJECT.md §7.1), en texte.
 *
 * Version console du seul écran qui compte avec la vue 3D (§13). L'écrire
 * maintenant coûte dix minutes et dérisque l'étape 5 : la mise en forme HTML
 * n'aura plus qu'à habiller une sortie dont on sait déjà qu'elle est juste.
 *
 * La première ligne du tableau est toujours la référence naïve. Le tableau doit
 * montrer d'abord le mauvais chiffre, celui d'aujourd'hui — c'est le delta qui
 * est le produit, pas la valeur absolue (§6.2).
 */

const eur = (v: number) => `${v.toLocaleString('fr-FR')} €`;
const mm = (v: number) => `${(v / 1000).toFixed(2)} m`;

export function render(title: string, result: Study): void {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
  console.log(`Masse machine : ${result.massKg.toLocaleString('fr-FR')} kg\n`);

  const header = ['Pose', 'Caisse L×l×h', 'Gabarit', 'Coût', 'Délai'];
  const rows = result.poses.map((p) => [
    p.forbidden ? `${p.label} ✕` : result.best?.pose === p.pose && result.arbitrage === 'gabarit' ? `${p.label} ★` : p.label,
    `${mm(p.crate.outer.lengthMm)} × ${mm(p.crate.outer.widthMm)} × ${mm(p.crate.outer.heightMm)}`,
    p.forbidden ? 'écartée' : p.retained ? p.retained.gabarit.label : 'hors gabarit',
    // Une pose écartée n'a pas de prix : afficher un montant inviterait à
    // comparer, alors qu'elle est interdite, pas chère.
    p.forbidden ? '—' : eur(p.costing.totalEur),
    p.forbidden ? '—' : `${p.costing.leadTimeDays} j`,
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
      `\n→ Refus par charge utile : ${o.grossKg.toLocaleString('fr-FR')} kg brut pour ` +
        `${o.maxPayloadKg.toLocaleString('fr-FR')} kg admissibles sur le gabarit le plus capable ` +
        `(${o.gabaritLabel}). Aucune orientation ne change cela, et le hors gabarit non plus : ` +
        `c'est un problème de masse, pas d'encombrement.`
    );
  } else if (result.arbitrage === 'aucun') {
    console.log(
      `\n→ Toutes les poses tombent dans le même gabarit — ${result.best!.retained!.gabarit.label}, ` +
        `${result.best!.costing.leadTimeDays} j. L'écart entre elles n'est que du contreplaqué : ` +
        `gardez le repère CAO, il n'y a rien à arbitrer.`
    );
  } else if (delta) {
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

