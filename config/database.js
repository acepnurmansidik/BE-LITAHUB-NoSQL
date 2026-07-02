// (1) import package mongoose
const mongoose = require("mongoose");

// (2) kita import konfigurasi terkait MongoDB dari app/config.js
const { urlDb } = require("../resource/utils/config", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function connectDB() {
  mongoose.connection.on("connected", () => {
    console.log("✅ [DATABASE] MongoDB connection established");
  });
  mongoose.connection.on("error", () => {
    console.error(
      "❌ [DATABASE] Connection error: Failed to connect to MongoDB",
    );
  });

  // (3) connect ke MongoDB menggunakan konfigurasi yang telah kita import
  await mongoose.connect(urlDb);

  // (4) simpan koneksi dalam constant db
  return mongoose.connection;
}

// (5) export db supaya bisa digunakan oleh file lain yang membutuhkan
module.exports = connectDB;
