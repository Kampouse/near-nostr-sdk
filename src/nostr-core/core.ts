import {
  SimplePool,
} from "nostr-tools/pool";
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from "nostr-tools/pure";
import type {
  NostrEvent,
  UnsignedNostrEvent,
  NostrFilter,
  RelayMessage,
  ConnectionResult,
} from "./types.js";

export type { NostrEvent, UnsignedNostrEvent, NostrFilter, RelayMessage, ConnectionResult } from "./types.js";
export { Kind } from "./types.js";

// ── Config ──

export type NostrCoreConfig = {
  relays: string[];
};

export type PublishOptions = {
  event: NostrEvent;
  relays?: string[];
  timeoutMs?: number;
};

export type QueryOptions = {
  filters: NostrFilter | NostrFilter[];
  relays?: string[];
  timeoutMs?: number;
};

export type SubscribeOptions = {
  filters: NostrFilter | NostrFilter[];
  relays?: string[];
};

// ── NostrCore ──

export class NostrCore {
  #relays: string[];
  readonly pool: SimplePool;

  constructor(config: NostrCoreConfig) {
    this.#relays = config.relays;
    this.pool = new SimplePool();
  }

  /** Close all relay connections. Call when done using this instance. */
  close(): void {
    this.pool.close(this.#relays);
  }

  get relays(): string[] {
    return this.#relays;
  }

  // ── Key generation ──

  static generateKeys(): { secretKey: Uint8Array; publicKey: string } {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    return { secretKey: sk, publicKey: pk };
  }

  // ── Publish ──

  async publishEvent(opts: PublishOptions): Promise<Map<string, boolean>> {
    const relays = opts.relays ?? this.#relays;
    const results = this.pool.publish(relays, opts.event as any);
    const statuses = new Map<string, boolean>();
    await Promise.allSettled(
      results.map(async (p, i) => {
        try {
          await p;
          statuses.set(relays[i], true);
        } catch {
          statuses.set(relays[i], false);
        }
      }),
    );
    return statuses;
  }

  // ── Query ──

  async queryEvents(opts: QueryOptions): Promise<NostrEvent[]> {
    const relays = opts.relays ?? this.#relays;
    const events = await this.pool.querySync(
      relays,
      opts.filters as any,
    );
    return events as unknown as NostrEvent[];
  }

  // ── Subscribe ──

  subscribe(opts: SubscribeOptions): NostrSubscription {
    const relays = opts.relays ?? this.#relays;
    let closed = false;

    const closer = this.pool.subscribeMany(
      relays,
      [opts.filters] as any,
      {
        onevent: (event: any) => {
          if (!closed && eventCb) eventCb(event as unknown as NostrEvent);
        },
        oneose: () => {
          if (!closed && eoseCb) eoseCb();
        },
      },
    );

    let eventCb: ((event: NostrEvent) => void) | null = null;
    let eoseCb: (() => void) | null = null;

    return {
      on<K extends "event" | "eose">(
        type: K,
        handler: K extends "event" ? (event: NostrEvent) => void : () => void,
      ): NostrSubscription {
        if (type === "event") eventCb = handler as any;
        if (type === "eose") eoseCb = handler as any;
        return this;
      },
      close: () => {
        closed = true;
        closer.close();
      },
    };
  }
}

// ── Subscription wrapper ──

export interface NostrSubscription {
  on<K extends "event" | "eose">(
    type: K,
    handler: K extends "event" ? (event: NostrEvent) => void : () => void,
  ): NostrSubscription;
  close(): void;
}
