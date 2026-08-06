const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const ModuleModel = require("../models/Module.model");
const PathAccessModel = require("../models/PathAccess.model");
const RoleModuleModel = require("../models/RoleModule.model");
const controller = {};

// Normalisasi actions menjadi object { view: true, ... }.
// PathAccess menyimpan actions sebagai Map<String, Boolean>, sedangkan
// Module menyimpannya sebagai array string.
// Hanya action yang aktif yang dipertahankan — action yang dihapus atau
// bernilai false akan ikut terbuang, sehingga saat di-$set (menimpa penuh)
// field tersebut benar-benar hilang di PathAccess & RoleModule.
const toActionObject = (actions) => {
  // Format array: ["view","create"] -> { view: true, create: true }
  if (Array.isArray(actions)) {
    return actions.reduce((acc, action) => ({ ...acc, [action]: true }), {});
  }
  // Format object/Map: pertahankan hanya key yang bernilai truthy
  const entries =
    actions instanceof Map
      ? [...actions.entries()]
      : Object.entries(actions ?? {});
  return entries.reduce(
    (acc, [key, value]) => (value ? { ...acc, [key]: true } : acc),
    {},
  );
};

// Kumpulkan pasangan { path, actions } dari seluruh permission modul
// (menu utama + submenu/children) untuk disinkronkan ke PathAccess.
const collectPathActions = (permissions = []) => {
  const list = [];
  for (const perm of permissions) {
    list.push({ path: perm.path, actions: toActionObject(perm.actions) });
    for (const child of perm.children ?? []) {
      list.push({ path: child.path, actions: toActionObject(child.actions) });
    }
  }
  return list;
};

// Bangun ulang permission untuk RoleModule dalam format yang sama dengan
// seeder: bila punya children, actions parent dikosongkan dan actions child
// dikonversi ke object; bila tidak, actions parent yang dikonversi.
const buildRoleModulePermission = (permissions = []) =>
  permissions.map((perm) => {
    const hasChildren = perm.children && perm.children.length > 0;
    return {
      icon: perm.icon,
      menu_name: perm.menu_name,
      path: perm.path,
      actions: hasChildren ? {} : toActionObject(perm.actions),
      children: hasChildren
        ? perm.children.map((child) => ({
            name: child.name,
            path: child.path,
            actions: toActionObject(child.actions),
          }))
        : [],
    };
  });

controller.getAllModule = async (req, res, next) => {
  /*
    #swagger.tags = ['Module']
    #swagger.summary = 'List Modules'
    #swagger.description = 'Retrieve a paginated list of modules with optional search.'
    #swagger.parameters['search'] = { default: '', description: 'search by value' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const query = {};
    const populateField = [];
    const { search, page, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    if (search) {
      query["$or"] = [{ name: { $regex: search, $options: "i" } }];
    }

    const [page_size, result] = await Promise.all([
      ModuleModel.countDocuments(query),
      crudServices.findAllPagination(ModuleModel, {
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

controller.createModule = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['Module']
    #swagger.summary = 'Create Module'
    #swagger.description = 'Create a new module with its menu permission tree.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create Module',
      schema: { $ref: '#/definitions/BodyModuleSchema' }
    }
  */
    const payload = req.body;
    console.log(payload.permission[0].actions);
    payload.name = payload.name.toUpperCase();
    payload.slug = globalService.createSlug(payload.name);

    const result = await crudServices.create(ModuleModel, { data: payload });
    res.status(201).json({
      code: 201,
      success: true,
      message: "Module created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.updateModule = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['Module']
    #swagger.summary = 'Update Module'
    #swagger.description = 'Update a module and sync its permissions to related roles.'
    #swagger.parameters['id'] = { description: 'Module ID' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update Module',
      schema: { $ref: '#/definitions/BodyModuleSchema' }
    }
  */
    const { id } = req.params;
    const payload = req.body;

    // Ambil nama lama dulu untuk mencocokkan dokumen RoleModule terkait,
    // sebab nama modul bisa berubah pada update ini.
    const oldModule = await ModuleModel.findById(id).lean();
    if (!oldModule) throw new Error("Data not found!");

    payload.name = payload.name.toUpperCase();
    payload.slug = globalService.createSlug(payload.name);

    const result = await crudServices.update(ModuleModel, {
      id,
      data: payload,
    });

    // Sinkronkan actions ke PathAccess: setiap dokumen yang path-nya cocok
    // dengan permission modul di-update actions-nya sesuai hasil edit.
    const pathActions = collectPathActions(payload.permission);

    // Sinkronkan juga ke RoleModule (cocokkan lewat nama lama modul):
    // name, title, dan permission ikut diperbarui di semua role.
    const roleModulePermission = buildRoleModulePermission(payload.permission);

    await Promise.all([
      ...pathActions.map(({ path, actions }) =>
        PathAccessModel.updateMany({ path }, { $set: { actions } }),
      ),
      RoleModuleModel.updateMany(
        { name: oldModule.name },
        {
          $set: {
            name: payload.name,
            title: payload.title,
            permission: roleModulePermission,
          },
        },
      ),
    ]);

    res.status(200).json({
      code: 200,
      success: true,
      message: "Module updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.deleteModule = async (req, res, next) => {
  try {
    /*
    #swagger.tags = ['Module']
    #swagger.summary = 'Delete Module (soft delete)'
    #swagger.description = 'Soft delete a module by its ID.'
    #swagger.parameters['id'] = { description: 'Module ID' }
  */
    const { id } = req.params;
    const result = await crudServices.delete(ModuleModel, { id });
    res.status(200).json({
      code: 200,
      success: true,
      message: "Module deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
