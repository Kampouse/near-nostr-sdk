# near-nostr-sdk

NEAR <> Nostr integration SDK — comments, feeds, and messaging backed by public relays.

Two layers:

- **`nostr-core`** — protocol-agnostic Nostr relay wrapper. Publish, query, subscribe. No NEAR assumptions.
- **`near-nostr`** — NEAR opinionated layer. Account linking, comments, threads, feeds.

## Install

```bash
npm install near-nostr-sdk
```

## nostr-core

```ts
import { NostrCore } from "near-nostr-sdk/nostr-core";

const core = new NostrCore({
  relays: ["wss://relay.damus.io", "wss://nos.lol"],
});

// Publish a signed event
await core.publishEvent({ event, relays: ["wss://relay.damus.io"] });

// Query events
const events = await core.queryEvents({
  filters: { kinds: [1], "#t": ["nearbuilders"] },
  relays: ["wss://relay.damus.io"],
  timeoutMs: 5000,
});

// Real-time subscription
const sub = core.subscribe({
  filters: { kinds: [1], authors: [pubkey] },
  relays: ["wss://relay.damus.io"],
});
sub.on("event", (event) => console.log(event));
sub.close();
```

## near-nostr

```ts
import { NearNostr } from "near-nostr-sdk/near-nostr";

const nn = new NearNostr({
  relays: ["wss://relay.damus.io"],
  kvApiUrl: "https://kv.main.fastnear.com",
  nearRpc: "https://rpc.mainnet.near.org",
});

// Link NEAR account to Nostr pubkey
await nn.linkAccount({
  nearAccountId: "elliot.near",
  nostrPubkey: "npub1...",
  proof: signedEvent,
});

// Create a comment on a target
await nn.createComment({
  target: { type: "project", id: "near-ai-agent-market" },
  content: "Looking forward to this!",
  nearAccountId: "elliot.near",
  relays: ["wss://relay.damus.io"],
});

// List comments on a target
const comments = await nn.listComments({
  target: { type: "project", id: "near-ai-agent-market" },
  limit: 20,
});
```

## License

MIT
