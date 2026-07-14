const bcrypt = require("bcryptjs");
const roleModel = require("../app/models/Role.model");
const globalService = require("../helper/global-func");
const UsersModel = require("../app/models/Users.model");
const { USER_IAM } = require("../utils/etc/permission");
const ModuleModel = require("../app/models/Module.model");
const AuthUserModel = require("../app/models/Auth.model");
const RoleModuleModel = require("../app/models/RoleModule.model");
const PathAccessModel = require("../app/models/PathAccess.model");
const crudServices = require("../helper/crudService");

const runMainSeeder = async () => {
  try {
    // Jalankan di dalam transaction bila didukung; jika server standalone,
    // otomatis fallback tanpa session (semua operasi di bawah idempoten).
    await crudServices.runWithOptionalTransaction(async (session) => {
    // ==========================================
    // SEEDER 1: PROSES MEMBUAT MODULE
    // ==========================================
    for (const mod of USER_IAM) {
      const processedModule = {
        name: mod.name,
        title: mod.title,
        slug: globalService.createSlug(mod.name),
        permission: mod.permission.map((perm) => ({
          icon: perm.icon,
          menu_name: perm.menu_name,
          path: perm.path,
          actions: perm.actions,
          children: perm.children.map((child) => ({
            name: child.name,
            path: child.path,
            actions: child.actions,
          })),
        })),
      };

      await ModuleModel.findOneAndUpdate(
        { slug: processedModule.slug },
        { $set: processedModule },
        { upsert: true, session },
      );
    }
    console.log("✅ [SEEDERS] Modules upserted successfully!");

    // ==========================================
    // SEEDER 2: PROSES MEMBUAT ROLES
    // ==========================================

    const allModules = await ModuleModel.find({ is_delete: false }).session(
      session,
    );

    const roleSlug = "super-ultraman";
    const superUltramanData = {
      name: "Super Ultraman",
      slug: roleSlug,
      has_access_module: [], // Inisialisasi array kosong
      path_access: [],
    };

    // Helper function untuk mengubah array ["view", "create"] menjadi { view: true, create: true }
    const arrayToObjectActions = (actionsArray) => {
      const actionsObj = {};
      if (Array.isArray(actionsArray)) {
        actionsArray.forEach((action) => {
          actionsObj[action] = true;
        });
      } else if (actionsArray instanceof Map) {
        // Jika sudah berupa Map, konversi ke objek
        Object.fromEntries(actionsArray).forEach((val, key) => {
          actionsObj[key] = val;
        });
      } else {
        // Jika sudah objek, kembalikan apa adanya
        return actionsArray;
      }
      return actionsObj;
    };

    // Mapping has_access_module dengan pembersihan mendalam
    for (const mod of allModules) {
      const moduleItem = {
        name: mod.name,
        title: mod.title,
        permission: [],
      };

      for (const perm of mod.permission) {
        const hasChildren = perm.children && perm.children.length > 0;

        // Jika ada children, actions parent kosong, jika tidak, konversi ke object
        const permActions = hasChildren
          ? {}
          : arrayToObjectActions(perm.actions);

        const permissionItem = {
          icon: perm.icon,
          menu_name: perm.menu_name,
          path: perm.path,
          actions: permActions,
          children: [],
        };

        if (hasChildren) {
          for (const child of perm.children) {
            permissionItem.children.push({
              name: child.name,
              path: child.path,
              actions: arrayToObjectActions(child.actions), // Konversi ke object
            });
          }
        }

        moduleItem.permission.push(permissionItem);
      }
      superUltramanData.has_access_module.push(moduleItem);
    }

    // Logika path_access dengan konversi ke object
    for (const mod of allModules) {
      for (const perm of mod.permission) {
        if (perm.children && perm.children.length > 0) {
          for (const child of perm.children) {
            superUltramanData.path_access.push({
              path: child.path,
              actions: arrayToObjectActions(child.actions),
            });
          }
        } else {
          superUltramanData.path_access.push({
            path: perm.path,
            actions: arrayToObjectActions(perm.actions),
          });
        }
      }
    }

    // Upsert Role tanpa arrays — has_access_module & path_access kini
    // berada di collection terpisah dan direferensikan lewat ObjectId.
    const role = await roleModel.findOneAndUpdate(
      { slug: roleSlug },
      { $set: { name: superUltramanData.name, slug: roleSlug } },
      { upsert: true, returnDocument: "after", session },
    );

    // Re-seed dokumen anak: hapus lama lalu buat ulang agar idempoten.
    await Promise.all([
      RoleModuleModel.deleteMany({ role_id: role._id }, { session }),
      PathAccessModel.deleteMany({ role_id: role._id }, { session }),
    ]);

    const [createdModules, createdPaths] = await Promise.all([
      RoleModuleModel.create(
        superUltramanData.has_access_module.map((m) => ({
          role_id: role._id,
          ...m,
        })),
        { session, ordered: true },
      ),
      PathAccessModel.create(
        superUltramanData.path_access.map((p) => ({
          role_id: role._id,
          ...p,
        })),
        { session, ordered: true },
      ),
    ]);

    role.has_access_module = createdModules.map((d) => d._id);
    role.path_access = createdPaths.map((d) => d._id);
    await role.save({ session });
    console.log("✅ [SEEDERS] Role upserted successfully!");

    // ==========================================
    // SEEDER 3: PROSES MEMBUAT AKUN SUPER ADMIN
    // ==========================================
    const adminEmail = "superultraman@mail.com";
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash("password123", salt);

    const authUser = await AuthUserModel.findOneAndUpdate(
      { email: adminEmail },
      {
        username: "superultraman",
        email: adminEmail,
        password: hashedPassword,
        is_delete: false,
      },
      { upsert: true, returnDocument: "after", session },
    );

    await UsersModel.findOneAndUpdate(
      { auth_id: authUser._id },
      {
        auth_id: authUser._id,
        name: "Akun Super Admin",
        role_id: role._id,
        device_token: "",
        subscription_info: { status: "none" },
      },
      { upsert: true, returnDocument: "after", session },
    );

    console.log("✅ [SEEDERS] Super Admin account & Role linked successfully!");
    });
  } catch (error) {
    console.error("❌ Seeder failed with error:", error);
  }
};

module.exports = { runMainSeeder };
