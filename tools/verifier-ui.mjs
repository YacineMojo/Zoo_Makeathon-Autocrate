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
await page.selectOption('#mode', 'maritime');
await page.click('#calculer');
await page.waitForSelector('.tableau-poses tr[data-pose]', { timeout: 120_000 });

// Le maillage de la machine pèse plusieurs mégaoctets : on laisse le temps au
// chargeur OBJ de le poser dans la caisse avant de photographier.
await page.waitForTimeout(12_000);
await page.screenshot({ path: `${OUT}/ui-etude.png`, fullPage: true });

console.log('verdict :', propre(await page.textContent('#verdict')));
console.log('état    :', propre(await page.textContent('#etat-calcul')));
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
