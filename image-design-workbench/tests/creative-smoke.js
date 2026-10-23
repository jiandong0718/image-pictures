// 仅在专用本机模拟环境运行：node tests/creative-smoke.js http://127.0.0.1:4175
const assert = require('node:assert/strict');
const base = process.argv[2];
if (base !== 'http://127.0.0.1:4175') throw new Error('仅允许本轮隔离测试环境');
let cookie = '';
async function request(route, body, method = body ? 'POST' : 'GET', auth = cookie) {
  const response = await fetch(base + route, { method, headers: { ...(auth ? { Cookie: auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  return { response, data };
}
async function poll(id, audio = false) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const { data } = await request((audio ? '/api/audio/tasks/' : '/api/tasks/') + id);
    if (data.status === 'done') return data.result;
    if (data.status === 'error') throw new Error(data.error);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('模拟任务超时');
}
(async () => {
  const login = await request('/api/auth/login', { username: 'review_admin', password: 'local-review-only' });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get('set-cookie').split(';')[0];
  const before = (await request('/api/auth/me')).data.user.credits;
  const prompt = await request('/api/prompts', { title: '验收商品模板', content: '保持商品形状，柔和侧光', tags: ['验收'] });
  assert.equal(prompt.response.status, 200, JSON.stringify(prompt.data));
  assert.ok((await request('/api/prompts?q=' + encodeURIComponent('验收商品'))).data.items.length > 0);
  const text = (await request('/api/assets', { kind: 'text', title: '商品说明', content: '不得改变商品 Logo', tags: ['验收'] })).data.asset;
  const image = (await request('/api/assets', { kind: 'image', mediaId: '001/review-1.png', title: '商品正面', tags: ['验收'] })).data.asset;
  const image2 = (await request('/api/assets', { kind: 'image', mediaId: '001/review-2.png', title: '商品侧面', tags: ['验收'] })).data.asset;
  assert.ok(text?.id && image?.id && image2?.id);
  const composed = await request('/api/compositions/resolve', { text: `请参考 @[asset:${image.id}] 与 @[asset:${image2.id}]。@[asset:${text.id}]`, assetIds: [image.id, text.id] });
  assert.equal(composed.response.status, 200, JSON.stringify(composed.data));
  assert.equal(composed.data.imageIds.length, 2);
  assert.match(composed.data.prompt, /不得改变商品 Logo/);
  const generated = await request('/api/playground/images', { prompt: composed.data.prompt, mode: 'edit', referenceImageIds: composed.data.imageIds, count: 2 });
  assert.equal(generated.response.status, 200, JSON.stringify(generated.data));
  const result = await poll(generated.data.taskId);
  assert.equal(result.images.length, 2);
  assert.equal(result.credits, before - 2, '原有生图仍按成功图片数扣费');
  const config = await request('/api/audio-config', { apiBase: 'http://127.0.0.1:4177/v1', apiKey: 'local-mock', model: 'mock-tts', charactersPerCredit: 10, creditsPerUnit: 2 });
  assert.equal(config.response.status, 200, JSON.stringify(config.data));
  assert.equal(Object.hasOwn(config.data.config, 'apiKey'), false);
  const audio = await request('/api/audio', { prompt: '你好'.repeat(6), voice: 'alloy', format: 'wav', speed: 1 });
  assert.equal(audio.response.status, 202, JSON.stringify(audio.data));
  assert.equal(audio.data.estimatedCost, 4);
  const sound = await poll(audio.data.taskId, true);
  assert.equal(sound.credits, before - 6);
  const audioFile = await fetch(base + sound.audio.fileUrl, { headers: { Cookie: cookie, Range: 'bytes=0-3' } });
  assert.equal(audioFile.status, 206); assert.equal(await audioFile.text(), 'RIFF');
  const forbidden = await request('/api/assets/file/' + image.id, null, 'GET', '');
  assert.equal(forbidden.response.status, 401);
  const name = 'check_' + Date.now();
  const other = await request('/api/auth/register', { username: name, password: 'local-test-only', email: name + '@example.test' }, 'POST', '');
  assert.ok([200,201].includes(other.response.status), JSON.stringify(other.data));
  const otherLogin = await request('/api/auth/login', { username: name, password: 'local-test-only' }, 'POST', '');
  const otherCookie = otherLogin.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/assets/file/' + image.id, null, 'GET', otherCookie)).response.status, 404);
  assert.equal((await request('/api/compositions/resolve', { text: `@[asset:${image.id}]` }, 'POST', otherCookie)).response.status, 404);
  assert.equal((await request('/api/audio-config', { model: 'other' }, 'POST', otherCookie)).response.status, 403);
  assert.equal((await request('/api/prompt-sources')).data.sources.length, 8);
  for (const route of ['/workbench','/prompts','/assets','/audio','/playground','/video','/retouch','/studio/hat','/my-images']) {
    const page = await fetch(base + route, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200, route);
    assert.match(await page.text(), /<!doctype html>/i);
  }
  const original = await fetch(base+'/api/showcase/media/image/001%2Freview-1.png');
  const originalBytes = (await original.arrayBuffer()).byteLength;
  const preview = await fetch(base+'/api/showcase/media/image/001%2Freview-1.png?thumb=1');
  const previewBytes = (await preview.arrayBuffer()).byteLength;
  assert.ok(previewBytes < originalBytes / 10);
  const cached = await fetch(base+'/api/showcase/media/image/001%2Freview-1.png?thumb=1', { headers: { 'If-None-Match': preview.headers.get('etag') } });
  assert.equal(cached.status, 304);
  const withdrawn = await request('/api/gallery/item', { kind: 'image', id: '001/review-1.png', published: false });
  assert.equal(withdrawn.response.status, 200);
  const noLongerPublic = await fetch(base+'/api/showcase/media/image/001%2Freview-1.png?thumb=1', { headers: { 'If-None-Match': preview.headers.get('etag') } });
  assert.equal(noLongerPublic.status, 404, '撤回后不得用304绕过公开权限');
  await request('/api/gallery/item', { kind: 'image', id: '001/review-1.png', published: true });
  const baseline = (await request('/api/auth/me')).data.user.credits;
  const set = (await request('/api/image-sets', {})).data.imageSet;
  const mainTask = await request('/api/images/main', { prompt: '旧主图流程验收', imageSetId: set.id });
  const main = await poll(mainTask.data.taskId);
  assert.ok(main.image.id); assert.equal(main.credits, baseline - 1);
  const batchTask = await request('/api/images/derived/batch', { imageSetId: set.id, mainImageId: main.image.id, types: ['whiteBackground', 'detail'], prompts: { whiteBackground: '白底图', detail: '细节图' } });
  const batch = await poll(batchTask.data.taskId);
  assert.equal(Object.keys(batch.results).length, 2); assert.equal(batch.credits, baseline - 3);
  const zip = await fetch(base+'/api/images/download-all', { method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({ids:[main.image.id,...Object.values(batch.results).map(i=>i.id)]}) });
  assert.equal(zip.status,200); assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0,2).toString(),'PK');
  const promptBody = new FormData();
  const source = await fetch(base+'/api/images/file/001%2Freview-1.png', {headers:{Cookie:cookie}});
  promptBody.append('image', new Blob([await source.arrayBuffer()], {type:'image/png'}), 'source.png');
  const extraction = await fetch(base+'/api/prompts/extract', {method:'POST',headers:{Cookie:cookie},body:promptBody});
  assert.equal(extraction.status,200);assert.match((await extraction.json()).prompt,/本地测试提示词/);
  await request('/api/video-config',{apiKey:'local-mock',model:'mock-video'});
  const videoTask = await request('/api/videos',{mode:'text',prompt:'测试镜头',ratio:'16:9',quality:'720p',duration:'5s'});
  const video = await poll(videoTask.data.taskId);
  assert.equal(video.credits,baseline-9); assert.ok(video.video.id);
  const videoFile = await fetch(base+video.video.url, {headers:{Cookie:cookie,Range:'Bytes=0-31'}});
  assert.equal(videoFile.status,206); assert.equal((await videoFile.arrayBuffer()).byteLength,32);
  const embedded = await fetch(base+'/gpt-image-playground/', {headers:{Cookie:cookie}});
  assert.equal(embedded.status,200,'已有绘图聚集地编译产物仍可访问');
  const proxy = await request('/api/full-playground-proxy/images/generations?async=true',{prompt:'嵌入工作台兼容验收',model:'mock-image',n:1});
  const proxyDone = await poll(proxy.data.taskId);
  assert.equal(proxyDone.credits,baseline-10);
  const proxyView = await request('/api/full-playground-proxy/tasks/'+proxy.data.taskId);
  assert.equal(proxyView.data.status,'done');assert.match(proxyView.data.result.images[0].url,/^http:\/\/127\.0\.0\.1:4175\//);
  console.log(JSON.stringify({ ok: true, verified: ['私有提示词','素材与引用编排','真实Python多参考图调用本机mock','旧生图成功后扣费','按Unicode字符计费音频','音频Range','所有权隔离','原有与新增页面','预览与304','公开作品撤回'], originalBytes, previewBytes, imageTaskId: generated.data.taskId, audioTaskId: audio.data.taskId }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
