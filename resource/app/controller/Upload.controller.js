const globalService = require("../../helper/global-func");
const BadRequest = require("../../utils/errors/bad-request");

const controller = {};

// Ubah path absolut hasil multer (…/uploads/images/single/xxx.png) menjadi
// path publik yang bisa diakses lewat express.static ("/uploads/images/...").
const toPublicPath = (absPath) => {
  const normalized = String(absPath).replace(/\\/g, "/");
  const idx = normalized.indexOf("uploads/");
  const rel = idx >= 0 ? normalized.slice(idx) : normalized;
  return `/${rel.replace(/^\/+/, "")}`;
};

// Simpan daftar file (objek multer) ke koleksi Image, kembalikan {_id, path}.
const persistFiles = async (files) => {
  const payload = files.map((file) => ({ path: toPublicPath(file.path) }));
  const result = await globalService.uploadFiles(payload);
  return result.map((item) => ({ _id: item._id, path: item.path }));
};

controller.uploadSingle = async (req, res, next) => {
  /*
    #swagger.tags = ['File Upload']
    #swagger.summary = 'Upload single file'
    #swagger.description = 'Upload one file (jpg, jpeg, png, doc, docx, csv, pdf; max 15MB) via the multipart field `file`. Stored and recorded in the Image collection; returns the created id and public path.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['file'] = {
      in: 'formData',
      type: 'file',
      required: true,
      description: 'File to upload (field name: file)'
    }
    #swagger.responses[200] = {
      description: 'File uploaded successfully',
      schema: {
        success: true,
        message: 'File uploaded successfully!',
        data: { _id: '6a74f0bafd4e750846e87c14', path: '/uploads/images/single/1786048698299taio1cvbfpt0quaggn4ohwe.png' }
      },
      examples: {
        'application/json': {
          success: true,
          message: 'File uploaded successfully!',
          data: { _id: '6a74f0bafd4e750846e87c14', path: '/uploads/images/single/1786048698299taio1cvbfpt0quaggn4ohwe.png' }
        }
      }
    }
  */
  try {
    const files = req?.files?.file;
    if (!files || files.length === 0) {
      throw new BadRequest("No file uploaded. Use form field 'file'.");
    }

    const [data] = await persistFiles([files[0]]);

    res.status(200).json({
      success: true,
      message: "File uploaded successfully!",
      data,
    });
  } catch (err) {
    next(err);
  }
};

controller.uploadMultiple = async (req, res, next) => {
  /*
    #swagger.tags = ['File Upload']
    #swagger.summary = 'Upload multiple files'
    #swagger.description = 'Upload one or more files (jpg, jpeg, png, doc, docx, csv, pdf; max 15MB each, up to 10 files) via the multipart field `files`. Each file is stored and recorded in the Image collection; returns the created ids and public paths.'
    #swagger.consumes = ['multipart/form-data']
    #swagger.parameters['files'] = {
      in: 'formData',
      type: 'array',
      required: true,
      description: 'Files to upload (field name: files)',
      collectionFormat: 'multi',
      items: { type: 'file' }
    }
    #swagger.responses[200] = {
      description: 'Files uploaded successfully',
      schema: {
        success: true,
        message: '2 file(s) uploaded successfully!',
        data: [
          { _id: '6a74f097fd4e750846e87c12', path: '/uploads/images/multiple/1786048663928gqd1dsn8mec92dtnq0y9o5.png' },
          { _id: '6a74f097fd4e750846e87c13', path: '/uploads/images/multiple/178604866393323vzrtk3jzzsd96awjvisp.png' }
        ]
      },
      examples: {
        'application/json': {
          success: true,
          message: '2 file(s) uploaded successfully!',
          data: [
            { _id: '6a74f097fd4e750846e87c12', path: '/uploads/images/multiple/1786048663928gqd1dsn8mec92dtnq0y9o5.png' },
            { _id: '6a74f097fd4e750846e87c13', path: '/uploads/images/multiple/178604866393323vzrtk3jzzsd96awjvisp.png' }
          ]
        }
      }
    }
  */
  try {
    const files = req?.files?.files;
    if (!files || files.length === 0) {
      throw new BadRequest("No file uploaded. Use form field 'files'.");
    }

    const data = await persistFiles(files);

    res.status(200).json({
      success: true,
      message: `${data.length} file(s) uploaded successfully!`,
      data,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
