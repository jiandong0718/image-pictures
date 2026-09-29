const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

async function loadAuthNavigation() {
  const source = await readFile(path.join(__dirname, "../public/shared/auth-navigation.js"), "utf8");
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

test("login defaults to the workbench and preserves an intended workspace page", async () => {
  const { resolveAuthDestination } = await loadAuthNavigation();
  assert.equal(resolveAuthDestination(null), "/playground");
  assert.equal(resolveAuthDestination("/"), "/playground");
  assert.equal(resolveAuthDestination("/login"), "/playground");
  assert.equal(resolveAuthDestination("/my-images?page=2"), "/my-images?page=2");
});

test("login never redirects to another origin", async () => {
  const { resolveAuthDestination } = await loadAuthNavigation();
  assert.equal(resolveAuthDestination("https://example.com"), "/playground");
  assert.equal(resolveAuthDestination("//example.com"), "/playground");
  assert.equal(resolveAuthDestination("/\\example.com"), "/playground");
  assert.equal(resolveAuthDestination("/studio/hat\n"), "/playground");
});
