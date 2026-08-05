import WebSocket from "ws";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent, NostrFilter } from "../types.js";
import type { NostrSubscription } from "../core.js";
import type {
  RelayAdapter,
  PublishAdapterOptions,
  QueryAdapterOptions,
  SubscribeAdapterOptions,
  PublishResult,
} from "./types.js";

// ── BuzzAdapter (NIP-29) ──
// Raw WebSocket with NIP-42 auth. SimplePool doesn't support AUTH events.

export type BuzzAdapterConfig = {
  relays: string[];
  secretKey: Uint8Array;
  resolveChannel: (target: string) => string;
  connectTimeoutMs?: number;
  queryTimeoutMs?: number;
};

type ConnState = "disconnected" | "connecting" | "authing" | "connected" | "failed";

export class BuzzAdapter implements RelayAdapter {
  readonly type = "buzz" as const;
  readonly relays: string[];
  readonly secretKey: Uint8Array;
  readonly resolveChannel: (target: string) => string;
  readonly connectTimeoutMs: number;
  readonly queryTimeoutMs: number;
  readonly pubkey: string;

  #conns = new Map<string, WebSocket>();
  #states = new Map<string, ConnState>();
  #queries = new Map<string, { events: NostrEvent[]; eose: boolean; resolve: () => void }>();

  constructor(config: BuzzAdapterConfig) {
    this.relays = config.relays;
    this.secretKey = config.secretKey;
    this.resolveChannel = config.resolveChannel;
    this.connectTimeoutMs = config.connectTimeoutMs ?? 10_000;
    this.queryTimeoutMs = config.queryTimeoutMs ?? 8_000;
    this.pubkey = getPublicKey(config.secretKey);
  }

  channelFor(target: string): string {
    return this.resolveChannel(target);
  }

  // ── Connect + NIP-42 Auth ──

  async connect(relay?: string): Promise<string> {
    const url = relay ?? this.relays[0];
    if (!url) throw new Error("No relays configured");

    const state = this.#states.get(url);
    if (state === "connected" || state === "authing") {
      await this.#waitAuth(url);
      return url;
    }

    this.#states.set(url, "connecting");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#states.set(url, "failed");
        ws.close();
        reject(new Error(`Buzz connect timeout: ${url}`));
      }, this.connectTimeoutMs);

      const ws = new WebSocket(url);
      this.#conns.set(url, ws);

      ws.on("open", () => {
        this.#states.set(url, "authing");
      });

      ws.on("message", (raw: Buffer) => {
        this.#handle(url, ws, raw.toString());
      });

      ws.on("error", (err: Error) => {
        clearTimeout(timer);
        this.#states.set(url, "failed");
        reject(err);
      });

      ws.on("close", () => {
        clearTimeout(timer);
        this.#states.set(url, "disconnected");
      });

      this.#waitAuth(url).then(() => {
        clearTimeout(timer);
        resolve(url);
      }).catch(reject);
    });
  }

  async #ensureConnected(relay?: string): Promise<string> {
    const url = relay ?? this.relays[0];
    if (this.#states.get(url) === "connected") return url;
    return this.connect(url);
  }

  async #waitAuth(url: string): Promise<void> {
    if (this.#states.get(url) === "connected") return;
    if (this.#states.get(url) === "failed") throw new Error(`Connection failed: ${url}`);
    return new Promise((resolve, reject) => {
      const iv = setInterval(() => {
        const s = this.#states.get(url);
        if (s === "connected") { clearInterval(iv); resolve(); }
        if (s === "failed") { clearInterval(iv); reject(new Error(`Auth failed: ${url}`)); }
      }, 50);
      setTimeout(() => { clearInterval(iv); reject(new Error("Auth timeout")); }, this.connectTimeoutMs);
    });
  }

  // ── Message handling ──

  #handle(relay: string, ws: WebSocket, raw: string): void {
    let msg: unknown[];
    try { msg = JSON.parse(raw); } catch { return; }
    const t = msg[0] as string;

    // AUTH challenge → sign + respond
    if (t === "AUTH") {
      const challenge = msg[1] as string;
      const evt = finalizeEvent(
        { kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", relay], ["challenge", challenge]], content: "" },
        this.secretKey,
      );
      ws.send(JSON.stringify(["AUTH", evt]));
      return;
    }

    // OK → track auth success
    if (t === "OK") {
      if (msg[2] === true && this.#states.get(relay) === "authing") {
        this.#states.set(relay, "connected");
      }
      return;
    }

    // EVENT → route to pending query
    if (t === "EVENT") {
      const subId = msg[1] as string;
      const q = this.#queries.get(subId);
      if (q && !q.eose) q.events.push(msg[2] as unknown as NostrEvent);
      return;
    }

    // EOSE → resolve query
    if (t === "EOSE") {
      const subId = msg[1] as string;
      const q = this.#queries.get(subId);
      if (q) { q.eose = true; q.resolve(); }
      return;
    }
    // NOTICE, CLOSED — silently ignore
  }

  #send(relay: string, msg: unknown[]): void {
    const ws = this.#conns.get(relay);
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error(`Not connected: ${relay}`);
    ws.send(JSON.stringify(msg));
  }

  // ── RelayAdapter ──

  async publish(opts: PublishAdapterOptions): Promise<PublishResult> {
    const relays = opts.relays ?? this.relays;
    const channelId = this.channelFor(opts.target);
    const tags: string[][] = [
      ["h", channelId],                             // NIP-29 channel ref
      // Standard tags (relay-filterable)
      ["t", opts.targetType],                       // topic
      ["p", opts.pubkey],                           // pubkey ref: author
      ["client", opts.clientName],
    ];
    if (opts.nearAccountId) {
      tags.push(["p", `_near:${opts.nearAccountId}`]); // pubkey ref: NEAR account
    }
    if (opts.parentEventId) {
      tags.push(["e", opts.parentEventId, "", "reply"]); // event ref: parent thread
    }
    if (opts.targetUrl) {
      tags.push(["r", opts.targetUrl]);                   // URL ref
    }
    // App-specific tags
    tags.push(["near_target", opts.target]);
    if (opts.nearAccountId) tags.push(["near_account", opts.nearAccountId]);
    if (opts.extraTags) tags.push(...opts.extraTags);

    const event = finalizeEvent(
      { kind: 9, created_at: Math.floor(Date.now() / 1000), tags, content: opts.content },
      opts.secretKey,
    );

    const statuses = new Map<string, boolean>();
    await Promise.allSettled(
      relays.map(async (r: string) => {
        try {
          await this.#ensureConnected(r);
          this.#send(r, ["EVENT", event]);
          statuses.set(r, true);
        } catch {
          statuses.set(r, false);
        }
      }),
    );

    return { event: event as unknown as NostrEvent, statuses };
  }

  async publishSigned(event: NostrEvent, relays?: string[]): Promise<PublishResult> {
    const relayList = relays ?? this.relays;
    const statuses = new Map<string, boolean>();
    await Promise.allSettled(
      relayList.map(async (r: string) => {
        try {
          await this.#ensureConnected(r);
          this.#send(r, ["EVENT", event]);
          statuses.set(r, true);
        } catch {
          statuses.set(r, false);
        }
      }),
    );
    return { event, statuses };
  }

  async query(opts: QueryAdapterOptions): Promise<{ events: NostrEvent[] }> {
    const relays = opts.relays ?? this.relays;
    const channelId = this.channelFor(opts.target);
    const allEvents: NostrEvent[] = [];

    await Promise.allSettled(
      relays.map(async (r: string) => {
        try {
          await this.#ensureConnected(r);
        } catch { return; }

        const subId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const filter: Record<string, unknown> = { kinds: [9], "#h": [channelId], limit: opts.limit ?? 100 };
        if (opts.until) filter.until = opts.until;
        if (opts.since) filter.since = opts.since;

        return new Promise<void>((resolve) => {
          const q = { events: [] as NostrEvent[], eose: false, resolve };
          this.#queries.set(subId, q);

          const timer = setTimeout(() => {
            if (!q.eose) { q.eose = true; allEvents.push(...q.events); this.#queries.delete(subId); resolve(); }
          }, this.queryTimeoutMs);

          const origResolve = q.resolve;
          q.resolve = () => { clearTimeout(timer); allEvents.push(...q.events); this.#queries.delete(subId); origResolve(); };

          this.#send(r, ["REQ", subId, filter]);
        });
      }),
    );

    return { events: allEvents };
  }

  subscribe(opts: SubscribeAdapterOptions): NostrSubscription {
    const relays = opts.relays ?? this.relays;
    const channelId = this.channelFor(opts.target);
    const subId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let closed = false;
    let eventCb: ((event: NostrEvent) => void) | null = null;
    let eoseCb: (() => void) | null = null;
    const wsList: WebSocket[] = [];

    const setup = async () => {
      for (const r of relays) {
        try {
          await this.#ensureConnected(r);
          const ws = this.#conns.get(r);
          if (!ws) continue;
          wsList.push(ws);

          ws.on("message", (raw: Buffer) => {
            let msg: unknown[];
            try { msg = JSON.parse(raw.toString()); } catch { return; }
            if (msg[0] === "EVENT" && msg[1] === subId) {
              if (!closed && eventCb) eventCb(msg[2] as unknown as NostrEvent);
              return;
            }
            if (msg[0] === "EOSE" && msg[1] === subId) {
              if (!closed && eoseCb) eoseCb();
              return;
            }
            // Pass other messages to the main handler
            this.#handle(r, ws, raw.toString());
          });

          this.#send(r, ["REQ", subId, { kinds: [9], "#h": [channelId], limit: 100 }]);
        } catch { /* skip */ }
      }
    };

    setup();

    return {
      on: (type: string, handler: unknown) => {
        if (type === "event") eventCb = handler as (event: NostrEvent) => void;
        if (type === "eose") eoseCb = handler as () => void;
        return {} as NostrSubscription;
      },
      close: () => {
        closed = true;
        for (let i = 0; i < wsList.length; i++) {
          try { this.#send(relays[i], ["CLOSE", subId]); } catch { /* ignore */ }
        }
      },
    };
  }

  // ── Channel management (NIP-29) ──

  async listChannels(relays?: string[]): Promise<NostrEvent[]> {
    const relayList = relays ?? this.relays;
    const allEvents: NostrEvent[] = [];

    await Promise.allSettled(
      relayList.map(async (r: string) => {
        try {
          await this.#ensureConnected(r);
        } catch { return; }

        const subId = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        return new Promise<void>((resolve) => {
          const q = { events: [] as NostrEvent[], eose: false, resolve };
          this.#queries.set(subId, q);

          const timer = setTimeout(() => {
            if (!q.eose) { q.eose = true; allEvents.push(...q.events); this.#queries.delete(subId); resolve(); }
          }, 5_000);

          const origResolve = q.resolve;
          q.resolve = () => { clearTimeout(timer); allEvents.push(...q.events); this.#queries.delete(subId); origResolve(); };

          this.#send(r, ["REQ", subId, { kinds: [9007], limit: 100 }]);
        });
      }),
    );

    return allEvents;
  }

  async createChannel(opts: {
    target: string;
    name: string;
    visibility?: "open" | "private" | "closed";
    relays?: string[];
  }): Promise<NostrEvent> {
    const relays = opts.relays ?? this.relays;
    const channelId = this.channelFor(opts.target);
    const event = finalizeEvent(
      {
        kind: 9007,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", channelId], ["name", opts.name], ["visibility", opts.visibility ?? "open"]],
        content: "",
      },
      this.secretKey,
    );

    await Promise.allSettled(
      relays.map(async (r: string) => {
        try { await this.#ensureConnected(r); this.#send(r, ["EVENT", event]); } catch { /* skip */ }
      }),
    );

    return event as unknown as NostrEvent;
  }

  async joinChannel(opts: { target: string; relays?: string[] }): Promise<void> {
    const relays = opts.relays ?? this.relays;
    const channelId = this.channelFor(opts.target);
    const event = finalizeEvent(
      { kind: 9021, created_at: Math.floor(Date.now() / 1000), tags: [["h", channelId]], content: "" },
      this.secretKey,
    );

    await Promise.allSettled(
      relays.map(async (r: string) => {
        try { await this.#ensureConnected(r); this.#send(r, ["EVENT", event]); } catch { /* skip */ }
      }),
    );
  }

  close(): void {
    for (const [url, ws] of this.#conns) {
      try { ws.close(); } catch { /* ignore */ }
      this.#states.set(url, "disconnected");
    }
    this.#conns.clear();
  }
}
