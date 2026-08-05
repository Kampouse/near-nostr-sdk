import type { EventTemplate, VerifiedEvent } from "nostr-tools/pure";
import type { NostrSigner, WindowNostr } from "./types.js";

/**
 * Extension signer — delegates signing to a browser Nostr extension (nos2x, Alby, Amber).
 * The private key never leaves the extension.
 */
export class ExtensionSigner implements NostrSigner {
  private ext: WindowNostr;
  private _pubkey?: string;

  constructor(ext: WindowNostr) {
    this.ext = ext;
  }

  async getPublicKey(): Promise<string> {
    if (!this._pubkey) {
      this._pubkey = await this.ext.getPublicKey();
    }
    return this._pubkey!;
  }

  async signEvent(template: EventTemplate): Promise<VerifiedEvent> {
    return this.ext.signEvent(template);
  }

  get nip04() {
    if (this.ext.nip04) {
      return {
        encrypt: (recipient: string, plaintext: string) => this.ext.nip04!.encrypt(recipient, plaintext),
        decrypt: (sender: string, ciphertext: string) => this.ext.nip04!.decrypt(sender, ciphertext),
      };
    }
    return undefined;
  }

  get nip44() {
    if (this.ext.nip44) {
      return {
        encrypt: (recipient: string, plaintext: string) => this.ext.nip44!.encrypt(recipient, plaintext),
        decrypt: (sender: string, ciphertext: string) => this.ext.nip44!.decrypt(sender, ciphertext),
      };
    }
    return undefined;
  }
}
