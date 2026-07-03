"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveVipStatus } = require("../lib/vip-tiers");

test("resolves the correct tier at each cumulative boundary", () => {
  const cases = [
    [0, "normal"],
    [99, "normal"],
    [100, "silver"],
    [299, "silver"],
    [300, "platinum"],
    [599, "platinum"],
    [600, "diamond"],
    [1099, "diamond"],
    [1100, "vip"],
    [2099, "vip"],
    [2100, "svip"],
    [999999, "svip"],
  ];
  for (const [total, expected] of cases) {
    const status = resolveVipStatus(total);
    assert.equal(status.currentTier.key, expected, `total=${total}`);
  }
});

test("computes remaining count to next tier, and null next tier at the top", () => {
  const mid = resolveVipStatus(50);
  assert.equal(mid.nextTier.key, "silver");
  assert.equal(mid.remainingToNext, 50);

  const top = resolveVipStatus(5000);
  assert.equal(top.nextTier, null);
  assert.equal(top.remainingToNext, 0);
});

test("negative or non-numeric input clamps to zero", () => {
  assert.equal(resolveVipStatus(-5).currentTier.key, "normal");
  assert.equal(resolveVipStatus(NaN).currentTier.key, "normal");
});
