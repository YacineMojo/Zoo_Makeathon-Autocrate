import { Client } from '@kittycad/lib';

/**
 * Charge le .env (Node >= 20.12) sans dépendance externe.
 * Silencieux si le fichier n'existe pas : on retombe sur l'env du shell.
 */
function loadEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // pas de .env local, on continue
  }
}

/**
 * Récupère le token Zoo.
 *
 * `ZOO_API_TOKEN` est la convention documentée par Zoo. `KITTYCAD_TOKEN` est
 * la variable que `@kittycad/lib` lit par défaut : on l'accepte en secours pour
 * rester compatible avec les exemples officiels. Voir FEEDBACK.md #1.
 */
export function getToken(): string {
  loadEnv();
  const token = process.env.ZOO_API_TOKEN ?? process.env.KITTYCAD_TOKEN;
  if (!token) {
    throw new Error(
      'Aucun token trouvé. Copie .env.example vers .env et renseigne ZOO_API_TOKEN.'
    );
  }
  return token;
}

/** Client Zoo authentifié, à passer à tous les appels de la lib. */
export function createZooClient(): Client {
  return new Client(getToken());
}

/** Détecte la forme d'erreur renvoyée par l'API Zoo. */
export function isApiError(
  response: unknown
): response is { error_code: string; message: string; request_id?: string } {
  return typeof response === 'object' && response !== null && 'error_code' in response;
}
