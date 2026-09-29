const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeFilters, normalizeItemKey, toGalleryItem, toPublicItem } = require("../lib/gallery");

test("gallery filters accept only supported media and trim search text", () => {
  assert.deepEqual(normalizeFilters({
    media: "video",
    favorite: "1",
    keyword: "  产品摄影  ",
  }), { media: "video", favorite: true, keyword: "产品摄影" });
  assert.deepEqual(normalizeFilters({ media: "private", favorite: "false" }), {
    media: "all", favorite: false, keyword: "",
  });
});

test("gallery item lookup accepts only image and video kinds", () => {
  assert.deepEqual(normalizeItemKey("image", "001/a.png"), { kind: "image", id: "001/a.png" });
  assert.throws(() => normalizeItemKey("file", "001/a.png"), /类型无效/);
  assert.throws(() => normalizeItemKey("image", ""), /编号无效/);
});

test("gallery media records use the existing protected file routes", () => {
  const image = toGalleryItem({
    kind: "image", id: "001/a b.png", type: "main", label: "主图",
    prompt: "商品摄影", filename: "a b.png", created_at: "2026-09-29",
    image_set_id: "001", title: "封面", favorite: 1,
  });
  const video = toGalleryItem({
    kind: "video", id: "002/clip.mp4", type: "text", label: "AI 视频",
    prompt: "运镜", filename: "clip.mp4", created_at: "2026-09-29",
  });
  assert.equal(image.url, "/api/images/file/001%2Fa%20b.png");
  assert.equal(video.downloadUrl, "/api/videos/download/002%2Fclip.mp4");
  assert.equal(image.prompt, "商品摄影");
  assert.equal(image.favorite, true);
  assert.equal(image.imageSetId, "001");
  assert.equal(image.published, false);
});

test("public gallery projection exposes only published creative content", () => {
  const item = toPublicItem({
    kind: "image", id: "001/a b.png", type: "playground", label: "自由生图",
    prompt: "商品摄影", title: "封面", created_at: "2026-09-29",
    published_at: "2026-09-29", owner_user_id: 12, image_set_id: "001",
    filename: "a b.png", favorite: 1,
  });
  assert.equal(item.url, "/api/showcase/media/image/001%2Fa%20b.png");
  assert.equal(item.prompt, "商品摄影");
  assert.equal(item.title, "封面");
  assert.equal(Object.hasOwn(item, "ownerUserId"), false);
  assert.equal(Object.hasOwn(item, "imageSetId"), false);
  assert.equal(Object.hasOwn(item, "downloadUrl"), false);
});
