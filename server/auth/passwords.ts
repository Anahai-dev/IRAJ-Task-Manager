import bcrypt from "bcryptjs";

export async function hashPassword(password: string, bcryptRounds: number): Promise<string> {
  const salt = await bcrypt.genSalt(bcryptRounds);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: unknown, minLength: number): password is string {
  return typeof password === "string" && password.length >= minLength;
}
