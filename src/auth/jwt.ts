import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface JwtPayload {
  sub: string;            // user email
  name?: string;
  typ: "access" | "refresh";
  client_id: string;
  iat: number;
  exp: number;
  jti: string;
  [key: string]: unknown;
}

export function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp" | "jti">,
  key: string,
  expiresInSec: number
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSec,
    jti: randomBytes(8).toString("hex"),
  } as JwtPayload;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(full));
  const sig = createHmac("sha256", key).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string, key: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", key).update(`${header}.${body}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as JwtPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
