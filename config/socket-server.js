const { Server } = require("socket.io");
const { createClient } = require("redis");
const { urlRedis } = require("../resource/utils/config");
const { createAdapter } = require("@socket.io/redis-adapter");
const { clearCacheByPattern } = require("../resource/helper/redis-cache");

/**
 * Inisialisasi Socket.io + Redis Adapter.
 * Redis Adapter dipakai agar broadcast tetap sampai ke semua client meskipun
 * server di-scale ke banyak instance (horizontal scaling).
 */
async function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  });

  // Setup Redis Clients (pub/sub) untuk adapter.
  // Dilewati kalau URL Redis kosong supaya server tetap jalan tanpa Redis.
  if (urlRedis) {
    const pubClient = createClient({ url: urlRedis });
    const subClient = pubClient.duplicate();

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));

      // pubClient disimpan ke global agar bisa dipakai buat CACHING di controller
      global.redisClient = pubClient;
      console.log("✅ [REDIS] Redis Adapter connected");
    } catch (err) {
      console.error("❌ [REDIS] Redis Adapter Error:", err);
    }
  } else {
    console.warn(
      "⚠️  [REDIS] PUBLIC_REDIS_SERVER kosong — adapter & cache dilewati",
    );
  }

  global.io = io;

  io.on("connection", (socket) => {
    console.log("✅ SOCKET CONNECTED: " + socket.id);

    socket.on("updateData", (data) => {
      console.log("📩 Updated Client:", data);
      io.emit("refreshData", data);
    });

    socket.on("disconnect", () => {
      console.log("❌ SOCKET DISCONNECTED: " + socket.id);
    });
  });

  return io;
}

/**
 * Emit event ke semua client + sekaligus bersihkan cache-nya.
 *
 * Konvensi: nama event dipakai juga sebagai pattern cache, jadi semua key
 * cache yang diawali `${event}:` akan otomatis dihapus sebelum broadcast.
 * Contoh: emitEvent("update_account_receivable", id) akan menghapus cache
 * "update_account_receivable:*" lalu emit event tsb ke semua client.
 *
 * Aman dipanggil kapan saja: no-op (tidak melempar error) bila Socket.io /
 * Redis belum siap.
 */
async function emitEvent(event) {
  await clearCacheByPattern(`${event}:*`);
  if (global.io) global.io.emit(event);
  return true;
}

module.exports = initSocket;
module.exports.emitEvent = emitEvent;
