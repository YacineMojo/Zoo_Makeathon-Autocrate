import { api_calls } from '@kittycad/lib';
import { createZooClient } from './zoo-client.js';

/**
 * Le 504 de la File Format API est-il un échec, ou seulement une passerelle qui
 * abandonne pendant que la conversion continue côté serveur ?
 *
 * La question décide de l'architecture : si la conversion aboutit, il suffit de
 * ne pas attendre la réponse HTTP et d'aller chercher le résultat par son id
 * d'opération. Si elle n'aboutit pas, le fichier de démo doit changer de taille.
 *
 * On regarde donc ce que le compte a réellement enregistré comme appels.
 */

const client = createZooClient();

const page = await api_calls.user_list_api_calls({ client, limit: 15, sort_by: 'created_at_descending' });

if ('error_code' in (page as object)) {
  console.error(JSON.stringify(page, null, 2).slice(0, 1000));
  process.exit(1);
}

console.log('Most recent calls recorded on the account :\n');
for (const call of page.items ?? []) {
  const started = call.started_at ?? call.created_at;
  const ended = call.completed_at;
  const seconds =
    started && ended ? ((Date.parse(ended) - Date.parse(started)) / 1000).toFixed(1) : '—';

  console.log(
    [
      (call.created_at ?? '').slice(11, 19),
      (call.method ?? '').padEnd(5),
      (call.endpoint ?? '').padEnd(30),
      `${call.status_code ?? '—'}`.padEnd(4),
      `${seconds} s`.padStart(8),
    ].join('  ')
  );
}
