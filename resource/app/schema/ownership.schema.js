const OwnershipSchema = {
  BodyOwnershipSchema: {
    // WAJIB ref ke Unit.
    unit_id: "000000000000000000000000",
    // Opsional; bila kosong diisi otomatis dari nama/kode unit di backend.
    unit_name: "A324",
    // WAJIB ref ke User. owner_name diisi otomatis dari nama User ini (backend).
    user_ownership_id: "000000000000000000000000",
    // OWNER | TENANT
    ownership_type: "OWNER",
    identity_number: "3175xxxxxxxxxxxx",
    phone: "081234567890",
    email: "john@example.com",
    address: "Jl. Contoh No. 1",
    // Masa kepemilikan/sewa (opsional).
    start_date: "2026-01-01",
    end_date: null,
    notes: "",
    is_active: true,
  },
};

module.exports = OwnershipSchema;
