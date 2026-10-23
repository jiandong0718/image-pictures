const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlaygroundRequest } = require('../server');

test('多参考图保留顺序去重，并保留旧单参考参数协议', () => {
  const old = normalizePlaygroundRequest({ prompt: '商品图', mode: 'edit', referenceImageId: '001/a.png' });
  assert.equal(old.referenceImageId, '001/a.png');
  assert.equal(Object.hasOwn(old, 'referenceImageIds'), false);
  const next = normalizePlaygroundRequest({ prompt: '商品图', mode: 'edit', referenceImageIds: ['asset:2', '001/a.png', 'asset:2'] });
  assert.deepEqual(next.referenceImageIds, ['asset:2', '001/a.png']);
  assert.throws(() => normalizePlaygroundRequest({ prompt: '商品图', referenceImageIds: 'asset:2' }), /格式/);
});
