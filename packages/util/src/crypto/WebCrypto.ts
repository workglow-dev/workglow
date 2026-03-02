/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Number of bytes used for the PBKDF2 salt prepended to each ciphertext. */
const SALT_LENGTH = 16;

/**
 * Derives a 256-bit AES-GCM key from a passphrase using PBKDF2.
 */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts plaintext using AES-256-GCM with a random salt and IV.
 * The salt is prepended to the ciphertext bytes and stored in the `encrypted` field
 * so that decryption can reconstruct the same key.
 *
 * @param keyCache - Per-store cache of derived CryptoKey instances keyed by base64(salt).
 */
export async function encrypt(
  plaintext: string,
  passphrase: string,
  keyCache: Map<string, CryptoKey>
): Promise<{ encrypted: string; iv: string }> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const saltB64 = bufToBase64(salt);
  let key = keyCache.get(saltB64);
  if (!key) {
    key = await deriveKey(passphrase, salt);
    keyCache.set(saltB64, key);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawCiphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  // Prepend the salt to the ciphertext so decrypt can recover it.
  const ciphertextBytes = new Uint8Array(rawCiphertext);
  const combined = new Uint8Array(SALT_LENGTH + ciphertextBytes.length);
  combined.set(salt, 0);
  combined.set(ciphertextBytes, SALT_LENGTH);
  return {
    encrypted: bufToBase64(combined),
    iv: bufToBase64(iv),
  };
}

/**
 * Decrypts ciphertext encrypted with {@link encrypt}.
 *
 * @param keyCache - Per-store cache of derived CryptoKey instances keyed by base64(salt).
 */
export async function decrypt(
  encrypted: string,
  iv: string,
  passphrase: string,
  keyCache: Map<string, CryptoKey>
): Promise<string> {
  const encryptedBuf = base64ToBuf(encrypted);
  const salt = encryptedBuf.subarray(0, SALT_LENGTH);
  const ciphertextBytes = encryptedBuf.subarray(SALT_LENGTH);
  const saltB64 = bufToBase64(salt);
  let key = keyCache.get(saltB64);
  if (!key) {
    key = await deriveKey(passphrase, salt);
    keyCache.set(saltB64, key);
  }
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBuf(iv) as unknown as ArrayBuffer },
    key,
    ciphertextBytes as unknown as ArrayBuffer
  );
  return new TextDecoder().decode(plainBuf);
}

export function bufToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

export function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}
