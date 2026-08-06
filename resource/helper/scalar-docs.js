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
    name: "Authentication & Access",
    tags: ["Authentication", "User & IAM", "Role", "Module"],
  },
  {
    name: "Finance",
    tags: [
      "Chart of Account",
      "Journal Entry",
      "Journal Write Off",
      "Account Receivable",
      "Account Payable",
    ],
  },
  {
    name: "Inventory",
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
    name: "Procurement",
    tags: ["Purchase Request", "Purchase Order", "Good Receipt"],
  },
  {
    name: "Space Management",
    tags: ["Branch", "Building", "Building Floor", "Room Unit", "Layout Component"],
  },
  {
    name: "Organization",
    tags: ["Department"],
  },
  {
    name: "Configuration",
    tags: [
      "App Configuration",
      "Reference Parameter",
      "Component Formula",
      "Calculated Formula",
    ],
  },
  {
    name: "Utilities",
    tags: ["File Upload"],
  },
];

// Bangun spec ber-grouping: tambahkan `x-tagGroups` + `tags` (urut sesuai
// grup) tanpa mengubah dokumen asli.
const buildGroupedSpec = (swaggerDocument) => {
  const orderedTags = TAG_GROUPS.flatMap((g) => g.tags).map((name) => ({
    name,
  }));
  return {
    ...swaggerDocument,
    tags: orderedTags,
    "x-tagGroups": TAG_GROUPS,
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
