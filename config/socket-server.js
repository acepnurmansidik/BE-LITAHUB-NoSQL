const { Server } = require("socket.io");
const { createClient } = require("redis");
const { urlRedis } = require("../resource/utils/config");
const { createAdapter } = require("@socket.io/redis-adapter");

async function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  });

  // Setup Redis Clients
  const pubClient = createClient({ url: urlRedis });
  const subClient = pubClient.duplicate();

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));

    // Kita simpan pubClient ke global agar bisa dipakai buat CACHING di controller
    global.redisClient = pubClient;
    console.log("✅ [REDIS] Redis Adapter connected");
  } catch (err) {
    console.error("❌ [REDIS] Redis Adapter Error:", err);
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
}

module.exports = initSocket;
