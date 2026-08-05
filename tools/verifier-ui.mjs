import { chromium } from 'playwright-core';

/**
 * Vérifie les deux pages dans un vrai navigateur, et en rapporte les images.
 *
 * Un serveur qui répond 200 ne prouve pas qu'une page fonctionne : une faute de
 * frappe sur un identifiant DOM ne casse rien côté serveur et vide l'écran côté
 * client. Ce script joue donc le parcours entier — la page d'accueil, le bouton
 * qui mène au studio, l'étude, puis la génération chez Zoo — et échoue si la
 * console du navigateur a émis la moindre erreur.
 *
 * Il vérifie aussi trois choses qui se sont déjà cassées en silence :
 *
 *   - le voile de chargement est **parti**, pas seulement marqué `hidden` : une
 *     règle de feuille de style peut annuler l'attribut, et le calque reste
 *     alors par-dessus la vue en interceptant les clics ;
 *   - la page ne déborde pas horizontalement ;
 *   - les deux liens de téléchargement pointent sur des fichiers réellement
 *     servis, et pas sur un `href` laissé à vide.
 *
 * Il produit `out/ui-accueil.png` et `out/ui-studio.png`, les captures du README.
 *
 * Prérequis : `npm run dev` sur le port visé, et un Chromium de Playwright
 * (`npx playwright install chromium`).
 *
 * Usage : node tools/verifier-ui.mjs [url] [chemin/vers/chrome]
 */

const URL_BASE = (process.argv[2] ?? process.env.URL ?? 'http://localhost:5174/').replace(/\/$/, '');
const CHROME = process.argv[3] ?? process.env.CHROME;
const OUT = 'out';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const erreurs = [];
page.on('console', (m) => {
  if (m.type() === 'error') erreurs.push(m.text());
});
page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400) erreurs.push(`HTTP ${r.status()} sur ${r.url()}`);
});

const propre = (s) => s.replace(/\s+/g, ' ').trim();

/** Une page qui déborde horizontalement se voit tout de suite en démonstration. */
const deborde = () =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

/* ------------------------------------------------------------------ accueil */

await page.goto(`${URL_BASE}/`, { waitUntil: 'load' });
await page.waitForSelector('.cta');

const cible = await page.getAttribute('.cta', 'href');
if (cible !== '/app.html') erreurs.push(`the “try it now” button points at ${cible}`);
if (await deborde()) erreurs.push("the landing page overflows horizontally");

console.log('landing :', propre(await page.textContent('.hero-lead')));
console.log('apis    :', (await page.$$('.apis li')).length, 'entries');
await page.screenshot({ path: `${OUT}/ui-accueil.png`, fullPage: true });

/* ------------------------------------------------------------------- studio */

await page.click('.cta');
await page.waitForURL('**/app.html');
await page.waitForSelector('#readout > div', { timeout: 120_000 });

await page.waitForFunction(
  () => getComputedStyle(document.getElementById('chargement')).display === 'none',
  null,
  { timeout: 60_000 }
);
const voile = await page.evaluate(() => {
  const r = document.getElementById('scene').getBoundingClientRect();
  const cible = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return cible && cible.id !== 'scene' ? `${cible.tagName}.${cible.className}` : null;
});
if (voile) erreurs.push(`the 3D view is hidden by ${voile}`);
if (await deborde()) erreurs.push('the studio overflows horizontally');

console.log('state   :', propre(await page.textContent('#etat-calcul')));
for (const ligne of await page.$$eval('#readout > div', (ds) =>
  ds.map((d) => `${d.querySelector('dt').textContent} : ${d.querySelector('dd').textContent}`)
)) {
  console.log('   ', propre(ligne));
}

/* ------------------------------------------------------- génération chez Zoo */

await page.waitForFunction(() => !document.getElementById('generer').disabled, null, { timeout: 60_000 });
await page.click('#generer');
await page.waitForFunction(() => !/running/.test(document.getElementById('vue-etat').textContent), null, {
  timeout: 300_000,
});
await page.waitForTimeout(6_000);
await page.screenshot({ path: `${OUT}/ui-studio.png` });
console.log('zoo     :', propre(await page.textContent('#vue-etat')));

// Un bouton rouge qui ne télécharge rien est pire qu'un bouton grisé.
for (const id of ['dl-step', 'dl-gltf']) {
  const lien = await page.evaluate((x) => {
    const a = document.getElementById(x);
    return { href: a.getAttribute('href'), disabled: a.getAttribute('aria-disabled') };
  }, id);
  if (lien.disabled !== 'false' || !lien.href) {
    erreurs.push(`${id} was not armed after generation`);
    continue;
  }
  const reponse = await page.request.get(`${URL_BASE}${lien.href}`);
  if (!reponse.ok()) erreurs.push(`${id} points at ${lien.href}, which answers ${reponse.status()}`);
  else console.log(`output  : ${lien.href} — ${(await reponse.body()).length} bytes`);
}

await browser.close();

if (erreurs.length) {
  console.error(`\n❌ ${erreurs.length} problem(s) :`);
  for (const e of erreurs.slice(0, 10)) console.error(`   ${e}`);
  process.exit(1);
}
console.log('\n✅ no console errors, both outputs are served');
