import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const SITE_COOKIE = "acb_site_session";
const COOKIE_PATH = "/";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_VERIFY_URL = "http://127.0.0.1:39766/basic-check";
const VERIFY_TIMEOUT_MS = 3000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ATTEMPTS = 10;

type Body = Record<string, unknown>;

export interface SiteAuthOptions {
  /** Dependency injection for tests: return true if credentials are valid. */
  verifyCredentials?: (username: string, password: string) => Promise<boolean>;
  /** Fixture/injected key bytes or hex/utf8 string. Takes precedence over file/env. */
  sessionKey?: string | Uint8Array;
  /** Override key file path (tests/prod). */
  sessionKeyFile?: string;
  /** Optional fixed loopback verify URL override for controlled environments (not user input). */
  verifyUrl?: string;
  /** Injected clock for tests. */
  now?: () => number;
}

interface SessionPayload {
  u: string;
  exp: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSecureRequest(request: FastifyRequest): boolean {
  const xf = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  if (xf.split(",").map((s) => s.trim()).includes("https")) return true;
  const proto = (request as unknown as { protocol?: string }).protocol;
  if (proto === "https") return true;
  return !!(request.raw.socket as unknown as { encrypted?: boolean })?.encrypted;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function normalizeKey(input: string | Uint8Array): Uint8Array | null {
  if (input instanceof Uint8Array) return input.length > 0 ? input : null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  return Buffer.from(s, "utf8");
}

function loadSessionKey(options?: SiteAuthOptions): Uint8Array | null {
  if (options?.sessionKey !== undefined) return normalizeKey(options.sessionKey);
  const file =
    options?.sessionKeyFile ||
    process.env.AGENTCHATBUS_SITE_SESSION_KEY_FILE ||
    "/var/lib/agentchatbus/site-session.key";
  try {
    return normalizeKey(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function signPayload(payloadB64: string, key: Uint8Array): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

function encodeSession(payload: SessionPayload, key: Uint8Array): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `v1.${payloadB64}.${signPayload(payloadB64, key)}`;
}

function decodeSession(value: string | undefined, key: Uint8Array | null, now: number): SessionPayload | null {
  if (!value || !key) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payloadB64 = parts[1];
  const sig = parts[2];
  if (!payloadB64 || !sig) return null;
  const expected = signPayload(payloadB64, key);
  if (!safeCompare(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof parsed.u !== "string" || !parsed.u) return null;
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
    if (parsed.exp <= now) return null;
    return { u: parsed.u, exp: parsed.exp };
  } catch {
    return null;
  }
}

function serializeCookie(value: string, secure: boolean, maxAgeSeconds: number): string {
  const attrs = [
    `${SITE_COOKIE}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

function clearCookie(secure: boolean): string {
  return serializeCookie("", secure, 0);
}

export function isSafeNextPath(next: unknown): string | null {
  if (next === undefined || next === null || next === "") return "/";
  if (typeof next !== "string") return null;
  if (next.length > 2048) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    const url = new URL(next, "https://agentchatbus.invalid");
    if (url.origin !== "https://agentchatbus.invalid") return null;
    if (url.username || url.password) return null;
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return null;
  }
}

function getHost(request: FastifyRequest): string {
  return String(request.headers.host || "").trim().toLowerCase();
}

function rejectCrossOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin.trim() : "";
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host.trim().toLowerCase();
    const host = getHost(request);
    if (host && originHost && host !== originHost) {
      reply.code(403).send({ error: "CROSS_ORIGIN_FORBIDDEN", detail: "跨站请求已拒绝。" });
      return true;
    }
  } catch {
    reply.code(403).send({ error: "CROSS_ORIGIN_FORBIDDEN", detail: "无效的 Origin。" });
    return true;
  }
  return false;
}

function createRateLimiter() {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (ip: string, now: number): boolean => {
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    const cur = buckets.get(ip);
    if (!cur || cur.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return true;
    }
    if (cur.count >= RATE_MAX_ATTEMPTS) return false;
    cur.count += 1;
    return true;
  };
}

export function renderLoginPage(params?: { error?: string; username?: string; next?: string }): string {
  const error = params?.error ? escapeHtml(params.error) : "";
  const username = params?.username ? escapeHtml(params.username) : "";
  const next = escapeHtml(isSafeNextPath(params?.next) || "/");
  const errorBlock = error
    ? `<div role="alert" style="margin:12px 0;padding:10px 12px;border:1px solid #c33;border-radius:8px;background:#fff5f5;color:#7a1111;">${error}</div>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>AgentChatBus 登录</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7f9;color:#111;font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans SC','Microsoft YaHei',sans-serif;">
  <main style="max-width:420px;margin:6vh auto;padding:24px;background:#fff;border:1px solid #d7dbe0;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.04);">
    <h1 style="margin:0 0 8px;font-size:22px;">AgentChatBus 登录</h1>
    <p style="margin:0 0 16px;color:#444;">请输入已配置的用户名和密码。此页面仅用于网站会话登录，不会弹出浏览器原生认证框。</p>
    ${errorBlock}
    <form method="post" action="/auth/login" accept-charset="UTF-8" autocomplete="on">
      <input type="hidden" name="next" value="${next}">
      <label for="username" style="display:block;margin:12px 0 4px;font-weight:600;">用户名</label>
      <input id="username" name="username" type="text" required autocomplete="username" value="${username}" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #b8c0cc;border-radius:8px;font:inherit;">
      <label for="password" style="display:block;margin:12px 0 4px;font-weight:600;">密码</label>
      <input id="password" name="password" type="password" required autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #b8c0cc;border-radius:8px;font:inherit;">
      <button type="submit" style="margin-top:16px;width:100%;padding:10px 14px;border:0;border-radius:8px;background:#175cd3;color:#fff;font:inherit;font-weight:600;cursor:pointer;">登录</button>
    </form>
  </main>
</body>
</html>`;
}

function parseFormUrlEncoded(raw: string): Body {
  const out: Body = {};
  const params = new URLSearchParams(raw);
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function ensureFormParser(server: FastifyInstance): void {
  try {
    const anyServer = server as unknown as { hasContentTypeParser?: (t: string) => boolean };
    if (typeof anyServer.hasContentTypeParser === "function" && anyServer.hasContentTypeParser("application/x-www-form-urlencoded")) {
      return;
    }
  } catch {
    // Fall through and attempt registration.
  }
  try {
    server.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          done(null, parseFormUrlEncoded(typeof body === "string" ? body : String(body ?? "")));
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
  } catch {
    // A compatible parser may already exist; do not break isolated mounting.
  }
}

async function defaultVerifyCredentials(username: string, password: string, verifyUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const basic = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    const res = await fetch(verifyUrl, {
      method: "GET",
      headers: { authorization: `Basic ${basic}` },
      signal: controller.signal,
    });
    return res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function bodyString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function registerSiteAuthRoutes(server: FastifyInstance, options?: SiteAuthOptions): void {
  const key = loadSessionKey(options);
  const now = options?.now ?? (() => Date.now());
  const verifyUrl = options?.verifyUrl ?? DEFAULT_VERIFY_URL;
  const verifyCredentials =
    options?.verifyCredentials ?? ((username: string, password: string) => defaultVerifyCredentials(username, password, verifyUrl));
  const allowAttempt = createRateLimiter();

  ensureFormParser(server);

  server.addHook("onRequest", async (request, reply) => {
    if (!String(request.url || "").startsWith("/auth/")) return;
    reply.header("Cache-Control", "no-store");
  });

  server.get("/auth/login-page", async (request, reply) => {
    const query = (request.query || {}) as Record<string, unknown>;
    const next = isSafeNextPath(query.next ?? request.headers["x-original-uri"]) || "/";
    const username = bodyString(query.username).slice(0, 200);
    reply.type("text/html; charset=utf-8").code(200);
    return renderLoginPage({ next, username });
  });

  server.post("/auth/login", async (request, reply) => {
    if (rejectCrossOrigin(request, reply)) return;
    const body = (request.body || {}) as Body;
    const username = bodyString(body.username).trim().slice(0, 200);
    const password = bodyString(body.password);
    const next = isSafeNextPath(body.next) || "/";
    const secure = isSecureRequest(request);

    const sendFormError = (detail: string) => {
      reply.type("text/html; charset=utf-8").code(200);
      return renderLoginPage({ error: detail, username, next });
    };

    if (!allowAttempt(String(request.ip || request.socket?.remoteAddress || "unknown"), now())) {
      return sendFormError("登录尝试过于频繁，请稍后再试。");
    }
    if (!username || !password) {
      return sendFormError("请输入用户名和密码。");
    }
    if (!key) {
      return sendFormError("登录服务未正确配置，请联系管理员。");
    }

    let ok = false;
    try {
      ok = await verifyCredentials(username, password);
    } catch {
      ok = false;
    }
    if (!ok) {
      return sendFormError("用户名或密码错误，或验证服务暂时不可用。");
    }

    const session = encodeSession({ u: username, exp: now() + SESSION_TTL_MS }, key);
    reply.header("Set-Cookie", serializeCookie(session, secure, SESSION_TTL_MS / 1000));
    reply.header("Location", next);
    reply.code(303).type("text/html; charset=utf-8");
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>登录成功</title><body>登录成功，正在跳转… <a href="${escapeHtml(next)}">继续</a></body></html>`;
  });

  server.get("/auth/check", async (request, reply) => {
    const session = parseCookies(request.headers.cookie)[SITE_COOKIE];
    const valid = decodeSession(session, key, now());
    if (!valid) {
      return reply.code(401).send({ error: "UNAUTHORIZED", detail: "网站会话无效或已过期。" });
    }
    return reply.code(204).send();
  });

  server.post("/auth/logout", async (request, reply) => {
    if (rejectCrossOrigin(request, reply)) return;
    reply.header("Set-Cookie", clearCookie(isSecureRequest(request)));
    return reply.code(204).send();
  });
}
