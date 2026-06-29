const CATEGORY_RULES = [
  {
    category: "餐饮",
    confidence: 92,
    keywords: ["美团", "饿了么", "餐饮", "饭店", "餐厅", "小吃", "外卖", "奶茶", "咖啡", "瑞幸", "星巴克", "肯德基", "麦当劳", "必胜客", "火锅", "烧烤"],
  },
  {
    category: "交通",
    confidence: 90,
    keywords: ["滴滴", "高德打车", "地铁", "公交", "出租", "加油", "停车", "高速", "路桥", "12306", "火车票", "机票"],
  },
  {
    category: "购物",
    confidence: 88,
    keywords: ["淘宝", "天猫", "京东", "拼多多", "抖音商城", "快手小店", "得物", "唯品会", "山姆", "盒马", "超市", "便利店"],
  },
  {
    category: "居家生活",
    confidence: 90,
    keywords: ["水费", "电费", "燃气", "物业", "宽带", "话费", "移动", "联通", "电信", "家政", "维修"],
  },
  {
    category: "医疗",
    confidence: 92,
    keywords: ["医院", "药店", "挂号", "门诊", "医保", "体检", "牙科", "口腔", "诊所", "药房"],
  },
  {
    category: "孩子相关",
    confidence: 90,
    keywords: ["幼儿园", "学费", "绘本", "奶粉", "尿不湿", "儿童", "宝宝", "大宝", "二宝", "培训", "早教"],
  },
  {
    category: "房贷",
    fixedExpenseType: "房贷",
    confidence: 96,
    keywords: ["房贷", "住房贷款", "按揭", "还贷"],
  },
  {
    category: "还款",
    confidence: 95,
    keywords: ["信用卡", "花呗", "白条", "借呗", "银行卡还款", "贷款还款", "消费分期", "购物平台分期", "车贷"],
  },
  {
    category: "订阅",
    fixedExpenseType: "订阅",
    confidence: 92,
    keywords: ["会员", "订阅", "自动续费", "网易云", "腾讯视频", "爱奇艺", "优酷", "哔哩哔哩", "B站", "百度网盘", "夸克", "WPS", "ChatGPT", "OpenAI", "Claude", "Apple", "iCloud"],
  },
  {
    category: "收入",
    confidence: 96,
    type: "收入",
    keywords: ["工资", "薪资", "奖金", "报销", "退款", "转入", "收款", "收入", "理财赎回"],
  },
  {
    category: "人情往来",
    confidence: 86,
    keywords: ["红包", "礼金", "随礼", "份子钱", "转账", "婚礼", "满月", "乔迁", "生日"],
  },
];

export function isUncategorizedCategory(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return ["未分类", "其它", "其他", "unknown", "uncategorized"].includes(text.toLowerCase()) || text.includes("未") && text.includes("类") || text.includes("鏈");
}

export function classifyBill(item = {}) {
  return classifyBillWithRules(item);
}

function normalizeRuleKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[|/\\\-_:：·•,，.。()（）【】\[\]]/g, "")
    .trim()
    .toLowerCase();
}

export function getBillClassificationKeyword(item = {}) {
  const title = String(item.title || "").trim();
  const description = String(item.description || "").trim();
  const candidate = title.split(/\s+路\s+|[|/\\\-_:：·•,，.。()（）【】\[\]]/).find(Boolean) || title || description;
  return normalizeRuleKeyword(candidate).slice(0, 32);
}

export function createBillClassificationRule(item = {}) {
  const category = String(item.category || "").trim();
  const keyword = getBillClassificationKeyword(item);
  if (!keyword || isUncategorizedCategory(category)) return null;
  return {
    id: `rule-${keyword}`,
    keyword,
    category,
    fixedExpenseType: item.fixedExpenseType || "",
    confidence: 99,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

function classifyBillWithRules(item = {}, memoryRules = []) {
  const text = [
    item.title,
    item.description,
    item.category,
    item.source,
    item.paymentMethod,
    item.fixedExpenseType,
    ...(item.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const normalizedText = normalizeRuleKeyword(text);
  const remembered = (memoryRules || [])
    .filter((rule) => rule?.keyword && rule?.category)
    .sort((left, right) => String(right.keyword).length - String(left.keyword).length)
    .find((rule) => normalizedText.includes(String(rule.keyword || "").toLowerCase()));

  if (remembered) {
    return {
      category: remembered.category,
      fixedExpenseType: remembered.fixedExpenseType || item.fixedExpenseType || "",
      confidence: remembered.confidence || 99,
      source: "memory",
      reason: `命中记忆规则：${remembered.keyword}`,
    };
  }

  const matched = CATEGORY_RULES.find((rule) => rule.keywords.some((keyword) => text.includes(String(keyword).toLowerCase())));
  if (!matched) {
    return {
      category: item.type === "收入" ? "收入" : "未分类",
      confidence: 0,
      source: "unmatched",
      reason: "未命中自动分类规则",
    };
  }

  return {
    category: matched.category,
    fixedExpenseType: matched.fixedExpenseType || item.fixedExpenseType || "",
    type: matched.type || item.type || "",
    confidence: matched.confidence,
    source: "rule",
    reason: `命中关键词：${matched.keywords.find((keyword) => text.includes(String(keyword).toLowerCase()))}`,
  };
}

export function applyBillClassification(item = {}, memoryRules = []) {
  const result = classifyBillWithRules(item, memoryRules);
  const shouldApplyCategory = isUncategorizedCategory(item.category);
  const shouldApplyType = result.type && item.type !== result.type;
  const next = {
    ...item,
    category: shouldApplyCategory ? result.category : item.category,
    fixedExpenseType: item.fixedExpenseType || result.fixedExpenseType || "",
    type: shouldApplyType ? result.type : item.type,
  };

  next.classification = {
    autoCategory: shouldApplyCategory && result.category !== "未分类",
    category: next.category,
    confidence: result.confidence,
    source: result.source,
    reason: result.reason,
    needsReview: result.confidence < 75 || next.category === "未分类",
  };

  if (next.classification.autoCategory) {
    next.tags = [...new Set([...(next.tags || []), "自动分类"])];
  }

  return next;
}
