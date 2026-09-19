const http = require("http");
const { readFile, writeFile, mkdir } = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 3019);
const DB_FILE = path.join(__dirname, "data", "db.json");

const initialData = {
  tunes: [
    {
      id: "tune_demo",
      title: "雨后圆舞曲",
      composer: "匿名",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 82,
        paperType: "半透明纸带"
      },
      createdAt: new Date().toISOString()
    }
  ],
  sections: [
    {
      id: "section_demo_1",
      tuneId: "tune_demo",
      startBeat: 1,
      endBeat: 32,
      laneRange: "1-10",
      checked: true,
      note: "开头主题已试奏"
    },
    {
      id: "section_demo_2",
      tuneId: "tune_demo",
      startBeat: 33,
      endBeat: 64,
      laneRange: "4-18",
      checked: false,
      note: "副歌段等待校对"
    }
  ],
  issues: [
    {
      id: "issue_demo",
      tuneId: "tune_demo",
      sectionId: "section_demo_2",
      type: "漏孔",
      beat: 41,
      lane: 12,
      description: "第41拍高音孔漏打",
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null
    }
  ],
  reworkOrders: []
};

const routes = [
  "GET /health",
  "GET /tunes",
  "POST /tunes",
  "GET /tunes/:id/progress",
  "GET /tunes/:id/sections",
  "POST /tunes/:id/sections",
  "GET /tunes/:id/unchecked-sections",
  "PATCH /sections/:id/check",
  "GET /issues",
  "POST /issues",
  "PATCH /issues/:id/status",
  "GET /rework-orders",
  "POST /rework-orders",
  "PATCH /rework-orders/:id/review",
  "POST /rework-orders/archive"
];

async function ensureDb() {
  await mkdir(path.dirname(DB_FILE), { recursive: true });
  try {
    JSON.parse(await readFile(DB_FILE, "utf8"));
  } catch {
    await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  const db = JSON.parse(await readFile(DB_FILE, "utf8"));
  if (!Array.isArray(db.reworkOrders)) db.reworkOrders = [];
  return db;
}

async function writeDb(data) {
  await writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function parseUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return { pathname: url.pathname, searchParams: url.searchParams };
}

async function parseBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体必须是合法JSON");
    error.status = 400;
    throw error;
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === "");
  if (missing.length) {
    const error = new Error(`缺少字段：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function findTune(db, tuneId) {
  const tune = db.tunes.find((item) => item.id === tuneId);
  if (!tune) {
    const error = new Error("曲目不存在");
    error.status = 404;
    throw error;
  }
  return tune;
}

function buildProgress(db, tuneId) {
  findTune(db, tuneId);
  const sections = db.sections.filter((item) => item.tuneId === tuneId);
  const issues = db.issues.filter((item) => item.tuneId === tuneId);
  const checkedCount = sections.filter((item) => item.checked).length;
  const openIssues = issues.filter((item) => item.status !== "resolved").length;
  return {
    tuneId,
    totalSections: sections.length,
    checkedSections: checkedCount,
    uncheckedSections: sections.length - checkedCount,
    openIssues,
    resolvedIssues: issues.length - openIssues,
    percent: sections.length ? Math.round((checkedCount / sections.length) * 100) : 0,
    rework: buildReworkStats(db, tuneId)
  };
}

function buildReworkStats(db, tuneId) {
  const orders = db.reworkOrders.filter((item) => item.tuneId === tuneId);
  const countBy = (status) => orders.filter((item) => item.status === status).length;
  return {
    total: orders.length,
    pendingReview: countBy("pending_review"),
    approved: countBy("approved"),
    rejected: countBy("rejected"),
    invalidated: countBy("invalidated"),
    archived: countBy("archived")
  };
}

async function handle(req, res) {
  const { pathname, searchParams } = parseUrl(req);
  const db = await readDb();

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "organ-strip-punch-api", routes });
  }

  if (req.method === "GET" && pathname === "/tunes") {
    const tunes = db.tunes.map((tune) => ({ ...tune, progress: buildProgress(db, tune.id) }));
    return send(res, 200, { data: tunes });
  }

  if (req.method === "POST" && pathname === "/tunes") {
    const body = await parseBody(req);
    required(body, ["title", "stripSpec"]);
    const tune = {
      id: makeId("tune"),
      title: body.title,
      composer: body.composer || "",
      stripSpec: body.stripSpec,
      createdAt: new Date().toISOString()
    };
    db.tunes.push(tune);
    await writeDb(db);
    return send(res, 201, { data: tune });
  }

  const tuneSectionsMatch = pathname.match(/^\/tunes\/([^/]+)\/sections$/);
  if (tuneSectionsMatch && req.method === "GET") {
    const tuneId = tuneSectionsMatch[1];
    findTune(db, tuneId);
    return send(res, 200, { data: db.sections.filter((item) => item.tuneId === tuneId) });
  }

  if (tuneSectionsMatch && req.method === "POST") {
    const tuneId = tuneSectionsMatch[1];
    findTune(db, tuneId);
    const body = await parseBody(req);
    required(body, ["startBeat", "endBeat", "laneRange"]);
    const section = {
      id: makeId("section"),
      tuneId,
      startBeat: Number(body.startBeat),
      endBeat: Number(body.endBeat),
      laneRange: body.laneRange,
      checked: Boolean(body.checked),
      note: body.note || ""
    };
    db.sections.push(section);
    await writeDb(db);
    return send(res, 201, { data: section });
  }

  const uncheckedMatch = pathname.match(/^\/tunes\/([^/]+)\/unchecked-sections$/);
  if (uncheckedMatch && req.method === "GET") {
    const tuneId = uncheckedMatch[1];
    findTune(db, tuneId);
    return send(res, 200, { data: db.sections.filter((item) => item.tuneId === tuneId && !item.checked) });
  }

  const progressMatch = pathname.match(/^\/tunes\/([^/]+)\/progress$/);
  if (progressMatch && req.method === "GET") {
    return send(res, 200, { data: buildProgress(db, progressMatch[1]) });
  }

  const checkMatch = pathname.match(/^\/sections\/([^/]+)\/check$/);
  if (checkMatch && req.method === "PATCH") {
    const section = db.sections.find((item) => item.id === checkMatch[1]);
    if (!section) return send(res, 404, { error: "区间不存在" });
    const body = await parseBody(req);
    section.checked = body.checked !== undefined ? Boolean(body.checked) : true;
    section.note = body.note ?? section.note;
    await writeDb(db);
    return send(res, 200, { data: section });
  }

  if (req.method === "GET" && pathname === "/issues") {
    const tuneId = searchParams.get("tuneId");
    const status = searchParams.get("status");
    const issues = db.issues.filter((item) => (!tuneId || item.tuneId === tuneId) && (!status || item.status === status));
    return send(res, 200, { data: issues });
  }

  if (req.method === "POST" && pathname === "/issues") {
    const body = await parseBody(req);
    required(body, ["tuneId", "sectionId", "type", "description"]);
    findTune(db, body.tuneId);
    const section = db.sections.find((item) => item.id === body.sectionId && item.tuneId === body.tuneId);
    if (!section) return send(res, 400, { error: "区间不存在或不属于该曲目" });
    const issue = {
      id: makeId("issue"),
      tuneId: body.tuneId,
      sectionId: body.sectionId,
      type: body.type,
      beat: body.beat === undefined ? null : Number(body.beat),
      lane: body.lane === undefined ? null : Number(body.lane),
      description: body.description,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null
    };
    db.issues.push(issue);
    // 新问题会让同曲目中"已通过但未归档"的返工单失效，须重新复核
    const invalidatedAt = new Date().toISOString();
    const invalidated = [];
    for (const order of db.reworkOrders) {
      if (order.tuneId === issue.tuneId && order.status === "approved") {
        order.status = "invalidated";
        order.invalidatedAt = invalidatedAt;
        order.invalidReason = `新问题 ${issue.id} 登记，需重新复核`;
        invalidated.push(order.id);
      }
    }
    await writeDb(db);
    return send(res, 201, { data: issue, invalidatedReworkOrders: invalidated });
  }

  const issueStatusMatch = pathname.match(/^\/issues\/([^/]+)\/status$/);
  if (issueStatusMatch && req.method === "PATCH") {
    const issue = db.issues.find((item) => item.id === issueStatusMatch[1]);
    if (!issue) return send(res, 404, { error: "问题不存在" });
    const body = await parseBody(req);
    required(body, ["status"]);
    issue.status = body.status;
    issue.resolvedAt = body.status === "resolved" ? new Date().toISOString() : null;
    issue.note = body.note ?? issue.note;
    await writeDb(db);
    return send(res, 200, { data: issue });
  }

  if (req.method === "GET" && pathname === "/rework-orders") {
    const tuneId = searchParams.get("tuneId");
    const status = searchParams.get("status");
    const orders = db.reworkOrders.filter(
      (item) => (!tuneId || item.tuneId === tuneId) && (!status || item.status === status)
    );
    return send(res, 200, { data: orders });
  }

  if (req.method === "POST" && pathname === "/rework-orders") {
    const body = await parseBody(req);
    required(body, ["tuneId", "issueIds"]);
    findTune(db, body.tuneId);
    if (!Array.isArray(body.issueIds) || body.issueIds.length === 0) {
      return send(res, 400, { error: "issueIds 必须是非空数组" });
    }
    const issueIds = [...new Set(body.issueIds)];
    const issues = issueIds.map((id) => db.issues.find((item) => item.id === id));
    if (issues.some((item) => !item || item.tuneId !== body.tuneId)) {
      return send(res, 400, { error: "问题不存在或不属于该曲目，整单拒绝" });
    }
    // 同一问题只允许一张待复核单
    const pendingOrder = db.reworkOrders.find(
      (order) => order.status === "pending_review" && order.issueIds.some((id) => issueIds.includes(id))
    );
    if (pendingOrder) {
      return send(res, 409, { error: `同一问题只允许一张待复核单，与返工单 ${pendingOrder.id} 冲突` });
    }
    // 跨区间整单拒绝
    const sectionIds = [...new Set(issues.map((item) => item.sectionId))];
    if (sectionIds.length > 1) {
      return send(res, 400, { error: "返工单跨区间，整单拒绝" });
    }
    // 问题已结案整单拒绝
    const resolved = issues.filter((item) => item.status === "resolved");
    if (resolved.length) {
      return send(res, 400, { error: `问题已结案，整单拒绝：${resolved.map((item) => item.id).join(", ")}` });
    }
    const section = db.sections.find((item) => item.id === sectionIds[0]);
    const order = {
      id: makeId("rework"),
      tuneId: body.tuneId,
      sectionId: sectionIds[0],
      issueIds,
      note: body.note || "",
      status: "pending_review",
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      reviewNote: null,
      invalidatedAt: null,
      invalidReason: null,
      archivedAt: null
    };
    db.reworkOrders.push(order);
    // 返工后问题仍计未解决（保持 open），所属区间转为待校对
    if (section) section.checked = false;
    await writeDb(db);
    return send(res, 201, { data: order });
  }

  const reviewMatch = pathname.match(/^\/rework-orders\/([^/]+)\/review$/);
  if (reviewMatch && req.method === "PATCH") {
    const order = db.reworkOrders.find((item) => item.id === reviewMatch[1]);
    if (!order) return send(res, 404, { error: "返工单不存在" });
    if (order.status !== "pending_review" && order.status !== "invalidated") {
      return send(res, 409, { error: `当前状态 ${order.status} 不可复核` });
    }
    const body = await parseBody(req);
    required(body, ["result"]);
    if (!["approved", "rejected"].includes(body.result)) {
      return send(res, 400, { error: "result 必须是 approved 或 rejected" });
    }
    const now = new Date().toISOString();
    if (body.result === "rejected") {
      // 退回须填原因，问题与区间保持原状态
      if (body.reason === undefined || body.reason === "") {
        return send(res, 400, { error: "退回必须填写原因" });
      }
      order.status = "rejected";
      order.reviewNote = body.reason;
    } else {
      // 复核通过才结案
      order.status = "approved";
      order.reviewNote = body.note ?? null;
      order.invalidatedAt = null;
      order.invalidReason = null;
      for (const issueId of order.issueIds) {
        const issue = db.issues.find((item) => item.id === issueId);
        if (issue && issue.status !== "resolved") {
          issue.status = "resolved";
          issue.resolvedAt = now;
        }
      }
    }
    order.reviewedAt = now;
    await writeDb(db);
    return send(res, 200, { data: order });
  }

  if (req.method === "POST" && pathname === "/rework-orders/archive") {
    const body = await parseBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : null;
    // 批量归档只处理已复核通过且未失效的记录
    const candidates = db.reworkOrders.filter(
      (item) => (!body.tuneId || item.tuneId === body.tuneId) && (!ids || ids.includes(item.id))
    );
    const now = new Date().toISOString();
    const archived = [];
    const skipped = [];
    for (const order of candidates) {
      if (order.status === "approved") {
        order.status = "archived";
        order.archivedAt = now;
        archived.push(order);
      } else if (order.status !== "archived") {
        skipped.push({ id: order.id, status: order.status });
      }
    }
    await writeDb(db);
    return send(res, 200, { data: { archived, skipped } });
  }

  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Organ strip punch API running at http://127.0.0.1:${PORT}`);
});
