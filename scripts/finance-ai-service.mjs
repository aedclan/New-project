function getAiConfig() {
  return {
    apiKey: String(process.env.FINANCE_AI_API_KEY || process.env.OPENAI_API_KEY || "").trim(),
    model: String(process.env.FINANCE_AI_MODEL || process.env.OPENAI_MODEL || "").trim(),
    apiUrl: String(process.env.FINANCE_AI_API_URL || "https://api.openai.com/v1/chat/completions").trim(),
  };
}

function requireAiConfig() {
  const config = getAiConfig();
  if (!config.apiKey || !config.model) {
    throw new Error("大模型未配置。请在服务端设置 FINANCE_AI_API_KEY 和 FINANCE_AI_MODEL。");
  }
  return config;
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function requestLargeModel({ system, user, temperature = 0.2 }) {
  const config = requireAiConfig();
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || "大模型请求失败。");
  }
  const content = payload.choices?.[0]?.message?.content || payload.output_text || payload.content || "";
  const parsed = extractJsonObject(content);
  if (!parsed) throw new Error("大模型返回内容无法解析为 JSON。");
  return parsed;
}

function normalizeList(value, limit) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, limit) : [];
}

function normalizeAnalysisResult(result = {}) {
  const tone = ["good", "watch", "risk"].includes(result.tone) ? result.tone : "watch";
  const risks = normalizeList(result.risks, 4);
  const actions = normalizeList(result.actions, 5);
  return {
    ok: true,
    mode: "ai-api",
    privacyMode: "server-ai",
    tone,
    title: String(result.title || "AI 智能分析").slice(0, 48),
    conclusion: String(result.conclusion || "暂无分析结论。"),
    riskBreakdown: result.riskBreakdown && typeof result.riskBreakdown === "object" ? result.riskBreakdown : null,
    priorityActions: Array.isArray(result.priorityActions) ? result.priorityActions.slice(0, 5).map((item, index) => ({
      rank: Number(item.rank || index + 1),
      key: String(item.key || `ai-${index + 1}`),
      label: String(item.label || "AI"),
      title: String(item.title || item.action || "AI 行动"),
      score: Number(item.score || 0),
      reason: String(item.reason || ""),
      action: String(item.action || ""),
    })) : [],
    evidence: normalizeList(result.evidence, 6),
    risks,
    actions,
    narrative: String(result.narrative || [result.conclusion, risks.join("；"), actions.join("；")].filter(Boolean).join("\n")),
  };
}

function buildAnalysisPrompt(summary = {}) {
  return [
    "你是严谨的家庭财务分析助手。只能根据提供的聚合账本摘要分析，不要编造不存在的流水。",
    "请返回严格 JSON，不要 Markdown，不要代码块。",
    "JSON 字段：tone(good/watch/risk)、title、conclusion、riskBreakdown、priorityActions、evidence、risks、actions、narrative。",
    "riskBreakdown 结构：{total:number, level:string, rows:[{key,label,score,text}]}，rows 建议包含现金流、数据质量、预测压力、支出集中、波动缓冲。",
    "priorityActions 最多 5 条，每条包含 rank,key,label,title,score,reason,action。建议必须可执行。",
    "回答必须附数据依据，避免空泛建议。",
    `聚合账本摘要：${JSON.stringify(summary)}`,
  ].join("\n");
}

function detectIntent(question = "") {
  const text = String(question || "");
  if (/减少|降低|下降|如果|结余会|模拟|20%|百分之/.test(text)) return "scenario_simulation";
  if (/订阅|续费|暂停/.test(text)) return "subscription_pause";
  if (/未来|三个月|3个月|压力/.test(text)) return "future_pressure";
  if (/花到哪里|花哪|流向|分类|主要花/.test(text)) return "spending_flow";
  if (/下个月|下月|控制|怎么控/.test(text)) return "next_month_control";
  if (/风险|为什么.*高|高风险/.test(text)) return "risk_reason";
  return "general";
}

function normalizeQaResult(result = {}, question = "") {
  const actions = Array.isArray(result.actions) ? result.actions.slice(0, 5).map((item, index) => ({
    key: String(item.key || `qa-${index + 1}`),
    title: String(item.title || item.action || "问答行动"),
    action: String(item.action || item.title || ""),
    reason: String(item.reason || ""),
    score: Number(item.score || 0),
  })) : [];
  return {
    ok: true,
    mode: "ai-api",
    privacyMode: "server-ai",
    intent: String(result.intent || detectIntent(question)),
    answer: String(result.answer || "暂无回答。"),
    evidence: normalizeList(result.evidence, 8),
    calculations: normalizeList(result.calculations, 6),
    actions,
    followUps: normalizeList(result.followUps, 4),
  };
}

function buildQaPrompt({ question, summary }) {
  return [
    "你是用户的个人账本问答助手。用户会询问自己的账本，请只根据聚合数据回答。",
    "禁止编造具体流水。若数据不足，明确说明缺口。",
    "请返回严格 JSON，不要 Markdown，不要代码块。",
    "JSON 字段：intent、answer、evidence(string数组)、calculations(string数组)、actions数组、followUps(string数组)。",
    "actions 每条包含 key,title,action,reason,score，可被用户采纳为本月行动。",
    "回答要短、明确、专业，有数字依据。",
    `用户问题：${question}`,
    `系统识别意图：${detectIntent(question)}`,
    `聚合账本摘要：${JSON.stringify(summary)}`,
  ].join("\n");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readRequestBuffer(request, maxBytes = 1024 * 1024) {
  return new Promise((resolveBuffer, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("请求内容过大。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const buffer = await readRequestBuffer(request);
  return buffer.length ? JSON.parse(buffer.toString("utf8")) : {};
}

export async function handleFinanceAiRequest(request, response) {
  if (!request.url?.startsWith("/api/ai/finance-")) return false;
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "仅支持 POST。" });
    return true;
  }
  try {
    const payload = await readJsonBody(request);
    if (request.url.startsWith("/api/ai/finance-analysis")) {
      const result = await requestLargeModel({
        system: "你是严谨的家庭财务分析助手，只返回严格 JSON。",
        user: buildAnalysisPrompt(payload.summary || payload),
      });
      sendJson(response, 200, normalizeAnalysisResult(result));
      return true;
    }
    if (request.url.startsWith("/api/ai/finance-qa")) {
      const question = String(payload.question || "").trim();
      if (!question) {
        sendJson(response, 400, { ok: false, message: "请输入问题。" });
        return true;
      }
      const result = await requestLargeModel({
        system: "你是个人账本问答助手，只返回严格 JSON。",
        user: buildQaPrompt({ question, summary: payload.summary || {} }),
      });
      sendJson(response, 200, normalizeQaResult(result, question));
      return true;
    }
    sendJson(response, 404, { ok: false, message: "接口不存在。" });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error.message || "大模型分析失败。" });
  }
  return true;
}
