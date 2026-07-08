"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeVideoSize, VIDEO_DURATIONS } = require("../server");

test("computeVideoSize 长边取该档基准，短边按比例，且宽高均为 8 的倍数", () => {
  const l720 = computeVideoSize("16:9", "720p");
  assert.equal(l720.width, 1280);
  assert.equal(l720.height, 720);

  const p720 = computeVideoSize("9:16", "720p");
  assert.equal(p720.width, 720);
  assert.equal(p720.height, 1280);

  const sq = computeVideoSize("1:1", "480p");
  assert.equal(sq.width, sq.height);

  for (const ratio of ["16:9", "9:16", "1:1", "4:3", "3:4"]) {
    for (const q of ["480p", "720p", "1080p"]) {
      const { width, height } = computeVideoSize(ratio, q);
      assert.equal(width % 8, 0, `${ratio}/${q} 宽非 8 倍数`);
      assert.equal(height % 8, 0, `${ratio}/${q} 高非 8 倍数`);
    }
  }
});

test("未知比例/清晰度回退默认，不抛错", () => {
  const fallback = computeVideoSize("bogus", "bogus");
  assert.equal(fallback.width, 1280);
  assert.equal(fallback.height, 720);
});

test("所有时长档的帧数满足 Agnes 的 8n+1 规则", () => {
  for (const [label, frames] of Object.entries(VIDEO_DURATIONS)) {
    assert.equal((frames - 1) % 8, 0, `${label}=${frames} 不满足 8n+1`);
    assert.ok(frames <= 441, `${label}=${frames} 超过最大帧数 441`);
  }
});
