# Integration Guide: Adding Nostr Comments to Any NEAR App

This guide shows how to add public comments, identity linking, and feed functionality to a NEAR app using `near-nostr-sdk` and the nearbuilders.org API.

## Prerequisites

- A NEAR wallet integration (e.g. `@near-wallet-selector`)
- A Nostr signer (browser extension like nos2x/Alby, or local nsec)
- Users with NEAR accounts they want to link

## Quick Start

### 1. Install the SDK

```bash
npm install near-nostr-sdk
```

### 2. Initialize

```ts
import { NearNostr, StandardAdapter, detectNostrExtension, ExtensionSigner } from "near-nostr-sdk";

// Set up adapters (standard relay for open comments)
const nostr = new NearNostr({
  clientName: "my-near-app",
  kvApiUrl: "https://kv.main.fastnear.com",
  bindingContract: "contextual.near",
  adapters: [
    new StandardAdapter([
      "wss://nos.lol",
      "wss://relay.damus.io",
      "wss://relay.camelus.app",
    ]),
  ],
});
```

### 3. Link NEAR Account ↔ Nostr Key

Users need to link their NEAR account to a Nostr pubkey before commenting. This is a one-time flow:

```ts
// Detect signer
const signer = detectNostrExtension()
  ? new ExtensionSigner()
  : null; // fallback: prompt user to install extension

if (!signer) {
  // Show "Install a Nostr extension" message
  return;
}

const nearAccountId = "user.near"; // from wallet

// Step 1: Generate binding challenge
const { challenge, expiresAt } = nostr.createBindingChallenge(nearAccountId);

// Step 2: Build event template and sign with Nostr extension
const template = nostr.buildBindingEventTemplate({
  nostrPubkey: await signer.getPublicKey(),
  challenge,
});
const signedEvent = await signer.signEvent(template);

// Step 3: Verify the signed event
const result = nostr.verifyBindingEvent(signedEvent);

// Step 4: Store binding via NEAR wallet tx (FastNear KV)
const txArgs = nostr.buildBindingArgs({
  nearAccountId: result.nearAccountId,
  nostrPubkey: result.nastrPubkey,
  proof: JSON.stringify(result),
});

// Call via wallet:
// wallet.signAndSendTransactions({
//   transactions: [{
//     receiverId: "contextual.near",
//     actions: [{
//       type: "FunctionCall",
//       params: txArgs,        // {"nostr/user.near": "<json>"}
//       methodName: "__fastdata_kv",
//       gas: "30000000000000",
//       deposit: "0",
//     }],
//   }],
// });

// Step 5: Verify binding stored
const identity = await nostr.getIdentity(nearAccountId);
// identity.nastrPubkey === "abc123..."
```

### 4. Post a Comment

```ts
// After linking, user can post comments
const event = await nostr.createComment({
  content: "This project looks great!",
  target: { type: "project", id: "abc-123" },
  nearAccountId: "user.near",
  nostrSecretKey: signerSecretKey, // Uint8Array — use ExtensionSigner for browser
});
// event.id, event.pubkey, etc.
```

**With browser extension (no server-side keys):**

```ts
import { StandardAdapter, ExtensionSigner, detectNostrExtension } from "near-nostr-sdk";

const adapter = new StandardAdapter(["wss://nos.lol"]);
const signer = new ExtensionSigner();
const pubkey = await signer.getPublicKey();

// Build event template
const template = {
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["t", "project"],
    ["t", "my-app"],
    ["p", pubkey],
    ["p", "_near:user.near"],
    ["near_target", "project:abc-123"],
    ["near_account", "user.near"],
    ["client", "my-app"],
  ],
  content: "This project looks great!",
};

// Sign with extension (triggers popup)
const signed = await signer.signEvent(template);

// Publish
await adapter.publishSigned(signed);
```

### 5. List Comments

```ts
// Basic listing
const comments = await nostr.listComments({
  target: { type: "project", id: "abc-123" },
  adapterType: "standard",
  limit: 50,
});

// Filtered: only bound users (fast, no KV check)
const boundComments = await nostr.listComments({
  target: { type: "project", id: "abc-123" },
  adapterType: "standard",
  requireBound: true,
});

// Filtered: only verified bindings (KV check)
const verifiedComments = await nostr.listComments({
  target: { type: "project", id: "abc-123" },
  adapterType: "standard",
  requireVerified: true,
});

// With profile enrichment
const enriched = await nostr.enrichComments(verifiedComments);
// enriched[0].profile = { name: "Jean", picture: "https://..." }
```

### 6. Using the nearbuilders.org API

If you don't want to manage relays yourself, use the API:

```ts
const BASE = "https://api.nearbuilders.org";

// List comments
const res = await fetch(
  `${BASE}/v1/comments?target=project:abc-123&adapterType=standard&requireBound=true&enrich=true`
);
const { data, meta } = await res.json();

// Create comment (pre-signed event)
await fetch(`${BASE}/v1/comments`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    event: signedEvent,        // pre-signed by extension/nsec
    target: "project:abc-123",
    targetType: "project",
    adapterType: "standard",
  }),
});

// Get binding
const identity = await fetch(`${BASE}/v1/binding/user.near`).then(r => r.json());
// identity.nastrPubkey

// Raw relay query (for agents/custom clients)
const events = await fetch(`${BASE}/v1/nostr/query`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    filter: { kinds: [1], "#t": ["project"], limit: 100 },
  }),
}).then(r => r.json());
```

## Tag Convention

Comments use these tags — follow this convention for interoperability:

| Tag | Value | Notes |
|-----|-------|-------|
| `t` | `project`, `builder`, `scope` | Topic — target type |
| `t` | `<your-app-name>` | Topic — client attribution |
| `p` | `<pubkey>` | Event author |
| `p` | `_near:<account.near>` | NEAR account (namespaced) |
| `near_target` | `<type>:<id>` | App-level target ID |
| `near_account` | `<account.near>` | Raw NEAR account |
| `e` | `<event-id>`, `""`, `"reply"` | Reply threading |
| `r` | `<url>` | Optional URL reference |

## Binding Storage

Bindings are stored in FastNear KV on `contextual.near`. No contract deploy needed.

**Write:** `__fastdata_kv` method, any account can write.
```
Key:   nostr/<account.near>
Value: { npub: "<pubkey>", relay: "...", proof: "...", bound_at: <timestamp> }
```

**Read:** `POST https://kv.main.fastnear.com/v0/latest/contextual.near/<account>/nostr/<account>` with body `{}`

## Two Adapter Types

| | Standard | Buzz |
|---|---|---|
| Protocol | NIP-01 (kind 1) | NIP-29 (kind 9) |
| Auth | None | NIP-42 (requires nsec for relay auth) |
| Discovery | Open, any client | Channel-scoped |
| Use case | Public comments, feeds | Group chat, team channels |
| Relay | Any open relay | `wss://nearbuilders.communities.buzz.xyz` |

Choose based on your use case. Use both for maximum reach.

## Architecture Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  NEAR App   │────▶│ near-nostr   │────▶│ Nostr Relays│
│  (Frontend) │     │    -sdk      │     │ (nos.lol,   │
│             │     │              │     │  damus,     │
│  - Wallet   │     │  Adapters:   │     │  camelus)   │
│  - Nostr    │     │  - Standard  │     └─────────────┘
│    Extension│     │  - Buzz      │
│             │     │              │     ┌─────────────┐
│             │     │  Signers:    │────▶│ FastNear KV │
│             │     │  - Extension│     │ (contextual │
└─────────────┘     │  - Local    │     │  .near)     │
                    └──────────────┘     └─────────────┘
                           │
                    ┌──────────────┐
                    │ nearbuilders │
                    │ .org API     │  (optional — managed relay access)
                    └──────────────┘
```

## Checklist for New Integrations

- [ ] Install `near-nostr-sdk`
- [ ] Set up StandardAdapter with 2+ relays
- [ ] Implement binding flow (challenge → sign → verify → wallet tx)
- [ ] Add comment posting with standard tags (`t`, `p`, `near_target`, `near_account`)
- [ ] Add comment listing with `requireBound` or `requireVerified` filtering
- [ ] Add profile enrichment via `enrichComments()`
- [ ] Add reply threading via `e` tag with `"reply"` marker
- [ ] Test with a live relay (nos.lol)
- [ ] Document your target types and tag usage
