const { parseBody, parseCookies, sendJson } = require("../../lib/http");
const {
  makeId,
  hashPassword,
  verifyPassword,
  sanitizeUser,
  setSessionCookie,
  clearSessionCookie
} = require("../../lib/auth");

function createAuthHandler({ usersFile, readJson, writeJson, sessions, authUser }) {
  return async function handleAuth(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }

      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const name = String(body.name || "").trim() || "사용자";
      if (!email || !password || password.length < 6) {
        return sendJson(res, 400, { error: "invalid_input", message: "email/password(6+) 필요" });
      }

      const existing = await readJson(usersFile, { email });
      if (existing) {
        return sendJson(res, 409, { error: "email_exists" });
      }

      const user = {
        id: makeId(),
        email,
        name,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString()
      };
      await writeJson(usersFile, user);

      const token = makeId();
      sessions.set(token, user.id);
      setSessionCookie(res, token);
      return sendJson(res, 201, { user: sanitizeUser(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        return sendJson(res, 400, { error: "invalid_json" });
      }

      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = await readJson(usersFile, { email });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { error: "invalid_credentials" });
      }

      const token = makeId();
      sessions.set(token, user.id);
      setSessionCookie(res, token);
      return sendJson(res, 200, { user: sanitizeUser(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const cookies = parseCookies(req);
      if (cookies.session) sessions.delete(cookies.session);
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const user = await authUser(req);
      return sendJson(res, 200, { user: user ? sanitizeUser(user) : null });
    }

    return false;
  };
}

module.exports = {
  createAuthHandler
};
