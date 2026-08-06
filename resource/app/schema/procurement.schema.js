// Swagger body definitions — Procurement module:
// Purchase Request, Purchase Order, Good Receipt.
const ProcurementSchema = {
  BodyPurchaseRequestSchema: {
    date: "2026-08-01",
    needed_date: "2026-08-01",
    requested_by: "Andi",
    reference: "REQ-2026-0001",
    description: "",
    items: [
      {
        product_id: "000000000000000000000000",
        uom_id: "000000000000000000000000",
        supplier_id: "000000000000000000000000",
        quantity: 10,
        price: 10000,
      },
    ],
  },
  BodyPurchaseOrderSchema: {
    date: "2026-08-01",
    expected_date: "2026-08-01",
    reference: "REF-2026-0001",
    description: "",
    pr_ids: ["000000000000000000000000"],
    status: "DRAFT",
    items: [
      {
        product_id: "000000000000000000000000",
        uom_id: "000000000000000000000000",
        supplier_id: "000000000000000000000000",
        quantity: 10,
        price: 10000,
        source_item_ids: ["000000000000000000000000"],
      },
    ],
  },
  BodyGoodReceiptSchema: {
    date: "2026-08-01",
    received_date: "2026-08-01",
    reference: "REF-2026-0001",
    description: "",
    po_ids: ["000000000000000000000000"],
    warehouse_mode: "SINGLE",
    warehouse_id: "000000000000000000000000",
    items: [
      {
        product_id: "000000000000000000000000",
        uom_id: "000000000000000000000000",
        quantity: 10,
        received_qty: 10,
        warehouse_id: "000000000000000000000000",
        price: 10000,
        source_item_ids: ["000000000000000000000000"],
      },
    ],
  },
};

module.exports = ProcurementSchema;
