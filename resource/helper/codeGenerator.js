// ============================================================
// CODE GENERATOR — membuat kode singkat (short code) yang deterministik
// dari sebuah nama, plus turunannya untuk Building / Floor / Room.
//
// Aturan generateShortCode (sesuai spesifikasi "ANGGREK" -> "AGRK"):
//   1. Uppercase & buang karakter non-alfanumerik.
//   2. Kerangka konsonan: hilangkan huruf vokal (A,E,I,O,U) lalu
//      rapatkan huruf kembar berturut-turut (GG -> G).
//   3. Paksa karakter PERTAMA memakai huruf awal nama aslinya, sehingga
//      nama berawalan vokal tetap mempertahankan vokalnya.
//        ANGGREK -> (konsonan) NGGRK -> (rapatkan) NGRK -> (paksa awal 'A') AGRK
//   4. Pad dengan 'X' / potong hingga panjang `length`.
// ============================================================

const VOWELS = /[AEIOU]/g;

const generateShortCode = (text, length = 5) => {
  if (!text || typeof text !== "string") return "";

  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!clean) return "";

  const firstChar = clean.charAt(0);

  // Kerangka konsonan: buang vokal lalu rapatkan huruf kembar berturut-turut.
  let skeleton = clean.replace(VOWELS, "").replace(/(.)\1+/g, "$1");
  if (!skeleton) skeleton = clean; // fallback untuk kata yang seluruhnya vokal

  // Paksa huruf pertama = huruf awal nama asli (mis. 'A' pada ANGGREK).
  const code = firstChar + skeleton.slice(1);

  return code.padEnd(length, "X").slice(0, length);
};

// Kode lantai = kombinasi kode building + urutan lantai. Mis. "AGRK-FLR1".
const buildFloorCode = (buildingCode, index) => `${buildingCode}-FLR${index}`;

// Nama lantai otomatis mengikuti urutan (counting). Mis. "Floor 1".
const buildFloorName = (index) => `Floor ${index}`;

// Kode ruangan = kombinasi kode lantai + urutan ruangan. Mis. "AGRK-FLR1-RM1".
const buildRoomCode = (floorCode, index) => `${floorCode}-RM${index}`;

// Nama ruangan otomatis mengikuti urutan (counting). Mis. "Room 1".
const buildRoomName = (index) => `Room ${index}`;

module.exports = {
  generateShortCode,
  buildFloorCode,
  buildFloorName,
  buildRoomCode,
  buildRoomName,
};
