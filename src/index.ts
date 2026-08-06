// ── nostr-core ──
export { NostrCore } from "./nostr-core/core.js";
export type { NostrEvent, UnsignedNostrEvent, NostrFilter, RelayMessage, ConnectionResult } from "./nostr-core/types.js";
export { Kind } from "./nostr-core/types.js";
export type { NostrSubscription } from "./nostr-core/core.js";
export { StandardAdapter } from "./nostr-core/adapters/standard.js";
export { BuzzAdapter } from "./nostr-core/adapters/buzz.js";
export type {
  RelayAdapter,
  RelayAdapterConfig,
  PublishResult,
  QueryResult,
  PublishAdapterOptions,
  QueryAdapterOptions,
  SubscribeAdapterOptions,
} from "./nostr-core/adapters/types.js";
export type { BuzzAdapterConfig } from "./nostr-core/adapters/buzz.js";

// ── signers ──
export type { NostrSigner, WindowNostr } from "./nostr-core/signers/types.js";
export { LocalSigner } from "./nostr-core/signers/local-signer.js";
export { ExtensionSigner } from "./nostr-core/signers/extension-signer.js";
export { detectNostrExtension, waitForNostrExtension } from "./nostr-core/signers/types.js";

// ── near-nostr ──
export { NearNostr } from "./near-nostr/core.js";
export type {
  NearNostrTarget,
  NearNostrTargetType,
  NearNostrBinding,
  NearNostrIdentity,
  NearNostrComment,
  NearNostrConfig,
} from "./near-nostr/types.js";
