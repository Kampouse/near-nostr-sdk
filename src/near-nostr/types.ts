// ── NEAR <> Nostr target types ──

export type NearNostrTargetType =
  | "builder"
  | "project"
  | "scope"
  | "submission"
  | "page";

export type NearNostrTarget = {
  type: NearNostrTargetType;
  id: string;
  url?: string;
};

// ── Binding: NEAR account → Nostr pubkey ──

export type NearNostrBinding = {
  nearAccountId: string;
  nostrPubkey: string;
  relay?: string;
  proof?: string;
  boundAt?: number;
};

// ── Identity ──

export type NearNostrIdentity = {
  nearAccountId: string;
  nostrPubkey: string;
  profile?: {
    name?: string;
    picture?: string;
    about?: string;
    nip05?: string;
    website?: string;
  };
  relay?: string;
};

// ── Comment ──

export type NearNostrComment = {
  eventId: string;
  pubkey: string;
  nearAccountId?: string;
  content: string;
  createdAt: number;
  parentId?: string;
  target: NearNostrTarget;
  profile?: {
    name?: string;
    picture?: string;
  };
};

// ── Config ──

export type NearNostrConfig = {
  relays: string[];
  kvApiUrl?: string;
  nearRpc?: string;
  bindingContract?: string;
  clientName?: string; // e.g. "nearbuilders.org"
};
