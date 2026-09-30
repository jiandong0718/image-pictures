const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

async function loadPreferences() {
  const source = await readFile(path.join(__dirname, "../public/shared/site-preferences.js"), "utf8");
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

test("site preferences normalize supported themes and languages", async () => {
  const { normalizeTheme, normalizeLanguage } = await loadPreferences();
  assert.equal(normalizeTheme("mystic"), "mystic");
  assert.equal(normalizeTheme("unexpected"), "mystic");
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("fr"), "zh");
});

test("theme initializes to mystic and keeps an explicit theme choice", async () => {
  const source = await readFile(path.join(__dirname, "../public/shared/theme-init.js"), "utf8");
  const apply = (savedTheme) => {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(source, { document, localStorage: { getItem: () => savedTheme } });
    return document.documentElement.dataset.theme;
  };
  assert.equal(apply(null), "mystic");
  assert.equal(apply("tech"), "tech");
  assert.equal(apply("xianxia"), "xianxia");
  assert.equal(apply("mystic"), "mystic");
});

test("release notifications count only unseen versions and recover from bad storage", async () => {
  const { parseReadReleaseIds, unreadReleaseIds, RELEASE_NOTES } = await loadPreferences();
  assert.deepEqual(parseReadReleaseIds("not json"), []);
  assert.deepEqual(parseReadReleaseIds('{"id":"old"}'), []);
  assert.deepEqual(parseReadReleaseIds('["read",7,null]'), ["read"]);
  assert.deepEqual(unreadReleaseIds(RELEASE_NOTES, []), RELEASE_NOTES.map((note) => note.id));
  assert.deepEqual(unreadReleaseIds(RELEASE_NOTES, RELEASE_NOTES.map((note) => note.id)), []);
  assert.deepEqual(unreadReleaseIds([{ id: "old" }, { id: "new" }], ["old"]), ["new"]);
});
