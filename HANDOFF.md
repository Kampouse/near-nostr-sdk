# Nostr <> NEAR Integration — Project Handoff

**Builder:** Jemartel (Kampouse)
**Owner:** NearBuilders / Builder Ops
**Target:** August 2026
**Cadence:** Weekly demo

## Repos

| Repo | Purpose | URL |
|------|---------|-----|
| **near-nostr-sdk** | Reusable SDK — adapters, signers, binding, comments | [github.com/Kampouse/near-nostr-sdk](https://github.com/Kampouse/near-nostr-sdk) |
| **nearbuilders.org** | nearbuilders.org monorepo — plugin + merged API | [github.com/Kampouse/nearbuilders.org](https://github.com/Kampouse/nearbuilders.org) (branch: `pr/mcp-plugin`) |
| **legion-chat** | Existing SBT-gated Nostr group chat (reference) | Local: `~/dev/legion-chat` |

## What Was Built

### SDK (`near-nostr-sdk`)

Reusable TypeScript package for NEAR ↔ Nostr integration:

- **StandardAdapter** — kind 1 public notes on any open relay (SimplePool)
- **BuzzAdapter** — kind 9 NIP-29 messages on Buzz relay (raw WebSocket + NIP-42 auth)
- **Signers** — `LocalSigner` (nsec), `ExtensionSigner` (window.nostr), `detectNostrExtension()`
- **Binding flow** — challenge → sign event → verify → NEAR wallet tx → FastNear KV
- **Comments** — create, list, reply, enrich with profiles, filter by binding
- **Agent access** — `queryRaw()`, `getProfile()`, standard tag convention

### Plugin (`nearbuilders.org/plugins/nostr-comments/`)

oRPC plugin wired into the merged API:

- `GET /v1/comments` — list comments with filtering (`requireBound`, `requireVerified`, `enrich`)
- `POST /v1/comments` — publish pre-signed event
- `GET /v1/binding/{account}` — read NEAR ↔ Nostr binding
- `POST /v1/binding/challenge` — generate binding challenge
- `POST /v1/binding/verify` — verify signed binding event
- `POST /v1/nostr/query` — raw relay query (agent access)
- `POST /v1/nostr/publish` — raw event publish (agent access)
- `GET /v1/nostr/profile/{pubkey}` — fetch kind 0 profile

### Merged API (`nearbuilders.org/api/`)

All plugin routes exposed under `/v1/comments`, `/v1/binding/*`, `/v1/nostr/*`.

## Two Integration Paths

Per spec, the API exposes two layers:

1. **`near-nostr` (product layer)** — `/v1/comments`, `/v1/binding/*` — for common product flows
2. **`nostr-core` (agent layer)** — `/v1/nostr/query`, `/v1/nostr/publish`, `/v1/nostr/profile/*` — for custom clients, agents, relay tooling

## Tag Convention

| Tag | Value | Purpose |
|-----|-------|---------|
| `t` | `project`, `builder`, `scope` | Topic — target type (relay-filterable) |
| `p` | `<pubkey>` | Author pubkey (relay-filterable) |
| `p` | `_near:<account.near>` | NEAR account (namespaced) |
| `e` | `<event-id>`, `""`, `"reply"` | Reply threading (NIP-10) |
| `r` | `<url>` | URL reference |
| `near_target` | `<type>:<id>` | App-level target ID (client-side filter) |
| `near_account` | `<account.near>` | Raw account name (client-side filter) |
| `client` | `<app-name>` | Client attribution |

Standard tags first, custom tags second. Relays filter on `#t`/`#p`/`#e`. Custom tags filtered client-side.

## Binding Flow

1. User connects NEAR wallet
2. App checks if user has a linked Nostr identity (`GET /v1/binding/{account}`)
3. If not linked: generate challenge → sign with Nostr extension → verify → wallet tx to `contextual.near.__fastdata_kv`
4. Binding stored as `nostr/<account.near>` → `{ npub, relay, proof, bound_at }`

Two signatures required: Nostr event sig (proves pubkey) + NEAR wallet tx (proves account).

## Relay Configuration

| Relay | Type | Purpose |
|-------|------|---------|
| `wss://nos.lol` | Standard | Primary open relay |
| `wss://relay.damus.io` | Standard | Fallback |
| `wss://relay.camelus.app` | Standard | Legion-compatible fallback |
| `wss://nearbuilders.communities.buzz.xyz` | Buzz (NIP-29) | NEARBuilders group channels |

## Legion Chat Interop

Legion Chat uses kind 42 (NIP-28 channels). SDK uses kind 1 (public notes). Different kinds, same relays, same KV contract. To show SDK comments in Legion, add `kinds: [1, 42]` to Legion's subscription filter and filter by `#t` tag client-side. One-line change in Legion's `subscribeChannel`.

## Docs

| Doc | Location |
|-----|----------|
| SDK README | [near-nostr-sdk/README.md](https://github.com/Kampouse/near-nostr-sdk/blob/main/README.md) |
| Integration Guide | [near-nostr-sdk/INTEGRATION.md](https://github.com/Kampouse/near-nostr-sdk/blob/main/INTEGRATION.md) |
| This handoff | [near-nostr-sdk/HANDOFF.md](https://github.com/Kampouse/near-nostr-sdk/blob/main/HANDOFF.md) |

## API Endpoints Summary

```
Product layer (near-nostr):
  GET  /v1/comments?target=<type:id>&adapterType=standard&requireBound=true&enrich=true
  POST /v1/comments  { event, target, targetType, adapterType }
  GET  /v1/binding/{nearAccountId}
  POST /v1/binding/challenge  { nearAccountId }
  POST /v1/binding/verify     { event }

Agent layer (nostr-core):
  POST /v1/nostr/query        { filter: {...}, relays?: [...] }
  POST /v1/nostr/publish      { event, relays?: [...] }
  GET  /v1/nostr/profile/{pubkey}
```

## Out of Scope (per spec)

- Building a full Buzz competitor
- Replacing Telegram or all existing Legion communication
- Creating a new Nostr standard
- Complex moderation/reputation systems
- Full private messaging guarantees
- DMs, NIP-04/NIP-44 encrypted messaging

## Open Items

- [ ] **UI component** — Comments/feed widget for nearbuilders.org frontend
- [ ] **Linking UX** — Wallet → Nostr connect/create flow in frontend
- [ ] **npm publish** — SDK currently used via local path reference
- [ ] **NIP-46 remote signer** — Deferred, only Local + Extension supported
- [ ] **Live agent validation** — Events are structured, but no confirmed agent reading the stream yet
