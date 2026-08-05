// Probe: connect to Buzz relay with NIP-42 auth, list channels + messages
import WebSocket from "ws";
import { getPublicKey, finalizeEvent } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";

const RELAY = "wss://nearbuilders.communities.buzz.xyz";
const NSEC = "nsec1s7x3p6h8he7c2gf3fhrypagdd2zeaslgz8dcmsec7k90us6vncmq2lh7ma";

const { type, data } = nip19.decode(NSEC);
if (type !== "nsec") throw new Error(`Expected nsec, got ${type}`);
const secretKey = data as Uint8Array;
const publicKey = getPublicKey(secretKey);
console.log(`Pubkey: ${publicKey.slice(0, 16)}...${publicKey.slice(-4)}`);
console.log(`Relay:  ${RELAY}`);

const results: Array<{ subId: string; event: any }> = [];
let authed = false;
let eoseCount = 0;

function send(ws: WebSocket, msg: any) {
  const str = JSON.stringify(msg);
  ws.send(str);
}

function signAuthEvent(challenge: string, relay: string): string {
  const event = finalizeEvent(
    { kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", relay], ["challenge", challenge]], content: "" },
    secretKey,
  );
  return JSON.stringify(["AUTH", event]);
}

await new Promise<void>((resolve) => {
  const timeout = setTimeout(() => { console.log("Timeout"); process.exit(1); }, 15000);
  const ws = new WebSocket(RELAY);

  ws.on("open", () => {
    console.log("✓ Connected — waiting for AUTH challenge...\n");
    clearTimeout(timeout);
  });

  ws.on("message", (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());
    const t = msg[0];

    if (t === "AUTH") {
      const challenge = msg[1];
      console.log(`← AUTH challenge: ${challenge.slice(0, 24)}...`);
      const authMsg = signAuthEvent(challenge, RELAY);
      console.log(`→ AUTH msg (first 120): ${authMsg.slice(0, 120)}`);
      console.log(`→ Type check: starts with [ ? ${authMsg.startsWith("[")}`);
      ws.send(authMsg);
      return;
    }

    if (t === "OK") {
      const ok = msg[2];
      console.log(`← OK id=${msg[1].slice(0,12)}... ${ok} ${msg[3] || ""}`);
      if (ok && !authed) {
        authed = true;
        console.log("\n✓ Authenticated! Querying...\n");
        send(ws, ["REQ", "channels", { kinds: [39000], limit: 100 }]);
        send(ws, ["REQ", "groups", { kinds: [9007], limit: 100 }]);
        send(ws, ["REQ", "members", { kinds: [39002], limit: 100 }]);
        send(ws, ["REQ", "admins", { kinds: [39001], limit: 100 }]);
      }
      return;
    }

    if (t === "EVENT") {
      const [_, subId, event] = msg;
      results.push({ subId, event });
      const name = event.tags.find((t: string[]) => t[0] === "name")?.[1] || "";
      const d = event.tags.find((t: string[]) => t[0] === "d")?.[1] || "";
      if (event.kind === 39000) {
        console.log(`   CHANNEL: "${name}" (d=${d})`);
      } else if (event.kind === 9007) {
        console.log(`   GROUP: "${name}" (d=${d})`);
      } else if (event.kind === 39002) {
        const members = event.tags.filter((t: string[]) => t[0] === "p").map((t: string[]) => t[1].slice(0, 12) + "...");
        console.log(`   MEMBERS [${d}]: ${members.length} members`);
      } else if (event.kind === 39001) {
        const admins = event.tags.filter((t: string[]) => t[0] === "p")
          .map((t: string[]) => `${t[1].slice(0, 12)}... (${t[2] || "member"})`);
        console.log(`   ADMINS [${d}]: ${admins.join(", ")}`);
      } else if (event.kind === 9) {
        console.log(`   MSG [${subId}]: "${event.content.slice(0, 60)}"`);
      }
      return;
    }

    if (t === "EOSE") {
      eoseCount++;
      console.log(`← EOSE [${msg[1]}] (${eoseCount}/4)`);
      if (eoseCount === 4) {
        console.log("\n=== Fetching recent messages from each channel ===\n");
        const channels = results.filter(r => r.subId === "channels" && r.event.kind === 39000);
        for (const ch of channels.slice(0, 5)) {
          const h = ch.event.tags.find((t: string[]) => t[0] === "d")?.[1];
          if (h) send(ws, ["REQ", `msgs-${h.slice(0, 8)}`, { kinds: [9], "#h": [h], limit: 3 }]);
        }
        setTimeout(() => {
          console.log("\n=== Summary ===");
          const byKind = new Map<number, number>();
          for (const r of results) {
            byKind.set(r.event.kind, (byKind.get(r.event.kind) || 0) + 1);
          }
          for (const [k, v] of [...byKind].sort((a, b) => b[1] - a[1])) {
            console.log(`  kind ${k}: ${v} events`);
          }
          console.log(`\nTotal: ${results.length} events`);
          ws.close();
          resolve();
        }, 5000);
      }
      return;
    }

    if (t === "NOTICE") {
      console.log(`← NOTICE: ${msg[1]}`);
      return;
    }
    if (t === "CLOSED") {
      console.log(`← CLOSED: ${msg[1]} ${msg[2]}`);
      return;
    }
  });

  ws.on("error", (err: Error) => { console.error(`✗ ${err.message}`); resolve(); });
  ws.on("close", () => { resolve(); });
});
