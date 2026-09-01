const jwtToken = require("jsonwebtoken");
const { jwt, server, smtpConfig } = require("../utils/config");
const nodemailer = require("nodemailer");
const ImageSchema = require("../app/models/Image.model");
const { default: mongoose } = require("mongoose");
const path = require("path");
const fs = require("fs");
const globalService = {};

const transporter = nodemailer.createTransport({
  host: smtpConfig.host,
  port: smtpConfig.port,
  secure: smtpConfig.secure, // true for 465, false for other ports
  auth: {
    user: smtpConfig.senderEmail,
    // password device
    pass: smtpConfig.password,
  },
});

/**
 * -----------------------------------------------
 * | EMAIL
 * -----------------------------------------------
 * | if you wanna send email to yours friends
 * | or another people this function can do it
 * | don't worry this very secret, just you and me
 * |
 */
globalService.sendEmail = async ({ template, payload, receive, subject }) => {
  // Get template email from html file
  const tempFile = fs.readFileSync(
    `resource/templates/${template}.html`,
    "utf-8",
  );

  // create instance email/config email
  let message = {
    from: ENV.emailSender,
    to: receive,
    subject,
    html: Mustache.render(tempFile, payload),
  };

  // send email
  return await transporter.sendMail(message);
};

/**
 * -----------------------------------------------
 * | GENERATE JWT TOKEN
 * -----------------------------------------------
 * | if you wanna privacy data exchange
 * | this function can be help you
 * | and your privay keep safe using JWT
 * |
 */
globalService.generateJwtToken = ({ ...payload }) => {
  const jwtSignOptions = {
    algorithm: jwt.tokenAlgorithm,
    // expiresIn: jwt.tokenExp,
    jwtid: jwt.jwtId,
  };

  return jwtToken.sign(payload, jwt.secretKey, jwtSignOptions);
};

/**
 * -----------------------------------------------
 * | VERIFY JWT TOKEN
 * -----------------------------------------------
 * | if you wanna privacy data exchange
 */
globalService.verifyJwtToken = async (token, next) => {
  try {
    // verify token
    const decode = await jwtToken.verify(
      token,
      jwt.secretKey,
      (err, decode) => {
        if (err) throw new Error(err.message);
        if (!err) return decode;
      },
    );
    return decode;
  } catch (err) {
    console.log(err, "ERRROR====>");
    next(err);
  }
};

/**
 * -----------------------------------------------
 * | CREATE UNIQUE
 * -----------------------------------------------
 * | if you wanna privacy data exchange
 * |
 */
globalService.generateUniqueCode = ({ customeCode = "", lengthCode = 10 }) => {
  const tokenCode = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  let token = "";
  for (let i = 0; i < lengthCode; i++) {
    token += tokenCode.charAt(Math.floor(Math.random() * tokenCode.length));
  }
  return customeCode + "-" + token + Date.now();
};

/**
 * -----------------------------------------------
 * | CREATE OTP CODE
 * -----------------------------------------------
 * | if you wanna privacy data exchange
 * |
 */
globalService.generateOTPCode = () => {
  const tokenCode = "1234567890";
  const token = [];
  for (let i = 0; i < 5; i++) {
    token.push(tokenCode[~~(Math.random() * tokenCode.length + 1)]);
  }

  return token.join(""); // Totalnya 14 digit
};

/**
 * -----------------------------------------------
 * | UPLOAD FILES
 * -----------------------------------------------
 * | if you wanna privacy data exchange
 */
globalService.uploadFiles = async (files, source_name) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // `ordered: true` wajib saat create banyak dokumen dalam satu session.
    const fileResult = await ImageSchema.create(files, {
      session,
      ordered: true,
    });

    await session.commitTransaction();
    return fileResult;
  } catch (err) {
    await session.abortTransaction();
    throw new Error(err.message);
  } finally {
    await session.endSession();
  }
};

/**
 * -----------------------------------------------
 * | LOGGER
 * -----------------------------------------------
 * | Create logger directory and dated file
 */
globalService.setupLogger = (fileName, log) => {
  const loggerDir = path.join(__dirname, "../../logger");
  const dateFileName = `${fileName.split(" ")[0]}.txt`;
  const filePath = path.join(loggerDir, dateFileName);

  try {
    if (server.nodeEnv !== "production") return; // Skip logging in non-production environments
    // Create directory if it doesn't exist
    if (!fs.existsSync(loggerDir)) {
      fs.mkdirSync(loggerDir, { recursive: true });
      console.log(`Created logger directory: ${loggerDir}`);

      // Create parent directory for dated file if needed
      const dateDir = path.dirname(filePath);
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
      }

      // Write initial data to file
      fs.writeFileSync(filePath, `${log}\n`, "utf8");
      console.log(`Created file with initial data: ${filePath}`);
    } else {
      // Check if file exists
      if (fs.existsSync(filePath)) {
        // Append data to existing file
        fs.appendFileSync(filePath, `${log}\n`, "utf8");
      } else {
        // Create parent directories if needed
        const dateDir = path.dirname(filePath);
        if (!fs.existsSync(dateDir)) {
          fs.mkdirSync(dateDir, { recursive: true });
        }

        // Create new file
        fs.writeFileSync(filePath, `${log}\n`, "utf8");
        console.log(`Created new file with initial data: ${filePath}`);
      }
    }
  } catch (err) {
    console.error("Error in logger setup:", err);
    // You might want to throw the error here if this is critical setup
  }
};

/**
 * -----------------------------------------------
 * | SLUG
 * -----------------------------------------------
 * | Create slug from string
 */

globalService.createSlug = (text) => {
  return text
    .toString() // Memastikan input adalah string
    .toLowerCase() // Mengubah semua huruf menjadi kecil
    .trim() // Menghapus spasi di awal dan akhir string
    .replace(/\s+/g, "-") // Mengganti satu atau lebih spasi dengan satu tanda "-"
    .replace(/[^\w-]+/g, ""); // Opsional: Menghapus karakter non-alfanumerik kecuali "-" (agar URL bersih)
};

/**
 * -----------------------------------------------
 * | TITLE CASE
 * -----------------------------------------------
 * | Convert string to Title Case (Capitalize each word)
 * |
 * | @param {string} text - Input teks yang akan diubah formatnya
 * | @returns {string} String dengan huruf kapital di setiap awal kata
 * |
 * | Example:
 * | globalService.toTitleCase("mALL aNGGREK jAKARTA") -> "Mall Anggrek Jakarta"
 * | globalService.toTitleCase("room_unit_detail")     -> "Room Unit Detail"
 */
globalService.toTitleCase = (text) => {
  if (!text) return "";

  return text
    .toString() // Memastikan input adalah string
    .toLowerCase() // Mengubah semua huruf menjadi kecil terlebih dahulu
    .replace(/[_-]+/g, " ") // Mengganti tanda "_" atau "-" menjadi spasi
    .trim() // Menghapus spasi di awal dan akhir string
    .replace(/\s+/g, " ") // Menggabungkan multi-spasi menjadi satu spasi
    .replace(/\b\w/g, (char) => char.toUpperCase()); // Mengubah huruf pertama setiap kata menjadi kapital
};

/**
 * -----------------------------------------------
 * | MONTH RANGE
 * -----------------------------------------------
 * | Compute the [start, end) range of the month for a given date (UTC-based
 * | so it stays consistent across timezones). Used to check for duplicate
 * | records "within the same month".
 * |
 * | @param {string|number|Date} value - Any date-parseable value
 * | @returns {{start: Date, end: Date}|null} Month range, or null when the
 * |          date is invalid
 * |
 * | Example:
 * | globalService.monthRange("2026-08-15")
 * |   -> { start: 2026-08-01T00:00:00Z, end: 2026-09-01T00:00:00Z }
 */
globalService.monthRange = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
};

/**
 * -----------------------------------------------
 * | MONTH & YEAR FILTER RANGE
 * -----------------------------------------------
 * | Build a [start, end) Date range from a month and/or year filter (dipakai
 * | filter "misc > filter" di FE yang hanya menampilkan bulan & tahun).
 * | - month + year  -> rentang satu bulan pada tahun itu.
 * | - year saja     -> rentang sepanjang tahun.
 * | - month saja    -> bulan itu pada tahun berjalan.
 * | - keduanya kosong/invalid -> null (tanpa filter).
 * |
 * | @param {string|number} month - 1..12 (opsional)
 * | @param {string|number} year  - contoh 2026 (opsional)
 * | @returns {{start: Date, end: Date}|null}
 * |
 * | Example:
 * | globalService.monthYearRange(8, 2026)
 * |   -> { start: 2026-08-01T00:00:00Z, end: 2026-09-01T00:00:00Z }
 */
globalService.monthYearRange = (month, year) => {
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  const hasMonth = !Number.isNaN(m) && m >= 1 && m <= 12;
  const hasYear = !Number.isNaN(y);

  if (!hasMonth && !hasYear) return null;

  const baseYear = hasYear ? y : new Date().getUTCFullYear();
  if (hasMonth) {
    return {
      start: new Date(Date.UTC(baseYear, m - 1, 1)),
      end: new Date(Date.UTC(baseYear, m, 1)),
    };
  }
  return {
    start: new Date(Date.UTC(baseYear, 0, 1)),
    end: new Date(Date.UTC(baseYear + 1, 0, 1)),
  };
};

/**
 * -----------------------------------------------
 * | SET IMAGE STATUS
 * -----------------------------------------------
 * | Flip the `status` flag on an Image document (true = in use, false = freed).
 * | Safe to call with a null/undefined id (it is skipped). Pass a Mongoose
 * | session to run inside a transaction.
 * |
 * | @param {string|ObjectId|null} imageId - target Image id (skipped when falsy)
 * | @param {boolean} status - true = mark used, false = release
 * | @param {ClientSession} [session] - optional transaction session
 * | @returns {Promise<void>}
 * |
 * | Example:
 * | await globalService.setImageStatus(doc.image_id, true, session);
 */
globalService.setImageStatus = async (imageId, status, session) => {
  if (!imageId) return;
  await ImageSchema.findOneAndUpdate({ _id: imageId }, { status }, { session });
};

module.exports = globalService;
