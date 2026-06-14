const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createProductWorkspaces,
  getProductWorkspace,
} = require("../public/product-workspaces.js");

const MODES = ["hat", "bag", "shoulderBagFlat"];
const DEFAULT_PROMPTS = {
  main: "main prompt",
  derived: "derived prompt",
  shoulderBagStrap: "strap prompt",
};

test("isolates legacy shared state into the active product workspace only", () => {
  const workspaces = createProductWorkspaces({
    modes: MODES,
    defaultPrompts: DEFAULT_PROMPTS,
    savedWorkspaces: {},
    activeMode: "bag",
    legacyWorkspace: {
      imageSet: { id: "set-bag", folderName: "013" },
      prompts: { main: "bag main prompt" },
      images: { main: { id: "bag-main" } },
    },
    forceNew: false,
  });

  assert.equal(workspaces.bag.imageSet.id, "set-bag");
  assert.equal(workspaces.bag.prompts.main, "bag main prompt");
  assert.equal(workspaces.bag.images.main.id, "bag-main");

  assert.equal(workspaces.hat.imageSet, null);
  assert.equal(workspaces.hat.prompts.main, DEFAULT_PROMPTS.main);
  assert.deepEqual(workspaces.hat.images, {});

  assert.equal(workspaces.shoulderBagFlat.imageSet, null);
  assert.equal(workspaces.shoulderBagFlat.prompts.main, DEFAULT_PROMPTS.main);
  assert.deepEqual(workspaces.shoulderBagFlat.images, {});
});

test("keeps saved product workspaces independent and applies prompt overrides only to the active mode", () => {
  const workspaces = createProductWorkspaces({
    modes: MODES,
    defaultPrompts: DEFAULT_PROMPTS,
    savedWorkspaces: {
      hat: {
        imageSet: { id: "set-hat" },
        prompts: { main: "hat prompt" },
        images: { main: { id: "hat-main" } },
      },
      bag: {
        imageSet: { id: "set-bag" },
        prompts: { main: "bag prompt" },
        images: { main: { id: "bag-main" } },
      },
    },
    activeMode: "hat",
    promptOverrides: { derived: "override derived" },
  });

  assert.equal(workspaces.hat.imageSet.id, "set-hat");
  assert.equal(workspaces.hat.images.main.id, "hat-main");
  assert.equal(workspaces.hat.prompts.derived, "override derived");

  assert.equal(workspaces.bag.imageSet.id, "set-bag");
  assert.equal(workspaces.bag.images.main.id, "bag-main");
  assert.equal(workspaces.bag.prompts.derived, DEFAULT_PROMPTS.derived);
});

test("creates a missing workspace lazily without mutating existing workspaces", () => {
  const workspaces = {
    hat: {
      imageSet: { id: "set-hat" },
      prompts: { ...DEFAULT_PROMPTS, main: "hat prompt" },
      images: { main: { id: "hat-main" } },
    },
  };

  const flatWorkspace = getProductWorkspace(workspaces, "shoulderBagFlat", MODES, DEFAULT_PROMPTS);

  assert.equal(flatWorkspace.imageSet, null);
  assert.equal(flatWorkspace.prompts.main, DEFAULT_PROMPTS.main);
  assert.deepEqual(flatWorkspace.images, {});
  assert.equal(workspaces.hat.images.main.id, "hat-main");
});

test("stores loading and message state per workspace", () => {
  const workspaces = createProductWorkspaces({
    modes: MODES,
    defaultPrompts: DEFAULT_PROMPTS,
    savedWorkspaces: {
      hat: {
        loading: { main: true },
        messages: { main: { text: "生成中", kind: "success" } },
      },
      bag: {
        loading: { derived: false },
        messages: { derived: { text: "待生成", kind: "" } },
      },
    },
    activeMode: "hat",
  });

  assert.equal(workspaces.hat.loading.main, true);
  assert.deepEqual(workspaces.hat.messages.main, { text: "生成中", kind: "success" });
  assert.equal(workspaces.bag.loading.derived, false);
  assert.deepEqual(workspaces.bag.messages.derived, { text: "待生成", kind: "" });
  assert.deepEqual(workspaces.shoulderBagFlat.loading, {});
  assert.deepEqual(workspaces.shoulderBagFlat.messages, {});
});
