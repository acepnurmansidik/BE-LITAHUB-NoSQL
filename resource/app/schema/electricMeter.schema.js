const ElectricMeterSchema = {
  BodyElectricMeterSchema: {
    unit_id: "000000000000000000000000",
    unit_name: "A324",
    // Meter akhir yang dibaca/diinput user. Server menghitung usage_meter &
    // actual_meter dari nilai ini (usage_meter = current_meter - prev_meter).
    current_meter: 1234,
    // Tanggal pembacaan meter. Bulan dari tanggal ini dipakai untuk mencegah
    // duplikasi data per unit dalam satu bulan.
    date: "2026-08-01",
    // Foto meter — hanya id ke koleksi Image (opsional, satu file).
    image_id: "000000000000000000000000",
  },
};

module.exports = ElectricMeterSchema;
