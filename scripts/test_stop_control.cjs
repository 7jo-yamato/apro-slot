const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf("const reels =")), context);
const control = vm.runInContext("({ selectStopPosition, winningRoles, matchesRole, symbolPosition })", context);
const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

assert(control.matchesRole("bell", 0, 9, 0));
assert(!control.matchesRole("bell", 0, 8, 0));
assert(control.matchesRole("gear", 2, 5, 0));
assert(control.matchesRole("gear", 2, 18, 0));

let cases = 0;
for (const flag of ["none", "bell", "replay", "gear", "cherry", "big-seven", "big-clock", "regular"]) {
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
                cache.set(key, control.selectStopPosition(flag, reel, presses[reel], stopped, positions, gearMiss));
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
          const result = control.winningRoles(positions);
          assert(result.every((role) => role === flag), `${flag}: illegal win ${result}`);
          if (flag === "gear" && gearMiss) assert(!result.includes("gear"));
          if (result.includes(flag)) wins += 1;
          cases += 1;
        }
      }
    }
    console.log(`  ${order.map((reel) => reel + 1).join("→")}: ${wins - winsBeforeOrder} / 9261`);
  }
  console.log(`${flag}: ${wins} wins / 55566 cases`);
}
console.log(`PASS: ${cases} stop sequences, all six stop orders, slips 0–4, no non-established wins`);

function element() {
  return {
    disabled: false, dataset: {}, handlers: {}, images: [{}, {}, {}], textContent: "", style: {},
    classList: { add() {}, remove() {}, toggle() {} },
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
forcedRole.value = "random";
const timers = new Map();
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
    querySelectorAll: (selector) => selector === ".reel" ? reels : buttons,
    querySelector: (selector) => ({ "#lever": lever, "#maxBet": bet, ".cabinet": cabinet, "#gameResult": status, "#forcedRole": forcedRole, "#slip0": slipReadouts[0], "#slip1": slipReadouts[1], "#slip2": slipReadouts[2] })[selector],
    addEventListener() {},
    createElement: element,
  },
  window: {
    requestAnimationFrame(callback) { timers.set(++timerId, callback); return timerId; },
    cancelAnimationFrame(id) { timers.delete(id); },
  },
  performance: { now: () => currentTime },
  crypto: { getRandomValues(values) { values[0] = 12000; return values; } },
});
vm.runInContext(source, appContext);
assert(lever.disabled);
bet.handlers.click();
lever.handlers.click();
// 全停止を同じ瞬間に要求しても、滑り終わるまで次ゲームを受け付けない。
buttons.forEach((button) => button.handlers.pointerdown({ button: 0 }));
for (let step = 0; step < 24; step += 1) advanceFrame();
assert.equal(timers.size, 0);
assert.equal(cabinet.dataset.result, "replay");
assert.equal(status.textContent, "リプレイ入賞");
assert(slipReadouts.every((readout) => /^[0-4]コマ$/.test(readout.textContent)));
assert(!lever.disabled && bet.disabled);
lever.handlers.click();
assert.equal(timers.size, 3);
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
