import { getPublicKey } from "nostr-tools/pure";
import { NostrCore } from "../nostr-core/core.js";
import type { NostrEvent, NostrFilter } from "../nostr-core/types.js";
import type { RelayAdapter, PublishAdapterOptions, QueryAdapterOptions, SubscribeAdapterOptions } from "../nostr-core/adapters/types.js";
import type {
  NearNostrConfig,
  NearNostrTarget,
  NearNostrBinding,
  NearNostrIdentity,
  NearNostrComment,
} from "./types.js";

export type { NearNostrConfig, NearNostrTarget, NearNostrBinding, NearNostrIdentity, NearNostrComment } from "./types.js";

// ── Defaults ──

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

const DEFAULT_KV_API = "https://kv.main.fastnear.com";

// ── NearNostr ──

export class NearNostr {
  readonly core: NostrCore;
  readonly config: Required<Pick<NearNostrConfig, "relays" | "kvApiUrl" | "nearRpc" | "bindingContract" | "clientName">>;
  readonly adapters: Map<string, RelayAdapter>;

  constructor(config?: NearNostrConfig) {
    const relays = config?.relays ?? DEFAULT_RELAYS;
    this.core = new NostrCore({ relays });
    this.config = {
      relays,
      kvApiUrl: config?.kvApiUrl ?? DEFAULT_KV_API,
      nearRpc: config?.nearRpc ?? "https://rpc.mainnet.near.org",
      bindingContract: config?.bindingContract ?? "contextual.near",
      clientName: config?.clientName ?? "near-nostr-sdk",
    };
    this.adapters = new Map();
  }

  // ── Adapter management ──

  /** Register a relay adapter (standard, buzz, custom) */
  useAdapter(adapter: RelayAdapter): this {
    this.adapters.set(adapter.type, adapter);
    return this;
  }

  /** Get adapter by type, falls back to first registered or creates default StandardAdapter */
  getAdapter(type?: "standard" | "buzz"): RelayAdapter {
    if (type && this.adapters.has(type)) {
      return this.adapters.get(type)!;
    }
    // Default: create a StandardAdapter on the fly using the core pool
    // (lazy — avoids creating a pool until needed)
    if (this.adapters.size > 0) {
      return this.adapters.values().next().value!;
    }
    throw new Error("No adapter registered. Call .useAdapter() first.");
  }

  // ── Identity: link NEAR account → Nostr pubkey ──

  async linkAccountWithSigner(opts: {
    nearAccountId: string;
    nostrPubkey: string;
    proof: string;
    relay?: string;
    signAndSend: (args: { contract: string; method: string; args: Record<string, string> }) => Promise<string>;
  }): Promise<string> {
    const txHash = await opts.signAndSend({
      contract: this.config.bindingContract,
      method: "set",
      args: {
        key: `nostr/${opts.nearAccountId}`,
        value: JSON.stringify({
          npub: opts.nostrPubkey,
          relay: opts.relay ?? this.config.relays[0],
          proof: opts.proof,
          bound_at: Math.floor(Date.now() / 1000),
        }),
      },
    });
    return txHash;
  }

  // ── Identity: resolve Nostr pubkey from NEAR account ──

  async getIdentity(nearAccountId: string): Promise<NearNostrIdentity | null> {
    const binding = await this.#fetchBinding(nearAccountId);
    if (!binding) return null;

    const profile = await this.#fetchProfile(binding.nostrPubkey);

    return {
      nearAccountId,
      nostrPubkey: binding.nostrPubkey,
      profile,
      relay: binding.relay,
    };
  }

  // ── Comments (adapter-aware) ──

  /**
   * Create a comment on a target via the specified adapter.
   * If adapterType is not specified, uses the first registered adapter.
   */
  async createComment(opts: {
    target: NearNostrTarget;
    content: string;
    nearAccountId: string;
    nostrSecretKey: Uint8Array;
    parentEventId?: string;
    relays?: string[];
    adapterType?: "standard" | "buzz";
  }): Promise<NostrEvent> {
    const adapter = this.getAdapter(opts.adapterType);
    const targetKey = `${opts.target.type}:${opts.target.id}`;
    const pubkey = getPublicKey(opts.nostrSecretKey);

    const result = await adapter.publish({
      content: opts.content,
      target: targetKey,
      targetType: opts.target.type,
      clientName: this.config.clientName,
      pubkey,
      secretKey: opts.nostrSecretKey,
      parentEventId: opts.parentEventId,
      nearAccountId: opts.nearAccountId,
      relays: opts.relays,
    });

    return result.event;
  }

  /**
   * List comments on a target via the specified adapter.
   */
  async listComments(opts: {
    target: NearNostrTarget;
    limit?: number;
    until?: number;
    since?: number;
    relays?: string[];
    adapterType?: "standard" | "buzz";
  }): Promise<NearNostrComment[]> {
    const adapter = this.getAdapter(opts.adapterType);
    const targetKey = `${opts.target.type}:${opts.target.id}`;

    const { events } = await adapter.query({
      target: targetKey,
      targetType: opts.target.type,
      clientName: this.config.clientName,
      limit: opts.limit,
      until: opts.until,
      since: opts.since,
      relays: opts.relays,
    });

    const comments: NearNostrComment[] = [];
    for (const event of events) {
      const parentTag = event.tags.find(
        (t) => t[0] === "e" && t[3] === "reply",
      );
      const nearAccount = event.tags.find((t) => t[0] === "near_account")?.[1];

      comments.push({
        eventId: event.id,
        pubkey: event.pubkey,
        nearAccountId: nearAccount,
        content: event.content,
        createdAt: event.created_at,
        parentId: parentTag?.[1],
        target: opts.target,
      });
    }

    comments.sort((a, b) => b.createdAt - a.createdAt);
    return comments;
  }

  /**
   * Subscribe to comments on a target.
   */
  subscribeComments(opts: {
    target: NearNostrTarget;
    relays?: string[];
    adapterType?: "standard" | "buzz";
  }): import("../nostr-core/core.js").NostrSubscription {
    const adapter = this.getAdapter(opts.adapterType);
    const targetKey = `${opts.target.type}:${opts.target.id}`;

    return adapter.subscribe({
      target: targetKey,
      targetType: opts.target.type,
      clientName: this.config.clientName,
      relays: opts.relays,
    });
  }

  // ── Internal: fetch binding from FastNear KV ──

  async #fetchBinding(nearAccountId: string): Promise<NearNostrBinding | null> {
    try {
      const res = await fetch(
        `${this.config.kvApiUrl}/v1/account/${this.config.bindingContract}/nostr/${nearAccountId}`,
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.value) return null;
      const parsed = JSON.parse(data.value);
      return {
        nearAccountId,
        nostrPubkey: parsed.npub,
        relay: parsed.relay,
        proof: parsed.proof,
        boundAt: parsed.bound_at,
      };
    } catch {
      return null;
    }
  }

  // ── Internal: fetch Nostr profile (kind 0) ──

  async #fetchProfile(pubkey: string): Promise<NearNostrIdentity["profile"]> {
    try {
      const events = await this.core.queryEvents({
        filters: { kinds: [0], authors: [pubkey], limit: 1 },
      });
      if (events.length === 0) return undefined;
      return JSON.parse(events[0].content);
    } catch {
      return undefined;
    }
  }
}
