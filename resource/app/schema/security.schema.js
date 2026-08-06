// Definisi body untuk Swagger — modul Security/Access:
// Module, Role, User & IAM.
const SecuritySchema = {
  BodyModuleSchema: {
    name: "INVENTORY",
    title: "Inventory Management",
    sequence: 1,
    permission: [
      {
        icon: "box",
        menu_name: "Master Data",
        path: "/inventory/master",
        actions: [],
        children: [
          {
            name: "Product",
            path: "/inventory/master/product",
            actions: ["view", "create", "update", "delete"],
          },
        ],
      },
    ],
  },
  BodyRoleSchema: {
    name: "administrator",
    has_access_module: [
      {
        name: "INVENTORY",
        title: "Inventory Management",
        sequence: 1,
        permission: [
          {
            icon: "box",
            menu_name: "Master Data",
            path: "/inventory/master",
            actions: {},
            children: [
              {
                name: "Product",
                path: "/inventory/master/product",
                actions: { view: true, create: true, update: true, delete: true },
              },
            ],
          },
        ],
      },
    ],
  },
  BodyUserIAMSchema: {
    username: "johndoe",
    email: "john.doe@example.com",
    password: "secret123",
    role_id: "000000000000000000000000",
    device_token: "",
  },
};

module.exports = SecuritySchema;
