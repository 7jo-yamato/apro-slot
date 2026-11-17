const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf("const reels =")), context);
const { selectGameEffects, selectReelFlash, rules } = vm.runInContext("({selectGameEffects, selectReelFlash, rules:EFFECT_ROLES})", context);
for (const role of ["none", "bell", "replay", "cherry", "gear"]) {
  for (const warning of ["auto", "on", "off"]) {
    for (const shoto of ["auto", "0", "1", "2", "3"]) {
      for (const clock of ["auto", "on", "off"]) {
        for (const roll of [0, 0.499, 0.5, 0.999]) {
          const effect = selectGameEffects(role,{warning,shoto,clock},()=>roll);
          assert(rules[effect.warning][effect.shoto].includes(role));
          if (role === "cherry") assert.equal(effect.warning,"on");
          if (role === "replay") assert.equal(effect.warning,"off");
          if (effect.clock) {
            assert(["replay","cherry"].includes(role));
            assert.equal(effect.shoto,3);
            assert.equal(selectReelFlash(role,"auto",effect.shoto,true,()=>roll),"trace");
          }
          if (clock === "auto" || clock === "off") assert.equal(effect.clock,false);
          if (clock === "on" && ["replay","cherry"].includes(role)) assert(effect.clock);
        }
      }
    }
  }
}
for (let level = 0; level < 4; level += 1) {
  assert.equal(selectReelFlash("none","auto",level,false,()=>0),level===3?"idle":"none");
  assert.equal(selectReelFlash("replay","auto",level,false,()=>0.999),"pendulum");
  for (const role of ["bell","cherry","gear"]) {
    const counts = new Map();
    for (let roll = 0; roll < 1000; roll += 1) {
      const flash = selectReelFlash(role,"auto",level,false,()=>roll/1000);
      counts.set(flash,(counts.get(flash)||0)+1);
    }
    assert.equal(counts.get("none"),500);
    const selected = role === "gear" ? (level===3?"idle":"mesh") : "tick";
    assert.equal(counts.get(selected),500);
  }
}
assert.equal(selectGameEffects("none",{warning:"on",shoto:"0"},()=>0).adjusted,true);
assert.equal(selectReelFlash("none","v",3,false),"none");
console.log("PASS: all effect-rule combinations, replay/cherry exclusions, exact 50% boundaries, CLOCK eligibility, 3-shoto miss 100%");
