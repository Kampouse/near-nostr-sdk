import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { NostrCore } from "../nostr-core/core.js";
import type { NostrEvent, NostrFilter } from "../nostr-core/types.js";
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

// ── Tag builders ──

function buildTargetTags(target: NearNostrTarget, clientName: string): string[][] {
  const tags: string[][] = [];

  tags.push(["client", clientName]);
  tags.push(["near_target", `${target.type}:${target.id}`]);
  tags.push(["t", target.type]);
  tags.push(["t", "nearbuilders"]);

  if (target.url) {
    tags.push(["r", target.url]);
  }

  return tags;
}

function targetFilterTags(target: NearNostrTarget): NostrFilter {
  // Some relays reject unknown custom tags in filters.
  // Use standard tags for relay query, filter near_target client-side.
  return {
    kinds: [1],
    "#t": [target.type, "nearbuilders"],
    limit: 100,
  };
}

// ── NearNostr ──

export class NearNostr {
  readonly core: NostrCore;
  readonly config: Required<Pick<NearNostrConfig, "relays" | "kvApiUrl" | "nearRpc" | "bindingContract" | "clientName">>;

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

  // ── Comments ──

  async createComment(opts: {
    target: NearNostrTarget;
    content: string;
    nearAccountId: string;
    nostrSecretKey: Uint8Array;
    parentEventId?: string;
    relays?: string[];
  }): Promise<NostrEvent> {
    const tags = buildTargetTags(opts.target, this.config.clientName);

    if (opts.parentEventId) {
      tags.push(["e", opts.parentEventId, "", "reply"]);
    }

    const pubkey = getPublicKey(opts.nostrSecretKey);
    tags.push(["p", pubkey]);
    tags.push(["near_account", opts.nearAccountId]);

    const template = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: opts.content,
    };

    const event = finalizeEvent(template as any, opts.nostrSecretKey);

    await this.core.publishEvent({ event: event as unknown as NostrEvent, relays: opts.relays ?? this.config.relays });

    return event as unknown as NostrEvent;
  }

  async listComments(opts: {
    target: NearNostrTarget;
    limit?: number;
    until?: number;
    relays?: string[];
  }): Promise<NearNostrComment[]> {
    const filter = targetFilterTags(opts.target);
    if (opts.limit) filter.limit = opts.limit;
    if (opts.until) filter.until = opts.until;

    const events = await this.core.queryEvents({
      filters: filter,
      relays: opts.relays ?? this.config.relays,
    });

    const comments: NearNostrComment[] = [];
    const targetKey = `${opts.target.type}:${opts.target.id}`;
    for (const event of events) {
      // Client-side filter: match near_target tag
      const hasTarget = event.tags.some(
        (t) => t[0] === "near_target" && t[1] === targetKey,
      );
      if (!hasTarget) continue;

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

    // Sort newest first
    comments.sort((a, b) => b.createdAt - a.createdAt);

    return comments;
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
