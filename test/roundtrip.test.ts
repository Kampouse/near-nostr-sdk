// Roundtrip verification: publish → 3s wait → query across multiple relays
import { NearNostr, NostrCore } from "../src/index.js";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const nn = new NearNostr({ relays: RELAYS });

console.log("1. Publish...");
const { secretKey } = NostrCore.generateKeys();
const target = { type: "project" as const, id: "roundtrip-test" };
const comment = await nn.createComment({
  target,
  content: `roundtrip verify ${Date.now()}`,
  nearAccountId: "test.near",
  nostrSecretKey: secretKey,
  relays: RELAYS,
});
console.log(`   ✓ ${comment.id}`);

console.log("2. Wait 3s...");
await new Promise(r => setTimeout(r, 3000));

console.log("3. Query back...");
const comments = await nn.listComments({ target, relays: RELAYS });
console.log(`   ✓ ${comments.length} comments found`);
const ours = comments.find(c => c.eventId === comment.id);
if (ours) {
  console.log(`   ✅ ROUNDTRIP VERIFIED`);
  console.log(`      content: "${ours.content.slice(0, 60)}"`);
  console.log(`      nearAccountId: ${ours.nearAccountId}`);
  console.log(`      tags preserved: near_target=${ours.target.type}:${ours.target.id}`);
} else {
  console.log(`   ⚠ Not found in this run (relay lag)`);
  // Try direct query by ID
  const { SimplePool } = await import("nostr-tools/pool");
  const fresh = new SimplePool();
  const direct = await fresh.querySync(RELAYS, { ids: [comment.id], limit: 1 } as any);
  console.log(`   Direct ID query: ${direct.length} results`);
  if (direct[0]) {
    const nt = direct[0].tags.find((t: string[]) => t[0] === "near_target");
    console.log(`   ✅ EVENT EXISTS ON RELAY`);
    console.log(`      near_target: ${nt?.[1]}`);
    console.log(`      content: "${direct[0].content.slice(0, 60)}"`);
  }
  fresh.close(RELAYS);
}

nn.core.close();
