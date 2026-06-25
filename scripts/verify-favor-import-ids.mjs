import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "../src/vendor/xlsx.full.min.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const file = join(rootDir, "test-fixtures", "人情往来导入测试.xlsx");
const workbook = XLSX.read(readFileSync(file), { type: "buffer", cellDates: true });
const contacts = XLSX.utils.sheet_to_json(workbook.Sheets["关系人"], { defval: "", raw: false });
const events = XLSX.utils.sheet_to_json(workbook.Sheets["人情往来"], { defval: "", raw: false });

let counter = 0;
function createId(prefix) {
  counter += 1;
  return `${prefix}-test-${counter}`;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function keyFor(name, relation, phone = "") {
  const cleanName = normalize(name);
  const cleanPhone = String(phone || "").replace(/\s+/g, "").trim();
  const cleanRelation = normalize(relation);
  if (cleanPhone) return `${cleanName}|phone:${cleanPhone}`;
  if (cleanRelation) return `${cleanName}|relation:${cleanRelation}`;
  return cleanName;
}

const savedContacts = contacts.map((contact) => ({
  id: createId("contact"),
  name: contact["姓名"],
  relationType: contact["关系"],
  phone: contact["电话"],
}));

const contactMap = new Map();
savedContacts.forEach((contact) => {
  [keyFor(contact.name, contact.relationType, contact.phone), keyFor(contact.name, contact.relationType), keyFor(contact.name, "")]
    .filter(Boolean)
    .forEach((key) => {
      if (!contactMap.has(key)) contactMap.set(key, contact.id);
    });
});
const savedEvents = events.map((event) => {
  const contactId = contactMap.get(keyFor(event["关系人"], event["关系"]));
  const contact = savedContacts.find((item) => item.id === contactId);
  return {
    id: createId("favor"),
    contactId,
    contactName: contact?.name,
    title: `${contact?.name || event["关系人"]}${event["事件类型"]}`,
    direction: event["方向"] === "收礼" ? "received" : "given",
    amount: Number(String(event["金额"]).replace(/[¥元,\s]/g, "")),
  };
});

const duplicateContactIds = Object.entries(
  savedContacts.reduce((map, contact) => {
    map[contact.id] = (map[contact.id] || 0) + 1;
    return map;
  }, {}),
).filter(([, count]) => count > 1);

const summary = savedContacts.map((contact) => {
  const related = savedEvents.filter((event) => event.contactId === contact.id);
  return {
    name: contact.name,
    relationType: contact.relationType,
    count: related.length,
    received: related.filter((event) => event.direction === "received").reduce((sum, event) => sum + event.amount, 0),
    given: related.filter((event) => event.direction === "given").reduce((sum, event) => sum + event.amount, 0),
    titles: related.map((event) => event.title),
  };
});

console.log(JSON.stringify({ duplicateContactIds, summary }, null, 2));

const expected = new Map([
  ["敖文群|亲戚", { count: 1, received: 900, given: 0 }],
  ["沉雯林|亲戚", { count: 1, received: 800, given: 0 }],
  ["姚兴明|亲戚", { count: 1, received: 0, given: 200 }],
  ["陈小莲|亲戚", { count: 1, received: 700, given: 0 }],
  ["张三|朋友", { count: 1, received: 0, given: 1200 }],
  ["张三|同事", { count: 1, received: 600, given: 0 }],
]);

if (duplicateContactIds.length) {
  throw new Error("关系人 ID 仍然重复");
}

summary.forEach((item) => {
  const target = expected.get(`${item.name}|${item.relationType}`);
  if (!target) return;
  if (item.count !== target.count || item.received !== target.received || item.given !== target.given) {
    throw new Error(`${item.name}/${item.relationType} 统计不正确`);
  }
});
