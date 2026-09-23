import { describe, expect, it } from "vite-plus/test";

import { createAesGcmSecretCipher } from "./secret-cipher.ts";

describe("Workspace secret encryption", () => {
  it("uses fresh authenticated ciphertext bound to the Workspace and setting", async () => {
    const cipher = createAesGcmSecretCipher(() =>
      crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["encrypt", "decrypt"]),
    );
    const first = await cipher.encrypt("private-token", "workspace-1", "api_key");
    const second = await cipher.encrypt("private-token", "workspace-1", "api_key");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain("private-token");
    await expect(cipher.decrypt(first, "workspace-1", "api_key")).resolves.toBe("private-token");
    await expect(cipher.decrypt(first, "workspace-2", "api_key")).rejects.toThrow();
    await expect(cipher.decrypt(first, "workspace-1", "other_key")).rejects.toThrow();
    await expect(
      cipher.decrypt({ ...first, ciphertext: second.ciphertext }, "workspace-1", "api_key"),
    ).rejects.toThrow();
  });
});
