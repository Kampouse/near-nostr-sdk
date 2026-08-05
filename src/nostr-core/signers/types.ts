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
  // nos2x, Alby, Amber all set window.nostr
  const ext = (window as any).nostr as WindowNostr | undefined;
  if (ext && typeof ext.getPublicKey === "function" && typeof ext.signEvent === "function") {
    return ext;
  }
  return null;
}
