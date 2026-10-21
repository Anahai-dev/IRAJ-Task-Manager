import jwt, { type SignOptions } from "jsonwebtoken";
import type { JwtPayload } from "../types.ts";

export function signAuthToken(
  payload: JwtPayload,
  secretKey: string,
  expiresIn: string,
  algorithm: "HS256" = "HS256"
): string {
  const options: SignOptions = { expiresIn: expiresIn as SignOptions["expiresIn"], algorithm };
  return jwt.sign(payload, secretKey, options);
}

export function verifyAuthToken(token: string, secretKey: string, algorithm: "HS256" = "HS256"): JwtPayload {
  const decoded = jwt.verify(token, secretKey, { algorithms: [algorithm] });
  if (typeof decoded !== "object" || decoded === null || typeof (decoded as JwtPayload).id !== "string") {
    throw new Error("Invalid token payload");
  }
  return decoded as JwtPayload;
}
