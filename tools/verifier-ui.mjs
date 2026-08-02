import { chromium } from 'playwright-core';

/**
 * Vérifie l'atelier dans un vrai navigateur, et en rapporte les images.
 *
 * Un serveur qui répond 200 ne prouve pas qu'une page fonctionne : une faute de
 * frappe sur un identifiant DOM ne casse rien côté serveur et vide l'écran côté
 * client. Ce script joue donc la démonstration du §16 de bout en bout —
 * étudier, lire le tableau, générer la caisse chez Zoo — et échoue si la console
 * du navigateur a émis la moindre erreur.
 *
 * Il produit aussi `out/ui-etude.png` et `out/ui-zoo.png`, qui sont les captures
 * du README.
 *
 * Prérequis : `npm run dev` sur le port visé, et un Chromium de Playwright
 * (`npx playwright install chromium`).
 *
 * Usage : node tools/verifier-ui.mjs [url] [chemin/vers/chrome]
 */

const URL_BASE = process.argv[2] ?? process.env.URL ?? 'http://localhost:5174/';
const CHROME = process.argv[3] ?? process.env.CHROME;
const OUT = 'out';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });

const erreurs = [];
page.on('console', (m) => {
  if (m.type() === 'error') erreurs.push(m.text());
});
page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`));

const propre = (s) => s.replace(/\s+/g, ' ').trim();

await page.goto(URL_BASE, { waitUntil: 'networkidle' });
// Mode maritime, celui du §16 : c'est là que le franchissement de seuil coûte
// le plus cher, et c'est la phrase de la démonstration — debout hors gabarit,
// couchée dans un 40 pieds standard.
//
// Il n'y a pas de bouton « calculer » : l'étude part au chargement et se
// relance à chaque changement. Ce script cliquait un `#calculer` disparu depuis
// plusieurs versions, et échouait avant d'avoir rien vérifié.
await page.selectOption('#mode', 'maritime');
await page.waitForSelector('.tableau-poses tr[data-pose]', { timeout: 120_000 });
await page.waitForSelector('.coupe svg', { timeout: 120_000 });

// Le voile de chargement doit être **parti**, pas seulement marqué caché : une
// règle de feuille de style peut annuler l'attribut `hidden`, et le calque
// reste alors par-dessus la vue en interceptant les clics.
await page.waitForFunction(
  () => getComputedStyle(document.getElementById('chargement')).display === 'none',
  null,
  { timeout: 60_000 }
);
const voileBloque = await page.evaluate(() => {
  const r = document.getElementById('scene').getBoundingClientRect();
  const cible = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return cible && cible.id !== 'scene' ? `${cible.tagName}.${cible.className}` : null;
});
if (voileBloque) erreurs.push(`la vue 3D est masquée par ${voileBloque}`);

// Une page qui déborde horizontalement se voit tout de suite en démonstration.
if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) {
  erreurs.push('la page déborde horizontalement');
}

// Le maillage de la machine pèse plusieurs mégaoctets : on laisse le temps au
// chargeur OBJ de le poser dans la caisse avant de photographier.
await page.waitForTimeout(12_000);
await page.screenshot({ path: `${OUT}/ui-etude.png`, fullPage: true });

console.log('chiffre :', propre(await page.textContent('#verdict-chiffre')));
console.log('verdict :', propre(await page.textContent('#verdict')));
console.log('état    :', propre(await page.textContent('#etat-calcul')));
for (const coupe of await page.$$eval('.coupe', (cs) =>
  cs.map((c) => ({
    titre: c.querySelector('.coupe-pose')?.textContent.trim(),
    verdict: c.dataset.verdict,
    cote: c.querySelector('.cote-texte')?.textContent.trim(),
    prix: c.querySelector('.coupe-prix-montant')?.textContent.trim(),
  }))
)) {
  console.log(`    coupe ${coupe.titre} — ${coupe.verdict}, ${coupe.cote}, ${coupe.prix}`);
}
for (const ligne of await page.$$eval('.tableau-poses tbody tr', (rs) =>
  rs.map((r) => [...r.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | '))
)) {
  console.log('   ', ligne);
}

await page.click('#generer');
await page.waitForFunction(() => !/en cours/.test(document.getElementById('vue-etat').textContent), null, {
  timeout: 300_000,
});
await page.waitForTimeout(8_000);
await page.screenshot({ path: `${OUT}/ui-zoo.png`, fullPage: true });
console.log('zoo     :', propre(await page.textContent('#vue-etat')));

await browser.close();

if (erreurs.length) {
  console.error(`\n❌ ${erreurs.length} erreur(s) dans la console du navigateur :`);
  for (const e of erreurs.slice(0, 10)) console.error(`   ${e}`);
  process.exit(1);
}
console.log('\n✅ aucune erreur console');
