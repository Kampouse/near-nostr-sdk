# near-nostr-sdk

Nostr integration SDK for NEAR apps. Post comments, link identities, and read from any Nostr relay.

## Install

```bash
npm install near-nostr-sdk
```

## Core Concepts

**Two layers** exposed by the API:
- **`near-nostr`** — NEAR-native product actions: account linking, comments, feeds, threads
- **`nostr-core`** — low-level relay access: raw queries, any-kind publish, subscriptions (for agents/custom clients)

**Adapters** abstract relay differences:
- **StandardAdapter** — kind 1 (public notes) on any open relay
- **BuzzAdapter** — kind 9 (NIP-29) on Buzz relay with NIP-42 auth

**Signers** abstract key management:
- **LocalSigner** — wraps a raw `nsec` (server-side or CLI)
- **ExtensionSigner** — delegates to `window.nostr` (nos2x, Alby, Amber)
- **`detectNostrExtension()`** — auto-detects browser extension

## Usage

### Post a comment (client-side signing)

```ts
import { NearNostr, StandardAdapter, ExtensionSigner, LocalSigner, detectNostrExtension } from "near-nostr-sdk";

const signer = detectNostrExtension()
  ? new ExtensionSigner()
  : new LocalSigner("nsec1...");

const nn = new NearNostr({
  clientName: "my-app",
  adapters: [
    new StandardAdapter(["wss://nos.lol", "wss://relay.damus.io"]),
  ],
});

// Build + sign + publish
const event = await nn.createComment({
  content: "Great project!",
  target: { type: "project", id: "123" },
  nearAccountId: "jemartel.near",
  nostrSecretKey: signerKey,
});
```

### Post a comment (extension — no server-side keys)

```ts
import { NostrCore, StandardAdapter, ExtensionSigner, finalizeEvent } from "near-nostr-sdk";
import { bytesToHex } from "@noble/hashes/utils";

const adapter = new StandardAdapter(["wss://nos.lol"]);
const signer = new ExtensionSigner();
const pubkey = await signer.getPublicKey();

// Build template
const template = {
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["t", "project"], ["t", "my-app"],
    ["p", pubkey], ["p", "_near:jemartel.near"],
    ["near_target", "project:123"], ["client", "my-app"],
  ],
  content: "Great project!",
};

// Sign with extension (triggers popup)
const signed = await signer.signEvent(template);

// Publish
await adapter.publishSigned(signed);
```

### List comments with profile enrichment

```ts
const comments = await nn.listComments({
  target: { type: "project", id: "123" },
  limit: 50,
});

// Batch-resolve profiles
const enriched = await nn.enrichComments(comments);
// enriched[0].profile = { name: "Jean", picture: "https://...", about: "..." }
```

### NEAR ↔ Nostr identity binding

```ts
// 1. Get challenge
const { challenge, expiresAt } = nn.createBindingChallenge("jemartel.near");

// 2. Build + sign binding event (client-side)
const template = nn.buildBindingEventTemplate({ nostrPubkey: pubkey, challenge });
const signedEvent = await signer.signEvent(template);

// 3. Server verifies the event
const result = nn.verifyBindingEvent(signedEvent);

// 4. Client stores binding via NEAR wallet (FastNear KV)
const txArgs = nn.buildBindingArgs({
  nearAccountId: result.nearAccountId,
  nostrPubkey: result.nastrPubkey,
  proof: JSON.stringify(result),
});
// wallet.signAndSend({ contract: "contextual.near", method: "__fastdata_kv", args: txArgs })

// 5. Read binding later
const identity = await nn.getIdentity("jemartel.near");
```

### Buzz relay (NIP-29)

```ts
import { BuzzAdapter } from "near-nostr-sdk";
import { createHash } from "crypto";

const buzz = new BuzzAdapter({
  relays: ["wss://nearbuilders.communities.buzz.xyz"],
  secretKey: nsecBytes, // for NIP-42 relay auth only
  resolveChannel: (target) => createHash("sha256").update(target).digest("hex").slice(0, 16),
});

// Query messages
const { events } = await buzz.query({ target: "my-channel", targetType: "general", clientName: "near-nostr-sdk" });

// List channels
const channels = await buzz.listChannels();
```

### Low-level relay access (nostr-core layer)

For agents, custom clients, or relay tooling:

```ts
import { StandardAdapter } from "near-nostr-sdk";

const adapter = new StandardAdapter(["wss://nos.lol", "wss://relay.damus.io"]);

// Raw query — any filter shape
const events = await adapter.queryRaw(
  { kinds: [1], "#t": ["project"], authors: ["abc..."], limit: 100 },
  ["wss://nos.lol"],
);

// Publish any pre-signed event (any kind)
await adapter.publishSigned(signedEvent);

// Fetch profile
const profile = await adapter.getProfile("abc123...");
// { pubkey, name, picture, about, nip05, website }
```

## Tag Convention

### Standard tags (relay-filterable)

| Tag | Value | Purpose |
|-----|-------|---------|
| `e` | `<event-id>`, `""`, `"reply"` | Reply to parent event (NIP-10) |
| `p` | `<pubkey>` | Event author pubkey |
| `p` | `_near:<account.near>` | NEAR account reference (namespaced) |
| `t` | `project`, `builder`, `scope` | Topic — target type |
| `t` | `<client-name>` | Topic — client attribution |
| `r` | `<url>` | URL reference (if target has a URL) |

### App-specific tags (client-side filtering)

| Tag | Value | Purpose |
|-----|-------|---------|
| `near_target` | `<type>:<id>` | e.g. `project:123` — app-level target ID |
| `near_account` | `<account.near>` | e.g. `jemartel.near` — raw account name |
| `client` | `<app-name>` | Client attribution |

> Standard tags come first in events. App-specific tags follow. Relays filter on standard tags (`#t`, `#p`, `#e`); `near_target` and `near_account` are filtered client-side.

## Event Structure

A comment event (kind 1 on standard, kind 9 on Buzz):

```json
{
  "id": "abc123...",
  "pubkey": "def456...",
  "created_at": 1722873600,
  "kind": 1,
  "tags": [
    ["t", "project"],
    ["t", "my-app"],
    ["p", "def456..."],
    ["p", "_near:jemartel.near"],
    ["near_target", "project:123"],
    ["near_account", "jemartel.near"],
    ["client", "my-app"]
  ],
  "content": "Great project!",
  "sig": "..."
}
```

A reply adds an `e` tag:

```json
"tags": [
  ["e", "parent-event-id", "", "reply"],
  ["t", "project"],
  ...
]
```

## Agent Integration

Agents can read the public relay stream to summarize activity, surface unanswered questions, or identify promising projects.

### Query comments by topic

```bash
curl -X POST https://api.nearbuilders.org/v1/nostr/query \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "kinds": [1],
      "tags": [{ "tag": "t", "values": ["project"] }],
      "limit": 50,
      "since": 1722800000
    }
  }'
```

### Query by NEAR account

```bash
curl -X POST https://api.nearbuilders.org/v1/nostr/query \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "kinds": [1],
      "tags": [{ "tag": "p", "values": ["_near:jemartel.near"] }]
    }
  }'
```

### Fetch profile for a pubkey

```bash
curl https://api.nearbuilders.org/v1/nostr/profile/def456...
```

### Publish an event

```bash
curl -X POST https://api.nearbuilders.org/v1/nostr/publish \
  -H "Content-Type: application/json" \
  -d '{
    "event": { ... },
    "relays": ["wss://nos.lol"]
  }'
```

### SDK agent example

```ts
import { NearNostr, StandardAdapter } from "near-nostr-sdk";

const nn = new NearNostr({
  clientName: "buzz-agent",
  adapters: [new StandardAdapter()],
});

// Get all project comments from last 24h
const comments = await nn.listComments({
  target: { type: "project", id: "*" },
  since: Math.floor(Date.now() / 1000) - 86400,
  limit: 200,
});

// Enrich with profiles
const enriched = await nn.enrichComments(comments);

// Agent reasoning
const unanswered = enriched.filter(c => !c.parentId);
const questions = unanswered.filter(c => c.content.endsWith("?"));
console.log(`Found ${questions.length} unanswered questions`);
```

## API Reference

### NearNostr

| Method | Description |
|--------|-------------|
| `createComment(opts)` | Sign + publish a kind 1 comment |
| `listComments(opts)` | Query comments for a target |
| `enrichComments(comments)` | Batch-resolve kind 0 profiles |
| `subscribeComments(opts)` | Live subscription to new comments |
| `createBindingChallenge(account)` | Generate time-limited binding challenge |
| `buildBindingEventTemplate(opts)` | Build unsigned binding event for signer |
| `verifyBindingEvent(event)` | Verify signed binding event |
| `buildBindingArgs(opts)` | Build FastNear KV tx args |
| `getIdentity(account)` | Read binding from FastNear KV |

### StandardAdapter

| Method | Description |
|--------|-------------|
| `publish(opts)` | Sign + publish kind 1 event |
| `publishSigned(event)` | Publish pre-signed event |
| `query(opts)` | Query comments by target |
| `queryRaw(filter)` | Raw query — any filter shape |
| `getProfile(pubkey)` | Fetch kind 0 profile |
| `subscribe(opts)` | Live subscription |
| `close()` | Tear down connections |

### BuzzAdapter

| Method | Description |
|--------|-------------|
| `publish(opts)` | Sign + publish kind 9 message |
| `publishSigned(event)` | Publish pre-signed event |
| `query(opts)` | Query messages by channel |
| `listChannels()` | List all Buzz channels |
| `close()` | Tear down connections |

## License

MIT
