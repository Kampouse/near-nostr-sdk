// ── Nostr Event (NIP-01) ──

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type UnsignedNostrEvent = Omit<NostrEvent, "id" | "sig">;

// ── Filters (NIP-01) ──

export type NostrFilter = {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  "#e"?: string[];
  "#p"?: string[];
  "#a"?: string[];
  "#d"?: string[];
  "#t"?: string[];
  "#r"?: string[];
  [key: `#${string}`]: string[] | undefined; // allow custom tags like #near_target
};

// ── Relay Messages (NIP-01) ──

export type RelayMessage =
  | ["EVENT", string, NostrEvent]      // subscription event
  | ["OK", string, boolean, string]   // publish ack
  | ["EOSE", string]                   // end of stored events
  | ["NOTICE", string];                // relay notice

// ── Common Kinds ──

export const Kind = {
  METADATA: 0,        // NIP-01
  TEXT_NOTE: 1,        // NIP-01
  RELAY_LIST: 2,       // NIP-65
  CONTACT_LIST: 3,     // NIP-02
  DELETION: 5,         // NIP-09
  REACTION: 7,         // NIP-25
  CHANNEL_CREATE: 40,  // NIP-28
  CHANNEL_META: 41,    // NIP-28
  CHANNEL_MSG: 42,     // NIP-28
} as const;

// ── Connection ──

export type ConnectionResult = {
  ok: boolean;
  relay: string;
  message?: string;
};
