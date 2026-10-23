const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const { byteRange, sendMediaFile } = require('../lib/media-response');

test('媒体 Range 保留旧大小写、空白、多段回退和越界语义', () => {
  assert.deepEqual(byteRange(' Bytes=0-1 ', 6), { start: 0, end: 1 });
  assert.deepEqual(byteRange('bytes=-2', 6), { start: 4, end: 5 });
  assert.equal(byteRange('bytes=0-1,4-5', 6), null);
  assert.deepEqual(byteRange('bytes=9-', 6), { invalid: true });
});

test('实际文件流支持 Range、HEAD 和 ETag 304，不重新传输正文', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-response-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'clip.mp4');
  await fs.writeFile(file, 'abcdef');
  async function request(headers = {}, method = 'GET') {
    const chunks = [];
    const response = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
    response.writeHead = (status, values) => { response.status = status; response.headers = values; };
    await sendMediaFile({ method, headers }, response, file, { 'Cache-Control': 'private, no-cache' });
    return { status: response.status, headers: response.headers, body: Buffer.concat(chunks).toString() };
  }
  const full = await request();
  assert.equal(full.body, 'abcdef');
  const range = await request({ range: 'Bytes=1-3' });
  assert.equal(range.status, 206); assert.equal(range.body, 'bcd');
  assert.equal((await request({ range: 'bytes=0-1,4-5' })).status, 200);
  const cached = await request({ 'if-none-match': full.headers.ETag });
  assert.equal(cached.status, 304); assert.equal(cached.body, '');
  const head = await request({}, 'HEAD');
  assert.equal(head.headers['Content-Length'], 6); assert.equal(head.body, '');
  assert.equal((await request({ range: 'bytes=99-' })).status, 416);
  assert.equal((await request({ range: 'bytes=0-1', 'if-range': 'old-etag' })).body, 'abcdef');
});
