"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAudioInput, normalizeAudioConfig, publicAudioConfig, calculateAudioCost, generateSpeech } = require("../lib/audio-client");

const config = { apiBase: "https://voice.example/v1", apiKey: "private-test-key", model: "tts-test", charactersPerCredit: 1000, creditsPerUnit: 1 };

test("音频价格按去除首尾空白后的 Unicode 字符数向上分档", () => {
  assert.equal(calculateAudioCost(" 中🙂文 ", config).characterCount, 3);
  assert.equal(calculateAudioCost("🙂".repeat(1000), config).estimatedCost, 1);
  assert.equal(calculateAudioCost("🙂".repeat(1001), config).estimatedCost, 2);
  assert.equal(calculateAudioCost("12345", { charactersPerCredit: 2, creditsPerUnit: 3 }).estimatedCost, 9);
});

test("音频配置独立、密钥不返回、留空保留而显式清除停用", () => {
  const saved = normalizeAudioConfig({ ...config, apiKey: "" }, config);
  assert.equal(saved.apiKey, config.apiKey);
  assert.equal(publicAudioConfig(saved).configured, true);
  assert.equal(JSON.stringify(publicAudioConfig(saved)).includes(config.apiKey), false);
  assert.equal(publicAudioConfig(normalizeAudioConfig({ clearKey: true }, config)).configured, false);
  for (const invalid of [{ charactersPerCredit: 0 }, { creditsPerUnit: 0.5 }, { apiBase: "file:///tmp/a" }, { apiBase: "https://secret@voice.example" }, { apiKey: "key\nInjected: 1" }]) {
    assert.throws(() => normalizeAudioConfig(invalid, config));
  }
});

test("语音请求携带标准 speech 字段，返回受限二进制", async () => {
  let request;
  const result = await generateSpeech(config, { prompt: "  欢迎  ", voice: "alloy", speed: 1.25, format: "mp3", instructions: "平缓" }, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(Buffer.from("ID3fake-audio"), { headers: { "content-type": "audio/mpeg" } });
    },
  });
  assert.equal(request.url, "https://voice.example/v1/audio/speech");
  assert.equal(request.options.redirect, "error");
  assert.deepEqual(JSON.parse(request.options.body), { model: "tts-test", input: "欢迎", voice: "alloy", response_format: "mp3", speed: 1.25, instructions: "平缓" });
  assert.equal(result.data.toString(), "ID3fake-audio");
  assert.equal(result.mime, "audio/mpeg");
});

test("请求 MP3 但上游实际返回 WAV 时，文件格式跟随响应而非请求", async () => {
  const wav = Buffer.from("RIFF0000WAVEactual-audio");
  let requestedFormat;
  const result = await generateSpeech(config, { prompt: "你好", format: "mp3" }, {
    fetchImpl: async (_, options) => {
      requestedFormat = JSON.parse(options.body).response_format;
      return new Response(wav, { headers: { "content-type": "audio/wav; charset=binary" } });
    },
  });
  assert.equal(requestedFormat, "mp3");
  assert.equal(result.input.format, "mp3");
  assert.equal(result.ext, "wav");
  assert.equal(result.mime, "audio/wav");
  assert.deepEqual(result.data, wav);
});

test("实际音频 MIME 别名规范化；通用二进制响应才按请求格式回退", async () => {
  for (const [contentType, expectedMime, expectedExt] of [
    ["audio/x-wav", "audio/wav", "wav"],
    ["audio/opus", "audio/ogg", "ogg"],
    ["audio/x-flac", "audio/flac", "flac"],
    ["audio/flac", "audio/flac", "flac"],
    ["audio/mp3", "audio/mpeg", "mp3"],
    ["audio/aac", "audio/aac", "aac"],
  ]) {
    const result = await generateSpeech(config, { prompt: "你好", format: "mp3" }, { fetchImpl: async () => new Response("audio-data", { headers: { "content-type": contentType } }) });
    assert.equal(result.mime, expectedMime);
    assert.equal(result.ext, expectedExt);
  }
  for (const format of ["mp3", "wav", "opus", "flac", "aac"]) {
    const result = await generateSpeech(config, { prompt: "你好", format }, { fetchImpl: async () => new Response("audio-data", { headers: { "content-type": "application/octet-stream" } }) });
    assert.equal(result.ext, format === "opus" ? "ogg" : format);
    assert.equal(result.mime, ({ mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", flac: "audio/flac", aac: "audio/aac" })[format]);
  }
});

test("无配置、非法输入、错误响应和超大文件均不能成为成功音频", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(); };
  await assert.rejects(generateSpeech({}, { prompt: "hello" }, { fetchImpl }), /配置音频/);
  assert.equal(calls, 0);
  for (const raw of [{ prompt: "" }, { prompt: "a".repeat(4097) }, { prompt: "hello", speed: 5 }, { prompt: "hello", format: "html" }]) assert.throws(() => normalizeAudioInput(raw));
  await assert.rejects(generateSpeech(config, { prompt: "hello" }, { fetchImpl: async () => new Response(config.apiKey, { status: 401 }) }), (error) => error.statusCode === 502 && !error.message.includes(config.apiKey));
  await assert.rejects(generateSpeech(config, { prompt: "hello" }, { fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json" } }) }), /未返回音频/);
  await assert.rejects(generateSpeech(config, { prompt: "hello" }, { fetchImpl: async () => new Response("ID3", { headers: { "content-type": "audio/mpeg", "content-length": String(21 * 1024 * 1024) } }) }), /20MB/);
});

test("音频超时中断请求且不泄漏底层异常", async () => {
  await assert.rejects(generateSpeech(config, { prompt: "hello" }, {
    timeoutMs: 5,
    fetchImpl: (_, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error(config.apiKey)))),
  }), /超时/);
});
