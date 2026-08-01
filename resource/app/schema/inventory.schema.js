// Definisi body untuk Swagger — modul Inventory:
// Product Category, UOM, Product, Warehouse, Supplier, Stock Position,
// Stock Movement.
const InventorySchema = {
  BodyProductCategorySchema: {
    name: "Bahan Baku",
    prefix: "RAW",
    is_active: true,
    line_accounts: [
      {
        title: "Inventory Account",
        account_id: "000000000000000000000000",
        product_category_id: null,
      },
      {
        title: "COGS Account",
        account_id: "000000000000000000000000",
        product_category_id: null,
      },
    ],
  },
  BodyUomSchema: {
    name: "Pieces",
    code: "PCS",
    description: "Satuan buah",
    is_active: true,
  },
  BodyProductSchema: {
    product_category_id: "000000000000000000000000",
    uom_id: "000000000000000000000000",
    code: "RAW-0001",
    name: "Tepung Terigu",
    description: "",
    barcode: "",
    purchase_price: 10000,
    selling_price: 12000,
    is_active: true,
  },
  BodyWarehouseSchema: {
    code: "WH-JKT",
    name: "Gudang Jakarta",
    phone: "021-1234567",
    address: {
      street: "Jl. Industri No. 1",
      city: "Jakarta",
      state_province: "DKI Jakarta",
      postal_code: "10110",
      country: "Indonesia",
    },
    is_active: true,
  },
  BodySupplierSchema: {
    code: "SUP-001",
    name: "PT Sumber Rejeki",
    contact_info: {
      phone: ["021-7654321"],
      email: "sales@sumberrejeki.co.id",
      contact_person: "Andi",
    },
    address: {
      street: "Jl. Niaga No. 5",
      city: "Bekasi",
      state_province: "Jawa Barat",
      postal_code: "17530",
      country: "Indonesia",
    },
    is_active: true,
  },
  BodyStockPositionSchema: {
    product_id: "000000000000000000000000",
    warehouse_id: "000000000000000000000000",
    uom_id: "000000000000000000000000",
    quantity: 100,
    reserved_quantity: 0,
  },
  BodyStockMovementSchema: {
    product_id: "000000000000000000000000",
    warehouse_id: "000000000000000000000000",
    destination_warehouse_id: null,
    uom_id: "000000000000000000000000",
    type: "IN",
    quantity: 50,
    reference: "PO-2026-0001",
    date: "2026-08-01",
    note: "",
  },
};

module.exports = InventorySchema;
