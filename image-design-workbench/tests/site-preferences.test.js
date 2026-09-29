const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

async function loadPreferences() {
  const source = await readFile(path.join(__dirname, "../public/shared/site-preferences.js"), "utf8");
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

test("site preferences normalize supported themes and languages", async () => {
  const { normalizeTheme, normalizeLanguage } = await loadPreferences();
  assert.equal(normalizeTheme("mystic"), "mystic");
  assert.equal(normalizeTheme("unexpected"), "tech");
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("fr"), "zh");
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
