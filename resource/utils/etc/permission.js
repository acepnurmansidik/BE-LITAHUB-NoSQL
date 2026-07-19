const USER_IAM = [
  {
    name: "MOD_OVERVIEW",
    title: "Overview",
    permission: [
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-gauge-icon lucide-gauge"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`,
        menu_name: "Dashboard",
        path: "/dashboard",
        actions: [],
        children: [],
      },
    ],
  },
  {
    name: "MOD_PRIVACY_SECURITY",
    title: "Privacy & Security",
    permission: [
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-component-icon lucide-component"><path d="M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z"/><path d="M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z"/><path d="M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z"/><path d="M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z"/></svg>`,
        menu_name: "Module",
        path: "/security/module",
        actions: [
          "view",
          "create",
          "update",
          "delete",
          "pdf",
          "import",
          "export",
          "whatsapp",
        ],
        children: [],
      },
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-key-icon lucide-key"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>`,
        menu_name: "Role",
        path: "/security/role",
        actions: [
          "view",
          "create",
          "update",
          "delete",
          "pdf",
          "import",
          "export",
          "whatsapp",
        ],
        children: [],
      },
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-key-icon lucide-user-key"><path d="M20 11v6"/><path d="M20 13h2"/><path d="M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 2.072.578"/><circle cx="10" cy="7" r="4"/><circle cx="20" cy="19" r="2"/></svg>`,
        menu_name: "IAM",
        path: "/security/iam",
        actions: [
          "view",
          "create",
          "update",
          "delete",
          "pdf",
          "import",
          "export",
          "whatsapp",
        ],
        children: [],
      },
    ],
  },
  {
    name: "MOD_DOCUMENTATION",
    title: "Documentation",
    permission: [
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-form-icon lucide-form"><path d="M4 14h6"/><path d="M4 2h10"/><rect x="4" y="18" width="16" height="4" rx="1"/><rect x="4" y="6" width="16" height="4" rx="1"/></svg>`,
        menu_name: "Form",
        path: "/documentation/table",
        actions: [],
        children: [
          {
            name: "Multi Step",
            path: "/documentation/form/multi-step",
            actions: [
              "view",
              "create",
              "update",
              "delete",
              "pdf",
              "import",
              "export",
              "whatsapp",
            ],
          },
        ],
      },
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-table-icon lucide-table"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>`,
        menu_name: "Table",
        path: "/documentation/table",
        actions: [],
        children: [
          {
            name: "Basic Table",
            path: "/documentation/table/basic-table",
            actions: [],
          },
          {
            name: "Expanded Table",
            path: "/documentation/table/expanded-table",
            actions: [],
          },
        ],
      },
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-dashboard-icon lucide-layout-dashboard"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
        menu_name: "Widget",
        path: "/documentation/widgets",
        actions: [],
        children: [
          {
            name: "Charts",
            path: "/documentation/widget/charts",
            actions: [],
          },
          { name: "Map", path: "/documentation/widget/map", actions: [] },
          {
            name: "Measurement",
            path: "/documentation/widget/measurement",
            actions: [],
          },
        ],
      },
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-asterisk-icon lucide-asterisk"><path d="M12 6v12"/><path d="M17.196 9 6.804 15"/><path d="m6.804 9 10.392 6"/></svg>`,
        menu_name: "Misc",
        path: "/documentation/widgets",
        actions: [],
        children: [
          {
            name: "Text Input",
            path: "/documentation/misc/text-input",
            actions: [],
          },
          {
            name: "Filter",
            path: "/documentation/misc/filter",
            actions: [],
          },
          { name: "Etc", path: "/documentation/misc/etc", actions: [] },
        ],
      },
    ],
  },
  {
    name: "MOD_SETTING",
    title: "Setting",
    permission: [
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rocket-icon lucide-rocket"><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/></svg>`,
        menu_name: "App Config",
        path: "/setting/app-config",
        actions: ["view", "create", "update", "delete"],
        children: [],
      },
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flask-conical-icon lucide-flask-conical"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg>`,
        menu_name: "Formula",
        path: "/setting/formula",
        actions: [],
        children: [
          {
            name: "Calculated Formula",
            path: "/setting/formula/calculated-formula",
            actions: ["view", "create", "update", "delete"],
          },
          {
            name: "Component",
            path: "/setting/formula/component",
            actions: ["view", "create", "update", "delete"],
          },
        ],
      },
    ],
  },
  {
    name: "MOD_FINANCE",
    title: "Finance",
    permission: [
      {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book-open-icon lucide-book-open"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`,
        menu_name: "Chart of Account",
        path: "/finance/chart-of-accounts",
        actions: ["view", "create", "update", "delete"],
        children: [],
      },
    ],
  },
];

module.exports = { USER_IAM };
