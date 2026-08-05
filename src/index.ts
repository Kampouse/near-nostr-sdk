export { NostrCore } from "./nostr-core/core.js";
export { NearNostr } from "./near-nostr/core.js";

export type { NostrEvent, UnsignedNostrEvent, NostrFilter, RelayMessage, ConnectionResult } from "./nostr-core/types.js";
export { Kind } from "./nostr-core/types.js";

export type {
  NearNostrTarget,
  NearNostrTargetType,
  NearNostrBinding,
  NearNostrIdentity,
  NearNostrComment,
  NearNostrConfig,
} from "./near-nostr/types.js";
