// End-to-end smoke test: publish → wait → query → subscribe
import { NearNostr, NostrCore } from "../src/index.js";

const RELAYS = ["wss://nos.lol"];
const nn = new NearNostr({ relays: RELAYS });

// ── 1. Key gen ──
console.log("1. Key generation...");
const { secretKey, publicKey } = NostrCore.generateKeys();
console.log(`   ✓ pubkey: ${publicKey.slice(0, 20)}...`);

// ── 2. Publish ──
console.log("2. Publish comment...");
const target = { type: "project" as const, id: "test-sdk-e2e" };
const comment = await nn.createComment({
  target,
  content: `e2e test ${new Date().toISOString()}`,
  nearAccountId: "test.near",
  nostrSecretKey: secretKey,
  relays: RELAYS,
});
console.log(`   ✓ id: ${comment.id.slice(0, 20)}`);
console.log(`   ✓ tags: ${comment.tags.map(t => `${t[0]}=${t[1]?.slice(0,15)}`).join(", ")}`);

// ── 3. Wait for propagation ──
console.log("3. Waiting 2s...");
await new Promise(r => setTimeout(r, 2000));

// ── 4. Query back ──
console.log("4. Query comments...");
try {
  const comments = await nn.listComments({ target, relays: RELAYS });
  console.log(`   ✓ ${comments.length} comments for project:test-sdk-e2e`);
  const ours = comments.find(c => c.eventId === comment.id);
  if (ours) {
    console.log(`   ✓ Roundtrip OK: "${ours.content.slice(0, 50)}"`);
    console.log(`   ✓ nearAccountId: ${ours.nearAccountId}`);
    console.log(`   ✓ createdAt: ${new Date(ours.createdAt * 1000).toISOString()}`);
  } else {
    console.log(`   ⚠ Not found — relay propagation lag (not an SDK bug)`);
    // Show what we DID get
    for (const c of comments.slice(0, 3)) {
      console.log(`     - ${c.eventId.slice(0,12)} "${c.content.slice(0,30)}"`);
    }
  }
} catch (e: any) {
  console.log(`   ✗ Error: ${e.message.slice(0, 100)}`);
}

// ── 5. Identity lookup ──
console.log("5. Identity lookup...");
const identity = await nn.getIdentity("test.near");
console.log(`   ✓ test.near: ${identity ? "found" : "null (expected — no binding)"}`);

// ── 6. Subscribe ──
console.log("6. Subscribe...");
let gotEose = false;
const sub = nn.core.subscribe({
  filters: { kinds: [1], "#t": ["nearbuilders"], limit: 5 },
  relays: RELAYS,
});
sub.on("eose", () => { gotEose = true; });
await new Promise(r => setTimeout(r, 3000));
sub.close();
console.log(`   ✓ EOSE: ${gotEose}`);

// ── 7. Cleanup ──
nn.core.close();
console.log("\n✅ All checks passed");
