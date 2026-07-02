const AuthUser = require("../app/models/Auth.model");
const UserModel = require("../app/models/Users.model");
const globalService = require("../helper/global-func");
const ENV = require("../utils/config");
const { UnauthenticatedError } = require("../utils/errors");
const NotFound = require("../utils/errors/not-found");

const AuthorizeUserLogin = async (req, res, next) => {
  try {
    // get JWT token from header
    const authHeader =
      req.headers?.authorization?.split(" ")[
        req.headers.authorization.split(" ").length - 1
      ];

    // send error Token not found
    if (
      !authHeader ||
      !req.headers.authorization ||
      (ENV.server.nodeEnv === "production" &&
        !req.headers["x-api-key"]?.length) ||
      (ENV.server.nodeEnv === "production" &&
        req.headers["x-api-key"] !== ENV.server.apiKey)
    )
      throw new UnauthenticatedError("Invalid credentials!");

    // verify JWT token
    const dataValid = await globalService.verifyJwtToken(authHeader, next);

    // check email is register on database
    const verifyData = await AuthUser.findOne({
      email: dataValid.email,
    }).lean();

    // send error not found, if data not register
    if (!verifyData) throw new NotFound("Data not register!");
    const userLogin = await UserModel.findOne({
      auth_id: verifyData._id,
    })
      .populate({
        path: "role_id",
        model: "Role",
        select: "_id name path_access",
      })
      .lean();

    // impliment login user
    delete dataValid.iat;
    delete dataValid.exp;
    delete dataValid.jti;

    req.login = {
      ...dataValid,
      auth_id: verifyData._id,
      user_id: userLogin._id,
      device_token: userLogin.device_token,
      role_id: userLogin.role_id._id,
      role_name: userLogin.role_id.name,
      has_access: userLogin.role_id.path_access,
    };

    // next to controller
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = AuthorizeUserLogin;
