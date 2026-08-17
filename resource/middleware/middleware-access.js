const { UnauthorizedError } = require("../utils/errors");

const HasAccess = (path, action) => {
  return async (req, res, next) => {
    try {
      // Pastikan data login tersedia
      const ACCESS = req.login?.has_access ?? [];
      const role = req.login?.role_name ?? "";

      const permissionAccess = new Map(
        ACCESS.map((item) => [String(item.path), item.actions]),
      );

      if (
        !permissionAccess.get("/security/role") &&
        !["Super Ultraman"].includes(role)
      ) {
        throw new UnauthorizedError(`You do not have access to this module!`);
      }

      if (
        !permissionAccess.get("/security/role")[action.toLowerCase()] &&
        !["Super Ultraman"].includes(role)
      ) {
        throw new UnauthorizedError(
          `You do not have permission to perform this action!`,
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = HasAccess;

// Cara Penggunaan di Route:
// router.get("/module", HasAccess("/security/module", "view"), ModuleController.getAll);
