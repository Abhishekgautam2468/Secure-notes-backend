const rateLimit = require("express-rate-limit");

const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later" }
});

module.exports = { authRateLimiter };
