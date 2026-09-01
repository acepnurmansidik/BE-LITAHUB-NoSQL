// ============================================================
// SCALAR API REFERENCE
// Dokumentasi API alternatif (selain Swagger UI di /docs) memakai Scalar.
// Spec yang dipakai = swagger-output.json (hasil swagger-autogen), di-serve
// mentah di `${mount}/openapi.json`.
//
// Bundle Scalar di-SELF-HOST dari package `@scalar/api-reference`
// (dist/browser/standalone.js) — TIDAK memakai CDN jsdelivr. Folder
// `dist/browser` di-serve statis di `${mount}/assets`, sehingga dokumentasi
// tetap jalan tanpa internet dan CSP bisa dikunci ke `'self'`.
//
// Tag dikelompokkan ke section besar (Finance, Inventory, Procurement, dst)
// lewat extension `x-tagGroups` yang dibaca Scalar. Grouping di-inject saat
// serve (tidak perlu regenerate swagger) sehingga selalu sinkron dengan tag
// yang dipakai controller.
//
// Pemakaian di app.js:
//   const { mountScalar } = require("./resource/helper/scalar-docs");
//   mountScalar(app, swaggerDocument, "/reference");
// ============================================================

const path = require("path");
const express = require("express");

// Direktori bundle browser milik @scalar/api-reference (berisi standalone.js).
// Di-resolve dari entry utama package: dist/index.js -> ../browser.
const SCALAR_BROWSER_DIR = path.join(
  path.dirname(require.resolve("@scalar/api-reference")),
  "browser",
);

// Pengelompokan tag -> section. Nama tag harus sama persis dengan
// `#swagger.tags` pada controller.
const TAG_GROUPS = [
  {
    name: "AUTHENTICATION & ACCESS",
    // Deskripsi group (Markdown). Ditempelkan ke tag pertama ("Authentication")
    // sehingga tampil tepat di bawah nama group di Scalar.
    description:
      "Modul autentikasi & kontrol akses.\n\n" +
      "**Alur umum:** user login (`/auth/sign-in`) → menerima **JWT** → token dikirim di header `Authorization` pada tiap request. Hak akses ditentukan dari **Role** yang memiliki kumpulan **Module** (menu + aksi CRUD).\n\n" +
      "- **Authentication** — registrasi, login, recovery password.\n" +
      "- **User & IAM** — kelola user & permission access.\n" +
      "- **Role** — definisi peran + hak akses per module.\n" +
      "- **Module** — daftar menu/fitur yang dapat diakses.",
    tags: ["Authentication", "User & IAM", "Role", "Module"],
  },
  {
    name: "BILL",
    tags: ["IPL", "Parking"],
  },
  {
    name: "UTILITY",
    description:
      "Modul pencatatan pemakaian utilitas per unit (meter listrik & air) beserta tarif kendaraan.\n\n" +
      "**Logika meter (Electric & Water):** tiap bulan dicatat satu pembacaan meter per unit. Client **hanya mengirim `current_meter`** (angka meter saat ini); seluruh nilai turunan dihitung ulang & otoritatif di server:\n\n" +
      "- **`prev_meter`** — meter awal, diambil dari `current_meter` pencatatan **terakhir** unit tersebut (berdasarkan `date`). Bernilai `0` bila unit belum pernah dicatat. Endpoint `GET /{modul}/prev-meter?unit_id=` dipakai untuk prefill nilai ini di form.\n" +
      "- **`current_meter`** — satu-satunya input user (**wajib**), harus **≥ `prev_meter`** (ditolak bila lebih kecil).\n" +
      "- **`usage_meter`** — pemakaian = `current_meter − prev_meter` (dihitung server).\n" +
      "- **`actual_meter`** — di-set **hanya di backend** dari `usage_meter` (tidak diterima dari client).\n\n" +
      "**Aturan tambahan:**\n" +
      "- **Anti-duplikat:** satu unit hanya boleh punya satu pencatatan per bulan (rentang bulan dari `date`).\n" +
      "- **Filter list:** query `month` (1-12) & `year` menyaring data berdasarkan bulan/tahun `date` — bulan+tahun (satu bulan), tahun saja (sepanjang tahun), atau bulan saja (tahun berjalan).\n" +
      "- **Foto meter:** opsional via `image_id`; status gambar otomatis di-flag saat dipakai/dilepas.\n" +
      "- Semua mutasi CREATE/UPDATE/DELETE ditulis transaksional beserta audit log.",
    tags: ["Electric", "Water", "Vehicle Utility"],
  },
  {
    name: "FINANCE",
    tags: [
      "Chart of Account",
      "Journal Entry",
      "Journal Write Off",
      "Account Receivable",
      "Account Payable",
    ],
  },
  {
    name: "INVENTORY",
    tags: [
      "Product Category",
      "Unit of Measure",
      "Product",
      "Warehouse",
      "Supplier",
      "Stock Position",
      "Stock Movement",
    ],
  },
  {
    name: "PROCURMENT",
    tags: ["Purchase Request", "Purchase Order", "Good Receipt"],
  },
  {
    name: "EDIFICE MANAGEMENT",
    tags: [
      "Building",
      "Building Floor",
      "Unit",
      "Layout Component",
      "Vehicle Rate",
    ],
  },
  {
    name: "ORGANIZATION",
    tags: ["Department"],
  },
  {
    name: "CONFIGURATION",
    tags: [
      "App Configuration",
      "Reference Parameter",
      "Component Formula",
      "Calculated Formula",
    ],
  },
  {
    name: "ETC",
    tags: ["File Upload"],
  },
];

// Bangun spec ber-grouping: tambahkan `x-tagGroups` + `tags` (urut sesuai
// grup) tanpa mengubah dokumen asli.
//
// Catatan: `x-tagGroups` (standar Redoc) TIDAK punya field deskripsi, jadi
// Scalar tak merender `description` yang ditaruh langsung di objek group.
// Yang dirender Scalar adalah deskripsi per-TAG (root `tags[]`). Karena itu:
//   - `group.description`      -> ditempelkan ke TAG PERTAMA grup (tampil
//                                 tepat di bawah nama group; cocok untuk
//                                 gambaran umum / logic section).
//   - `group.tagDescriptions`  -> map { "Nama Tag": "deskripsi markdown" }
//                                 untuk deskripsi tiap fitur (opsional).
// Semua mendukung Markdown (heading, list, gambar `![alt](/path)`).
const buildGroupedSpec = (swaggerDocument) => {
  const descByTag = {};
  for (const group of TAG_GROUPS) {
    if (group.description && group.tags.length) {
      descByTag[group.tags[0]] = group.description;
    }
    if (group.tagDescriptions) {
      for (const [tag, desc] of Object.entries(group.tagDescriptions)) {
        descByTag[tag] = desc;
      }
    }
  }

  const orderedTags = TAG_GROUPS.flatMap((g) => g.tags).map((name) =>
    descByTag[name] ? { name, description: descByTag[name] } : { name },
  );

  // x-tagGroups cukup name + tags (buang field non-standar seperti description
  // agar spec tetap bersih; deskripsi sudah dipindah ke tag).
  const cleanGroups = TAG_GROUPS.map((g) => ({ name: g.name, tags: g.tags }));

  return {
    ...swaggerDocument,
    tags: orderedTags,
    "x-tagGroups": cleanGroups,
  };
};

// HTML halaman Scalar.
//  `specUrl`   = endpoint JSON OpenAPI,
//  `scriptUrl` = bundle Scalar yang di-self-host (bukan CDN),
//  `title`     = judul tab.
const buildScalarHtml = (specUrl, scriptUrl, title) => `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="${scriptUrl}"></script>
    <script>
      Scalar.createApiReference("#app", {
        url: "${specUrl}",
        theme: "default",
      });
    </script>
  </body>
</html>`;

// Pasang route Scalar pada Express `app`.
//  - `${mount}/assets/*`     : bundle Scalar self-host (standalone.js dkk),
//  - `${mount}/openapi.json` : serve spec (dengan grouping x-tagGroups),
//  - `${mount}`              : halaman Scalar API Reference.
const mountScalar = (app, swaggerDocument, mount = "/reference") => {
  const base = mount.replace(/\/+$/, "") || "";
  const specUrl = `${base}/openapi.json`;
  const assetsBase = `${base}/assets`;
  const scriptUrl = `${assetsBase}/standalone.js`;
  const groupedSpec = buildGroupedSpec(swaggerDocument);

  // Serve bundle Scalar dari node_modules (tanpa CDN).
  app.use(assetsBase, express.static(SCALAR_BROWSER_DIR));

  app.get(specUrl, (req, res) => {
    res.json(groupedSpec);
  });

  app.get(base || "/", (req, res) => {
    res.type("html").send(buildScalarHtml(specUrl, scriptUrl, "API Reference"));
  });
};

module.exports = {
  mountScalar,
  buildScalarHtml,
  buildGroupedSpec,
  TAG_GROUPS,
  SCALAR_BROWSER_DIR,
};
