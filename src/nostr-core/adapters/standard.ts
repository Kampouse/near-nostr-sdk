import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent } from "nostr-tools/pure";
import type { NostrEvent, NostrFilter } from "../types.js";
import type { NostrSubscription } from "../core.js";
import type {
  RelayAdapter,
  PublishAdapterOptions,
  QueryAdapterOptions,
  SubscribeAdapterOptions,
  PublishResult,
} from "./types.js";

// ── StandardAdapter ──

// Publishes kind 1 (public notes) with custom near_target tags.
// Works with any standard Nostr relay (no auth required).

export class StandardAdapter implements RelayAdapter {
  readonly type = "standard" as const;
  readonly pool: SimplePool;

  constructor(
    public relays: string[] = ["wss://nos.lol", "wss://relay.damus.io", "wss://relay.primal.net"],
  ) {
    this.pool = new SimplePool();
  }

  async publish(opts: PublishAdapterOptions): Promise<PublishResult> {
    const tags = this.#buildTags(opts);
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: opts.content,
      },
      opts.secretKey,
    );

    const relays = opts.relays ?? this.relays;
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

  async query(opts: QueryAdapterOptions): Promise<{ events: NostrEvent[] }> {
    const relays = opts.relays ?? this.relays;
    const filter: NostrFilter = {
      kinds: [1],
      "#t": [opts.targetType, opts.clientName],
      limit: opts.limit ?? 100,
    };
    if (opts.until) filter.until = opts.until;
    if (opts.since) filter.since = opts.since;

    const events = await this.pool.querySync(relays, filter as any);
    // Client-side filter by near_target
    const filtered = events.filter((e: any) =>
      e.tags.some((t: string[]) => t[0] === "near_target" && t[1] === opts.target),
    );
    return { events: filtered as unknown as NostrEvent[] };
  }

  subscribe(opts: SubscribeAdapterOptions): NostrSubscription {
    const relays = opts.relays ?? this.relays;
    let closed = false;
    let eventCb: ((event: NostrEvent) => void) | null = null;
    let eoseCb: (() => void) | null = null;

    const closer = this.pool.subscribeMany(
      relays,
      [{ kinds: [1], "#t": [opts.targetType], limit: 100 }] as any,
      {
        onevent: (event: any) => {
          if (closed || !eventCb) return;
          // Client-side filter
          const hasTarget = event.tags.some(
            (t: string[]) => t[0] === "near_target" && t[1] === opts.target,
          );
          if (hasTarget) eventCb(event as unknown as NostrEvent);
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
    this.pool.close(this.relays);
  }

  #buildTags(opts: PublishAdapterOptions): string[][] {
    const tags: string[][] = [];
    tags.push(["client", opts.clientName]);
    tags.push(["near_target", opts.target]);
    tags.push(["t", opts.targetType]);
    tags.push(["t", opts.clientName]);
    tags.push(["p", opts.pubkey]);
    if (opts.nearAccountId) {
      tags.push(["near_account", opts.nearAccountId]);
    }
    if (opts.parentEventId) {
      tags.push(["e", opts.parentEventId, "", "reply"]);
    }
    if (opts.extraTags) {
      tags.push(...opts.extraTags);
    }
    return tags;
  }
}
