import type { NostrEvent, NostrFilter } from "../types.js";
import type { NostrSubscription } from "../core.js";

// ── Adapter types ──

export type RelayAdapterConfig = {
  type: "standard" | "buzz";
  relays: string[];
};

export type PublishResult = {
  event: NostrEvent;
  statuses: Map<string, boolean>;
};

export type QueryResult = {
  events: NostrEvent[];
};

// ── Adapter interface ──

export interface RelayAdapter {
  readonly type: "standard" | "buzz";

  /** Sign and publish an event. Adapter translates to the right kind/tags. */
  publish(opts: PublishAdapterOptions): Promise<PublishResult>;

  /** Publish a pre-signed event (signed client-side by extension/nsec). */
  publishSigned(event: NostrEvent, relays?: string[]): Promise<PublishResult>;

  /** Query events. Adapter translates filters to relay-specific shape. */
  query(opts: QueryAdapterOptions): Promise<QueryResult>;

  /** Subscribe to events. */
  subscribe(opts: SubscribeAdapterOptions): NostrSubscription;

  /** Close relay connections. */
  close(): void;
}

export type PublishAdapterOptions = {
  content: string;
  target: string;
  targetType: string;
  clientName: string;
  pubkey: string;
  secretKey: Uint8Array;
  parentEventId?: string;
  nearAccountId?: string;
  targetUrl?: string;     // include as "r" tag
  extraTags?: string[][];
  relays?: string[];
};

export type QueryAdapterOptions = {
  target: string;
  targetType: string;
  clientName: string;
  limit?: number;
  until?: number;
  since?: number;
  relays?: string[];
};

export type SubscribeAdapterOptions = {
  target: string;
  targetType: string;
  clientName: string;
  relays?: string[];
};
