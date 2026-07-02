const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const roleModel = require("../app/models/Role.model");
const globalService = require("../helper/global-func");
const UsersModel = require("../app/models/Users.model");
const GenreModel = require("../app/models/Genre.model");
const { USER_IAM } = require("../utils/etc/permission");
const ModuleModel = require("../app/models/Module.model");
const AuthUserModel = require("../app/models/Auth.model");

const runMainSeeder = async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const fullActions = {
    view: true,
    create: true,
    update: true,
    delete: true,
    import: true,
    export: true,
    pdf: true,
    whatsapp: true,
  };

  try {
    const defaultActions = [
      "view",
      "create",
      "update",
      "delete",
      "import",
      "export",
      "pdf",
      "whatsapp",
    ];

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

    const allModules = await ModuleModel.find({}).session(session);

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

    const role = await roleModel.findOneAndUpdate(
      { slug: roleSlug },
      { $set: superUltramanData },
      { upsert: true, returnDocument: "after", session }, // Gunakan returnDocument: 'after'
    );
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

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("❌ Seeder failed with error:", error);
  } finally {
    await session.endSession();
  }
};

const runSecondarySeeder = async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const fullActions = {
    view: true,
    create: true,
    update: true,
    delete: true,
    import: true,
    export: true,
    pdf: true,
    whatsapp: true,
  };

  try {
    // ==========================================
    // SEEDER 1: PROSES MEMBUAT GENRES (BARU)
    // ==========================================
    // Daftar genre film umum dan dewasa (18+)
    const genresToSeed = [
      // === GENRE UMUM / MAINSTREAM ===
      { name: "Action" },
      { name: "Adventure" },
      { name: "Animation" },
      { name: "Comedy" },
      { name: "Crime" },
      { name: "Documentary" },
      { name: "Drama" },
      { name: "Family" },
      { name: "Fantasy" },
      { name: "History" },
      { name: "Horror" },
      { name: "Music" },
      { name: "Mystery" },
      { name: "Romance" },
      { name: "Sci-Fi" },
      { name: "Thriller" },
      { name: "War" },
      { name: "Western" },

      // === SUB-GENRE POPULER & ANIME/MANGA ===
      { name: "Isekai" },
      { name: "Mecha" },
      { name: "Slice of Life" },
      { name: "Sports" },
      { name: "Supernatural" },
      { name: "Musical" },
      { name: "Cyberpunk" },
      { name: "Steampunk" },
      { name: "Psychological" },
      { name: "School" },
      { name: "Shounen" },
      { name: "Shoujo" },
      { name: "Seinen" },
    ];

    for (const genreData of genresToSeed) {
      // Standarisasi name menjadi lowercase sebelum di-slug (mengikuti aturan di controller genre Anda sebelumnya)
      const formattedName = genreData.name.toLowerCase();
      const slug = globalService.createSlug(formattedName);

      await GenreModel.findOneAndUpdate(
        { slug: slug }, // Cari berdasarkan slug uniknya
        {
          name: formattedName,
          slug: slug,
          is_adult: genreData.is_adult, // Otomatis terset true/false sesuai array di atas
          is_new: false,
          is_delete: false,
        },
        {
          upsert: true,
          returnDocument: "after",
          session,
          setDefaultsOnInsert: true,
        },
      );
    }
    console.log("✅ [SEEDERS] Genres upserted successfully!");

    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("❌ Seeder failed with error:", error);
  } finally {
    await session.endSession();
  }
};

module.exports = { runMainSeeder, runSecondarySeeder };
