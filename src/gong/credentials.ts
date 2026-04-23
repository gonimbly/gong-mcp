import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import os from "os";

const CREDENTIALS_PATH = path.join(os.homedir(), ".gong-mcp", "credentials.json");

export interface Credentials {
  accessKey: string;
  accessKeySecret: string;
}

export function loadCredentials(): Credentials | null {
  if (process.env.GONG_ACCESS_KEY && process.env.GONG_ACCESS_KEY_SECRET) {
    return {
      accessKey: process.env.GONG_ACCESS_KEY,
      accessKeySecret: process.env.GONG_ACCESS_KEY_SECRET,
    };
  }
  try {
    const data = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8")) as Credentials;
    if (data.accessKey && data.accessKeySecret) return data;
  } catch {
    // File doesn't exist yet
  }
  return null;
}

export function saveCredentials(creds: Credentials): void {
  mkdirSync(path.dirname(CREDENTIALS_PATH), { recursive: true });
  // mode 0o600 = owner read/write only
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}
