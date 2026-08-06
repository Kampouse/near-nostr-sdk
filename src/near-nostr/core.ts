import { getPublicKey, verifyEvent } from "nostr-tools/pure";
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

  /**
   * Generate a binding challenge for a NEAR account.
   * The client signs this as a kind 0 event (or any event with the challenge in content/tags).
   */
  createBindingChallenge(nearAccountId: string): { challenge: string; expiresAt: number } {
    const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 min
    const challenge = `bind:${nearAccountId}:${expiresAt}:${this.config.clientName}`;
    return { challenge, expiresAt };
  }

  /**
   * Verify a binding proof — a signed Nostr event containing the challenge.
   * Works with any signer (extension, nsec, NIP-46 remote).
   */
  verifyBindingEvent(event: {
    id: string;
    pubkey: string;
    content: string;
    tags: string[][];
    created_at: number;
    sig: string;
  }): { nearAccountId: string; expiresAt: number; clientName: string; nostrPubkey: string } {
    // Must be a valid signed event
    if (!verifyEvent(event as any)) {
      throw new Error("Invalid Nostr event signature");
    }

    // Extract challenge from tags
    const challengeTag = event.tags.find((t) => t[0] === "challenge");
    const challenge = challengeTag?.[1] ?? event.content;
    if (!challenge || !challenge.startsWith("bind:")) {
      throw new Error("No binding challenge found in event");
    }

    // Parse challenge
    const parts = challenge.split(":");
    if (parts.length !== 4 || parts[0] !== "bind") {
      throw new Error("Malformed binding challenge");
    }

    const expiresAt = parseInt(parts[2], 10);
    if (Math.floor(Date.now() / 1000) > expiresAt) {
      throw new Error("Binding challenge expired");
    }

    return {
      nearAccountId: parts[1],
      expiresAt,
      clientName: parts[3],
      nostrPubkey: event.pubkey,
    };
  }

  /**
   * Build a binding event template for a signer to sign.
   * Pass to `signer.signEvent(template)` — works with extension, nsec, or NIP-46.
   */
  buildBindingEventTemplate(opts: {
    nostrPubkey: string;
    challenge: string;
  }): { kind: number; created_at: number; tags: string[][]; content: string } {
    return {
      kind: 27235, // ephemeral binding event (won't be relayed)
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["challenge", opts.challenge],
        ["client", this.config.clientName],
      ],
      content: opts.challenge,
    };
  }

  /**
   * Build the FastNear KV write args for a binding.
   * Uses __fastdata_kv — no contract deploy needed, any account works as namespace.
   * The caller must sign + send the NEAR transaction via wallet.
   */
  buildBindingArgs(opts: {
    nearAccountId: string;
    nostrPubkey: string;
    proof: string;
    relay?: string;
  }): { contract: string; method: string; args: Record<string, unknown> } {
    return {
      contract: this.config.bindingContract,
      method: "__fastdata_kv",
      args: {
        [`nostr/${opts.nearAccountId}`]: JSON.stringify({
          npub: opts.nostrPubkey,
          relay: opts.relay ?? this.config.relays[0],
          proof: opts.proof,
          bound_at: Math.floor(Date.now() / 1000),
        }),
      },
    };
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
      targetUrl: opts.target.url,
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
    /** Filter to only show comments from users with a near_account tag (no KV check) */
    requireBound?: boolean;
    /** Filter to only show comments from users with verified KV binding (slower, bulletproof) */
    requireVerified?: boolean;
  }): Promise<NearNostrComment[]> {
    const adapter = this.getAdapter(opts.adapterType);
    const targetKey = `${opts.target.type}:${opts.target.id}`;

    // Fetch more if we'll be filtering out unbound
    const fetchLimit = (opts.requireBound || opts.requireVerified)
      ? (opts.limit ?? 50) * 3
      : opts.limit;

    const { events } = await adapter.query({
      target: targetKey,
      targetType: opts.target.type,
      clientName: this.config.clientName,
      limit: fetchLimit,
      until: opts.until,
      since: opts.since,
      relays: opts.relays,
    });

    let comments: NearNostrComment[] = [];
    for (const event of events) {
      const parentTag = event.tags.find(
        (t) => t[0] === "e" && t[3] === "reply",
      );
      const nearAccount = event.tags.find((t) => t[0] === "near_account")?.[1];

      // requireBound: skip comments without near_account tag
      if (opts.requireBound && !nearAccount) continue;

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

    // requireVerified: batch-check KV bindings
    if (opts.requireVerified) {
      const accounts = [...new Set(
        comments.filter((c) => c.nearAccountId).map((c) => c.nearAccountId!),
      )];
      const BATCH = 5;
      const verified = new Set<string>();
      for (let i = 0; i < accounts.length; i += BATCH) {
        const batch = accounts.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map((acc) => this.#fetchBinding(acc)),
        );
        results.forEach((r, idx) => {
          if (r.status === "fulfilled" && r.value) {
            verified.add(batch[idx]);
          }
        });
      }
      comments = comments.filter((c) => c.nearAccountId && verified.has(c.nearAccountId));
    }

    comments.sort((a, b) => b.createdAt - a.createdAt);
    return comments.slice(0, opts.limit);
  }

  /**
   * Batch-resolve Nostr kind 0 profiles for a list of comments.
   * Deduplicates pubkeys to avoid redundant relay queries.
   */
  async enrichComments(
    comments: NearNostrComment[],
  ): Promise<(NearNostrComment & { profile?: NearNostrIdentity["profile"] })[]> {
    // Deduplicate pubkeys
    const uniquePubkeys = [...new Set(comments.map((c) => c.pubkey))];
    const profileMap = new Map<string, NearNostrIdentity["profile"]>();

    // Batch fetch profiles in parallel (max 5 concurrent)
    const BATCH = 5;
    for (let i = 0; i < uniquePubkeys.length; i += BATCH) {
      const batch = uniquePubkeys.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map((pk) => this.#fetchProfile(pk)),
      );
      results.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value) {
          profileMap.set(batch[idx], r.value);
        }
      });
    }

    return comments.map((c) => ({
      ...c,
      profile: profileMap.get(c.pubkey),
    }));
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
        `${this.config.kvApiUrl}/v0/latest/${this.config.bindingContract}/${nearAccountId}/nostr/${nearAccountId}`,
      );
      if (!res.ok || res.status === 404) return null;
      const data = await res.json();
      const entry = data?.entries?.[0];
      if (!entry?.value) return null;
      const parsed =
        typeof entry.value === "string"
          ? JSON.parse(entry.value)
          : entry.value;
      return {
        nearAccountId,
        nostrPubkey: parsed.npub ?? parsed.value?.npub,
        relay: parsed.relay ?? parsed.value?.relay,
        proof: parsed.proof ?? parsed.value?.proof,
        boundAt: parsed.bound_at ?? parsed.value?.bound_at,
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
