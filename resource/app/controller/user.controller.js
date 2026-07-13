const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const RoleModel = require("../models/Role.model");
const UsersModel = require("../models/Users.model");
const controller = {};

controller.getAllUser = async (req, res, next) => {
  /*
    #swagger.tags = ['USERS / IAM']
    #swagger.summary = 'User'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['search'] = { default: '', description: 'search by value' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const query = {};
    const populateField = [
      { path: "role_id", model: "Role", select: "_id name path_access" },
      { path: "auth_id", model: "AuthUser", select: "_id username email" },
    ];
    const { search, page, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const arrFilter = [];
    if (search) {
      arrFilter.push({ name: { $regex: search, $options: "i" } });
    }
    if (arrFilter.length) query["$or"] = arrFilter;

    const [page_size, result] = await Promise.all([
      UsersModel.countDocuments(query),
      crudServices.findAllPagination(UsersModel, {
        query,
        populateField,
        skip,
        limit,
      }),
    ]);
    res.status(200).json({ ...result, page_size, current_page: Number(page) });
  } catch (err) {
    next(err);
  }
};

controller.getUserPermissionAccess = async (req, res, next) => {
  /*
    #swagger.tags = ['USERS / IAM']
    #swagger.summary = 'User'
    #swagger.description = 'untuk referensi group'
     #swagger.parameters['id'] = { description: 'User ID (UsersModel ID)' }
  */
  try {
    const populateField = [
      {
        path: "role_id",
        model: "Role",
        select: "_id name path_access has_access_module",
      },
      { path: "auth_id", model: "AuthUser", select: "_id username email" },
    ];
    const result = await UsersModel.findOne().populate(populateField).lean();
    res.status(200).json({
      success: true,
      message: "User has been retrieved!",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

controller.createUser = async (req, res, next) => {
  /*
      #swagger.tags = ['USERS / IAM']
      #swagger.summary = 'Create User'
      #swagger.parameters['id'] = { description: 'User ID (UsersModel ID)' }
      #swagger.parameters['obj'] = {
        in: 'body',
        schema: { $ref: '#/definitions/BodyUserIAMSchema' }
      }
    */
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { email, password, role_id, username, ...profileData } = req.body;

    // Validasi tunggal untuk efisiensi
    const [existingUser, role] = await Promise.all([
      AuthUserModel.findOne({ email, is_delete: false })
        .session(session)
        .lean(), // Hemat memori, lebih cepat
      RoleModel.findById(role_id) // Lebih efisien daripada findOne({ _id: ... })
        .where({ is_delete: false })
        .session(session)
        .lean(),
    ]);

    if (existingUser)
      return res
        .status(401)
        .json({ status: false, message: "Email already registered!" });
    if (!role)
      return res
        .status(404)
        .json({ status: false, message: "Role not found!" });

    // Enkripsi password
    const hashedPassword = await bcrypt.hash(
      password,
      parseInt(process.env.SALT_ROUNDS || 12),
    );

    // Create Auth User
    const [auth] = await AuthUserModel.create(
      [{ email, username, password: hashedPassword }],
      { session },
    );

    // Create User Profile
    const [user] = await UsersModel.create(
      [{ ...profileData, auth_id: auth._id, role_id }],
      { session },
    );

    await session.commitTransaction();

    res.status(201).json({
      code: 201,
      success: true,
      message: "User created successfully!",
      data: user,
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

controller.updateUser = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    /*
      #swagger.tags = ['USERS / IAM']
      #swagger.summary = 'Update User'
      #swagger.parameters['id'] = { description: 'User ID (UsersModel ID)' }
      #swagger.parameters['obj'] = {
        in: 'body',
        schema: { $ref: '#/definitions/BodyUserIAMSchema' }
      }
    */
    const { id } = req.params;
    const { name, email, password, role_id, ...otherFields } = req.body;

    const isRoleExist = await RoleModel.findOne({ _id: role_id }).lean();

    if (!isRoleExist) {
      return res
        .status(404)
        .json({ status: true, message: "Role not found!", data: null });
    }

    // 1. Cari data user & auth_id
    const userProfile = await UsersModel.findById(id).session(session);
    if (!userProfile) {
      return res
        .status(404)
        .json({ success: false, message: "User not found!" });
    }

    // 2. Update AuthUserModel (Email & Password jika ada)
    const authUpdate = {};
    if (email) authUpdate.email = email;
    if (password) {
      authUpdate.password = await bcrypt.hash(
        password,
        parseInt(jwt.saltEncrypt || 12),
      );
    }

    if (Object.keys(authUpdate).length > 0) {
      await AuthUserModel.findByIdAndUpdate(userProfile.auth_id, authUpdate, {
        session,
      });
    }

    // 3. Update UsersModel (Profile)
    const updatedUser = await UsersModel.findByIdAndUpdate(
      id,
      {
        name: name || userProfile.name,
        role_id: role_id || userProfile.role_id,
        ...otherFields,
      },
      {
        new: true,
        session,
      },
    );

    await session.commitTransaction();
    res.status(200).json({
      code: 200,
      success: true,
      message: "User updated successfully!",
      data: updatedUser,
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    await session.endSession();
  }
};

controller.deleteUser = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['USERS / IAM']
    #swagger.summary = 'User'
    #swagger.description = 'untuk referensi group'
    #swagger.parameters['id'] = { description: 'id role' }
  */
    const { id } = req.params;
    const result = await crudServices.delete(UsersModel, { id });
    res.status(200).json({
      code: 200,
      success: true,
      message: "User deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
