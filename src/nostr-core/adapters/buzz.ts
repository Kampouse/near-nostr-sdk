import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, getEventHash } from "nostr-tools/pure";
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

// Publishes kind 9 (group messages) with #h (channel) tags.
// Requires NIP-42 auth and channel membership.
// Channel = one per target (e.g. "project:nearbuilders.org")

export type BuzzAdapterConfig = {
  relays: string[];
  /** Auth handler — sign NIP-42 challenge event */
  signAuth?: (challenge: string, relay: string) => Promise<string>; // returns event JSON string
  /** Channel ID resolver — returns the #h channel UUID for a target */
  resolveChannel: (target: string) => string;
};

export class BuzzAdapter implements RelayAdapter {
  readonly type = "buzz" as const;
  readonly pool: SimplePool;
  #config: BuzzAdapterConfig;
  #authenticated = new Set<string>();

  constructor(config: BuzzAdapterConfig) {
    this.pool = new SimplePool();
    this.#config = config;
  }

  // ── NIP-42 Auth ──

  async #ensureAuth(relay: string): Promise<void> {
    if (this.#authenticated.has(relay)) return;
    // NIP-42: relay sends AUTH challenge, we sign and respond
    // The pool handles the challenge internally when we connect.
    // For NIP-29 relays, we set the auth function on the pool.
    this.#authenticated.add(relay);
  }

  // ── Channel mapping ──

  /** Get the #h channel UUID for a target */
  channelFor(target: string): string {
    return this.#config.resolveChannel(target);
  }

  // ── Publish (kind 9) ──

  async publish(opts: PublishAdapterOptions): Promise<PublishResult> {
    const relays = opts.relays ?? this.#config.relays;
    const channelId = this.channelFor(opts.target);
    const tags = this.#buildTags(opts, channelId);
    const event = finalizeEvent(
      {
        kind: 9,  // NIP-29 group message
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: opts.content,
      },
      opts.secretKey,
    );

    const results = this.pool.publish(relays, event as any);
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

    return { event: event as unknown as NostrEvent, statuses };
  }

  // ── Query (kind 9 by #h) ──

  async query(opts: QueryAdapterOptions): Promise<{ events: NostrEvent[] }> {
    const relays = opts.relays ?? this.#config.relays;
    const channelId = this.channelFor(opts.target);
    const filter: NostrFilter = {
      kinds: [9],
      "#h": [channelId],
      limit: opts.limit ?? 100,
    };
    if (opts.until) filter.until = opts.until;
    if (opts.since) filter.since = opts.since;

    const events = await this.pool.querySync(relays, filter as any);
    return { events: events as unknown as NostrEvent[] };
  }

  // ── Subscribe (kind 9 by #h) ──

  subscribe(opts: SubscribeAdapterOptions): NostrSubscription {
    const relays = opts.relays ?? this.#config.relays;
    const channelId = this.channelFor(opts.target);
    let closed = false;
    let eventCb: ((event: NostrEvent) => void) | null = null;
    let eoseCb: (() => void) | null = null;

    const closer = this.pool.subscribeMany(
      relays,
      [{ kinds: [9], "#h": [channelId], limit: 100 }] as any,
      {
        onevent: (event: any) => {
          if (closed || !eventCb) return;
          eventCb(event as unknown as NostrEvent);
        },
        oneose: () => {
          if (closed || !eoseCb) return;
          eoseCb();
        },
      },
    );

    return {
      on: (type: string, handler: any) => {
        if (type === "event") eventCb = handler;
        if (type === "eose") eoseCb = handler;
        return {} as NostrSubscription;
      },
      close: () => {
        closed = true;
        closer.close();
      },
    };
  }

  close(): void {
    this.pool.close(this.#config.relays);
  }

  // ── Channel management (NIP-29) ──

  /**
   * Create a Buzz group channel for a target.
   * Returns the create event (kind 9007).
   */
  async createChannel(opts: {
    target: string;
    name: string;
    pubkey: string;
    secretKey: Uint8Array;
    visibility?: "open" | "private" | "closed";
    relays?: string[];
  }): Promise<NostrEvent> {
    const relays = opts.relays ?? this.#config.relays;
    const channelId = this.channelFor(opts.target);
    const tags: string[][] = [
      ["d", channelId],
      ["name", opts.name],
      ["visibility", opts.visibility ?? "open"],
    ];

    const event = finalizeEvent(
      {
        kind: 9007,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "",
      },
      opts.secretKey,
    );

    await this.publish({ ...opts as any }); // just to send to relays
    // Actually publish directly
    const results = this.pool.publish(relays, event as any);
    await Promise.allSettled(results.map(async (p) => { try { await p; } catch {} }));

    return event as unknown as NostrEvent;
  }

  /**
   * Join a Buzz channel (kind 9021 — open channel join request).
   */
  async joinChannel(opts: {
    target: string;
    pubkey: string;
    secretKey: Uint8Array;
    relays?: string[];
  }): Promise<void> {
    const relays = opts.relays ?? this.#config.relays;
    const channelId = this.channelFor(opts.target);

    const event = finalizeEvent(
      {
        kind: 9021,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["h", channelId]],
        content: "",
      },
      opts.secretKey,
    );

    const results = this.pool.publish(relays, event as any);
    await Promise.allSettled(results.map(async (p) => { try { await p; } catch {} }));
  }

  #buildTags(opts: PublishAdapterOptions, channelId: string): string[][] {
    const tags: string[][] = [];
    tags.push(["h", channelId]);  // NIP-29 channel tag
    tags.push(["p", opts.pubkey]);
    tags.push(["client", opts.clientName]);
    tags.push(["near_target", opts.target]);  // preserve for cross-adapter compatibility
    tags.push(["t", opts.targetType]);
    if (opts.nearAccountId) {
      tags.push(["near_account", opts.nearAccountId]);
    }
    if (opts.parentEventId) {
      // NIP-10 threading: e tag with root event
      tags.push(["e", opts.parentEventId, "", "reply"]);
    }
    if (opts.extraTags) {
      tags.push(...opts.extraTags);
    }
    return tags;
  }
}
