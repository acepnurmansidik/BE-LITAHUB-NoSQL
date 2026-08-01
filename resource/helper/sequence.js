const SequenceModel = require("../app/models/Sequence.model");

// Ambil nomor urut BERIKUTNYA (atomik) untuk sebuah modul pada bulan & tahun
// dari `date`, disimpan di koleksi `sequence`. Lalu format menjadi:
//   `${prefix}-YYYYMM-####`   (mis. "AR-202607-0001").
//
// Counter di-increment via findOneAndUpdate($inc)+upsert sehingga:
//  - aman dari race condition (tak perlu scan dokumen terakhir),
//  - reset otomatis ke 1 saat kombinasi modul/tahun/bulan berganti.
const generateSequenceNo = async ({
  module,
  prefix,
  date,
  session,
  pad = 5,
}) => {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const mod = String(module).toUpperCase();

  const counter = await SequenceModel.findOneAndUpdate(
    { module: mod, year, month },
    { $inc: { seq: 1 } },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      session: session ?? null,
    },
  );

  const ym = `${year}${String(month).padStart(2, "0")}`;
  const seqStr = String(counter.seq).padStart(pad, "0");
  return `${prefix ?? mod}-${ym}-${seqStr}`;
};

module.exports = { generateSequenceNo };
