const crudServices = require("../../helper/crudService");
const globalService = require("../../helper/global-func");
const CalculatedFormulaModel = require("../models/CalculatedFormula.model");
const ComponentFormulaModel = require("../models/ComponentFormula.model");
const logActionModel = require("../models/LogAction.model");
const BadRequest = require("../../utils/errors/bad-request");

const controller = {};

const { runWithOptionalTransaction } = crudServices;

// Prioritas operator (ala matematika): * dan / lebih tinggi dari + dan -.
const PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2 };

// Arah pembulatan yang diterima. Default "round" (terdekat).
const ROUND_MODES = ["round", "up", "down", "none"];
const normalizeRounding = (v) => (ROUND_MODES.includes(v) ? v : undefined);

// Normalisasi satu token mentah dari payload menjadi bentuk kanonik.
// Mengembalikan null bila token tidak valid (akan disaring).
const normalizeToken = (raw) => {
  if (!raw || typeof raw !== "object") return null;

  switch (raw.type) {
    case "component": {
      const id = raw.component ?? raw.component_id;
      return id ? { type: "component", component: id } : null;
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
    throw new BadRequest("At least one operand (component/number) is required!");
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

controller.index = async (req, res, next) => {
  /*
    #swagger.tags = ['CALCULATED FORMULA']
    #swagger.summary = 'Calculated Formula'
    #swagger.description = 'Master formula yang menghitung beberapa ComponentFormula'
    #swagger.parameters['search'] = { default: '', description: 'search by name' }
    #swagger.parameters['limit'] = { default: 10, description: 'limit' }
    #swagger.parameters['page'] = { default: 1, description: 'page' }
  */
  try {
    const query = {};
    const { search, page, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const arrFilter = [];
    if (search) {
      arrFilter.push({ name: { $regex: search, $options: "i" } });
    }
    if (arrFilter.length) query["$or"] = arrFilter;

    const populateField = [
      {
        path: "expression.component",
        model: "ComponentFormula",
        select: "name slug rate_type fixed_rate calculated_rate decimal_place",
      },
    ];

    const [page_size, result] = await Promise.all([
      CalculatedFormulaModel.countDocuments({
        ...query,
        is_delete: { $ne: true },
      }),
      crudServices.findAllPagination(CalculatedFormulaModel, {
        query,
        populateField,
        skip,
        limit,
      }),
    ]);

    res.status(200).json({ ...result, page_size, current_page: Number(page) });
  } catch (err) {
    next(err);
  }
};

controller.create = async (req, res, next) => {
  /*
    #swagger.tags = ['CALCULATED FORMULA']
    #swagger.summary = 'Calculated Formula'
    #swagger.description = 'Buat master formula baru'
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
    const decimalPlace = Number.isInteger(payload.decimal_place)
      ? payload.decimal_place
      : 2;
    const rounding = normalizeRounding(payload.rounding) ?? "round";

    const result = await runWithOptionalTransaction(async (session) => {
      const { tokens, componentIds } = await resolveExpression(
        payload.expression,
        payload.components,
        session,
      );

      const [formula] = await CalculatedFormulaModel.create(
        [
          {
            name: payload.name,
            slug,
            expression: tokens,
            decimal_place: decimalPlace,
            rounding,
          },
        ],
        { session },
      );

      // Simpan referensi balik: komponen yang dipakai mencatat formula ini.
      if (componentIds.length) {
        await ComponentFormulaModel.updateMany(
          { _id: { $in: componentIds } },
          { $addToSet: { component_id: formula._id } },
          { session },
        );
      }

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
    #swagger.tags = ['CALCULATED FORMULA']
    #swagger.summary = 'Calculated Formula'
    #swagger.description = 'Perbarui master formula'
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

      const hasNewExpression =
        payload.expression !== undefined || payload.components !== undefined;

      if (hasNewExpression) {
        const oldIds = componentIdsFromTokens(formula.expression);

        const { tokens, componentIds } = await resolveExpression(
          payload.expression,
          payload.components,
          session,
        );

        const toAdd = componentIds.filter((cid) => !oldIds.includes(cid));
        const toRemove = oldIds.filter((cid) => !componentIds.includes(cid));

        if (toAdd.length) {
          await ComponentFormulaModel.updateMany(
            { _id: { $in: toAdd } },
            { $addToSet: { component_id: formula._id } },
            { session },
          );
        }
        if (toRemove.length) {
          await ComponentFormulaModel.updateMany(
            { _id: { $in: toRemove } },
            { $pull: { component_id: formula._id } },
            { session },
          );
        }

        formula.expression = tokens;
      }

      await formula.save({ session });

      await logActionModel.create(
        [
          {
            target_id: formula._id,
            source: CalculatedFormulaModel.collection.collectionName,
            activities: [
              { type: "UPDATE", before, after: formula.toObject() },
            ],
          },
        ],
        { session },
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
    #swagger.tags = ['CALCULATED FORMULA']
    #swagger.summary = 'Calculated Formula'
    #swagger.description = 'Hapus master formula'
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

      formula.is_delete = true;
      await formula.save({ session });

      await logActionModel.create(
        [
          {
            target_id: formula._id,
            source: CalculatedFormulaModel.collection.collectionName,
            activities: [
              { type: "DELETE", before, after: formula.toObject() },
            ],
          },
        ],
        { session },
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
