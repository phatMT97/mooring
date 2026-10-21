import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRestarter } from "../src/agent-restart.js";

function fixture(overrides = {}) {
  const tab = { id: 1, shell: "wsl", title: "✳ Agent", status: "idle", atPrompt: true };
  const tabs = new Map([[tab.id, tab]]);
  const writes = [], requests = [];
  let clock = 0;
  const plan = { tool: "claude", session: "session-1", launcher: "vclaude", cmd: "vclaude --resume session-1", exit: "/exit" };
  const ctx = { invoke: async (name, args) => {
    if (name === "agent_tabs") { requests.push(args); return JSON.stringify(plan); }
    writes.push(args.data);
    if (args.data === "/exit\r") tab.exiting = true;
  }, tabs, hasAgent: () => true, distro: () => "Ubuntu", app: "mooring.test", t: (k) => k,
  toast: () => {}, now: () => clock, sleep: async (ms) => {
    clock += ms;
    if (tab.exiting) tab.atPrompt = true;
  }, ...overrides };
  return { tab, tabs, writes, requests, ctx, plan, ...createAgentRestarter(ctx) };
}

test("waits for a fresh prompt and preserves session/profile", async () => {
  const f = fixture();
  const out = await f.restartAgent(f.tab);
  assert.deepEqual(f.writes, ["\x05\x15", "/exit\r", "vclaude --resume session-1\r"]);
  assert.equal(out.session, "session-1");
  assert.equal(out.launcher, "vclaude");
  assert.equal(f.tab.atPrompt, false);
  assert.equal(f.tab.restarting, false);
});

test("busy tabs receive no writes; force interrupts before exit", async () => {
  const f = fixture();
  f.tab.status = "working";
  assert.equal((await f.restartAgent(f.tab)).skipped, "busy");
  assert.deepEqual(f.writes, []);
  await f.restartAgent(f.tab, true);
  assert.equal(f.writes[0], "\x1b");
  assert.equal(f.writes.at(-1), "vclaude --resume session-1\r");
});

test("timeout never types resume into an agent; lock is released", async () => {
  let clock = 0;
  const f = fixture({ sleep: async (ms) => { clock += ms; }, now: () => clock });
  await assert.rejects(f.restartAgent(f.tab), /promptTimeout/);
  assert.deepEqual(f.writes, ["\x05\x15", "/exit\r"]);
  assert.equal(f.tab.restarting, false);
});

test("rejects unavailable sessions, agy and incompatible launchers before any write", async () => {
  for (const error of ["noSession", "unsupported", "invalidLauncher"]) {
    const f = fixture({ invoke: async () => JSON.stringify({ error }) });
    await assert.rejects(f.restartAgent(f.tab), new RegExp(error));
    assert.deepEqual(f.writes, []);
    assert.equal(f.tab.restarting, false);
  }
});

test("launcher selection goes to the helper and cannot bypass tool validation", async () => {
  const f = fixture();
  await f.restartAgent(f.tab, false, "claude");
  assert.deepEqual(f.requests[0].args, ["resume-cmd", "1", "mooring.test", "claude"]);
});

test("status changes during inspection are checked again before exit", async () => {
  const f = fixture();
  f.ctx.invoke = async () => { f.tab.status = "working"; return JSON.stringify(f.plan); };
  const restart = createAgentRestarter(f.ctx).restartAgent;
  assert.equal((await restart(f.tab)).skipped, "busy");
  assert.deepEqual(f.writes, []);
});

test("closed tabs cannot receive resume, and concurrent restart is refused", async () => {
  const f = fixture();
  f.ctx.sleep = async () => { f.tabs.delete(f.tab.id); };
  const restart = createAgentRestarter(f.ctx).restartAgent;
  const pending = restart(f.tab);
  await assert.rejects(restart(f.tab), /alreadyRestarting/);
  await assert.rejects(pending, /closed/);
  assert.deepEqual(f.writes, ["\x05\x15", "/exit\r"]);
});

test("batch always skips caller, counts busy tabs, continues after per-tab failure", async () => {
  const f = fixture();
  const busy = { ...f.tab, id: 2, status: "working" };
  const idle = { ...f.tab, id: 3 };
  const agy = { ...f.tab, id: 4 };
  for (const x of [busy, idle, agy]) f.tabs.set(x.id, x);
  const writes = [];
  f.ctx.invoke = async (name, args) => {
    if (name === "agent_tabs") return JSON.stringify(args.args[1] === "4" ? { error: "unsupported" } : f.plan);
    writes.push(args.id);
    if (args.data === "/exit\r") f.tabs.get(args.id).atPrompt = true;
  };
  const out = await createAgentRestarter(f.ctx).restartAll({ from: f.tab });
  assert.equal(out.skippedSelf, 1);
  assert.equal(out.skippedBusy, 1);
  assert.deepEqual(out.restarted.map((x) => x.id), [3]);
  assert.deepEqual(out.failed.map((x) => x.id), [4]);
  assert.deepEqual(writes, [3, 3, 3]);
});

test("force on a batch still never touches the caller", async () => {
  const f = fixture();
  const out = await f.restartAll({ from: f.tab, force: true });
  assert.equal(out.skippedSelf, 1);
  assert.deepEqual(f.writes, []);
});
