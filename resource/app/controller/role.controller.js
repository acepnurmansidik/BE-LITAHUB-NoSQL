const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const RoleModel = require("../models/Role.model");
const RoleModuleModel = require("../models/RoleModule.model");
const PathAccessModel = require("../models/PathAccess.model");
const logActionModel = require("../models/LogAction.model");
const ENV = require("../../utils/config");
const controller = {};

// Bangun & simpan dokumen anak (RoleModule + PathAccess) untuk sebuah role,
// terurut mengikuti `sequence` tiap module (kecil -> besar). Module tanpa
// sequence ditaruh paling belakang. Dipakai bersama oleh create & update agar
// urutan module selalu konsisten dengan sequence di role.
// Urutkan halaman (permission) sebuah module mengikuti `sequence` (kecil ->
// besar); halaman tanpa sequence memakai urutan aslinya. Halaman yang tidak
// dikirim payload otomatis terbuang (bisa dihapus/ditambah dari sisi frontend).
const orderPerms = (perms = []) =>
  [...(Array.isArray(perms) ? perms : [])]
    .map((p, i) => ({
      p,
      key: Number.isFinite(p?.sequence) ? p.sequence : i + 1,
    }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.p);

const createChildren = async (roleId, modules, session) => {
  const sorted = [...modules].sort(
    (a, b) => (a?.sequence ?? Infinity) - (b?.sequence ?? Infinity),
  );

  // 1. Dokumen RoleModule (satu per module) — sequence module & halaman ikut
  //    disimpan; halaman diurutkan mengikuti sequence-nya.
  const moduleDocs = sorted.map((mod, index) => ({
    role_id: roleId,
    name: mod.name,
    title: mod.title,
    sequence: mod.sequence ?? index + 1,
    permission: orderPerms(mod.permission),
  }));

  // 2. Dokumen PathAccess dari tiap menu (mengikuti urutan halaman).
  //    Menu tanpa children -> pakai path menu itu; ada children -> path child.
  const pathDocs = [];
  for (const mod of sorted) {
    for (const menu of orderPerms(mod.permission)) {
      const targets = menu.children?.length ? menu.children : [menu];
      for (const target of targets) {
        pathDocs.push({
          role_id: roleId,
          path: target.path,
          actions: target.actions,
        });
      }
    }
  }

  const [createdModules, createdPaths] = await Promise.all([
    RoleModuleModel.create(moduleDocs, { session, ordered: true }),
    PathAccessModel.create(pathDocs, { session, ordered: true }),
  ]);

  return {
    moduleIds: createdModules.map((d) => d._id),
    pathIds: createdPaths.map((d) => d._id),
  };
};

controller.getAllRole = async (req, res, next) => {
  /*
    #swagger.tags = ['Role']
    #swagger.summary = 'List Roles'
    #swagger.description = 'Retrieve a paginated list of roles with their access modules and path access.'
    #swagger.parameters['search'] = { default: '', description: 'search by value' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search } = req.query;

    const query = { is_delete: { $ne: true } };
    if (ENV.server.nodeEnv === "production") {
      query.slug = { $ne: "super-ultraman" };
    }
    if (search) {
      query["$or"] = [{ name: { $regex: search, $options: "i" } }];
    }

    const populateField = [
      {
        path: "has_access_module",
        model: "RoleModule",
        select: "-role_id -is_delete",
        options: { sort: { sequence: 1 } },
      },
      {
        path: "path_access",
        model: "PathAccess",
        select: "path actions -_id",
      },
    ];

    const [data, total] = await Promise.all([
      RoleModel.find(query)
        .populate(populateField)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      RoleModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: total,
      current_page: page,
    });
  } catch (err) {
    next(err);
  }
};

controller.createRole = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['Role']
    #swagger.summary = 'Create Role'
    #swagger.description = 'Create a new role along with its access modules and path access.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Role',
      schema: { $ref: '#/definitions/BodyRoleSchema' }
    }
  */
    const payload = req.body;
    payload.name = payload.name.toLowerCase();
    const slug = globalService.createSlug(payload.name);
    const modules = Array.isArray(payload.has_access_module)
      ? payload.has_access_module
      : [];

    const result = await crudServices.runWithOptionalTransaction(
      async (session) => {
        // 1. Buat dokumen Role dulu (arrays kosong) agar mendapat _id
        const [role] = await RoleModel.create(
          [
            {
              name: payload.name,
              slug,
              has_access_module: [],
              path_access: [],
            },
          ],
          { session },
        );

        // 2. Buat dokumen anak dengan role_id, lalu link balik ke Role
        const { moduleIds, pathIds } = await createChildren(
          role._id,
          modules,
          session,
        );
        role.has_access_module = moduleIds;
        role.path_access = pathIds;
        await role.save({ session });

        // 3. Log hanya untuk dokumen Role
        await logActionModel.create(
          [
            {
              target_id: role._id,
              source: RoleModel.collection.collectionName,
              activities: [{ type: "CREATE", after: role.toObject() }],
            },
          ],
          { session },
        );

        return role;
      },
    );

    res.status(201).json({
      code: 201,
      success: true,
      message: "Role created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.updateRole = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['Role']
    #swagger.summary = 'Update Role'
    #swagger.description = 'Update a role and rebuild its access modules and path access.'
    #swagger.parameters['id'] = { description: 'Role ID' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Role',
      schema: { $ref: '#/definitions/BodyRoleSchema' }
    }
  */
    const { id } = req.params;
    const payload = req.body;
    payload.name = payload.name.toLowerCase();
    const slug = globalService.createSlug(payload.name);
    const modules = Array.isArray(payload.has_access_module)
      ? payload.has_access_module
      : [];

    const result = await crudServices.runWithOptionalTransaction(
      async (session) => {
        const role = await RoleModel.findById(id).session(session);
        if (!role) throw new Error("Data not found!");

        const before = role.toObject();

        // 1. Hapus dokumen anak lama milik role ini, lalu buat ulang dari payload
        await Promise.all([
          RoleModuleModel.deleteMany({ role_id: id }, { session }),
          PathAccessModel.deleteMany({ role_id: id }, { session }),
        ]);

        // 2. Buat ulang dokumen anak (terurut mengikuti sequence module)
        const { moduleIds, pathIds } = await createChildren(
          id,
          modules,
          session,
        );

        // 3. Update dokumen Role dengan referensi anak yang baru
        role.name = payload.name;
        role.slug = slug;
        role.has_access_module = moduleIds;
        role.path_access = pathIds;
        await role.save({ session });

        // 5. Log hanya untuk dokumen Role
        await logActionModel.create(
          [
            {
              target_id: role._id,
              source: RoleModel.collection.collectionName,
              activities: [{ type: "UPDATE", before, after: role.toObject() }],
            },
          ],
          { session },
        );

        return role;
      },
    );

    res.status(200).json({
      code: 200,
      success: true,
      message: "Role updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.deleteRole = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['Role']
    #swagger.summary = 'Delete Role (soft delete)'
    #swagger.description = 'Soft delete a role and its related access modules and path access.'
    #swagger.parameters['id'] = { description: 'Role ID' }
  */
    const { id } = req.params;

    const result = await crudServices.runWithOptionalTransaction(
      async (session) => {
        const role = await RoleModel.findById(id).session(session);
        if (!role) throw new Error("Data not found!");

        const before = role.toObject();

        // Soft delete pada Role; anak (role_modules & path_accesses)
        // ikut di-soft-delete agar konsisten.
        role.is_delete = true;
        await role.save({ session });

        await Promise.all([
          RoleModuleModel.updateMany(
            { role_id: id },
            { is_delete: true },
            { session },
          ),
          PathAccessModel.updateMany(
            { role_id: id },
            { is_delete: true },
            { session },
          ),
        ]);

        await logActionModel.create(
          [
            {
              target_id: role._id,
              source: RoleModel.collection.collectionName,
              activities: [{ type: "DELETE", before, after: role.toObject() }],
            },
          ],
          { session },
        );

        return role;
      },
    );

    res.status(200).json({
      code: 200,
      success: true,
      message: "Role deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
