"use strict";

// 账户系统冒烟测试：需要可用的 MySQL（读取 .env 的 DB_* 配置）。
// 运行：node tests/account-smoke.js
// 会创建一个临时用户、校验赠送积分、扣减、充值、流水，跑完自动清理该用户。

require("../lib/env").loadEnv();
const assert = require("node:assert/strict");
const db = require("../lib/db");
const accounts = require("../lib/accounts");

async function main() {
  await db.init();
  const pool = db.getPool();
  const username = `smoke_${Date.now()}`;
  const password = "smoke-pass-123";

  try {
    // 1) 注册赠送积分（邮箱/手机号至少一项，这里用邮箱）
    const user = await accounts.register(username, password, { email: `${username}@smoke.test` });
    assert.equal(user.credits, db.SIGNUP_BONUS_CREDITS, "注册应赠送配置的积分");
    console.log(`✓ 注册成功，赠送 ${user.credits} 积分`);

    // 1b) 不填邮箱/手机号应拒绝；保留用户名应拒绝
    await assert.rejects(
      () => accounts.register(`${username}_b`, password),
      /邮箱或手机号/,
    );
    await assert.rejects(
      () => accounts.register("admin_test", password, { email: "x@smoke.test" }),
      /不可用/,
    );
    console.log("✓ 注册校验：邮箱/手机号必填、保留用户名拦截");

    // 2) 登录校验
    const logged = await accounts.login(username, password);
    assert.equal(logged.id, user.id);
    await assert.rejects(() => accounts.login(username, "wrong"), /密码错误/);
    console.log("✓ 登录校验通过（正确密码成功，错误密码拒绝）");

    // 3) 扣减积分
    const after = await accounts.consumeCredits(user.id, 3, "冒烟测试消费");
    assert.equal(after, db.SIGNUP_BONUS_CREDITS - 3);
    console.log(`✓ 扣减 3 积分，余额 ${after}`);

    // 4) 余额不足拦截
    await assert.rejects(
      () => accounts.consumeCredits(user.id, 9999, "超额"),
      (err) => err.statusCode === 402,
    );
    console.log("✓ 余额不足正确拦截（402）");

    // 5) 管理员充值
    const recharged = await accounts.rechargeCredits(user.id, 50, user.id, "冒烟测试充值");
    assert.equal(recharged.credits, after + 50);
    console.log(`✓ 充值 50 积分，余额 ${recharged.credits}`);

    // 6) 流水
    const tx = await accounts.listTransactions(user.id, { pageSize: 10 });
    assert.ok(tx.items.length >= 3, "应有注册/消费/充值流水");
    console.log(`✓ 流水 ${tx.items.length} 条`);

    console.log("\n全部通过 ✅");
  } finally {
    await pool.query("DELETE FROM users WHERE username = ?", [username]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✗ 冒烟测试失败：", err.message);
  process.exit(1);
});
