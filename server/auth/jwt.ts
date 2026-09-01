import jwt from "jsonwebtoken";
import type { JwtPayload } from "../types.ts";

export function signAuthToken(payload: JwtPayload, secretKey: string): string {
  return jwt.sign(payload, secretKey, { expiresIn: "7d", algorithm: "HS256" });
}

export function verifyAuthToken(token: string, secretKey: string): JwtPayload {
  const decoded = jwt.verify(token, secretKey, { algorithms: ["HS256"] });
  if (typeof decoded !== "object" || decoded === null || typeof (decoded as JwtPayload).id !== "string") {
    throw new Error("Invalid token payload");
  }
  return decoded as JwtPayload;
}
