const crypto = require("node:crypto");
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function makeId() {
  return crypto.randomBytes(12).toString("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, oldHash] = (stored || "").split(":");
  if (!salt || !oldHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(oldHash, "hex"));
}

function sanitizeUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role || "user", createdAt: user.createdAt };
}

function setSessionCookie(res, token) {
  const cookie = `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

module.exports = {
  makeId,
  hashPassword,
  verifyPassword,
  sanitizeUser,
  SESSION_MAX_AGE_SECONDS,
  setSessionCookie,
  clearSessionCookie
};
