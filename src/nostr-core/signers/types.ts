// ── NostrSigner interface ──

import type { EventTemplate, VerifiedEvent } from "nostr-tools/pure";

export interface NostrSigner {
  /** Returns hex pubkey */
  getPublicKey(): Promise<string>;

  /** Signs a nostr event template, returns a verified event with id + sig */
  signEvent(template: EventTemplate): Promise<VerifiedEvent>;

  /** Optional NIP-04 encrypt/decrypt */
  nip04?: {
    encrypt(recipientPubkey: string, plaintext: string): Promise<string>;
    decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
  };

  /** Optional NIP-44 encrypt/decrypt (preferred over NIP-04) */
  nip44?: {
    encrypt(recipientPubkey: string, plaintext: string): Promise<string>;
    decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
  };
}

/** Shape of `window.nostr` as implemented by nos2x, Alby, Amber, etc. */
export interface WindowNostr {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>;
  nip04?: {
    encrypt(recipientPubkey: string, plaintext: string): Promise<string>;
    decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(recipientPubkey: string, plaintext: string): Promise<string>;
    decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
  };
}

/** Detect if a Nostr extension is available in the browser */
export function detectNostrExtension(): WindowNostr | null {
  if (typeof window === "undefined") return null;
  // nos2x, Alby, Amber, Diogel, Soapbox — all set window.nostr (NIP-07)
  const win = window as any;
  const ext = win.nostr as WindowNostr | undefined;
  if (ext && typeof ext.getPublicKey === "function" && typeof ext.signEvent === "function") {
    return ext;
  }
  // Some Firefox extensions use window.nostrWallet
  const wallet = win.nostrWallet as WindowNostr | undefined;
  if (wallet && typeof wallet.getPublicKey === "function" && typeof wallet.signEvent === "function") {
    return wallet;
  }
  return null;
}

/** Poll for a Nostr extension — useful on Firefox where injection may be delayed */
export function waitForNostrExtension(timeoutMs = 3000): Promise<WindowNostr | null> {
  return new Promise((resolve) => {
    const existing = detectNostrExtension();
    if (existing) return resolve(existing);

    const start = Date.now();
    const poll = setInterval(() => {
      const ext = detectNostrExtension();
      if (ext || Date.now() - start > timeoutMs) {
        clearInterval(poll);
        resolve(ext ?? null);
      }
    }, 200);
  });
}
