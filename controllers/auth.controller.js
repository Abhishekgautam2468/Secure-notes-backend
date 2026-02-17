const bcrypt = require("bcrypt");
const crypto = require("crypto");
const User = require("../models/User");
const { createAccessToken, createRefreshToken, verifyRefreshToken, sha256Hex } = require("../utils/tokens");
const { isValidEmail, validatePasswordStrength } = require("../utils/validation");

function refreshCookieOptions() {
  const ttlMsRaw = process.env.REFRESH_TOKEN_TTL_MS;
  const ttlMs = ttlMsRaw ? Number(ttlMsRaw) : 7 * 24 * 60 * 60 * 1000;
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 7 * 24 * 60 * 60 * 1000
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sendValidation(res, errors) {
  return res.status(400).json({ message: "Validation error", errors });
}

async function register(req, res) {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  const errors = {};
  if (!name || name.length < 2) errors.name = "Name is required";
  if (!isValidEmail(email)) errors.email = "Valid email is required";
  const pw = validatePasswordStrength(password);
  if (!pw.ok) errors.password = pw.message;
  if (Object.keys(errors).length) return sendValidation(res, errors);

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    return res.status(409).json({ message: "Email already in use", errors: { email: "Email already in use" } });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash });

  const accessToken = createAccessToken({ userId: user._id.toString() });
  const { token: refreshToken, ttlMs } = createRefreshToken({ userId: user._id.toString() });
  await User.updateOne(
    { _id: user._id },
    {
      refreshTokenHash: sha256Hex(refreshToken),
      refreshTokenExpiresAt: new Date(Date.now() + ttlMs)
    }
  );

  res.cookie("refreshToken", refreshToken, refreshCookieOptions());
  return res.status(201).json({
    accessToken,
    user: { id: user._id.toString(), name: user.name, email: user.email }
  });
}

async function login(req, res) {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  const errors = {};
  if (!isValidEmail(email)) errors.email = "Valid email is required";
  if (!password) errors.password = "Password is required";
  if (Object.keys(errors).length) return sendValidation(res, errors);

  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ message: "Invalid email or password" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: "Invalid email or password" });

  const accessToken = createAccessToken({ userId: user._id.toString() });
  const { token: refreshToken, ttlMs } = createRefreshToken({ userId: user._id.toString() });

  user.refreshTokenHash = sha256Hex(refreshToken);
  user.refreshTokenExpiresAt = new Date(Date.now() + ttlMs);
  await user.save();

  res.cookie("refreshToken", refreshToken, refreshCookieOptions());
  return res.json({
    accessToken,
    user: { id: user._id.toString(), name: user.name, email: user.email }
  });
}

async function refresh(req, res) {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ message: "Missing refresh token" });

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.refreshTokenHash || !user.refreshTokenExpiresAt) {
    return res.status(401).json({ message: "Refresh token not recognized" });
  }

  const tokenHash = sha256Hex(token);
  const stored = user.refreshTokenHash;
  const storedBuf = Buffer.from(stored, "hex");
  const tokenBuf = Buffer.from(tokenHash, "hex");

  const hashMatches =
    storedBuf.length === tokenBuf.length && crypto.timingSafeEqual(storedBuf, tokenBuf) && user.refreshTokenExpiresAt > new Date();

  if (!hashMatches) {
    user.refreshTokenHash = null;
    user.refreshTokenExpiresAt = null;
    await user.save();
    res.clearCookie("refreshToken", refreshCookieOptions());
    return res.status(401).json({ message: "Refresh token reuse detected" });
  }

  const accessToken = createAccessToken({ userId: user._id.toString() });
  const { token: newRefreshToken, ttlMs } = createRefreshToken({ userId: user._id.toString() });

  user.refreshTokenHash = sha256Hex(newRefreshToken);
  user.refreshTokenExpiresAt = new Date(Date.now() + ttlMs);
  await user.save();

  res.cookie("refreshToken", newRefreshToken, refreshCookieOptions());
  return res.json({ accessToken });
}

async function logout(req, res) {
  const token = req.cookies?.refreshToken;
  if (token) {
    let payload;
    try {
      payload = verifyRefreshToken(token);
      await User.updateOne(
        { _id: payload.sub, refreshTokenHash: sha256Hex(token) },
        { refreshTokenHash: null, refreshTokenExpiresAt: null }
      );
    } catch {
      
    }
  }

  res.clearCookie("refreshToken", refreshCookieOptions());
  return res.json({ message: "Logged out" });
}

async function forgotPassword(req, res) {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) return sendValidation(res, { email: "Valid email is required" });

  const user = await User.findOne({ email });
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetTokenHash = sha256Hex(rawToken);
    user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
    const link = `${clientUrl}/auth/reset-password?userId=${user._id.toString()}&token=${rawToken}`;
    return res.json({
      message: "If the email exists, a reset link will be sent",
      resetLink: link
    });
  }

  return res.json({ message: "If the email exists, a reset link will be sent" });
}

async function resetPassword(req, res) {
  const userId = String(req.body?.userId || "");
  const token = String(req.body?.token || "");
  const newPassword = String(req.body?.password || "");

  const errors = {};
  if (!userId) errors.userId = "userId is required";
  if (!token) errors.token = "token is required";
  const pw = validatePasswordStrength(newPassword);
  if (!pw.ok) errors.password = pw.message;
  if (Object.keys(errors).length) return sendValidation(res, errors);

  const user = await User.findById(userId);
  if (!user || !user.passwordResetTokenHash || !user.passwordResetExpiresAt) {
    return res.status(400).json({ message: "Invalid or expired reset token" });
  }

  if (user.passwordResetExpiresAt <= new Date()) {
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    await user.save();
    return res.status(400).json({ message: "Invalid or expired reset token" });
  }

  const providedHash = sha256Hex(token);
  const stored = user.passwordResetTokenHash;
  const storedBuf = Buffer.from(stored, "hex");
  const tokenBuf = Buffer.from(providedHash, "hex");
  const matches = storedBuf.length === tokenBuf.length && crypto.timingSafeEqual(storedBuf, tokenBuf);
  if (!matches) return res.status(400).json({ message: "Invalid or expired reset token" });

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.refreshTokenHash = null;
  user.refreshTokenExpiresAt = null;
  await user.save();

  res.clearCookie("refreshToken", refreshCookieOptions());
  return res.json({ message: "Password updated successfully" });
}

async function me(req, res) {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({ user: { id: user._id.toString(), name: user.name, email: user.email } });
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  me
};
