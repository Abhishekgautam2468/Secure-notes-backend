const mongoose = require("mongoose");

async function connectDb() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUri);
}

async function disconnectDb() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
