// Definisi body untuk Swagger — Branch, Building, Building Floor, Room Unit.
const FacilitySchema = {
  BodyBranchSchema: {
    name: "ANGGREK JAKARTA",
    description: "Cabang utama Jakarta",
    contact_info: {
      phone: ["02112345678"],
      email: "branch@example.com",
      manager_name: "Budi",
    },
    address: {
      street: "Jl. Anggrek No. 1",
      city: "Jakarta",
      state_province: "DKI Jakarta",
      postal_code: "10110",
      country: "Indonesia",
    },
    location: { type: "Point", coordinates: [106.8, -6.2] },
    is_active: true,
    notes: "",
  },
  BodyBuildingSchema: {
    branch_id: "000000000000000000000000",
    name: "ANGGREK",
    building_type: "office",
    total_floors: 5,
    building_area_sqm: 1200,
    land_area_sqm: 2000,
    address: {
      street: "Jl. Anggrek No. 1",
      city: "Jakarta",
      state_province: "DKI Jakarta",
      postal_code: "10110",
      country: "Indonesia",
    },
    image_id: null,
    notes: "",
  },
  BodyBuildingFloorSchema: {
    building_id: "000000000000000000000000",
    type: "floor",
    name: "",
    floor_level: 1,
    floor_area_sqm: 200,
    max_capacity: 50,
    floor_plan_url_id: null,
    notes: "",
  },
  BodyRoomUnitSchema: {
    floor_id: "000000000000000000000000",
    name: "",
    unit_type: "bedroom",
    status: "available",
    capacity: 2,
    area_sqm: 24,
    amenities: ["ac", "wifi"],
    image_id: null,
    notes: "",
  },
};

module.exports = FacilitySchema;
