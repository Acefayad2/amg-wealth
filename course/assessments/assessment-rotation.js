var AMG_ASSESSMENT_ROTATION = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // netlify/functions/_shared/mock-rotation.mjs
  var mock_rotation_exports = {};
  __export(mock_rotation_exports, {
    createMockBank: () => createMockBank
  });
  function shuffled(items, random) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  var category = (q) => q.domain + ":" + Number(q.scored);
  function createMockBank(track, forms, extras = []) {
    if (!["life", "health"].includes(track)) throw Error("Unknown licensing track");
    const id = track + "-mock";
    const title = track === "life" ? "Life Mock Exam" : "Health Mock Exam";
    const legacy = new Map(forms.map((f) => [f.id, f]));
    const mocks = forms.filter((f) => f.id !== "D");
    const template = mocks[0];
    const pool = [...mocks.flatMap((f) => f.questions), ...extras];
    const byId = new Map(pool.map((q) => [q.id, q]));
    const groups = /* @__PURE__ */ new Map(), counts = /* @__PURE__ */ new Map();
    for (const q of template.questions) counts.set(category(q), (counts.get(category(q)) || 0) + 1);
    for (const q of pool) {
      const key = category(q);
      if (!counts.has(key) || !Number.isInteger(q.domain)) throw Error("Unmapped mock question: " + q.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(q);
    }
    if (byId.size !== pool.length) throw Error("Duplicate mock question ID");
    function formFor(a) {
      if (a.form !== id) return a.questionIds === void 0 ? legacy.get(a.form) : void 0;
      const ids = a.questionIds;
      if (!Array.isArray(ids) || ids.length !== template.questions.length || new Set(ids).size !== ids.length) return;
      const remaining = new Map(counts), questions = [];
      for (const qid of ids) {
        const q = byId.get(qid);
        if (!q || !remaining.get(category(q))) return;
        remaining.set(category(q), remaining.get(category(q)) - 1);
        questions.push(q);
      }
      return { id, title, minutes: template.minutes, questions };
    }
    function draw(attempts, random = Math.random) {
      const usage = /* @__PURE__ */ new Map(), last = /* @__PURE__ */ new Map();
      for (const [i, a] of attempts.entries()) {
        if (a.form === "D") continue;
        const f = formFor(a);
        if (!f) throw Error("Invalid saved mock attempt");
        for (const q of f.questions) {
          usage.set(q.id, (usage.get(q.id) || 0) + 1);
          last.set(q.id, i);
        }
      }
      const selected = [];
      for (const [key, size] of counts) {
        const ordered = shuffled(groups.get(key), random).sort((a, b) => (usage.get(a.id) || 0) - (usage.get(b.id) || 0) || (last.get(a.id) ?? -1) - (last.get(b.id) ?? -1));
        selected.push(...ordered.slice(0, size));
      }
      return {
        form: id,
        questionIds: shuffled(selected, random).map((q) => q.id),
        fresh: selected.every((q) => !usage.has(q.id))
      };
    }
    return { id, title, pool, size: template.questions.length, minutes: template.minutes, formFor, draw };
  }
  return __toCommonJS(mock_rotation_exports);
})();
