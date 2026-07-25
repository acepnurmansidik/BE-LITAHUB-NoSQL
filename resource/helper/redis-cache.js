const getOrSetCache = async ({ key, expiry = 3600, fetchFunction }) => {
  try {
    // 1. Coba ambil data dari Redis
    const cachedData = await global.redisClient.get(key);

    if (cachedData) {
      console.log(`🚀 Cache Hit: ${key}`);
      return JSON.parse(cachedData);
    }

    // 2. Jika tidak ada (Cache Miss), jalankan fungsi ambil data dari DB
    console.log(`🐢 Cache Miss: ${key}. Fetching from DB...`);
    const freshData = await fetchFunction();

    // 3. Simpan ke Redis untuk penggunaan berikutnya
    // Kita set kadaluarsa agar data tidak basi selamanya
    await global.redisClient.set(key, JSON.stringify(freshData), {
      EX: expiry,
    });

    return freshData;
  } catch (error) {
    console.error("Redis Cache Error:", error);
    // Jika Redis error, tetap kembalikan data dari DB agar aplikasi tidak crash
    return await fetchFunction();
  }
};

/**
 * Menghapus cache berdasarkan key (Gunakan saat data di-update/delete di DB)
 */
const clearCache = async (key) => {
  try {
    await global.redisClient.del(key);
    console.log(`🗑️  Cache Cleared: ${key}`);
  } catch (error) {
    console.error("Redis Clear Error:", error);
  }
};

/**
 * Menghapus banyak cache sekaligus berdasarkan pola (mis. "ar:list:*").
 * Dipakai saat data berubah agar seluruh varian cache list (per page/filter)
 * ikut dibersihkan.
 */
const clearCacheByPattern = async (pattern) => {
  try {
    if (!global.redisClient) return;

    const keys = [];
    for await (const entry of global.redisClient.scanIterator({
      MATCH: pattern,
      COUNT: 100,
    })) {
      // node-redis bisa mengembalikan key satuan atau array per iterasi
      if (Array.isArray(entry)) keys.push(...entry);
      else keys.push(entry);
    }

    if (keys.length) await global.redisClient.del(keys);
    console.log(`🗑️  Cache Cleared pattern: ${pattern} (${keys.length} keys)`);
  } catch (error) {
    console.error("Redis Clear Pattern Error:", error);
  }
};

/**
 * Menimpa cache secara langsung (Overwrite)
 */
const setCache = async ({ key, data, expiry = 3600 }) => {
  try {
    const res = await global.redisClient.set(key, JSON.stringify(data), {
      EX: expiry,
    });
    console.log(`💾 Cache Updated: ${key}`);
    return res;
  } catch (error) {
    console.error("Redis Set Error:", error);
  }
};

/**
 * get data dengan cache Redis
 */

const getCache = async (key) => {
  try {
    const cacheData = await global.redisClient.get(key);

    if (cacheData) {
      console.log(`🚀 Cache Hit: ${key}`);
      return JSON.parse(cacheData);
    }

    return null;
  } catch (error) {
    console.error("Redis Set Error:", error);
  }
};

module.exports = {
  getOrSetCache,
  clearCache,
  clearCacheByPattern,
  setCache,
  getCache,
};
