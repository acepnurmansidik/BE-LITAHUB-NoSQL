const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const fs = require("fs");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");

// Swagger
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger-output.json");
// Scalar API Reference (alternatif dokumentasi, spec sama dgn Swagger)
const { mountScalar } = require("./resource/helper/scalar-docs");

const app = express();
const memory = require("process").memoryUsage();

// Menentukan direktori untuk file gambar
const imagesDirectory = path.join(__dirname, "uploads", "images");
const imagesDoc = path.join(__dirname, "uploads", "doc");
const imagesCSV = path.join(__dirname, "uploads", "csv");

// Menggunakan middleware express.static untuk menyajikan file statis
app.use("/uploads/images", express.static(imagesDirectory));
app.use("/uploads/doc", express.static(imagesDoc));
app.use("/uploads/csv", express.static(imagesCSV));

// import router categories
const indexRouter = require("./routes");
const notFoundMiddleware = require("./resource/middleware/not-found");
const handleErrorMiddleware = require("./resource/middleware/handle-error");
const { setupLogger } = require("./resource/helper/global-func");
const { runMainSeeder, runFinanceSeeder } = require("./resource/seed");

// Middleware untuk logging dengan waktu yang diperbarui
app.use(
  helmet({
    // Content Security Policy (CSP) perlu disesuaikan jika menggunakan Swagger UI
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "blob:"], // Mengizinkan gambar dari server sendiri dan data URI
        "script-src": ["'self'", "'unsafe-inline'"], // Swagger UI + Scalar (bundle self-host) di-serve dari origin sendiri
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
      },
    },
    // Cross-Origin Resource Policy (CORP)
    // Penting agar file statis (gambar/uploads) bisa diakses oleh frontend yang berbeda domain
    crossOriginResourcePolicy: { policy: "cross-origin" },

    // Menyembunyikan informasi teknologi server (X-Powered-By)
    hidePoweredBy: true,

    // Mencegah clickjacking
    xFrameOptions: { action: "deny" },
  }),
);
app.use(cors());
app.use((req, res, next) => {
  const options = {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };

  const currentDateTime = new Intl.DateTimeFormat("id-ID", options)
    .format(new Date())
    .replaceAll("/", "-");

  // Store the start time for response time calculation
  const start = Date.now();

  const memoryUsage = `[MEM: ${`${(memory.rss / 1024 / 1024).toFixed(2)}MB`}]`;
  let logFormat = `[${currentDateTime}]::${memoryUsage}:: ${req.method}:${res.statusCode} :: ${req.url}`;
  res.on("finish", () => {
    logFormat = logFormat + ` - ${Date.now() - start} ms`;
    setupLogger(currentDateTime.split(", ")[0], logFormat);
    console.log(logFormat);
  });

  next();
});

app.use(express.json());
// Sanitasi input in-place (Express 5: req.query read-only, tidak boleh di-reassign)
app.use((req, res, next) => {
  ["body", "params", "query"].forEach((key) => {
    if (req[key]) mongoSanitize.sanitize(req[key]);
  });
  next();
});
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
// Scalar API Reference tersedia di /reference (spec: /reference/openapi.json)
mountScalar(app, swaggerDocument, "/reference");

runMainSeeder();
runFinanceSeeder();
// membuat variabel v1
const v1 = "/api/v1";

// gunakan categories router
app.use(v1, indexRouter);

// middleware
app.use(notFoundMiddleware);
app.use(handleErrorMiddleware);

module.exports = app;
