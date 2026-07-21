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
const AppConfigModel = require("../app/models/AppConfig.model");
const AppReleaseLogModel = require("../app/models/AppReleaseLog.model");
const ComponentFormulaModel = require("../app/models/ComponentFormula.model");
const CalculatedFormulaModel = require("../app/models/CalculatedFormula.model");
const ChartOfAccountModel = require("../app/models/ChartOfAccount.model");
const JournalEntryModel = require("../app/models/JournalEntry.model");

// ============================================================
// SEEDER: COMPONENT FORMULA (data master rate)
// Fungsi terpisah — dipanggil SEBELUM seedCalculatedFormula karena
// calculated formula mereferensikan komponen-komponen di sini.
// Idempoten: upsert by slug.
// ============================================================
const COMPONENT_SEED = [
  {
    name: "Base Salary",
    slug: "base-salary",
    rate_type: "FIXED",
    fixed_rate: 5000000,
    decimal_place: 2,
  },
  {
    name: "Transport Allowance",
    slug: "transport-allowance",
    rate_type: "FIXED",
    fixed_rate: 500000,
    decimal_place: 2,
  },
  {
    name: "Meal Allowance",
    slug: "meal-allowance",
    rate_type: "FIXED",
    fixed_rate: 300000,
    decimal_place: 2,
  },
  {
    name: "Tax Rate",
    slug: "tax-rate",
    rate_type: "FIXED",
    fixed_rate: 0.05,
    decimal_place: 2,
  },
  {
    name: "Performance Bonus",
    slug: "performance-bonus",
    rate_type: "CALCULATED",
    calculated_rate: 1000000,
    decimal_place: 2,
  },
  {
    name: "Overtime Rate",
    slug: "overtime-rate",
    rate_type: "FIXED",
    fixed_rate: 75000,
    decimal_place: 0,
  },
];

const seedComponentFormula = async (session) => {
  for (const comp of COMPONENT_SEED) {
    await ComponentFormulaModel.findOneAndUpdate(
      { slug: comp.slug },
      {
        $set: {
          name: comp.name,
          slug: comp.slug,
          rate_type: comp.rate_type,
          fixed_rate: comp.fixed_rate ?? 0,
          calculated_rate: comp.calculated_rate ?? 0,
          decimal_place: comp.decimal_place ?? 2,
          is_delete: false,
        },
      },
      { upsert: true, session },
    );
  }
  console.log("✅ [SEEDERS] Component formula upserted successfully!");
};

// ============================================================
// SEEDER: CALCULATED FORMULA (definisi formula berbasis token)
// Fungsi terpisah — mengambil komponen yang SUDAH ADA (hasil
// seedComponentFormula) lewat lookup by slug, lalu menyusun ekspresi
// bergaya infix (mendukung prioritas operator & tanda kurung).
// Ikut menjaga reverse-reference component_id agar konsisten dgn controller.
// ============================================================
const seedCalculatedFormula = async (session) => {
  // Ambil komponen yang sudah ada di DB (by slug) → peta slug → dokumen.
  const components = await ComponentFormulaModel.find({
    is_delete: false,
  }).session(session);
  const bySlug = {};
  for (const c of components) bySlug[c.slug] = c;

  // Helper penyusun token ekspresi.
  const comp = (slug) => {
    const doc = bySlug[slug];
    if (!doc)
      throw new Error(`[SEEDER] Komponen "${slug}" tidak ditemukan di DB.`);
    return { type: "component", component: doc._id };
  };
  const num = (value) => ({ type: "constant", value });
  const op = (operator) => ({ type: "operator", operator });
  // Kurung buka membawa decimal_place + arah pembulatan SENDIRI (dinamis per
  // kurung) — tiap "(" boleh beda. Kurung tutup tak perlu apa-apa.
  //  rounding: "round" (terdekat) | "up" (ke atas) | "down" (ke bawah)
  //          | "none" (nilai asli, tanpa pembulatan).
  const lp = (dp, rounding = "round") => ({
    type: "paren",
    paren: "(",
    decimal_place: dp,
    rounding,
  });
  const rp = { type: "paren", paren: ")" };

  const FORMULA_SEED = [
    {
      // (1) SATU KURUNG:  ( Transport + Meal ) * 2
      //     Kurung dibulatkan KE ATAS ke 0 desimal; hasil akhir NORMAL 2 desimal.
      name: "Total Tunjangan",
      slug: "total-tunjangan",
      decimal_place: 2,
      rounding: "round",
      expression: [
        lp(0, "up"),
        comp("transport-allowance"),
        op("+"),
        comp("meal-allowance"),
        rp,
        op("*"),
        num(2),
      ],
    },
    {
      // (2) KURUNG BERSARANG + ANGKA DI DALAM KURUNG:
      //     ( Base Salary * ( Tax Rate + 1 ) )
      //     -> kurung dalam berisi angka (1), dan berada di dalam kurung luar.
      //     Tiap kurung beda dp & arah: kurung dalam presisi 4 KE BAWAH,
      //     kurung luar 2 normal; hasil akhir KE ATAS.
      name: "Gaji Kotor",
      slug: "gaji-kotor",
      decimal_place: 2,
      rounding: "up",
      expression: [
        lp(2, "round"),
        comp("base-salary"),
        op("*"),
        lp(4, "down"),
        comp("tax-rate"),
        op("+"),
        num(1),
        rp,
        rp,
      ],
    },
    {
      // (3) KURUNG BERSARANG DALAM + BANYAK KOMPONEN:
      //     ( ( Base + Performance Bonus ) * ( 1 + Tax Rate ) ) + Overtime
      //     Tiap kurung beda dp & arah: penjumlahan komponen 0 KE ATAS,
      //     faktor pajak TANPA pembulatan (nilai asli), kurung terluar 2 normal;
      //     hasil akhir KE BAWAH.
      name: "Total Pembayaran",
      slug: "total-pembayaran",
      decimal_place: 2,
      rounding: "down",
      expression: [
        lp(2, "round"),
        lp(0, "up"),
        comp("base-salary"),
        op("+"),
        comp("performance-bonus"),
        rp,
        op("*"),
        lp(4, "none"),
        num(1),
        op("+"),
        comp("tax-rate"),
        rp,
        rp,
        op("+"),
        comp("overtime-rate"),
      ],
    },
  ];

  for (const formula of FORMULA_SEED) {
    const saved = await CalculatedFormulaModel.findOneAndUpdate(
      { slug: formula.slug },
      {
        $set: {
          name: formula.name,
          slug: formula.slug,
          expression: formula.expression,
          decimal_place: formula.decimal_place,
          rounding: formula.rounding ?? "round",
          is_delete: false,
        },
      },
      { upsert: true, returnDocument: "after", session },
    );

    // Jaga reverse-reference (component_id) seperti controller:
    // 1) lepaskan formula ini dari SEMUA komponen (bersihkan sisa run lama),
    // 2) pasang kembali hanya ke komponen yang dipakai ekspresi ini.
    const usedComponentIds = [
      ...new Set(
        formula.expression
          .filter((t) => t.type === "component")
          .map((t) => String(t.component)),
      ),
    ];

    await ComponentFormulaModel.updateMany(
      { component_id: saved._id },
      { $pull: { component_id: saved._id } },
      { session },
    );
    if (usedComponentIds.length) {
      await ComponentFormulaModel.updateMany(
        { _id: { $in: usedComponentIds } },
        { $addToSet: { component_id: saved._id } },
        { session },
      );
    }
  }
  console.log("✅ [SEEDERS] Calculated formula upserted successfully!");
};

// ============================================================
// SEEDER: CHART OF ACCOUNT (COA) — Finance
// Fungsi TERPISAH (runFinanceSeeder). COA berhierarki tak terbatas, jadi data
// seed disusun sebagai POHON lalu ditelusuri rekursif: induk di-upsert lebih
// dulu agar `parent_id`/`level`/`path` anak bisa dihitung. Anak MEWARISI `type`
// dari induk (root menentukan type), persis kaidah di controller.
// Idempoten: upsert by `code`.
// ============================================================

// Peta tipe akun → saldo normal (samakan persis dengan controller COA).
const COA_NORMAL_BALANCE_BY_TYPE = {
  ASSET: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
  EXPENSE: "DEBIT",
  CAPITAL: "CREDIT",
  SALES: "CREDIT",
  COGS: "DEBIT",
  OTHER_INCOME_EXPENSE: "CREDIT",
  ADM_OPERATION_EXPENSE: "DEBIT",
  DEPRECIATION_AMORTIZATION: "DEBIT",
  OTHERS: "DEBIT",
};
const coaNormalBalanceFor = (type) =>
  COA_NORMAL_BALANCE_BY_TYPE[type] ?? "DEBIT";

// Definisi pohon COA standar. `type` hanya perlu di node root; turunan
// mewarisinya. `h: true` menandai akun header (grup) yang boleh punya anak.
const COA_SEED = [
  {
    code: "1000",
    name: "Assets",
    type: "ASSET",
    h: true,
    children: [
      {
        code: "1100",
        name: "Current Assets",
        h: true,
        children: [
          {
            code: "1110",
            name: "Cash & Bank",
            h: true,
            children: [
              { code: "1111", name: "Cash on Hand" },
              { code: "1112", name: "Bank - Checking" },
            ],
          },
          { code: "1120", name: "Accounts Receivable" },
          { code: "1130", name: "Inventory" },
        ],
      },
      {
        code: "1200",
        name: "Fixed Assets",
        h: true,
        children: [
          { code: "1210", name: "Equipment" },
          { code: "1220", name: "Accumulated Depreciation" },
        ],
      },
    ],
  },
  {
    code: "2000",
    name: "Liabilities",
    type: "LIABILITY",
    h: true,
    children: [
      {
        code: "2100",
        name: "Current Liabilities",
        h: true,
        children: [
          { code: "2110", name: "Accounts Payable" },
          { code: "2120", name: "Taxes Payable" },
        ],
      },
      {
        code: "2200",
        name: "Long-term Liabilities",
        h: true,
        children: [{ code: "2210", name: "Bank Loan" }],
      },
    ],
  },
  {
    code: "3000",
    name: "Equity",
    type: "EQUITY",
    h: true,
    children: [
      { code: "3100", name: "Owner's Capital" },
      { code: "3200", name: "Retained Earnings" },
    ],
  },
  {
    code: "4000",
    name: "Revenue",
    type: "REVENUE",
    h: true,
    children: [
      { code: "4100", name: "Sales Revenue" },
      { code: "4200", name: "Service Revenue" },
    ],
  },
  {
    code: "5000",
    name: "Expenses",
    type: "EXPENSE",
    h: true,
    children: [
      {
        code: "5100",
        name: "Operating Expenses",
        h: true,
        children: [
          { code: "5110", name: "Salaries Expense" },
          { code: "5120", name: "Rent Expense" },
          { code: "5130", name: "Utilities Expense" },
        ],
      },
      { code: "5200", name: "Depreciation Expense" },
    ],
  },
  {
    code: "6000",
    name: "Capital",
    type: "CAPITAL",
    h: true,
    children: [
      { code: "6100", name: "Owner's Capital" },
      { code: "6200", name: "Additional Paid-in Capital" },
    ],
  },
  {
    code: "7000",
    name: "Sales",
    type: "SALES",
    h: true,
    children: [
      { code: "7100", name: "Product Sales" },
      { code: "7200", name: "Service Sales" },
    ],
  },
  {
    code: "8000",
    name: "Cost of Goods Sold",
    type: "COGS",
    h: true,
    children: [
      { code: "8100", name: "Direct Materials" },
      { code: "8200", name: "Direct Labor" },
    ],
  },
  {
    code: "8500",
    name: "Adm & Operation Expense",
    type: "ADM_OPERATION_EXPENSE",
    h: true,
    children: [
      { code: "8510", name: "Office Supplies" },
      { code: "8520", name: "Rent Expense" },
      { code: "8530", name: "Utilities Expense" },
    ],
  },
  {
    code: "8700",
    name: "Depreciation & Amortization",
    type: "DEPRECIATION_AMORTIZATION",
    h: true,
    children: [
      { code: "8710", name: "Depreciation Expense" },
      { code: "8720", name: "Amortization Expense" },
    ],
  },
  {
    code: "9000",
    name: "Other Income & Expense",
    type: "OTHER_INCOME_EXPENSE",
    h: true,
    children: [
      { code: "9100", name: "Interest Income" },
      { code: "9200", name: "Interest Expense" },
    ],
  },
  {
    code: "9500",
    name: "Others",
    type: "OTHERS",
    h: true,
    children: [{ code: "9510", name: "Miscellaneous" }],
  },
];

const seedChartOfAccount = async (session) => {
  // Upsert satu node lalu turun ke anak-anaknya. `parent` = dokumen induk (null
  // untuk root). Type diwariskan dari induk; hanya root yang membawa `type`.
  const upsertNode = async (node, parent) => {
    const type = parent ? parent.type : node.type;
    const level = parent ? parent.level + 1 : 1;
    // Kode induk menjadi prefix otomatis (berjenjang sampai ke bawah), jadi
    // `node.code` di data seed diperlakukan sebagai SEGMEN LOKAL dan kode final
    // = path (mis. root "1000" → anak "1000.1100" → cucu "1000.1100.1110").
    const path = parent ? `${parent.path}.${node.code}` : node.code;

    const saved = await ChartOfAccountModel.findOneAndUpdate(
      { code: path },
      {
        $set: {
          code: path,
          name: node.name,
          type,
          normal_balance: coaNormalBalanceFor(type),
          is_header: node.h === true,
          parent_id: parent ? parent._id : null,
          level,
          path,
          is_delete: false,
        },
      },
      { upsert: true, returnDocument: "after", session },
    );

    for (const child of node.children ?? []) {
      await upsertNode(child, saved);
    }
  };

  for (const root of COA_SEED) {
    await upsertNode(root, null);
  }
  console.log("✅ [SEEDERS] Chart of account upserted successfully!");
};

// ============================================================
// SEEDER: JOURNAL ENTRY — Finance
// Butuh COA sudah tersemai (mereferensikan akun POSTABLE by code). Idempoten:
// dilewati bila entri contoh (dikenali dari `reference`) sudah ada.
// ============================================================
const seedJournalEntry = async (session) => {
  const REF = "SEED-CASH-SALE";

  const exists = await JournalEntryModel.findOne({ reference: REF }).session(
    session,
  );
  if (exists) {
    console.log("ℹ️ [SEEDERS] Journal entry sample already exists, skipped.");
    return;
  }

  // Ambil akun postable contoh berdasarkan kode final (materialized path).
  const [cash, sales] = await Promise.all([
    ChartOfAccountModel.findOne({ code: "1000.1100.1110.1111" }).session(session),
    ChartOfAccountModel.findOne({ code: "7000.7100" }).session(session),
  ]);
  if (!cash || !sales) {
    console.log(
      "⚠️ [SEEDERS] Journal entry sample skipped (referenced COA not found).",
    );
    return;
  }

  const lines = [
    {
      account_id: cash._id,
      account_code: cash.code,
      account_name: cash.name,
      description: "Cash received from product sale",
      debit: 1500000,
      credit: 0,
    },
    {
      account_id: sales._id,
      account_code: sales.code,
      account_name: sales.name,
      description: "Product sale revenue",
      debit: 0,
      credit: 1500000,
    },
  ];

  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  await JournalEntryModel.create(
    [
      {
        entry_no: `JE-${ym}-0001`,
        date: now,
        description: "Sample cash sale (seed)",
        reference: REF,
        status: "POSTED",
        lines,
        total_debit: 1500000,
        total_credit: 1500000,
      },
    ],
    { session },
  );
  console.log("✅ [SEEDERS] Journal entry sample upserted successfully!");
};

// Seeder Finance berdiri sendiri — dipanggil terpisah dari runMainSeeder.
const runFinanceSeeder = async () => {
  try {
    // Pastikan collection ada sebelum transaksi (hindari konflik catalog).
    await Promise.all(
      [ChartOfAccountModel, JournalEntryModel].map((m) =>
        m.createCollection().catch((err) => {
          if (err?.code !== 48) throw err; // 48 = NamespaceExists → aman diabaikan
        }),
      ),
    );

    await crudServices.runWithOptionalTransaction(async (session) => {
      await seedChartOfAccount(session);
      // Jurnal contoh butuh COA di atas sudah ada.
      await seedJournalEntry(session);
    });
  } catch (error) {
    console.error("❌ Finance seeder failed with error:", error);
  }
};

const runMainSeeder = async () => {
  try {
    // Pastikan collection sudah ada SEBELUM transaksi, agar insert pertama
    // di dalam transaksi tidak memicu pembuatan collection yang bisa
    // menyebabkan konflik catalog ("Unable to write ... due to catalog changes").
    await Promise.all(
      [
        ModuleModel,
        roleModel,
        RoleModuleModel,
        PathAccessModel,
        AuthUserModel,
        UsersModel,
        ComponentFormulaModel,
        CalculatedFormulaModel,
        ChartOfAccountModel,
      ].map((m) =>
        m.createCollection().catch((err) => {
          // 48 = NamespaceExists -> collection sudah ada, aman diabaikan
          if (err?.code !== 48) throw err;
        }),
      ),
    );

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
      console.log(
        "✅ [SEEDERS] Super Admin account & Role linked successfully!",
      );

      // ==========================================
      // SEEDER 2: PROSES MEMBUAT APPCONFIG FOR VERSION
      // ==========================================

      for (const everyPlatform of ["web", "android", "ios"]) {
        const platform = await AppConfigModel.findOneAndUpdate(
          { platform: everyPlatform },
          { $set: { platform: everyPlatform, latest_version: "1.0.0" } },
          { upsert: true, session },
        );

        // 2. Catat riwayatnya ke koleksi terpisah (AppReleaseLog)
        await AppReleaseLogModel.create(
          [
            {
              platform: everyPlatform,
              version_released: "1.0.0",
              release_notes: "Initial version release.",
              released_by: null, // jika ada context user admin
            },
          ],
          { session },
        );
      }

      console.log(
        "✅ [SEEDERS] Multi-platform app configurations & initial versions seeded successfully!",
      );

      // ==========================================
      // SEEDER 4: COMPONENT FORMULA
      // ==========================================
      await seedComponentFormula(session);

      // ==========================================
      // SEEDER 5: CALCULATED FORMULA (butuh komponen di atas)
      // ==========================================
      await seedCalculatedFormula(session);
    });
  } catch (error) {
    console.error("❌ Seeder failed with error:", error);
  }
};

module.exports = { runMainSeeder, runFinanceSeeder };
