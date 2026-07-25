const { Server } = require("socket.io");
const { createClient } = require("redis");
const { urlRedis } = require("../resource/utils/config");
const { createAdapter } = require("@socket.io/redis-adapter");
const { clearCacheByPattern } = require("../resource/helper/redis-cache");

/**
 * Buat Redis client dengan auto-reconnect.
 * reconnectStrategy dipanggil tiap koneksi putus: makin sering gagal, makin
 * lama jeda retry (backoff), di-cap 5 detik. Return angka = jeda (ms) sebelum
 * mencoba connect lagi — jadi client TIDAK pernah berhenti mencoba.
 */
const makeRedisClient = (label) => {
  const client = createClient({
    url: urlRedis,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
    },
  });

  // Wajib pasang listener 'error', kalau tidak error dari Redis bisa meng-crash
  // proses (unhandled 'error' event).
  client.on("error", (err) => {
    console.error(`❌ [REDIS:${label}] ${err?.message || err}`);
  });
  client.on("reconnecting", () => {
    console.warn(`🔄 [REDIS:${label}] mencoba reconnect...`);
  });
  client.on("ready", () => {
    console.log(`✅ [REDIS:${label}] siap`);
  });

  return client;
};

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
    // Deteksi koneksi client yang putus diam-diam: kalau tidak ada pong dalam
    // pingTimeout setelah pingInterval, client dianggap disconnect. Client
    // (socket.io-client) akan otomatis reconnect secara default.
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Setup Redis Clients (pub/sub) untuk adapter.
  // Dilewati kalau URL Redis kosong supaya server tetap jalan tanpa Redis.
  if (urlRedis) {
    const pubClient = makeRedisClient("pub");
    const subClient = makeRedisClient("sub");

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));

      // pubClient disimpan ke global agar bisa dipakai buat CACHING di controller
      global.redisClient = pubClient;
      console.log("✅ [REDIS] Redis Adapter connected");
    } catch (err) {
      console.error("❌ [REDIS] Redis Adapter Error:", err?.message || err);
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

    socket.on("disconnect", (reason) => {
      console.log(`❌ SOCKET DISCONNECTED: ${socket.id} (${reason})`);
    });
  });

  return io;
}

/**
 * Emit event ke semua client + sekaligus bersihkan cache-nya.
 *
 * Konvensi: nama event dipakai juga sebagai pattern cache, jadi semua key
 * cache yang diawali `${event}:` akan otomatis dihapus sebelum broadcast.
 * Contoh: emitEvent("update_account_receivable") -> hapus cache
 * "update_account_receivable:*" lalu emit event tsb ke semua client.
 *
 * `payload` OPSIONAL: boleh dipanggil emitEvent("event") saja (tanpa payload),
 * atau emitEvent("event", data) bila ingin mengirim data.
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
