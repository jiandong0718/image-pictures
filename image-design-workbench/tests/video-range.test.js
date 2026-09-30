const assert = require("node:assert/strict");
const test = require("node:test");

const { sendVideoData } = require("../server");

const video = Buffer.from("0123456789");

function requestVideo(range, method = "GET") {
  const response = {};
  const req = { method, headers: range ? { range } : {} };
  const res = {
    writeHead(status, headers) {
      response.status = status;
      response.headers = headers;
    },
    end(body) {
      response.body = body;
    },
  };
  sendVideoData(req, res, video, { "Content-Type": "video/mp4" });
  return response;
}

test("video responses serve requested byte ranges for mobile playback", () => {
  const firstBytes = requestVideo("bytes=0-1");
  assert.equal(firstBytes.status, 206);
  assert.equal(firstBytes.headers["Accept-Ranges"], "bytes");
  assert.equal(firstBytes.headers["Content-Range"], "bytes 0-1/10");
  assert.equal(firstBytes.headers["Content-Length"], 2);
  assert.equal(firstBytes.body.toString(), "01");

  const remaining = requestVideo("bytes=7-");
  assert.equal(remaining.headers["Content-Range"], "bytes 7-9/10");
  assert.equal(remaining.body.toString(), "789");

  const suffix = requestVideo("bytes=-3");
  assert.equal(suffix.headers["Content-Range"], "bytes 7-9/10");
  assert.equal(suffix.body.toString(), "789");
});

test("video responses reject ranges outside the file and keep complete requests intact", () => {
  const missing = requestVideo("bytes=10-");
  assert.equal(missing.status, 416);
  assert.equal(missing.headers["Content-Range"], "bytes */10");
  assert.equal(missing.headers["Content-Length"], 0);

  const full = requestVideo();
  assert.equal(full.status, 200);
  assert.equal(full.headers["Content-Length"], 10);
  assert.equal(full.body.toString(), "0123456789");

  const head = requestVideo("bytes=0-1", "HEAD");
  assert.equal(head.status, 206);
  assert.equal(head.headers["Content-Length"], 2);
  assert.equal(head.body, undefined);
});
