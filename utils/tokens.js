const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function getAccessTokenTtlMs() {
  const raw = process.env.ACCESS_TOKEN_TTL_MS;
  const n = raw ? Number(raw) : 1 * 60 * 1000;
  return Number.isFinite(n) && n > 0 ? n : 1 * 60 * 1000;
}

function getRefreshTokenTtlMs() {
  const raw = process.env.REFRESH_TOKEN_TTL_MS;
  const n = raw ? Number(raw) : 7 * 24 * 60 * 60 * 1000;
  return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 60 * 60 * 1000;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createAccessToken({ userId }) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is required");
  const ttlMs = getAccessTokenTtlMs();
  const expiresIn = Math.max(1, Math.floor(ttlMs / 1000));
  return jwt.sign({ sub: userId }, secret, { expiresIn });
}

function createRefreshToken({ userId }) {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET is required");
  const ttlMs = getRefreshTokenTtlMs();
  const expiresIn = Math.max(1, Math.floor(ttlMs / 1000));
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, jti }, secret, { expiresIn });
  return { token, jti, ttlMs };
}

function verifyAccessToken(token) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is required");
  return jwt.verify(token, secret);
}

function verifyRefreshToken(token) {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET is required");
  return jwt.verify(token, secret);
}

module.exports = {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getAccessTokenTtlMs,
  getRefreshTokenTtlMs,
  sha256Hex
};
