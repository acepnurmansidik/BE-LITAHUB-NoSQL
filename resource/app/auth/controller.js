const { jwt } = require("../../utils/config");
const AuthUser = require("../models/Auth.model");
const UserSchema = require("../models/Users.model");
const bcrypt = require("bcrypt");
const { BadRequestError, NotFoundError } = require("../../utils/errors");
const globalService = require("../../helper/global-func");
const { default: mongoose } = require("mongoose");
const crudServices = require("../../helper/crudService");
const ReffParameter = require("../models/ReffParam.model");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

controller.Register = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    /* 
    #swagger.tags = ['Authentication']
    #swagger.summary = 'Register a new user account'
    #swagger.description = 'Create a new user account and issue authentication credentials.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create role',
      schema: { $ref: '#/definitions/BodyAuthRegisterSchema' }
    }
  */
    const { token, ...payload } = req.body;

    // komparasikan dengna yang ada di database
    const [isAvailable, defaultRole] = await Promise.all([
      AuthUser.findOne({ email: payload.email }).lean(),
      ReffParameter.findOne({ type: "role", value: "members" }).lean(),
    ]);

    if (isAvailable) {
      throw new BadRequestError("Email has been register!");
    }

    if (!defaultRole) {
      throw new BadRequestError("Role not found!");
    }

    // lakukan enkripsi pada password
    payload.password = await bcrypt.hash(
      payload.password,
      parseInt(jwt.saltEncrypt),
    );

    const auth = new AuthUser({ ...payload });
    await auth.save({ session });

    const [userResult] = await UserSchema.create(
      [
        {
          auth_id: auth._id,
          device_token: token,
          name: auth.username,
          role_id: defaultRole._id,
        },
      ],
      { session },
    );

    await LogActionModel.create(
      [
        {
          target_id: userResult._id,
          source: UserSchema.collection.collectionName,
          activities: [
            {
              type: "CREATE",
              after: userResult,
            },
          ],
        },
      ],
      { session },
    );

    // Jika semua operasi berhasil, commit transaksi
    await session.commitTransaction();

    res
      .status(200)
      .json({ status: true, message: "Register Success", data: null });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

controller.Login = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['Authentication']
    #swagger.summary = 'Log in'
    #swagger.description = 'Authenticate a user with email and password and return a JWT access token.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create role',
      schema: { $ref: '#/definitions/BodyAuthLoginSchema' }
    }
  */
    const { email, password } = req.body;
    // komparasikan data darai body dengan di databse

    const isAvailable = await crudServices.findOne(AuthUser, {
      query: { email },
      selectField: "-createdAt",
    });

    if (!isAvailable.data) {
      throw new NotFoundError("Email not register!");
    }

    const isMatch = await bcrypt.compare(password, isAvailable.data.password);
    if (!isMatch) {
      throw new BadRequestError("Please check your password!");
    }

    const populateField = [
      {
        path: "role_id",
        model: "Role",
        select: "_id name path_access",
        populate: {
          path: "path_access",
          model: "PathAccess",
          select: "path actions -_id",
        },
      },
    ];

    const users = await UserSchema.findOne({ auth_id: isAvailable.data._id })
      .select("-auth_id -device_token -created_at -updated_at")
      .populate(populateField)
      .lean(); // .lean() mengubah data menjadi objek literal JS biasa

    if (!users) {
      throw new NotFoundError("User profile data not found!");
    }

    const token = globalService.generateJwtToken({
      email,
      name: isAvailable.data.username,
    });

    res.status(200).json({
      status: true,
      message: "Login success!",
      data: {
        ...users,
        token,
        path_access: users.role_id?.path_access ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
};

controller.recoveryPassword = async (req, res, next) => {
  /*
    #swagger.tags = ['Authentication']
    #swagger.summary = 'Recover password'
    #swagger.description = 'Reset a user password using the account recovery flow.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create role',
      schema: { $ref: '#/definitions/BodyAuthForgotSchema' }
    }
  */
  try {
    const { email, password, confirm_password } = req.body;

    const isAvailable = await AuthUser.findOne({ email });

    if (!isAvailable) {
      throw new BadRequestError("Email not found!");
    }

    if (password !== confirm_password) {
      throw new BadRequestError("Please check your password!");
    }

    const result = await crudServices.update(AuthUser, {
      fieldSearch: { email },
      data: {
        password: await bcrypt.hash(password, parseInt(jwt.saltEncrypt)),
      },
    });

    const token = globalService.generateJwtToken({
      email,
      name: result.data.username,
    });

    res.status(200).json({
      status: true,
      message: "Login success!",
      data: {
        _id: result.data._id,
        name: result.data.username,
        email: result.data.email,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
