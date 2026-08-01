import WebSocket from 'ws';
import { decode as decodeMsgPack } from '@msgpack/msgpack';
import {
  modeling,
  type ModelingCmd,
  type OkWebSocketResponseData,
  type WebSocketRequest,
  type WebSocketResponse,
} from '@kittycad/lib';
import { createZooClient } from '../zoo-client.js';

/**
 * Ramène un `request_id` à une chaîne UUID.
 *
 * Dans les frames text/JSON c'est déjà une chaîne, mais dans les frames MsgPack
 * l'id arrive en 16 octets bruts alors que le type déclaré est `string`. Sans
 * cette normalisation, la réponse d'export ne se corrèle à aucune commande et
 * l'attente expire. Voir FEEDBACK.md #8.
 */
function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array && value.length === 16) {
    const hex = Buffer.from(value).toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }
  return undefined;
}

/**
 * Session sur l'Engine API de Zoo.
 *
 * Le moteur est piloté par un unique WebSocket : chaque commande part avec un
 * `cmd_id` et la réponse revient avec ce même id dans `request_id`. On maintient
 * donc une table des promesses en attente, indexée par id.
 *
 * La facturation Zoo se compte en minutes d'accès API et l'Engine fonctionne en
 * sessions : le temps de session compte, pas le nombre de commandes. D'où
 * `elapsedMs()` et l'obligation d'appeler `close()`.
 */
export class EngineSession {
  private ws: WebSocket;
  private pending = new Map<
    string,
    { resolve: (d: OkWebSocketResponseData) => void; reject: (e: Error) => void }
  >();
  private startedAt = 0;
  private seq = 0;

  private constructor(ws: WebSocket, startedAt: number) {
    this.ws = ws;
    this.startedAt = startedAt;
    this.ws.on('message', (raw: Buffer) => this.onMessage(raw));
  }

  /** Ouvre la session et attend que le moteur soit prêt à recevoir des commandes. */
  static async open(): Promise<EngineSession> {
    const client = createZooClient();

    // Pas de WebRTC : on ne veut pas de flux vidéo, seulement de la géométrie.
    const url = modeling.modeling_commands_ws.urlConstructFrom({
      client,
      webrtc: false,
      show_grid: false,
    });

    // En Node on peut passer l'en-tête HTTP directement. Le SDK propose aussi
    // `authenticate()`, qui envoie une frame `{type:'headers'}` — nécessaire
    // dans un navigateur, où les en-têtes WS ne sont pas accessibles.
    const ws = new WebSocket(url.toString(), {
      headers: { Authorization: `Bearer ${client.token}` },
    });

    // Horloge monotone : une mesure de durée ne doit pas dépendre de l'heure
    // système, qui peut sauter en arrière (NTP, suspension, WSL).
    const startedAt = performance.now();

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) =>
        reject(new Error(`Connexion à l'Engine API refusée : ${err.message}`));
      ws.once('open', () => {
        ws.off('error', onError);
        resolve();
      });
      ws.once('error', onError);
    });

    const session = new EngineSession(ws, startedAt);
    await session.waitForSceneReady();
    return session;
  }

  /**
   * Le moteur envoie des messages non sollicités à l'ouverture (infos de
   * session, serveurs ICE). On laisse passer ce préambule avant d'émettre :
   * une commande envoyée trop tôt est perdue sans erreur.
   */
  private async waitForSceneReady(): Promise<void> {
    await this.send({ type: 'set_scene_units', unit: 'mm' });
  }

  private onMessage(raw: Buffer): void {
    const msg = this.decode(raw);
    if (!msg) return;

    if (process.env.ENGINE_DEBUG) {
      console.error(`  ← ${JSON.stringify(msg).slice(0, 300)}`);
    }

    // Battement de cœur : le moteur émet `metrics_request` régulièrement et
    // attend un `metrics_response`. Sans réponse, il coupe la session avec
    // « modeling connection timed out waiting for heartbeats ». Ce n'est pas
    // optionnel et le SDK ne s'en charge pas. Voir FEEDBACK.md #7.
    if (msg.success === true && 'resp' in msg && msg.resp.type === 'metrics_request') {
      this.sendRaw({ type: 'metrics_response', metrics: {} });
      return;
    }

    const requestId = normalizeRequestId(
      'request_id' in msg ? (msg.request_id as unknown) : undefined
    );

    if (!requestId) {
      // Une erreur sans `request_id` ne peut être rattachée à aucune commande :
      // l'appelant attendrait jusqu'à son timeout sans jamais savoir pourquoi.
      // On la remonte au moins dans la console. Voir FEEDBACK.md #7.
      if (msg.success === false && 'errors' in msg) {
        const detail = msg.errors
          .map((e: { error_code: string; message: string }) => `[${e.error_code}] ${e.message}`)
          .join(' | ');
        console.error(`  ⚠ erreur moteur non corrélée : ${detail}`);
      }
      return; // message non sollicité (ice_server_info, session data, metrics…)
    }

    const waiter = this.pending.get(requestId);
    if (!waiter) return;
    this.pending.delete(requestId);

    if (msg.success === true && 'resp' in msg) {
      waiter.resolve(msg.resp);
    } else {
      const errors = 'errors' in msg ? msg.errors : [];
      const detail = errors
        .map((e: { error_code: string; message: string }) => `[${e.error_code}] ${e.message}`)
        .join(' | ');
      waiter.reject(new Error(detail || 'échec de commande sans détail'));
    }
  }

  /**
   * Décode une frame du moteur.
   *
   * Le moteur mélange deux encodages : les réponses courantes arrivent en
   * text/JSON, mais les réponses volumineuses — un export de fichier — arrivent
   * en binaire **MsgPack**. Le `parseMessage` du SDK n'essaie que JSON puis
   * BSON : il échoue donc systématiquement sur les exports, avec un message
   * trompeur (« buffer length must === bson size »). Voir FEEDBACK.md #8.
   */
  private decode(raw: Buffer): WebSocketResponse | undefined {
    try {
      return modeling.modeling_commands_ws.parseMessage({
        data: raw,
      } as MessageEvent);
    } catch {
      // Deuxième tentative en MsgPack, l'encodage réel des frames binaires.
    }

    try {
      return decodeMsgPack(raw) as WebSocketResponse;
    } catch (err) {
      console.error(
        `  ⚠ frame indécodable (${raw.length} octets) : ${err instanceof Error ? err.message : err}`
      );
      return undefined;
    }
  }

  /**
   * Envoie une requête sans attendre de réponse corrélée.
   *
   * En **text/JSON** : le moteur refuse certains messages en binaire
   * (« this message is not accepted over binary/MsgPack, try text/JSON
   * instead »), dont `metrics_response`. Voir FEEDBACK.md #7.
   */
  private sendRaw(request: WebSocketRequest): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(request));
  }

  /** Identifiants déterministes : un même modèle produit les mêmes ids, donc des logs comparables. */
  private nextId(): string {
    this.seq += 1;
    const hex = this.seq.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  }

  /**
   * Envoie une commande et attend sa réponse.
   *
   * Retourne aussi `id` : dans l'Engine API, l'id de la commande qui crée une
   * entité *est* l'identifiant de cette entité. `start_path` ne renvoie pas
   * d'id de chemin, c'est son `cmd_id` qui sert de référence à `extrude`.
   */
  async send(
    cmd: ModelingCmd,
    timeoutMs = 60_000
  ): Promise<{ id: string; resp: OkWebSocketResponseData }> {
    const cmdId = this.nextId();
    const request: WebSocketRequest = {
      type: 'modeling_cmd_req',
      cmd,
      cmd_id: cmdId,
    };

    const response = new Promise<OkWebSocketResponseData>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmdId);
        reject(new Error(`Timeout (${timeoutMs} ms) sur la commande ${cmd.type}`));
      }, timeoutMs);

      this.pending.set(cmdId, {
        resolve: (d) => {
          clearTimeout(timer);
          resolve(d);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(new Error(`${cmd.type} : ${e.message}`));
        },
      });
    });

    this.ws.send(modeling.modeling_commands_ws.toBSON(request));
    const resp = await response;

    // ENGINE_DEBUG=1 pour tracer les réponses du moteur. Indispensable : les
    // commandes peuvent répondre « succès » avec une charge utile vide.
    if (process.env.ENGINE_DEBUG) {
      console.error(`  [${cmd.type}] ${cmdId} → ${JSON.stringify(resp)}`);
    }

    return { id: cmdId, resp };
  }

  /**
   * Envoie plusieurs commandes en un seul aller-retour.
   *
   * Le moteur exécute le lot dans l'ordre et l'interrompt à la première commande
   * en échec. C'est indispensable ici : une implantation compte des dizaines de
   * volumes, soit des centaines de commandes, et la facturation Zoo se compte au
   * temps de session, pas au nombre d'appels.
   *
   * Retourne les ids attribués, dans l'ordre des commandes soumises.
   */
  async sendBatch(cmds: ModelingCmd[], timeoutMs = 180_000): Promise<string[]> {
    if (cmds.length === 0) return [];

    const ids = cmds.map(() => this.nextId());
    const batchId = this.nextId();

    const request: WebSocketRequest = {
      type: 'modeling_cmd_batch_req',
      batch_id: batchId,
      requests: cmds.map((cmd, i) => ({ cmd, cmd_id: ids[i] as string })),
      // Le détail des réponses ne nous sert pas : seul importe que le lot passe.
      responses: false,
    };

    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(batchId);
        reject(new Error(`Timeout (${timeoutMs} ms) sur un lot de ${cmds.length} commandes`));
      }, timeoutMs);

      this.pending.set(batchId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(new Error(`lot de ${cmds.length} commandes : ${e.message}`));
        },
      });
    });

    // En text/JSON : le moteur refuse `modeling_cmd_batch_req` en binaire, alors
    // qu'il accepte `modeling_cmd_req`. Voir FEEDBACK.md #7.
    this.ws.send(JSON.stringify(request));
    await done;
    return ids;
  }

  /** Durée de session écoulée, en ms. La facturation Zoo se compte au temps de session. */
  elapsedMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  /** Ferme proprement. À appeler systématiquement, y compris en cas d'erreur. */
  async close(): Promise<void> {
    for (const [, waiter] of this.pending) {
      waiter.reject(new Error('session fermée avant réponse'));
    }
    this.pending.clear();

    if (this.ws.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        this.ws.once('close', () => resolve());
        this.ws.close();
        setTimeout(resolve, 2_000); // ne pas rester bloqué si le serveur ne répond pas
      });
    }
  }
}
