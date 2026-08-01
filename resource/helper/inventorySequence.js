const InventorySequenceModel = require("../app/models/InventorySequence.model");

// Ambil nomor urut BERIKUTNYA (atomik) untuk sebuah `key` inventory.
const nextInventorySeq = async (key, session) => {
  const counter = await InventorySequenceModel.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      session: session ?? null,
    },
  );
  return counter.seq;
};

module.exports = { nextInventorySeq };
