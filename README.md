# near-nostr-sdk

Nostr integration SDK for NEAR apps. Post comments, link identities, and read from any Nostr relay.

## Install

```bash
npm install near-nostr-sdk
```

## Core Concepts

**Adapters** abstract relay differences:
- **StandardAdapter** — kind 1 (public notes) on any open relay
- **BuzzAdapter** — kind 9 (NIP-29) on Buzz relay with NIP-42 auth

**Signers** abstract key management:
- **LocalSigner** — wraps a raw `nsec` (server-side or CLI)
- **ExtensionSigner** — delegates to `window.nostr` (nos2x, Alby, Amber)

## Usage

### Post a comment (client-side signing)

```ts
import { NostrCore, StandardAdapter, detectNostrExtension, ExtensionSigner, LocalSigner } from "near-nostr-sdk";

// Auto-detect signer
const signer = detectNostrExtension()
  ? new ExtensionSigner()
  : new LocalSigner("nsec1...");

const nostr = new NostrCore({
  adapters: [
    new StandardAdapter(["wss://nos.lol", "wss://relay.damus.io"]),
  ],
});

const eventTemplate = nostr.buildCommentTemplate({
  content: "Great project!",
  target: "nearbuilders.org/project/123",
  targetType: "project",
  nearAccountId: "jemartel.near",
  clientName: "my-app",
});

// Sign client-side (extension popup or local nsec)
const signedEvent = await signer.signEvent(eventTemplate);

// Publish — server or client
await nostr.publishSigned(signedEvent, "standard");
```

### List comments

```ts
const { events } = await nostr.listComments({
  target: "nearbuilders.org/project/123",
  targetType: "project",
  adapterType: "standard",
  limit: 50,
});
```

### NEAR ↔ Nostr identity binding

```ts
// 1. Get challenge
const { challenge, expiresAt } = await nostr.createBindingChallenge("jemartel.near");

// 2. Build + sign binding event (client-side)
const template = nostr.buildBindingTemplate(challenge, "jemartel.near");
const signedEvent = await signer.signEvent(template);

// 3. Server verifies the event
const proof = await nostr.verifyBinding(signedEvent);

// 4. Client stores binding via NEAR wallet (FastNear KV)
const txArgs = nostr.buildBindingArgs({
  nearAccountId: "jemartel.near",
  nostrPubkey: proof.npub,
  proof: proof.json,
});
// wallet.signAndSend({ contract: "contextual.near", method: "__fastdata_kv", args: txArgs })

// 5. Read binding later
const identity = await nostr.getIdentity("jemartel.near");
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

// Connect (handles AUTH handshake automatically)
await buzz.connect();

// Query messages
const { events } = await buzz.query({ target: "my-channel", targetType: "general", clientName: "near-nostr-sdk" });

// List channels
const channels = await buzz.listChannels();
```

## API

### NostrCore

| Method | Description |
|--------|-------------|
| `createCommentTemplate(opts)` | Build unsigned kind 1 event template |
| `buildBindingTemplate(challenge, account)` | Build unsigned kind 27235 binding event |
| `publishSigned(event, adapterType)` | Publish a pre-signed event |
| `listComments(opts)` | Query comments from relay |
| `createBindingChallenge(account)` | Generate binding challenge string |
| `verifyBinding(event)` | Verify signed binding event |
| `buildBindingArgs(opts)` | Build FastNear KV tx args |
| `getIdentity(account)` | Read binding from FastNear KV |

### Signers

```ts
import { type NostrSigner, LocalSigner, ExtensionSigner, detectNostrExtension } from "near-nostr-sdk";

// Auto-detect
const signer: NostrSigner = detectNostrExtension()
  ? new ExtensionSigner()
  : new LocalSigner(nsecBytes);

const pubkey = await signer.getPublicKey();
const signed = await signer.signEvent(template);
```

## Tag Convention

| Tag | Value | Purpose |
|-----|-------|---------|
| `near_target` | `<type>:<id>` | Client-side target filtering |
| `near_account` | `<account.near>` | Link to NEAR identity |
| `t` | `<type>` | Relay-queryable type filter |
| `client` | `<app-name>` | Client attribution |

## License

MIT
