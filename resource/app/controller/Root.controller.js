const semver = require("semver");
const AppConfigModel = require("../models/AppConfig.model");
const AppReleaseLogModel = require("../models/AppReleaseLog.model");

const controller = {};

// 1. DIBERSIHKAN & DISESUAIKAN: Mengambil konfigurasi aktif versi terbaru
controller.getLatestVersion = async (req, res, next) => {
  /*
    #swagger.tags = ['Application Configuration']
    #swagger.summary = 'Get active latest version'
    #swagger.description = 'Retrieve the current active and latest version configuration for a specific platform.'
    #swagger.parameters['platform'] = { in: 'query', required: true, type: 'string', description: 'Platform name (e.g., android, ios)' }
  */
  try {
    const { platform } = req.query;
    if (!platform) {
      return res.status(400).json({
        success: false,
        message: "Platform query parameter is required.",
      });
    }

    const result = await AppConfigModel.findOne({ platform }).lean();

    res.status(200).json({
      success: true,
      message: "Latest version configuration retrieved successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// 2. DIBERSIHKAN & DISESUAIKAN: Mengambil seluruh riwayat rilis versi
controller.getReleaseHistory = async (req, res, next) => {
  /*
    #swagger.tags = ['Application Configuration']
    #swagger.summary = 'Get version release history'
    #swagger.description = 'Retrieve the historical logs of all released versions filtered by platform.'
    #swagger.parameters['platform'] = { in: 'query', required: true, type: 'string', description: 'Platform name (e.g., android, ios)' }
  */
  try {
    const { platform } = req.query;
    if (!platform) {
      return res.status(400).json({
        success: false,
        message: "Platform query parameter is required.",
      });
    }

    const result = await AppReleaseLogModel.find({ platform })
      .sort({ createdAt: -1 }) // Urutkan dari rilis terbaru
      .lean();

    res.status(200).json({
      success: true,
      message: "Release history logs retrieved successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// 3. DIBERSIHKAN & DISESUAIKAN: Mengupdate versi dan otomatis mencatat log riwayat
controller.updateVersion = async (req, res, next) => {
  /*
    #swagger.tags = ['Application Configuration']
    #swagger.summary = 'Update platform version config'
    #swagger.description = 'Upgrade the platform to a newer semantic version and automatically create a release log entry.'
    #swagger.parameters['body'] = {
        in: 'body',
        description: 'Version update payload',
        required: true,
        schema: {
            platform: 'android',
            latest_version: '1.0.0',
            maintenance_message: 'Minor bug fixes and stability improvements.'
        }
    }
  */
  try {
    const { platform, latest_version, maintenance_message } = req.body;

    // 1. Validate required fields
    if (!platform || !latest_version) {
      return res.status(400).json({
        success: false,
        message: "Platform and latest_version fields are required.",
      });
    }

    // 2. Validate semantic versioning format
    if (!semver.valid(latest_version)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid version format. Please use Semantic Versioning rules (e.g., 1.0.0).",
      });
    }

    // 3. Find current platform version configuration
    const currentConfig = await AppConfigModel.findOne({ platform }).lean();

    if (currentConfig && currentConfig.latest_version) {
      // Check if the incoming version is lower than the current database version
      if (semver.lt(latest_version, currentConfig.latest_version)) {
        return res.status(400).json({
          success: false,
          message: `Update rejected. The new version (${latest_version}) is lower than the current active version (${currentConfig.latest_version}).`,
        });
      }

      // Check if the incoming version is identical to the current one
      if (semver.eq(latest_version, currentConfig.latest_version)) {
        return res.status(400).json({
          success: false,
          message: `The provided version is identical to the current active version (${currentConfig.latest_version}).`,
        });
      }
    }

    // 4. FIX BUG: Gunakan findOneAndUpdate dengan returnDocument agar mendapatkan objek data terupdate
    const updatedConfig = await AppConfigModel.findOneAndUpdate(
      { platform },
      { $set: { latest_version, maintenance_message } },
      { upsert: true, returnDocument: "after" }, // Menggunakan returnDocument standar Mongoose 9+
    ).lean();

    // 5. Simpan catatan riwayat menggunakan data riil hasil update database
    await AppReleaseLogModel.create({
      platform: updatedConfig.platform,
      version_released: updatedConfig.latest_version,
      released_by: req.login?.user_id ?? null,
      release_notes:
        updatedConfig.maintenance_message ||
        maintenance_message ||
        "No release notes provided.",
    });

    res.status(200).json({
      success: true,
      message: `Platform ${platform} version has been successfully updated to ${latest_version}.`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = controller;
