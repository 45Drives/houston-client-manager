const SAFE_HOST = /^[A-Za-z0-9.-]+$/;
const SAFE_PATH_COMPONENT = /^[A-Za-z0-9._ -]+$/;
const SAFE_USERNAME = /^[A-Za-z0-9._@-]+$/;

export function assertSafeHost(host: string): string {
  const v = (host || "").trim();
  if (!v) throw new Error("Host is required");
  if (v.includes("/") || v.includes("\\") || v.includes("..")) {
    throw new Error("Host contains invalid path characters");
  }
  if (!SAFE_HOST.test(v)) {
    throw new Error("Host contains unsupported characters");
  }
  return v;
}

export function assertSafeShare(share: string): string {
  const v = (share || "").trim();
  if (!v) throw new Error("Share is required");
  if (v.includes("/") || v.includes("\\") || v.includes("..")) {
    throw new Error("Share contains invalid path characters");
  }
  if (!SAFE_PATH_COMPONENT.test(v)) {
    throw new Error("Share contains unsupported characters");
  }
  return v;
}

export function assertSafeUsername(username: string): string {
  const v = (username || "").trim();
  if (!v) throw new Error("Username is required");
  if (v.includes("/") || v.includes("\\") || v.includes("..")) {
    throw new Error("Username contains invalid path characters");
  }
  if (!SAFE_USERNAME.test(v)) {
    throw new Error("Username contains unsupported characters");
  }
  return v;
}

export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function toBase64(value: string): string {
  return Buffer.from(String(value), "utf8").toString("base64");
}

export function sanitizeCronComment(value: string): string {
  return String(value).replace(/[\r\n]/g, " ").replace(/#/g, "").trim();
}

export function escapeCmdValue(value: string): string {
  return String(value)
    .replace(/%/g, "%%")
    .replace(/\^/g, "^^")
    .replace(/&/g, "^&")
    .replace(/\|/g, "^|")
    .replace(/</g, "^<")
    .replace(/>/g, "^>")
    .replace(/"/g, "^\"");
}
