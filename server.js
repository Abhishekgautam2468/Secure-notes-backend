const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const helmet = require("helmet");

const { connectDb, disconnectDb } = require("./config/db");
const authRoutes = require("./routes/auth.routes");
const notesRoutes = require("./routes/notes.routes");
const usersRoutes = require("./routes/users.routes");
const notificationsRoutes = require("./routes/notifications.routes");

dotenv.config();

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
const nodeEnv = process.env.NODE_ENV || "development";
const allowedOrigins = new Set([clientUrl, "http://localhost:3000", "http://localhost:3001"]);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      if (nodeEnv !== "production" && /^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/notifications", notificationsRoutes);

app.use((err, req, res, next) => {
  const status = err?.statusCode || 500;
  const message = err?.message || "Internal server error";
  if (status >= 500) {
    return res.status(status).json({ message });
  }
  return res.status(status).json({ message });
});

async function start() {
  await connectDb();
  const port = process.env.PORT ? Number(process.env.PORT) : 5050;
  const server = app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });

  async function shutdown() {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDb();
  }

  const handleSignal = (signal) => {
    shutdown()
      .then(() => {
        process.exit(0);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
