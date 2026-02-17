const { verifyAccessToken } = require("../utils/tokens");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");
  if (!token) {
    return res.status(401).json({ message: "Missing access token" });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired access token" });
  }
}

module.exports = { requireAuth };

