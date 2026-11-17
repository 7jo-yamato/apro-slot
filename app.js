"use strict";

const SYMBOL_LABELS = {
  seven: "赤7",
  clock: "紫時計",
  bar: "BAR",
  cherry: "チェリー",
  gear: "歯車",
  replay: "リプレイ",
  bell: "ベル",
  blank: "ブランク",
};

// 新花火のリール配列を、APRO SLOTの対応図柄へ置換したもの。
// 配列の先頭がリール配列表の1番（下端）、末尾が21番（上端）。
const REEL_LAYOUTS = [
  ["replay", "gear", "bell", "clock", "cherry", "replay", "bell", "clock", "clock", "clock", "replay", "gear", "bell", "bar", "cherry", "replay", "bell", "seven", "gear", "replay", "blank"],
  ["replay", "cherry", "gear", "cherry", "bell", "replay", "clock", "blank", "bell", "replay", "cherry", "bar", "bell", "replay", "seven", "gear", "cherry", "bell", "replay", "bell", "cherry"],
  ["replay", "gear", "bell", "clock", "replay", "bar", "bell", "cherry", "replay", "bell", "gear", "seven", "cherry", "replay", "bell", "gear", "blank", "replay", "bar", "bell", "cherry"],
];

// 0〜65535の抽選値に対する暫定フラグテーブル。
// 確率設計前の仮値であり、正式な役確率ではない。
const LOTTERY_TABLE = [
  { upper: 280, flag: "big-seven" },
  { upper: 540, flag: "big-clock" },
  { upper: 780, flag: "regular" },
  { upper: 2580, flag: "cherry" },
  { upper: 3480, flag: "gear" },
  { upper: 11080, flag: "bell" },
  { upper: 20060, flag: "replay" },
  { upper: 65536, flag: "none" },
];

const MAX_SLIP = 4;
const REEL_RPM = 70; //リール回転速度関連，ここいじれば回転速度を早めたり遅めたりできる
const SYMBOL_INTERVAL_MS = 60000 / REEL_RPM / 21;
// 暫定の3枚掛け5ライン。各数値は中央段から見た配列上のオフセット。
const PAYLINES = [[1, 1, 1], [0, 0, 0], [-1, -1, -1], [1, 0, -1], [-1, 0, 1]];
const SMALL_ROLES = ["bell", "replay", "gear", "cherry"];

function symbolPosition(reel, center, offset) {
  const length = REEL_LAYOUTS[reel].length;
  return (center + offset + length) % length;
}

function matchesRole(role, reel, center, offset) {
  const position = symbolPosition(reel, center, offset);
  const symbol = REEL_LAYOUTS[reel][position];
  if (role === "bell" && reel === 0 && position === 9) return true;
  if (role === "gear" && reel === 2 && symbol === "bar") return true;
  return symbol === role;
}

function winningRoles(positions) {
  const roles = ["bell", "replay", "gear", "seven", "clock", "bar"].filter((role) =>
    PAYLINES.some((line) => line.every((offset, reel) => matchesRole(role, reel, positions[reel], offset))),
  );
  if ([1, 0, -1].some((offset) => matchesRole("cherry", 0, positions[0], offset))) roles.push("cherry");
  return roles;
}

// 合法な最終出目を先に列挙し、先に止まったリールと矛盾する候補を除く。
const STOP_OUTCOMES = new Map();
function stopOutcomes(flag) {
  const role = SMALL_ROLES.includes(flag) ? flag : "none";
  if (STOP_OUTCOMES.has(role)) return STOP_OUTCOMES.get(role);
  const outcomes = [];
  for (let left = 0; left < 21; left += 1) {
    for (let middle = 0; middle < 21; middle += 1) {
      for (let right = 0; right < 21; right += 1) {
        const positions = [left, middle, right];
        const wins = winningRoles(positions);
        if (wins.every((win) => win === role)) outcomes.push({ positions, win: wins.includes(role) });
      }
    }
  }
  STOP_OUTCOMES.set(role, outcomes);
  return outcomes;
}

function missesGearAtLeft(pressedPosition) {
  return [-1, 0, 1, 2].some((offset) => [7, 8, 9].includes(symbolPosition(0, pressedPosition, offset)));
}

const SAFE_COMPLETIONS = new Map();
function canFinishStops(flag, positions, gearMiss) {
  const key = `${flag}:${positions.join(",")}:${gearMiss}`;
  if (SAFE_COMPLETIONS.has(key)) return SAFE_COMPLETIONS.get(key);
  const outcomes = stopOutcomes(flag).filter((outcome) =>
    positions.every((position, reel) => position === null || outcome.positions[reel] === position)
    && (!gearMiss || !outcome.win),
  );
  const remaining = [0, 1, 2].filter((reel) => positions[reel] === null);
  let safe = outcomes.length > 0;
  for (const reel of remaining) {
    for (let press = 0; press < 21 && safe; press += 1) {
      const nextMiss = gearMiss || (flag === "gear" && reel === 0 && missesGearAtLeft(press));
      safe = Array.from({ length: MAX_SLIP + 1 }, (_, slip) => (press + slip) % 21).some((position) => {
        if (!outcomes.some((outcome) => outcome.positions[reel] === position)) return false;
        const next = positions.slice();
        next[reel] = position;
        return canFinishStops(flag, next, nextMiss);
      });
    }
  }
  SAFE_COMPLETIONS.set(key, safe);
  return safe;
}

const FIRST_STOPS = new Map();
const PREPARED_FLAGS = new Set();
function prepareStopControl(flag) {
  if (PREPARED_FLAGS.has(flag)) return;
  for (let reel = 0; reel < 3; reel += 1) {
    for (let press = 0; press < 21; press += 1) {
      const gearMiss = flag === "gear" && reel === 0 && missesGearAtLeft(press);
      selectStopPosition(flag, reel, press, [false, false, false], [0, 0, 0], gearMiss);
    }
  }
  PREPARED_FLAGS.add(flag);
}

function selectStopPosition(flag, reel, pressedPosition, stopped, positions, gearMiss) {
  const firstStop = stopped.every((value) => !value);
  const firstKey = `${flag}:${reel}:${pressedPosition}:${gearMiss}`;
  if (firstStop && FIRST_STOPS.has(firstKey)) return FIRST_STOPS.get(firstKey);
  const outcomes = stopOutcomes(flag).filter((outcome) =>
    stopped.every((isStopped, index) => !isStopped || outcome.positions[index] === positions[index]),
  );
  const futureReels = [0, 1, 2].filter((index) => index !== reel && !stopped[index]);
  let best = null;
  for (let slip = 0; slip <= MAX_SLIP; slip += 1) {
    const position = (pressedPosition + slip) % 21;
    const candidates = outcomes.filter((outcome) => outcome.positions[reel] === position && (!gearMiss || !outcome.win));
    if (candidates.length === 0) continue;
    const fixed = positions.map((value, index) => stopped[index] || index === reel ? (index === reel ? position : value) : null);
    if (!canFinishStops(flag, fixed, gearMiss)) continue;
    // 残りリールの押下位置をできるだけ広くカバーする候補を優先する。
    const coverage = new Set();
    for (const candidate of candidates) {
      if (!candidate.win) continue;
      let keys = [""];
      for (const future of futureReels) {
        keys = keys.flatMap((key) => Array.from({ length: MAX_SLIP + 1 }, (_, step) =>
          `${key},${(candidate.positions[future] - step + 21) % 21}`,
        ));
      }
      keys.forEach((key) => coverage.add(key));
    }
    const score = coverage.size;
    if (best === null || score > best.score) best = { position, slip, score };
  }
  if (best === null) throw new Error("4コマ以内に合法な停止位置がありません");
  if (firstStop) FIRST_STOPS.set(firstKey, best);
  return best;
}

const reels = [...document.querySelectorAll(".reel")];
const stopButtons = [...document.querySelectorAll(".stop-button")];
const lever = document.querySelector("#lever");
const maxBet = document.querySelector("#maxBet");
const cabinet = document.querySelector(".cabinet");
const resultStatus = document.querySelector("#gameResult");
const forcedRole = document.querySelector("#forcedRole");
const slipReadouts = [0, 1, 2].map((reel) => document.querySelector(`#slip${reel}`));
const reelStrips = reels.map((reel, reelIndex) => {
  const strip = document.createElement("div");
  strip.className = "reel-strip";
  // 周回の継ぎ目と上下のはみ出し用に4コマを追加する。
  for (let row = 0; row < 25; row += 1) {
    const symbol = REEL_LAYOUTS[reelIndex][(22 - row + 21) % 21];
    const cell = document.createElement("span");
    cell.className = "reel-symbol";
    const image = document.createElement("img");
    image.className = "symbol-image";
    const filename = symbol === "blank" ? "symbol-blank-light-outline.png" : `symbol-${symbol}.png`;
    image.src = `./web/public/symbols/${filename}`;
    image.alt = SYMBOL_LABELS[symbol];
    image.draggable = false;
    cell.append(image);
    strip.append(cell);
  }
  reel.replaceChildren(strip);
  return strip;
});

const game = {
  phase: "idle",
  number: 0,
  flag: "none",
  lotteryValue: 0,
  stopPositions: [0, 0, 0],
  stopped: [true, true, true],
  spinTimers: [null, null, null],
  // 各値は現在中央段にあるコマ位置（0 = 配列表の1番）。
  cursors: [0, 0, 0],
  gearMiss: false,
  result: "none",
  slips: [null, null, null],
  motion: [null, null, null],
};

function random16Bit() {
  const value = new Uint16Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

function drawFlag(lotteryValue) {
  return LOTTERY_TABLE.find((entry) => lotteryValue < entry.upper).flag;
}

function selectPresentation() {
  return { spinInterval: SYMBOL_INTERVAL_MS, name: "standard" };
}

function drawReel(reelIndex, position) {
  const phase = ((position % 21) + 21) % 21;
  reelStrips[reelIndex].style.transform = `translate3d(0, ${-(21 - phase) * 100 / 25}%, 0)`;
}

function setStopEnabled(reelIndex, enabled) {
  const button = stopButtons[reelIndex];
  button.disabled = !enabled;
  button.classList.toggle("is-lit", enabled);
  button.classList.toggle("is-off", !enabled);
  button.setAttribute("aria-pressed", enabled ? "false" : "true");
}

function startReelAnimation(reelIndex, interval) {
  reels[reelIndex].classList.add("is-spinning");
  setStopEnabled(reelIndex, true);
  game.motion[reelIndex] = { start: game.cursors[reelIndex], shown: game.cursors[reelIndex], time: performance.now(), interval, target: null, duration: 0 };
  game.spinTimers[reelIndex] = window.requestAnimationFrame((time) => animateReel(reelIndex, time));
}

function reelPositionAt(reelIndex, time) {
  const motion = game.motion[reelIndex];
  if (motion.target !== null) {
    const progress = motion.duration === 0 ? 1 : Math.min(1, Math.max(0, time - motion.time) / motion.duration);
    // 開始時は通常回転と同じ速度、終了時は速度0。逆方向へは動かさない。
    const eased = progress + progress * progress - progress * progress * progress;
    return motion.start + (motion.target - motion.start) * eased;
  }
  return motion.start + Math.max(0, time - motion.time) / motion.interval;
}

function animateReel(reelIndex, time) {
  const motion = game.motion[reelIndex];
  const position = reelPositionAt(reelIndex, time);
  if (motion.target !== null && position >= motion.target) {
    finishReelStop(reelIndex);
    return;
  }
  game.cursors[reelIndex] = Math.floor(position) % 21;
  motion.shown = position;
  drawReel(reelIndex, position);
  game.spinTimers[reelIndex] = window.requestAnimationFrame((nextTime) => animateReel(reelIndex, nextTime));
}

function startGame() {
  if (game.phase !== "ready") return;

  game.phase = "spinning";
  game.number += 1;
  game.lotteryValue = random16Bit();
  game.flag = drawFlag(game.lotteryValue);
  // デバッグ指定は次の1ゲームで消費する。成立後の停止制御は通常と共通。
  if (SMALL_ROLES.includes(forcedRole.value) || forcedRole.value === "none") {
    game.flag = forcedRole.value;
  }
  forcedRole.value = "random";
  // 初回の列挙・探索を回転中の停止入力から切り離す。
  prepareStopControl(game.flag);
  game.stopped = [false, false, false];
  game.gearMiss = false;
  game.result = "none";
  game.slips = [null, null, null];
  slipReadouts.forEach((readout) => { readout.textContent = "—"; });
  resultStatus.textContent = "回転中";

  const presentation = selectPresentation(game.flag);
  cabinet.dataset.presentation = presentation.name;
  updateBetControls();
  reels.forEach((_, reelIndex) => startReelAnimation(reelIndex, presentation.spinInterval));
}

function stopReel(reelIndex) {
  if (game.phase !== "spinning" || game.stopped[reelIndex]) return;

  const position = game.motion[reelIndex].shown;
  // 中央へ到達しつつある図柄を押下コマとし、残りの端数も前向きに送る。
  const pressedStep = Math.ceil(position);
  const pressedPosition = pressedStep % 21;
  // 3連時計のいずれかを枠内・枠上へ狙った場合の歯車取りこぼし。
  if (game.flag === "gear" && reelIndex === 0) {
    game.gearMiss = missesGearAtLeft(pressedPosition);
  }
  const stop = selectStopPosition(game.flag, reelIndex, pressedPosition, game.stopped, game.stopPositions, game.gearMiss);
  // 計算でフレームが止まった時間を回転の移動量へ加えない。
  const now = performance.now();
  game.motion.forEach((motion, index) => {
    if (index !== reelIndex && !game.stopped[index]) {
      motion.start = motion.shown;
      motion.time = now;
    }
  });
  game.stopped[reelIndex] = true;
  game.stopPositions[reelIndex] = stop.position;
  game.slips[reelIndex] = stop.slip;
  setStopEnabled(reelIndex, false);
  const motion = game.motion[reelIndex];
  motion.start = position;
  motion.time = now;
  motion.target = pressedStep + stop.slip;
  motion.duration = (motion.target - position) * motion.interval;
  if (game.motion[reelIndex].target === position) {
    finishReelStop(reelIndex);
  }
}

function finishReelStop(reelIndex) {
  window.cancelAnimationFrame(game.spinTimers[reelIndex]);
  game.spinTimers[reelIndex] = null;
  reels[reelIndex].classList.remove("is-spinning");
  game.cursors[reelIndex] = game.stopPositions[reelIndex];
  game.motion[reelIndex].shown = game.stopPositions[reelIndex];
  drawReel(reelIndex, game.cursors[reelIndex]);
  slipReadouts[reelIndex].textContent = `${game.slips[reelIndex]}コマ`;
  if (game.stopped.every(Boolean) && game.spinTimers.every((timer) => timer === null)) {
    const wins = winningRoles(game.stopPositions);
    game.result = wins.find((role) => SMALL_ROLES.includes(role)) ?? "none";
    cabinet.dataset.result = game.result;
    resultStatus.textContent = game.result === "none" ? "入賞なし" : `${SYMBOL_LABELS[game.result]}入賞`;
    game.phase = game.result === "replay" ? "ready" : "idle";
    updateBetControls();
  }
}

function updateBetControls() {
  lever.disabled = game.phase !== "ready";
  maxBet.disabled = game.phase !== "idle";
  forcedRole.disabled = game.phase === "spinning";
}

maxBet.addEventListener("click", () => {
  if (game.phase !== "idle") return;
  game.phase = "ready";
  updateBetControls();
});
lever.addEventListener("click", startGame);
updateBetControls();
stopButtons.forEach((button, reelIndex) => {
  button.addEventListener("pointerdown", (event) => {
    if (event.button === 0) stopReel(reelIndex);
  });
  // キーボード操作によるボタンの起動にも対応する。
  button.addEventListener("click", (event) => {
    if (event.detail === 0) stopReel(reelIndex);
  });
});
reels.forEach((_, reelIndex) => drawReel(reelIndex, game.cursors[reelIndex]));

function setBonusActive(isActive) {
  cabinet.classList.toggle("is-bonus", isActive);
  cabinet.dataset.bonusState = isActive ? "active" : "off";
}

window.setBonusActive = setBonusActive;

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "b" || event.repeat) return;
  setBonusActive(!cabinet.classList.contains("is-bonus"));
});
