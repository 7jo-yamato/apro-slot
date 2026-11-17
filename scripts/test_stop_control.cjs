const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf("const reels =")), context);
const control = vm.runInContext("({ selectStopPosition, winningRoles, matchesRole, symbolPosition, payoutFor })", context);
const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

assert(control.matchesRole("bell", 0, 9, 0));
assert(!control.matchesRole("bell", 0, 8, 0));
assert(control.matchesRole("gear", 2, 5, 0));
assert(control.matchesRole("gear", 2, 18, 0));

let cases = 0;
for (const bet of [3, 1]) {
for (const flag of ["none", "bell", "replay", "gear", "cherry", "big-seven", "big-clock", "regular"]) {
  if (bet === 1 && flag === "gear") continue;
  let wins = 0;
  const cache = new Map();
  for (const order of orders) {
    const winsBeforeOrder = wins;
    for (let a = 0; a < 21; a += 1) {
      for (let b = 0; b < 21; b += 1) {
        for (let c = 0; c < 21; c += 1) {
          const presses = [a, b, c];
          const stopped = [false, false, false];
          const positions = [0, 0, 0];
          let gearMiss = false;
          for (const reel of order) {
            if (flag === "gear" && reel === 0) {
              gearMiss = [-1, 0, 1, 2].some((offset) => [7, 8, 9].includes(control.symbolPosition(0, presses[0], offset)));
            }
            const key = JSON.stringify([reel, presses[reel], stopped, positions, gearMiss]);
            if (!cache.has(key)) {
              try {
                cache.set(key, control.selectStopPosition(flag, reel, presses[reel], stopped, positions, gearMiss, bet));
              } catch (error) {
                throw new Error(JSON.stringify({ flag, order, presses, reel, positions, stopped, gearMiss }), { cause: error });
              }
            }
            const stop = cache.get(key);
            assert(stop.slip >= 0 && stop.slip <= 4);
            assert.equal(stop.position, (presses[reel] + stop.slip) % 21);
            positions[reel] = stop.position;
            stopped[reel] = true;
          }
          const result = control.winningRoles(positions, bet);
          assert(result.every((role) => role === flag), `${flag}: illegal win ${result}`);
          if (flag === "gear" && gearMiss) assert(!result.includes("gear"));
          if (result.includes(flag)) wins += 1;
          cases += 1;
        }
      }
    }
    console.log(`  ${order.map((reel) => reel + 1).join("→")}: ${wins - winsBeforeOrder} / 9261`);
  }
  console.log(`${bet} BET ${flag}: ${wins} wins / 55566 cases`);
}
}
console.log(`PASS: ${cases} stop sequences, all six stop orders, slips 0–4, no non-established wins`);
assert(control.winningRoles([1, 3, 1], 3).includes("bell"));
assert(!control.winningRoles([1, 3, 1], 1).includes("bell"));
assert(control.winningRoles([3, 0, 0], 3).includes("cherry"));
assert(!control.winningRoles([3, 0, 0], 1).includes("cherry"));
for (const [bet, role, payout] of [[3,"bell",8],[1,"bell",5],[3,"gear",15],[1,"gear",0],[1,"cherry",2],[3,"cherry",2],[1,"replay",0],[3,"none",0]]) {
  assert.equal(control.payoutFor(role,bet),payout);
}

function element() {
  const classes = new Set();
  return {
    disabled: false, dataset: {}, handlers: {}, images: [{}, {}, {}], textContent: "", style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute() {},
    addEventListener(name, callback) { this.handlers[name] = callback; },
    querySelectorAll() { return this.images; },
    append() {},
    replaceChildren() {},
  };
}
const reels = Array.from({ length: 3 }, element);
const buttons = Array.from({ length: 3 }, element);
const lever = element(), bet = element(), cabinet = element(), status = element();
const forcedRole = element();
const slipReadouts = [element(), element(), element()];
const oneBet = element(), gearOption = element();
const flashSelect = element(), flashPreview = element(), flashStatus = element(), shotoSelect = element();
const warningSelect = element(), soundEnabled = element(), clockSelect = element(), effectStatus = element(), clockPanel = element();
warningSelect.value = "auto";
clockSelect.value = "auto";
flashSelect.value = "auto";
shotoSelect.value = "3";
const shotoLamps = [element(), element(), element()];
const counters = Object.fromEntries(["betCount", "totalIn", "totalOut", "netMedals", "lastPayout"].map((id) => [`#${id}`, element()]));
forcedRole.value = "random";
const timers = new Map();
const lampTimeouts = new Map();
let timerId = 0;
let currentTime = 0;
function advanceFrame() {
  currentTime += vm.runInContext("SYMBOL_INTERVAL_MS / 4", appContext);
  const pending = [...timers.entries()];
  pending.forEach(([id]) => timers.delete(id));
  pending.forEach(([, callback]) => callback(currentTime));
}
const appContext = vm.createContext({
  document: {
    querySelectorAll: (selector) => selector === ".reel" ? reels : selector === ".reel-shoto__lamp" ? shotoLamps : buttons,
    querySelector: (selector) => ({ ...counters, "#warningSound": warningSelect, "#soundEnabled": soundEnabled, "#clockChallenge": clockSelect, "#effectStatus": effectStatus, "#clockPanel": clockPanel, "#shotoLevel": shotoSelect, "#reelFlash": flashSelect, "#flashPreview": flashPreview, "#flashStatus": flashStatus, "#oneBet": oneBet, '#forcedRole option[value="gear"]': gearOption, "#lever": lever, "#maxBet": bet, ".cabinet": cabinet, "#gameResult": status, "#forcedRole": forcedRole, "#slip0": slipReadouts[0], "#slip1": slipReadouts[1], "#slip2": slipReadouts[2] })[selector],
    addEventListener() {},
    createElement: element,
  },
  window: {
    setTimeout(callback, delay) { lampTimeouts.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { lampTimeouts.delete(id); },
    requestAnimationFrame(callback) { timers.set(++timerId, callback); return timerId; },
    cancelAnimationFrame(id) { timers.delete(id); },
  },
  performance: { now: () => currentTime },
  crypto: { getRandomValues(values) { values[0] = 12000; return values; } },
});
vm.runInContext(source, appContext);
assert(lever.disabled);
bet.handlers.click();
assert.equal(counters["#totalIn"].textContent, "3枚");
lever.handlers.click();
// 全停止を同じ瞬間に要求しても、滑り終わるまで次ゲームを受け付けない。
buttons.forEach((button) => button.handlers.pointerdown({ button: 0 }));
for (let step = 0; step < 24; step += 1) advanceFrame();
assert.equal(timers.size, 0);
assert.equal(cabinet.dataset.result, "replay");
assert.equal(cabinet.dataset.lampRole, "replay");
assert.equal(status.textContent, "リプレイ入賞");
assert.equal(flashStatus.textContent, "振り子");
assert(shotoLamps.every((lamp) => lamp.classList.contains("is-shoto")));
assert(slipReadouts.every((readout) => /^[0-4]コマ$/.test(readout.textContent)));
assert(!lever.disabled && bet.disabled);
const replayInput = counters["#totalIn"].textContent;
lever.handlers.click();
assert.equal(counters["#totalIn"].textContent, replayInput);
assert.equal(timers.size, 3);
assert.equal(cabinet.dataset.lampRole, "none");
assert(slipReadouts.every((readout) => readout.textContent === "—"));
console.log("PASS: MAX BET → spin → simultaneous stops → sliding completion → replay → next spin");

assert.equal(vm.runInContext("SYMBOL_INTERVAL_MS * 21", appContext), vm.runInContext("60000 / REEL_RPM", appContext));
function stopAll() {
  buttons.forEach((button) => button.handlers.pointerdown({ button: 0 }));
  for (let step = 0; step < 24; step += 1) advanceFrame();
}
stopAll();
for (const role of ["bell", "replay", "cherry", "gear", "none"]) {
  forcedRole.value = role;
  bet.handlers.click();
  lever.handlers.click();
  assert.equal(vm.runInContext("game.flag", appContext), role);
  assert.equal(forcedRole.value, "random");
  assert(forcedRole.disabled);
  stopAll();
  assert(!forcedRole.disabled);
}
bet.handlers.click();
lever.handlers.click();
assert.equal(vm.runInContext("game.flag", appContext), "replay");
console.log("PASS: configured revolution period, one-shot forced roles, controls locked during spin, automatic random restoration");
advanceFrame();
const firstTransform = vm.runInContext("reelStrips[0].style.transform", appContext);
advanceFrame();
const secondTransform = vm.runInContext("reelStrips[0].style.transform", appContext);
assert.notEqual(firstTransform, secondTransform);
assert(vm.runInContext("reelPositionAt(0, performance.now()) % 1 !== 0", appContext));
stopAll();
assert.equal(timers.size, 0);
assert.equal(vm.runInContext("game.cursors.every(Number.isInteger)", appContext), true);
console.log("PASS: fractional frame movement and aligned stops");

forcedRole.value = "replay";
bet.handlers.click();
lever.handlers.click();
advanceFrame();
advanceFrame();
const shownBeforePress = vm.runInContext("game.motion[0].shown", appContext);
appContext.simulateSlowCalculation = () => { currentTime += 200; };
vm.runInContext(`
  const originalSelector = selectStopPosition;
  selectStopPosition = (...args) => {
    simulateSlowCalculation();
    return originalSelector(...args);
  };
`, appContext);
buttons[0].handlers.pointerdown({ button: 0 });
assert.equal(vm.runInContext("reelPositionAt(0, performance.now())", appContext), shownBeforePress);
let previousPosition = shownBeforePress;
const target = vm.runInContext("game.motion[0].target", appContext);
for (let frame = 0; frame < 24 && !/コマ$/.test(slipReadouts[0].textContent); frame += 1) {
  advanceFrame();
  const position = vm.runInContext("reelPositionAt(0, performance.now())", appContext);
  assert(position >= previousPosition - 1e-10 && position <= target + 1e-10);
  previousPosition = position;
}
assert(/コマ$/.test(slipReadouts[0].textContent));
console.log("PASS: 200ms computation delay causes no position jump; stop movement is monotonic and bounded");

stopAll();
vm.runInContext("selectStopPosition = originalSelector", appContext);
// 通常のハズレゲームを経て、再遊技中でない状態へ戻す。
forcedRole.value = "none";
bet.handlers.click();
lever.handlers.click();
stopAll();
const inputBeforeOneBet = vm.runInContext("game.totalIn", appContext);
forcedRole.value = "gear";
oneBet.handlers.click();
assert.equal(vm.runInContext("game.bet", appContext), 1);
assert.equal(vm.runInContext("game.totalIn", appContext), inputBeforeOneBet + 1);
assert(gearOption.disabled);
assert.equal(forcedRole.value, "random");
oneBet.handlers.click();
assert.equal(vm.runInContext("game.totalIn", appContext), inputBeforeOneBet + 1);
// 1枚掛けからMAX BETへの増し掛けでは追加2枚だけを計上する。
bet.handlers.click();
assert.equal(vm.runInContext("game.totalIn", appContext), inputBeforeOneBet + 3);
assert(!gearOption.disabled);
forcedRole.value = "none";
lever.handlers.click();
stopAll();
oneBet.handlers.click();
assert(vm.runInContext("Array.from({length:65536},(_,value)=>drawFlag(value,1)).every(flag=>flag!=='gear')", appContext));
forcedRole.value = "gear";
lever.handlers.click();
assert.equal(vm.runInContext("game.flag", appContext), "none");
stopAll();
assert.equal(cabinet.dataset.lampRole, "none");
assert.equal(counters["#netMedals"].textContent, vm.runInContext("`${game.totalOut-game.totalIn}枚`", appContext));
assert.equal(counters["#lastPayout"].textContent, "0枚");
console.log("PASS: 1/3 BET paylines, payouts, single-BET gear exclusion, upgrade accounting and replay accounting");

for (const [stake, role, positions, payout] of [
  [1, "bell", [0,0,0], 5],
  [3, "bell", [0,0,0], 8],
  [3, "gear", [1,2,1], 15],
  [1, "cherry", [4,0,0], 2],
  [3, "cherry", [4,0,0], 2],
]) {
  const beforeIn = vm.runInContext("game.totalIn", appContext);
  const beforeOut = vm.runInContext("game.totalOut", appContext);
  vm.runInContext(`game.cursors = ${JSON.stringify(positions)}`, appContext);
  (stake === 1 ? oneBet : bet).handlers.click();
  forcedRole.value = role;
  lever.handlers.click();
  stopAll();
  assert.equal(vm.runInContext("game.result", appContext), role);
  assert.equal(cabinet.dataset.lampRole, role);
  assert.equal(vm.runInContext("game.lastPayout", appContext), payout);
  assert.equal(vm.runInContext("game.totalOut", appContext), beforeOut + payout);
  assert.equal(vm.runInContext("game.totalIn", appContext), beforeIn + stake);
  stopAll();
  assert.equal(vm.runInContext("game.totalOut", appContext), beforeOut + payout);
}
console.log("PASS: actual bell/gear/cherry wins award configured medals exactly once");
console.log("PASS: side lamp follows the awarded role, stays off for losses, and clears on the next spin");
vm.runInContext("clearReelFlash()", appContext);
assert.equal(lampTimeouts.size, 1);
const lampTimeout = [...lampTimeouts.values()][0];
assert.equal(lampTimeout.delay, vm.runInContext("ROLE_LAMP_DURATION_MS", appContext));
lampTimeouts.clear();
lampTimeout.callback();
assert.equal(cabinet.dataset.lampRole, "none");
vm.runInContext('setRoleLamp("bell"); setRoleLamp("replay")', appContext);
assert.equal(lampTimeouts.size, 1);
assert.equal(cabinet.dataset.lampRole, "replay");
vm.runInContext('setRoleLamp("none")', appContext);
assert.equal(lampTimeouts.size, 0);
console.log("PASS: configured side lamp auto-off and old timeout cancellation");

for (const [pattern, label] of [["tick","秒刻み"],["pendulum","振り子"],["mesh","噛み合い"],["idle","空回り"],["v","Vフラッシュ"]]) {
  flashSelect.value = pattern;
  flashPreview.handlers.click();
  assert.equal(flashStatus.textContent, label);
  assert(reels.every((reel) => reel.classList.contains("is-flashing")));
  const steps = [...lampTimeouts.entries()].sort((a,b) => a[1].delay-b[1].delay);
  for (const [id, step] of steps) {
    lampTimeouts.delete(id);
    step.callback();
  }
  assert(reels.every((reel) => !reel.classList.contains("is-flashing")));
  assert.equal(flashStatus.textContent, "フラッシュなし");
}
flashSelect.value = "none";
flashPreview.handlers.click();
assert.equal(lampTimeouts.size,0);
flashSelect.value = "mesh";
flashPreview.handlers.click();
assert(lampTimeouts.size>0);
forcedRole.value = "none";
bet.handlers.click();
lever.handlers.click();
assert.equal(lampTimeouts.size,0);
assert(flashSelect.disabled && flashPreview.disabled);
assert.equal(flashSelect.value,"auto");
flashPreview.handlers.click();
assert.equal(lampTimeouts.size,0);
stopAll();
assert.equal(flashStatus.textContent,"噛み合い");
console.log("PASS: four flash sequences, preview, timeout cleanup, spin cancellation, selection consumption, shoto compatibility");
assert.equal(vm.runInContext('selectReelFlash("none", "v")', appContext), "none");
vm.runInContext('playReelFlash("v")', appContext);
assert.equal(vm.runInContext('flashCells.map((cell,index)=>cell.classList.contains("is-lit")?index:-1).filter(index=>index>=0).join(",")', appContext), "0,2");
const vSteps = [...lampTimeouts.entries()].sort((a,b) => a[1].delay-b[1].delay);
const vExpected = ["3,5", "7", "0,2,3,5,7", "0,2,3,5,7", "0,2,3,5,7", "", ""];
for (let step = 0; step < vSteps.length; step += 1) {
  const [id, timeout] = vSteps[step];
  lampTimeouts.delete(id);
  timeout.callback();
  assert.equal(vm.runInContext('flashCells.map((cell,index)=>cell.classList.contains("is-lit")?index:-1).filter(index=>index>=0).join(",")', appContext), vExpected[step]);
}
console.log("PASS: V preview follows both upper corners → sides → bottom center → V hold, and is excluded from normal play");

for (const role of ["replay", "cherry"]) {
  forcedRole.value = role;
  clockSelect.value = "on";
  warningSelect.value = "auto";
  shotoSelect.value = "auto";
  flashSelect.value = "auto";
  bet.handlers.click();
  lever.handlers.click();
  assert.equal(vm.runInContext("game.shotoTarget", appContext),3);
  assert(clockSelect.disabled && shotoSelect.disabled && warningSelect.disabled);
  assert(clockPanel.hidden);
  stopAll();
  assert.equal(flashStatus.textContent,"針の軌跡");
  assert.equal(clockPanel.hidden,false);
  assert(!clockSelect.disabled);
}
forcedRole.value="none";
shotoSelect.value="3";
flashSelect.value="auto";
bet.handlers.click();
lever.handlers.click();
assert(clockPanel.hidden);
stopAll();
assert.equal(flashStatus.textContent,"空回り");
forcedRole.value="none";
shotoSelect.value="0";
bet.handlers.click();
lever.handlers.click();
stopAll();
assert.equal(flashStatus.textContent,"フラッシュなし");
console.log("PASS: CLOCK force on replay/cherry, trace, 3-shoto miss flash, no flash on 0-shoto miss");

let audibleWarnings = 0;
appContext.window.AudioContext = class {
  constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
  createOscillator() {
    return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() { audibleWarnings += 1; }, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
  }
};
soundEnabled.checked = true;
vm.runInContext("Math.random = () => 0; game.cursors = [5, 9, 0]", appContext);
forcedRole.value="gear";
warningSelect.value="on";
shotoSelect.value="0";
clockSelect.value="off";
flashSelect.value="auto";
bet.handlers.click();
lever.handlers.click();
assert.equal(audibleWarnings,1);
stopAll();
assert.equal(vm.runInContext("game.result", appContext),"none");
assert.equal(flashStatus.textContent,"噛み合い");
soundEnabled.checked = false;
vm.runInContext("playWarningSound()",appContext);
assert.equal(audibleWarnings,1);
console.log("PASS: warning audio and mute, gear flash selected from flag even when the gear is missed");
