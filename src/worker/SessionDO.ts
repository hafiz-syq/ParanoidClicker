import { DurableObject } from 'cloudflare:workers';
import { FrameReject, parseFrame } from '../shared/limits';
import { isSid } from '../shared/ids';

export class SessionDO extends DurableObject<Env> {
  // Pola resmi Cloudflare: this.sql = ctx.storage.sql (basis data SQLite, bukan KV).
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS member (did TEXT PRIMARY KEY, joined_at INTEGER NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      ws.close(1003, 'spike accepts text frames only');
      return;
    }

    let frame: Record<string, unknown>;
    try {
      frame = parseFrame(message);
    } catch (e) {
      ws.send(JSON.stringify({ t: 'error', code: e instanceof FrameReject ? e.code : 'INTERNAL' }));
      return;
    }

    switch (frame.t) {
      case 'hello':
        return this.hello(ws, frame);
      case 'ping':
        return this.pong(ws, frame);
      default:
        ws.send(JSON.stringify({ t: 'error', code: 'PROTO' }));
    }
  }

  // Satu-satunya jalur tulis SQLite di spike ini: transisi keanggotaan, bukan heartbeat.
  private hello(ws: WebSocket, frame: Record<string, unknown>): void {
    const did = typeof frame.did === 'string' ? frame.did : '';
    const sid = typeof frame.sid === 'string' ? frame.sid : '';
    if (!isSid(sid) || did.length === 0 || did.length > 32) {
      ws.send(JSON.stringify({ t: 'error', code: 'PROTO' }));
      return;
    }
    const cursor = this.sql.exec(
      'INSERT OR REPLACE INTO member (did, joined_at) VALUES (?, ?)',
      did,
      Date.now()
    );
    ws.send(
      JSON.stringify({
        t: 'welcome',
        sid,
        did,
        serverNow: Date.now(),
        members: this.sql.exec('SELECT COUNT(*) AS n FROM member').one().n,
        rowsWritten: cursor.rowsWritten,
      })
    );
  }

  private pong(ws: WebSocket, frame: Record<string, unknown>): void {
    if (typeof frame.nonce !== 'number' || typeof frame.t1 !== 'number') {
      ws.send(JSON.stringify({ t: 'error', code: 'PROTO' }));
      return;
    }
    const t2 = Date.now();
    ws.send(JSON.stringify({ t: 'pong', nonce: frame.nonce, t1: frame.t1, t2, t3: Date.now() }));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(code, 'client closed');
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('websocket error', error);
    ws.close(1011, 'internal');
  }
}
