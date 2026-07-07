"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveVipStatus } = require("../lib/vip-tiers");

test("resolves the correct tier at each absolute threshold", () => {
  const cases = [
    [0, "normal"],
    [199, "normal"],
    [200, "silver"],
    [299, "silver"],
    [300, "platinum"],
    [499, "platinum"],
    [500, "diamond"],
    [799, "diamond"],
    [800, "vip"],
    [999, "vip"],
    [1000, "svip"],
    [1999, "svip"],
    [2000, "supreme"],
    [999999, "supreme"],
  ];
  for (const [total, expected] of cases) {
    const status = resolveVipStatus(total);
    assert.equal(status.currentTier.key, expected, `total=${total}`);
  }
});

test("computes remaining count to next tier, and null next tier at the top", () => {
  const mid = resolveVipStatus(50);
  assert.equal(mid.nextTier.key, "silver");
  assert.equal(mid.remainingToNext, 150);

  const top = resolveVipStatus(5000);
  assert.equal(top.nextTier, null);
  assert.equal(top.remainingToNext, 0);
});

test("negative or non-numeric input clamps to zero", () => {
  assert.equal(resolveVipStatus(-5).currentTier.key, "normal");
  assert.equal(resolveVipStatus(NaN).currentTier.key, "normal");
});
