const mongoose = require("mongoose");
const globalService = require("../../helper/global-func");

const RoomUnitSchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch reference is required"],
    },
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
      enum: ["available", "occupied", "under_maintenance", "reserved"],
      default: "available",
    },
    capacity: {
      type: Number, // Kapasitas orang dalam ruangan
      default: 0,
    },
    area_sqm: {
      type: Number, // Luas ruangan dalam meter persegi (m²)
      default: 0,
    },
    amenities: [
      {
        type: String,
        trim: true, // Example: ["projector", "whiteboard", "ac", "tv", "lan_port"]
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
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
    collection: "room_units",
  },
);

// Auto generate slug dari nama unit/ruangan sebelum validasi
RoomUnitSchema.pre("validate", function (next) {
  if (this.name && !this.slug) {
    this.slug = globalService.createSlug(this.name);
  }
});

module.exports =
  mongoose.models.RoomUnit || mongoose.model("RoomUnit", RoomUnitSchema);
