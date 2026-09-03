const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

// Data penempatan komponen di kanvas denah (Konva). Semua koordinat disimpan
// dalam RUANG DASAR (base space = ukuran natural gambar denah) supaya presisi
// & konsisten di layar kecil maupun besar. Penamaan field snake_case.
const RoomComponentSchema = new mongoose.Schema(
  {
    // Referensi ke master komponen (bentuk) yang dipilih.
    component_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LayoutComponent",
      default: null,
    },
    x: { type: Number, default: 0 }, // posisi X (base space)
    y: { type: Number, default: 0 }, // posisi Y (base space)
    width: { type: Number, default: 100 }, // lebar dasar
    height: { type: Number, default: 100 }, // tinggi dasar
    scale_x: { type: Number, default: 1 }, // skala horizontal
    scale_y: { type: Number, default: 1 }, // skala vertikal
    rotation: { type: Number, default: 0 }, // rotasi (derajat)
    color: { type: String, default: "#3B82F6" }, // warna hex
    opacity: { type: Number, default: 1, min: 0, max: 1 }, // 0..1
  },
  { _id: false },
);

const UnitSchema = new mongoose.Schema(
  {
    building_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
      required: [true, "Building reference is required"],
    },
    floor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BuildingFloor",
      required: [true, "Floor reference is required"],
    },
    code: {
      type: String,
      required: [true, "Room unit code is required"],
      trim: true,
      uppercase: true, // Example: RM-101, U-302
    },
    name: {
      type: String,
      required: [true, "Room unit name is required"],
      trim: true, // Example: "Meeting Room Alpha", "Unit 3B"
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    unit_type: {
      type: String,
      enum: [
        "room", // Kamar umum
        "bedroom", // Kamar tidur (Kost/Apartemen)
        "guest_room", // Kamar tamu / Hotel
        "dorm_room", // Kamar asrama / Mess
        "office_space", // Ruang kerja
        "meeting_room", // Ruang rapat
        "storage", // Gudang
        "server_room", // Ruang server
        "retail_shop", // Toko/Ruko
        "utility_room", // Ruang utilitas
        "other",
      ],
      default: "bedroom",
    },
    status: {
      type: String,
      enum: ["AVAILABLE", "OCCUPIED", "UNDER_MAINTENANCE", "RESERVED"],
      default: "AVAILABLE",
    },
    capacity: {
      type: Number, // Kapasitas orang dalam ruangan
      default: 0,
    },
    area_sqm: {
      type: Number, // Luas ruangan dalam meter persegi (m²)
      default: 0,
    },
    // Fasilitas ruangan — array referensi ke ReffParameter (type: "amenities").
    amenities: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ReffParameter",
      },
    ],
    // Foto ruangan — mengacu ke koleksi Image (model Image).
    image_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Image",
      default: null,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    is_delete: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    // Penempatan komponen pada kanvas denah lantai.
    component: {
      type: RoomComponentSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "units",
  },
);

// Auto generate slug dari nama unit/ruangan sebelum validasi
UnitSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports = mongoose.models.Unit || mongoose.model("Unit", UnitSchema);
