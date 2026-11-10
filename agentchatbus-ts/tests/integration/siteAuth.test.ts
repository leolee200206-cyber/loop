import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerSiteAuthRoutes } from "../../src/transports/http/siteAuth.js";

const FIXTURE_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const OTHER_KEY = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

function setCookieHeader(headers: Record<string, unknown>): string {
  const raw = headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === "string" ? first : "";
}

function cookieValue(headers: Record<string, unknown>): string {
  return setCookieHeader(headers).split(";")[0] || "";
}

function sessionCookieFrom(headers: Record<string, unknown>): string {
  const pair = cookieValue(headers);
  return pair.startsWith("acb_site_session=") ? pair : "";
}

describe("site auth module (isolated)", () => {
  let app: ReturnType<typeof Fastify>;
  let valid: boolean;
  let nowMs: number;

  async function build(options?: { key?: string | null; verify?: (u: string, p: string) => Promise<boolean>; startNow?: number }) {
    nowMs = options?.startNow ?? 1_700_000_000_000;
    valid = true;
    app = Fastify({ logger: false });
    registerSiteAuthRoutes(app, {
      sessionKey: options && "key" in options ? (options.key as string) : FIXTURE_KEY,
      now: () => nowMs,
      verifyCredentials: options?.verify ?? (async (_u, p) => valid && p === "correct-password"),
    });
    await app.ready();
    return app;
  }

  beforeEach(async () => {
    await build();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("serves a visible Chinese login page (200) with no auth cookie required", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/login-page" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("AgentChatBus 登录");
    expect(res.body).toContain('name="username"');
    expect(res.body).toContain('name="password"');
    expect(res.body).toContain("system-ui");
    expect(res.body.toLowerCase()).not.toContain("cdn.jsdelivr");
    expect(res.body.toLowerCase()).not.toContain("fonts.googleapis");
    expect(setCookieHeader(res.headers)).toBe("");
  });

  it("preserves the gateway's safe original page and rejects an external return path", async () => {
    const res = await app.inject({ url: "/auth/login-page", headers: { "x-original-uri": "/static/browser-agent.html?thread_id=fixture" } });
    expect(res.body).toContain('name="next" value="/static/browser-agent.html?thread_id=fixture"');
    const unsafe = await app.inject({ url: "/auth/login-page", headers: { "x-original-uri": "//evil.invalid/" } });
    expect(unsafe.body).toContain('name="next" value="/"');
  });

  it("sets acb_site_session cookie on correct credentials and /auth/check returns 204", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "zjkll.kdns.fr" },
      payload: "username=admin&password=correct-password&next=%2Fstatic%2Fbrowser-agent.html",
    });
    expect(login.statusCode).toBe(303);
    expect(login.headers.location).toBe("/static/browser-agent.html");
    expect(login.headers["www-authenticate"]).toBeUndefined();
    const setCookie = setCookieHeader(login.headers);
    expect(setCookie).toContain("acb_site_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).not.toMatch(/Max-Age=0/i);
    expect(setCookie).not.toContain("acb_browser_identity");
    expect(login.body).not.toContain("correct-password");

    const check = await app.inject({ method: "GET", url: "/auth/check", headers: { cookie: sessionCookieFrom(login.headers) } });
    expect(check.statusCode).toBe(204);
    expect(check.headers["www-authenticate"]).toBeUndefined();
  });

  it("adds Secure on HTTPS/proxied requests", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json", host: "zjkll.kdns.fr", "x-forwarded-proto": "https" },
      payload: { username: "admin", password: "correct-password" },
    });
    expect(login.statusCode).toBe(303);
    expect(setCookieHeader(login.headers).toLowerCase()).toContain("secure");
  });

  it("shows visible feedback on wrong password without granting a cookie", async () => {
    valid = false;
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "zjkll.kdns.fr" },
      payload: "username=admin&password=wrong-password&next=%2F",
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["www-authenticate"]).toBeUndefined();
    expect(login.headers["content-type"]).toContain("text/html");
    expect(setCookieHeader(login.headers)).toBe("");
    expect(login.body).toContain("用户名或密码错误");
    expect(login.body).toContain('value="admin"');
    expect(login.body).not.toContain("wrong-password");
  });

  it("rejects missing, tampered, expired, and agent cookies on /auth/check", async () => {
    const missing = await app.inject({ method: "GET", url: "/auth/check" });
    expect(missing.statusCode).toBe(401);
    expect(missing.headers["www-authenticate"]).toBeUndefined();

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json", host: "zjkll.kdns.fr" },
      payload: { username: "admin", password: "correct-password" },
    });
    const good = sessionCookieFrom(login.headers);
    expect(good).toBeTruthy();

    const tamperedValue = good.replace("acb_site_session=", "acb_site_session=x");
    const tampered = await app.inject({ method: "GET", url: "/auth/check", headers: { cookie: tamperedValue } });
    expect(tampered.statusCode).toBe(401);

    nowMs += 8 * 60 * 60 * 1000 + 1;
    const expired = await app.inject({ method: "GET", url: "/auth/check", headers: { cookie: good } });
    expect(expired.statusCode).toBe(401);

    await app.close();
    await build();
    const agentCookie = await app.inject({ method: "GET", url: "/auth/check", headers: { cookie: "acb_browser_identity=agent.token" } });
    expect(agentCookie.statusCode).toBe(401);
  });

  it("does not accept a site cookie signed with a different key", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json", host: "zjkll.kdns.fr" },
      payload: { username: "admin", password: "correct-password" },
    });
    const cookie = sessionCookieFrom(login.headers);
    await app.close();
    await build({ key: OTHER_KEY });
    const check = await app.inject({ method: "GET", url: "/auth/check", headers: { cookie } });
    expect(check.statusCode).toBe(401);
  });

  it("blocks unsafe next redirects and escapes reflected values", async () => {
    for (const badNext of ["//evil.invalid/phish", "https://evil.invalid", "/\\evil", "/ok\r\nx:1"]) {
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "content-type": "application/x-www-form-urlencoded", host: "zjkll.kdns.fr" },
        payload: `username=admin&password=correct-password&next=${encodeURIComponent(badNext)}`,
      });
      expect(login.statusCode).toBe(303);
      expect(login.headers.location).toBe("/");
    }

    const page = await app.inject({ method: "GET", url: "/auth/login-page?next=//evil.invalid&username=%3Cscript%3E" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('value="/"');
    expect(page.body).not.toContain("<script>");
    expect(page.body).toContain("&lt;script&gt;");
  });

  it("rejects cross-origin login/logout attempts", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json", host: "zjkll.kdns.fr", origin: "https://evil.invalid" },
      payload: { username: "admin", password: "correct-password" },
    });
    expect(login.statusCode).toBe(403);
    expect(setCookieHeader(login.headers)).toBe("");

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { host: "zjkll.kdns.fr", origin: "https://evil.invalid" },
    });
    expect(logout.statusCode).toBe(403);
  });

  it("fails closed when verifier throws or site key is unavailable", async () => {
    await app.close();
    await build({ verify: async () => { throw new Error("boom"); } });
    const boom = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json", host: "zjkll.kdns.fr" },
      payload: { username: "admin", password: "correct-password" },
    });
    expect(boom.statusCode).toBe(200);
    expect(setCookieHeader(boom.headers)).toBe("");

    await app.close();
    await build({ key: "" });
    const noKey = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json", host: "zjkll.kdns.fr" },
      payload: { username: "admin", password: "correct-password" },
    });
    expect(noKey.statusCode).toBe(200);
    expect(setCookieHeader(noKey.headers)).toBe("");
    const check = await app.inject({ method: "GET", url: "/auth/check" });
    expect(check.statusCode).toBe(401);
  });

  it("rate limits repeated login attempts", async () => {
    await app.close();
    valid = false;
    await build();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "content-type": "application/json", host: "zjkll.kdns.fr" },
        payload: { username: "admin", password: "wrong-password" },
      });
      last = res.statusCode;
      if (i >= 10) expect(res.body).toContain("过于频繁");
    }
    expect(last).toBe(200);
  });
});
