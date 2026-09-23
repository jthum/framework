import type { EncryptedSecret, SecretCipher } from "./workspace-config.ts";

/** Seals Workspace secrets with an environment-supplied AES-GCM key. */
export function createAesGcmSecretCipher(loadKey: () => Promise<CryptoKey>): SecretCipher {
  const key = loadKey();
  return {
    async encrypt(value, workspaceId, settingKey): Promise<EncryptedSecret> {
      const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: associatedData(workspaceId, settingKey) },
        await key,
        new TextEncoder().encode(value),
      );
      return {
        version: 1,
        algorithm: "AES-GCM",
        iv: encodeBase64(iv),
        ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      };
    },
    async decrypt(value, workspaceId, settingKey): Promise<string> {
      if (value.version !== 1 || value.algorithm !== "AES-GCM")
        throw new Error("Unsupported secret encryption envelope.");
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decodeBase64(value.iv),
          additionalData: associatedData(workspaceId, settingKey),
        },
        await key,
        decodeBase64(value.ciphertext),
      );
      return new TextDecoder().decode(plaintext);
    },
  };
}

function associatedData(workspaceId: string, settingKey: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([workspaceId, settingKey]));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
