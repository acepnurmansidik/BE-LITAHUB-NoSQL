const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const CalculatedFormulaModel = require("../models/CalculatedFormula.model");
const CalculatedFormulaComponentModel = require("../models/CalculatedFormulaComponent.model");
const ComponentFormulaModel = require("../models/ComponentFormula.model");
const logActionModel = require("../models/LogAction.model");
const BadRequest = require("../../utils/errors/bad-request");
const LogActionModel = require("../models/LogAction.model");

const controller = {};

const { runWithOptionalTransaction } = crudServices;

// Prioritas operator (ala matematika): * dan / lebih tinggi dari + dan -.
const PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2 };

// Arah pembulatan yang diterima. Default "round" (terdekat).
const ROUND_MODES = ["round", "up", "down", "none"];
const normalizeRounding = (v) => (ROUND_MODES.includes(v) ? v : undefined);

// Tipe perhitungan formula.
//  - SINGLE        : Ekspresi Tunggal (satu ekspresi utuh).
//  - PER_COMPONENT : Per Komponen (banyak komponen bernama, dihitung terpisah
//                    lalu dijumlahkan).
const CALC_TYPES = ["SINGLE", "PER_COMPONENT"];
const normalizeCalcType = (v) => {
  const t = String(v ?? "").toUpperCase();
  return CALC_TYPES.includes(t) ? t : "SINGLE";
};

// Rapikan array id akun (buang nilai kosong). Cast ObjectId dilakukan Mongoose.
const sanitizeAccounts = (v) => (Array.isArray(v) ? v : []).filter(Boolean);

// Jenis assign akun. Default FORMULA_COMPONENT.
const ACCOUNT_ASSIGNMENTS = ["FORMULA_COMPONENT", "COMPONENT_DETAIL"];
const normalizeAccountAssignment = (v) => {
  const t = String(v ?? "").toUpperCase();
  return ACCOUNT_ASSIGNMENTS.includes(t) ? t : "FORMULA_COMPONENT";
};

// Normalisasi satu token mentah dari payload menjadi bentuk kanonik.
// Mengembalikan null bila token tidak valid (akan disaring).
const normalizeToken = (raw) => {
  if (!raw || typeof raw !== "object") return null;

  switch (raw.type) {
    case "component": {
      const id = raw.component ?? raw.component_id;
      if (!id) return null;
      const token = { type: "component", component: id };
      // Operator penggabung x (khusus komponen EXTERNAL) — simpan bila valid.
      if (["+", "-", "*", "/"].includes(raw.x_operator)) {
        token.x_operator = raw.x_operator;
      }
      return token;
    }
    case "constant": {
      const v = Number(raw.value);
      return Number.isFinite(v) ? { type: "constant", value: v } : null;
    }
    case "operator":
      return ["+", "-", "*", "/"].includes(raw.operator)
        ? { type: "operator", operator: raw.operator }
        : null;
    case "paren": {
      if (!["(", ")"].includes(raw.paren)) return null;
      const token = { type: "paren", paren: raw.paren };
      // decimal_place & rounding hanya bermakna pada "(" (pembulatan grup ini).
      if (raw.paren === "(") {
        const dp = Number(raw.decimal_place);
        if (Number.isInteger(dp) && dp >= 0) token.decimal_place = dp;
        const rounding = normalizeRounding(raw.rounding);
        if (rounding) token.rounding = rounding;
      }
      return token;
    }
    default:
      // Back-compat: payload lama {component, operator} tanpa `type`.
      if (raw.component ?? raw.component_id) {
        return {
          type: "component",
          component: raw.component ?? raw.component_id,
        };
      }
      return null;
  }
};

// Back-compat: ubah payload lama `components` [{component, operator}] menjadi
// deretan token infix (comp0 op1 comp1 op2 comp2 ...). Operator operand pertama
// diabaikan seperti perilaku lama.
const legacyComponentsToTokens = (components) => {
  const tokens = [];
  (Array.isArray(components) ? components : []).forEach((item, index) => {
    const id = item.component ?? item.component_id;
    if (!id) return;
    if (index > 0) {
      const operator = ["+", "-", "*", "/"].includes(item.operator)
        ? item.operator
        : "+";
      tokens.push({ type: "operator", operator });
    }
    tokens.push({ type: "component", component: id });
  });
  return tokens;
};

// Validasi struktur ekspresi memakai shunting-yard (adjacency & keseimbangan
// kurung). Model TIDAK menyimpan hasil hitung, jadi fungsi ini hanya untuk
// memastikan ekspresi valid sebelum disimpan — tidak mengevaluasi nilainya.
const validateExpression = (tokens) => {
  const ops = [];
  let expectOperand = true; // true bila posisi berikutnya harus operand / "("

  for (const t of tokens) {
    if (t.type === "component" || t.type === "constant") {
      if (!expectOperand)
        throw new BadRequest("Invalid formula: unexpected operand.");
      expectOperand = false;
    } else if (t.type === "operator") {
      if (expectOperand)
        throw new BadRequest("Invalid formula: unexpected operator.");
      while (
        ops.length &&
        ops[ops.length - 1].type === "operator" &&
        PRECEDENCE[ops[ops.length - 1].operator] >= PRECEDENCE[t.operator]
      ) {
        ops.pop();
      }
      ops.push(t);
      expectOperand = true;
    } else if (t.type === "paren" && t.paren === "(") {
      if (!expectOperand)
        throw new BadRequest("Invalid formula: unexpected '('.");
      ops.push(t);
      expectOperand = true;
    } else if (t.type === "paren" && t.paren === ")") {
      if (expectOperand)
        throw new BadRequest("Invalid formula: unexpected ')'.");
      let matched = false;
      while (ops.length) {
        const top = ops.pop();
        if (top.type === "paren" && top.paren === "(") {
          matched = true;
          break;
        }
      }
      if (!matched)
        throw new BadRequest("Invalid formula: unbalanced parentheses.");
      expectOperand = false;
    }
  }

  if (expectOperand)
    throw new BadRequest("Invalid formula: incomplete expression.");

  while (ops.length) {
    const top = ops.pop();
    if (top.type === "paren")
      throw new BadRequest("Invalid formula: unbalanced parentheses.");
  }
};

// Normalisasi + validasi ekspresi, sekaligus memastikan seluruh komponen yang
// direferensikan benar-benar ada & aktif.
// Mengembalikan { tokens, componentIds }.
const resolveExpression = async (rawExpression, rawComponents, session) => {
  let tokens;
  if (Array.isArray(rawExpression) && rawExpression.length) {
    tokens = rawExpression.map(normalizeToken).filter(Boolean);
  } else {
    // Fallback ke payload lama `components`.
    tokens = legacyComponentsToTokens(rawComponents);
  }

  const operandTokens = tokens.filter(
    (t) => t.type === "component" || t.type === "constant",
  );
  if (!operandTokens.length) {
    throw new BadRequest(
      "At least one operand (component/number) is required!",
    );
  }

  const componentIds = [
    ...new Set(
      tokens
        .filter((t) => t.type === "component")
        .map((t) => String(t.component)),
    ),
  ];

  if (componentIds.length) {
    const count = await ComponentFormulaModel.countDocuments({
      _id: { $in: componentIds },
      is_delete: { $ne: true },
    }).session(session ?? null);

    if (count !== componentIds.length) {
      throw new BadRequest(
        "One or more selected components do not exist or have been deleted.",
      );
    }
  }

  // Validasi struktur ekspresi (melempar bila tidak valid).
  validateExpression(tokens);

  return { tokens, componentIds };
};

// Ambil daftar id komponen unik dari deretan token tersimpan.
const componentIdsFromTokens = (tokens) => [
  ...new Set(
    (Array.isArray(tokens) ? tokens : [])
      .filter((t) => t.type === "component" && t.component)
      .map((t) => String(t.component)),
  ),
];

// PER_COMPONENT: normalisasi + validasi daftar komponen formula. Tiap komponen
// wajib punya `name` dan ekspresi valid; dp/rounding-nya independen. Mengembalikan
// { components: [{ name, expression, decimal_place, rounding, order }], componentIds }
// dengan componentIds = gabungan seluruh ComponentFormula yang direferensikan.
const resolveComponents = async (rawComponents, session) => {
  if (!Array.isArray(rawComponents) || rawComponents.length === 0) {
    throw new BadRequest(
      "At least one formula component is required for PER_COMPONENT type.",
    );
  }

  const components = [];
  const allIds = new Set();

  for (let i = 0; i < rawComponents.length; i++) {
    const raw = rawComponents[i] || {};
    const name = String(raw.name ?? "").trim();
    if (!name) {
      throw new BadRequest(`Component ${i + 1}: name is required.`);
    }

    // Tiap komponen memakai resolver ekspresi yang sama seperti mode SINGLE.
    const { tokens, componentIds } = await resolveExpression(
      raw.expression,
      null,
      session,
    );
    componentIds.forEach((id) => allIds.add(id));

    components.push({
      name,
      expression: tokens,
      decimal_place: Number.isInteger(raw.decimal_place)
        ? raw.decimal_place
        : 2,
      rounding: normalizeRounding(raw.rounding) ?? "round",
      order: i,
      // ObjectId ComponentFormula yang ditambahkan pada komponen ini (opsional).
      component_line: raw.component_line || undefined,
      // Akun (Chart of Account) terkait komponen ini.
      accounts: sanitizeAccounts(raw.accounts),
    });
  }

  return { components, componentIds: [...allIds] };
};

// Daftar id ComponentFormula yang SAAT INI dipakai sebuah formula (untuk diff
// referensi-balik). SINGLE → dari ekspresi induk; PER_COMPONENT → gabungan dari
// seluruh komponennya.
const currentComponentIds = async (formula, session) => {
  if (formula.calc_type === "PER_COMPONENT") {
    const comps = await CalculatedFormulaComponentModel.find({
      calculated_formula_id: formula._id,
      is_delete: { $ne: true },
    }).session(session ?? null);
    const set = new Set();
    comps.forEach((c) =>
      componentIdsFromTokens(c.expression).forEach((id) => set.add(id)),
    );
    return [...set];
  }
  return componentIdsFromTokens(formula.expression);
};

// Sinkronkan referensi-balik ComponentFormula.component_id terhadap formula ini.
const syncComponentBackRefs = async (formulaId, oldIds, newIds, session) => {
  const toAdd = newIds.filter((id) => !oldIds.includes(id));
  const toRemove = oldIds.filter((id) => !newIds.includes(id));
  if (toAdd.length) {
    await ComponentFormulaModel.updateMany(
      { _id: { $in: toAdd } },
      { $addToSet: { component_id: formulaId } },
      { session },
    );
  }
  if (toRemove.length) {
    await ComponentFormulaModel.updateMany(
      { _id: { $in: toRemove } },
      { $pull: { component_id: formulaId } },
      { session },
    );
  }
};

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['Calculated Formula']
    #swagger.summary = 'List Calculated Formulas'
    #swagger.description = 'Retrieve calculated formulas that combine multiple component formulas.'
    #swagger.parameters['search'] = { default: '', description: 'search by name' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const query = { is_delete: { $ne: true } };
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const { search } = req.query;
    const skip = (page - 1) * limit;

    if (search) {
      query["$or"] = [{ name: { $regex: search, $options: "i" } }];
    }

    const componentSelect =
      "name slug rate_type fixed_rate calculated_rate decimal_place";
    const accountSelect = "code name type";
    const populateField = [
      // Mode SINGLE: komponen di ekspresi induk.
      {
        path: "expression.component",
        model: "ComponentFormula",
        select: componentSelect,
      },
      // Akun hasil akhir formula.
      { path: "accounts", model: "ChartOfAccount", select: accountSelect },
      // Mode PER_COMPONENT: komponen-komponen formula + isinya ter-populate.
      {
        path: "components",
        match: { is_delete: { $ne: true } },
        options: { sort: { order: 1 } },
        populate: [
          {
            path: "expression.component",
            model: "ComponentFormula",
            select: componentSelect,
          },
          { path: "accounts", model: "ChartOfAccount", select: accountSelect },
          {
            path: "component_line",
            model: "ComponentFormula",
            select: componentSelect,
          },
        ],
      },
    ];

    const [data, total] = await Promise.all([
      CalculatedFormulaModel.find(query)
        .populate(populateField)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      CalculatedFormulaModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      message: "Data retrieved successfully!",
      data,
      page_size: total,
      current_page: page,
    });
  } catch (err) {
    next(err);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['Calculated Formula']
    #swagger.summary = 'Create Calculated Formula'
    #swagger.description = 'Create a new calculated formula.'
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Create calculated formula',
      schema: { $ref: '#/definitions/BodyCalculatedFormulaSchema' }
    }
  */
  try {
    const payload = req.body;
    payload.name = payload.name.toLowerCase();
    const slug = globalService.createSlug(payload.name);
    const calcType = normalizeCalcType(payload.calc_type);
    const decimalPlace = Number.isInteger(payload.decimal_place)
      ? payload.decimal_place
      : 2;
    const rounding = normalizeRounding(payload.rounding) ?? "round";

    const result = await runWithOptionalTransaction(async (session) => {
      let componentIds = [];

      // Buat master lebih dulu; isi ekspresi/komponen sesuai tipe.
      const base = {
        name: payload.name,
        slug,
        calc_type: calcType,
        decimal_place: decimalPlace,
        rounding,
        // Akun hasil akhir (berlaku utk kedua tipe).
        accounts: sanitizeAccounts(payload.accounts),
        account_assignment: normalizeAccountAssignment(
          payload.account_assignment,
        ),
        expression: [],
        components: [],
      };

      if (calcType === "PER_COMPONENT") {
        // Validasi seluruh komponen sebelum menyentuh DB.
        const resolved = await resolveComponents(payload.components, session);
        componentIds = resolved.componentIds;

        const [formula] = await CalculatedFormulaModel.create([base], {
          session,
        });

        // Simpan tiap komponen ke koleksi terpisah, lalu tautkan ke induk.
        // ordered: true wajib saat create banyak dokumen dalam satu session.
        const createdComponents = await CalculatedFormulaComponentModel.create(
          resolved.components.map((c) => ({
            ...c,
            calculated_formula_id: formula._id,
          })),
          { session, ordered: true },
        );
        formula.components = createdComponents.map((c) => c._id);
        await formula.save({ session });

        await syncComponentBackRefs(formula._id, [], componentIds, session);

        await LogActionModel.create(
          [
            {
              target_id: formula._id,
              source: CalculatedFormulaModel.collection.collectionName,
              activities: [{ type: "CREATE", after: formula.toObject() }],
            },
          ],
          { session },
        );

        return formula;
      }

      // SINGLE (Ekspresi Tunggal): satu ekspresi utuh.
      const resolved = await resolveExpression(
        payload.expression,
        null,
        session,
      );
      componentIds = resolved.componentIds;
      base.expression = resolved.tokens;

      const [formula] = await CalculatedFormulaModel.create([base], {
        session,
      });

      await syncComponentBackRefs(formula._id, [], componentIds, session);

      await logActionModel.create(
        [
          {
            target_id: formula._id,
            source: CalculatedFormulaModel.collection.collectionName,
            activities: [{ type: "CREATE", after: formula.toObject() }],
          },
        ],
        { session },
      );

      return formula;
    });

    res.status(201).json({
      code: 201,
      success: true,
      message: "Calculated formula created successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.update = async (req, res, next) => {
  /*
    #swagger.tags = ['Calculated Formula']
    #swagger.summary = 'Update Calculated Formula'
    #swagger.description = 'Update an existing calculated formula.'
    #swagger.parameters['id'] = { description: 'id calculated formula' }
    #swagger.parameters['obj'] = {
      in: 'body',
      description: 'Update calculated formula',
      schema: { $ref: '#/definitions/BodyCalculatedFormulaSchema' }
    }
  */
  try {
    const { id } = req.params;
    const payload = req.body;

    const result = await runWithOptionalTransaction(async (session) => {
      const formula = await CalculatedFormulaModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!formula) throw new BadRequest("Data not found!");

      const before = formula.toObject();

      if (payload.name) {
        formula.name = payload.name.toLowerCase();
        formula.slug = globalService.createSlug(formula.name);
      }
      if (Number.isInteger(payload.decimal_place)) {
        formula.decimal_place = payload.decimal_place;
      }
      const nextRounding = normalizeRounding(payload.rounding);
      if (nextRounding) {
        formula.rounding = nextRounding;
      }
      // Akun hasil akhir.
      if (payload.accounts !== undefined) {
        formula.accounts = sanitizeAccounts(payload.accounts);
      }
      if (payload.account_assignment !== undefined) {
        formula.account_assignment = normalizeAccountAssignment(
          payload.account_assignment,
        );
      }

      const nextCalcType =
        payload.calc_type !== undefined
          ? normalizeCalcType(payload.calc_type)
          : formula.calc_type;
      const typeChanged = nextCalcType !== formula.calc_type;
      const wantsExpression = payload.expression !== undefined;
      const wantsComponents = payload.components !== undefined;

      // Perlu rebuild isi (dan sinkron referensi-balik) bila tipe berubah atau
      // konten (ekspresi / komponen) dikirim.
      if (typeChanged || wantsExpression || wantsComponents) {
        // Kumpulkan id komponen LAMA sebelum diubah (untuk diff referensi-balik).
        const oldIds = await currentComponentIds(formula, session);
        let newIds = [];

        if (nextCalcType === "PER_COMPONENT") {
          const source = wantsComponents ? payload.components : null;
          if (!source) {
            throw new BadRequest(
              "components are required for PER_COMPONENT type.",
            );
          }
          const resolved = await resolveComponents(source, session);
          newIds = resolved.componentIds;

          // Ganti total komponen lama (dimiliki penuh oleh induk ini).
          await CalculatedFormulaComponentModel.deleteMany(
            { calculated_formula_id: formula._id },
            { session },
          );
          const createdComponents =
            await CalculatedFormulaComponentModel.create(
              resolved.components.map((c) => ({
                ...c,
                calculated_formula_id: formula._id,
              })),
              { session, ordered: true },
            );

          formula.calc_type = "PER_COMPONENT";
          formula.expression = [];
          formula.components = createdComponents.map((c) => c._id);
        } else {
          // SINGLE. Bila hanya ganti tipe tanpa kirim ekspresi, pakai ekspresi
          // yang ada (akan error bila kosong — memang butuh ekspresi).
          const source = wantsExpression
            ? payload.expression
            : formula.expression;
          const resolved = await resolveExpression(source, null, session);
          newIds = resolved.componentIds;

          // Bersihkan komponen bila sebelumnya PER_COMPONENT.
          await CalculatedFormulaComponentModel.deleteMany(
            { calculated_formula_id: formula._id },
            { session },
          );

          formula.calc_type = "SINGLE";
          formula.expression = resolved.tokens;
          formula.components = [];
        }

        await syncComponentBackRefs(formula._id, oldIds, newIds, session);
      }

      await formula.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: CalculatedFormulaModel.collection.collectionName,
          },
          $push: {
            activities: {
              type: "UPDATE",
              before,
              after: formula.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return formula;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Calculated formula updated successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

controller.delete = async (req, res, next) => {
  /*
    #swagger.tags = ['Calculated Formula']
    #swagger.summary = 'Delete Calculated Formula (soft delete)'
    #swagger.description = 'Delete a calculated formula.'
    #swagger.parameters['id'] = { description: 'id calculated formula' }
  */
  try {
    const { id } = req.params;

    const result = await runWithOptionalTransaction(async (session) => {
      const formula = await CalculatedFormulaModel.findOne({
        _id: id,
        is_delete: { $ne: true },
      }).session(session);
      if (!formula) throw new BadRequest("Data not found!");

      const before = formula.toObject();

      // Lepas referensi balik dari semua komponen yang memakai formula ini,
      // sehingga komponen tersebut bisa dihapus bila sudah tidak dipakai lagi.
      await ComponentFormulaModel.updateMany(
        { component_id: formula._id },
        { $pull: { component_id: formula._id } },
        { session },
      );

      // Ikut hapus (soft) komponen milik formula PER_COMPONENT ini.
      await CalculatedFormulaComponentModel.updateMany(
        { calculated_formula_id: formula._id },
        { $set: { is_delete: true } },
        { session },
      );

      formula.is_delete = true;
      await formula.save({ session });

      await LogActionModel.findOneAndUpdate(
        { target_id: id },
        {
          $setOnInsert: {
            target_id: id,
            source: CalculatedFormulaModel.collection.collectionName,
          },
          $push: {
            activities: {
              type: "DELETE",
              before,
              after: formula.toObject(),
              created_by: req?.login?.user_id ?? null,
            },
          },
        },
        { upsert: true, session },
      );

      return formula;
    });

    res.status(200).json({
      code: 200,
      success: true,
      message: "Calculated formula deleted successfully!",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = controller;
