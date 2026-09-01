import crypto from "crypto";

export function createSecretCipher(rawSecret: string) {
  const key = crypto.createHash("sha256").update(rawSecret).digest();

  function encryptSecret(text: string): string {
    if (!text) return text;
    if (text.startsWith("enc:")) return text;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `enc:${iv.toString("hex")}:${authTag}:${encrypted}`;
  }

  function decryptSecret(text: string): string {
    if (!text || !text.startsWith("enc:")) return text;
    const parts = text.split(":");
    if (parts.length !== 4) {
      throw new Error("Malformed encrypted secret");
    }
    const iv = Buffer.from(parts[1], "hex");
    const authTag = Buffer.from(parts[2], "hex");
    const encryptedText = parts[3];
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  function decryptSecretOrEmpty(text: string): string {
    try {
      return decryptSecret(text);
    } catch (e) {
      console.error("Failed to decrypt secret:", e);
      return "";
    }
  }

  return { encryptSecret, decryptSecret, decryptSecretOrEmpty };
}
