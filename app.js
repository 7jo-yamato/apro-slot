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
const ROLE_LAMP_DURATION_MS = 300; // 小役入賞時の点灯時間（ミリ秒）
const REEL_RPM = 70; //リール回転速度関連，ここいじれば回転速度を早めたり遅めたりできる
const SYMBOL_INTERVAL_MS = 60000 / REEL_RPM / 21;
// 3枚掛けは5ライン、1枚掛けは中段のみ。数値は中央段からの配列オフセット。
const PAYLINES = [[1, 1, 1], [0, 0, 0], [-1, -1, -1], [1, 0, -1], [-1, 0, 1]];
const SMALL_ROLES = ["bell", "replay", "gear", "cherry"];
const PAYOUTS = { 1: { bell: 5, cherry: 2 }, 3: { bell: 8, gear: 15, cherry: 2 } };
// 各行が0〜3消灯の対応役。選択重みは未確定なので候補を均等に選ぶ。
const EFFECT_ROLES = {
  off: [["none","bell","gear"], ["bell","replay"], ["none","replay","gear"], ["none","replay","gear"]],
  on: [["bell","cherry","gear"], ["none","bell","cherry"], ["none","cherry","gear"], ["none","cherry","gear"]],
};
const CLOCK_CHALLENGE_RATE = null; // 発生率未確定。数値0〜1を決定後に設定する。

function selectGameEffects(flag, options = {}, random = Math.random) {
  const role = SMALL_ROLES.includes(flag) ? flag : "none";
  const candidates = [];
  for (const warning of ["off", "on"]) {
    EFFECT_ROLES[warning].forEach((roles, shoto) => {
      if (roles.includes(role)) candidates.push({ warning, shoto });
    });
  }
  const clockEligible = role === "replay" || role === "cherry";
  const forcedClock = options.clock === "on" && clockEligible;
  const base = forcedClock ? candidates.filter((candidate) => candidate.shoto === 3) : candidates;
  const specified = base.filter((candidate) =>
    (!options.warning || options.warning === "auto" || options.warning === candidate.warning)
    && (!options.shoto || options.shoto === "auto" || Number(options.shoto) === candidate.shoto));
  const pool = specified.length ? specified : base;
  const picked = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  const automaticClock = clockEligible && picked.shoto === 3 && options.clock !== "off"
    && CLOCK_CHALLENGE_RATE !== null && random() < CLOCK_CHALLENGE_RATE;
  return { ...picked, clock: forcedClock || automaticClock, adjusted: specified.length === 0 };
}

function selectReelFlash(flag, choice, shoto = 0, clock = false, random = Math.random) {
  if (clock) return "trace";
  // ボーナス用演出は内部状態との接続までプレビュー専用。
  if (choice === "v" || choice === "trace") return "none";
  if (choice !== "auto") return choice;
  if (flag === "none") return shoto === 3 ? "idle" : "none";
  if (flag === "replay") return "pendulum";
  if (flag === "bell" || flag === "cherry") return random() < 0.5 ? "tick" : "none";
  if (flag === "gear") return random() < 0.5 ? (shoto === 3 ? "idle" : "mesh") : "none";
  return "none";
}

function payoutFor(role, bet) {
  return PAYOUTS[bet][role] ?? 0;
}

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

function winningRoles(positions, bet = 3) {
  const lines = bet === 1 ? [[0, 0, 0]] : PAYLINES;
  const roles = ["bell", "replay", "gear", "seven", "clock", "bar"].filter((role) =>
    lines.some((line) => line.every((offset, reel) => matchesRole(role, reel, positions[reel], offset))),
  );
  const cherryRows = bet === 1 ? [0] : [1, 0, -1];
  if (cherryRows.some((offset) => matchesRole("cherry", 0, positions[0], offset))) roles.push("cherry");
  return roles;
}

// 合法な最終出目を先に列挙し、先に止まったリールと矛盾する候補を除く。
const STOP_OUTCOMES = new Map();
function stopOutcomes(flag, bet = 3) {
  const role = SMALL_ROLES.includes(flag) ? flag : "none";
  const key = `${bet}:${role}`;
  if (STOP_OUTCOMES.has(key)) return STOP_OUTCOMES.get(key);
  const outcomes = [];
  for (let left = 0; left < 21; left += 1) {
    for (let middle = 0; middle < 21; middle += 1) {
      for (let right = 0; right < 21; right += 1) {
        const positions = [left, middle, right];
        const wins = winningRoles(positions, bet);
        if (wins.every((win) => win === role)) outcomes.push({ positions, win: wins.includes(role) });
      }
    }
  }
  STOP_OUTCOMES.set(key, outcomes);
  return outcomes;
}

function missesGearAtLeft(pressedPosition) {
  return [-1, 0, 1, 2].some((offset) => [7, 8, 9].includes(symbolPosition(0, pressedPosition, offset)));
}

const SAFE_COMPLETIONS = new Map();
function canFinishStops(flag, positions, gearMiss, bet = 3) {
  const key = `${bet}:${flag}:${positions.join(",")}:${gearMiss}`;
  if (SAFE_COMPLETIONS.has(key)) return SAFE_COMPLETIONS.get(key);
  const outcomes = stopOutcomes(flag, bet).filter((outcome) =>
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
        return canFinishStops(flag, next, nextMiss, bet);
      });
    }
  }
  SAFE_COMPLETIONS.set(key, safe);
  return safe;
}

const FIRST_STOPS = new Map();
const PREPARED_FLAGS = new Set();
function prepareStopControl(flag, bet = 3) {
  const key = `${bet}:${flag}`;
  if (PREPARED_FLAGS.has(key)) return;
  for (let reel = 0; reel < 3; reel += 1) {
    for (let press = 0; press < 21; press += 1) {
      const gearMiss = flag === "gear" && reel === 0 && missesGearAtLeft(press);
      selectStopPosition(flag, reel, press, [false, false, false], [0, 0, 0], gearMiss, bet);
    }
  }
  PREPARED_FLAGS.add(key);
}

function selectStopPosition(flag, reel, pressedPosition, stopped, positions, gearMiss, bet = 3) {
  const firstStop = stopped.every((value) => !value);
  const firstKey = `${bet}:${flag}:${reel}:${pressedPosition}:${gearMiss}`;
  if (firstStop && FIRST_STOPS.has(firstKey)) return FIRST_STOPS.get(firstKey);
  const outcomes = stopOutcomes(flag, bet).filter((outcome) =>
    stopped.every((isStopped, index) => !isStopped || outcome.positions[index] === positions[index]),
  );
  const futureReels = [0, 1, 2].filter((index) => index !== reel && !stopped[index]);
  let best = null;
  for (let slip = 0; slip <= MAX_SLIP; slip += 1) {
    const position = (pressedPosition + slip) % 21;
    const candidates = outcomes.filter((outcome) => outcome.positions[reel] === position && (!gearMiss || !outcome.win));
    if (candidates.length === 0) continue;
    const fixed = positions.map((value, index) => stopped[index] || index === reel ? (index === reel ? position : value) : null);
    if (!canFinishStops(flag, fixed, gearMiss, bet)) continue;
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
const oneBet = document.querySelector("#oneBet");
const cabinet = document.querySelector(".cabinet");
const resultStatus = document.querySelector("#gameResult");
const forcedRole = document.querySelector("#forcedRole");
const slipReadouts = [0, 1, 2].map((reel) => document.querySelector(`#slip${reel}`));
const medalReadouts = Object.fromEntries(["betCount", "totalIn", "totalOut", "netMedals", "lastPayout"].map((id) => [id, document.querySelector(`#${id}`)]));
const gearOption = document.querySelector('#forcedRole option[value="gear"]');
const shotoSelect = document.querySelector("#shotoLevel");
const shotoLamps = [...document.querySelectorAll(".reel-shoto__lamp")];
const flashSelect = document.querySelector("#reelFlash");
const flashPreview = document.querySelector("#flashPreview");
const flashStatus = document.querySelector("#flashStatus");
const warningSelect = document.querySelector("#warningSound");
const soundEnabled = document.querySelector("#soundEnabled");
const clockSelect = document.querySelector("#clockChallenge");
const effectStatus = document.querySelector("#effectStatus");
const clockPanel = document.querySelector("#clockPanel");
let warningAudio = null;

function playWarningSound() {
  if (!soundEnabled.checked) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    warningAudio ??= new AudioContext();
    const beep = () => {
      const tone = warningAudio.createOscillator();
      const gain = warningAudio.createGain();
      const now = warningAudio.currentTime;
      tone.type = "sine";
      tone.frequency.setValueAtTime(880, now);
      tone.frequency.setValueAtTime(660, now + 0.08);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      tone.connect(gain);
      gain.connect(warningAudio.destination);
      tone.start(now);
      tone.stop(now + 0.18);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    };
    if (warningAudio.state === "suspended") warningAudio.resume().then(beep).catch(() => {});
    else beep();
  } catch (error) {
    console.warn("予告音を再生できませんでした", error);
  }
}
let roleLampTimer = null;

function setRoleLamp(role) {
  window.clearTimeout(roleLampTimer);
  roleLampTimer = null;
  cabinet.dataset.lampRole = role;
  if (!SMALL_ROLES.includes(role)) return;
  roleLampTimer = window.setTimeout(() => {
    cabinet.dataset.lampRole = "none";
    roleLampTimer = null;
  }, ROLE_LAMP_DURATION_MS);
}
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

// 区画番号は上段0・1・2、中段3・4・5、下段6・7・8。
const FLASH_PATTERNS = {
  tick: { name: "秒刻み", stepMs: 100, frames: [[0,3,6], [1,4,7], [2,5,8], []] },
  pendulum: { name: "振り子", stepMs: 100, frames: [[0,3,6], [1,4,7], [2,5,8], [1,4,7], [0,3,6], []] },
  mesh: { name: "噛み合い", stepMs: 120, frames: [[0,3,6,2,5,8], [3,4,5], [1,4,7], [4], []] },
  idle: { name: "空回り", stepMs: 90, frames: [[0], [1], [2], [5], [8], []] },
  trace: { name: "針の軌跡", stepMs: 100, frames: [[1], [2], [5], [8], [7], [6], [3], [0], [1], []] },
  v: { name: "Vフラッシュ", stepMs: 120, frames: [[0,2], [3,5], [7], [0,2,3,5,7], [0,2,3,5,7], [0,2,3,5,7], []] },
};
const flashCells = Array(9);
reels.forEach((reel, reelIndex) => {
  const overlay = document.createElement("div");
  overlay.className = "reel-flash-overlay";
  overlay.setAttribute("aria-hidden", "true");
  for (let row = 0; row < 3; row += 1) {
    const cell = document.createElement("span");
    cell.className = "reel-flash-cell";
    flashCells[row * 3 + reelIndex] = cell;
    overlay.append(cell);
  }
  reel.append(overlay);
});
let flashTimers = [];

function clearReelFlash() {
  flashTimers.forEach((timer) => window.clearTimeout(timer));
  flashTimers = [];
  flashCells.forEach((cell) => cell.classList.remove("is-lit"));
  reels.forEach((reel) => reel.classList.remove("is-flashing"));
  flashStatus.textContent = "フラッシュなし";
}

function playReelFlash(name) {
  clearReelFlash();
  const pattern = FLASH_PATTERNS[name];
  if (!pattern) return;
  flashStatus.textContent = pattern.name;
  reels.forEach((reel) => reel.classList.add("is-flashing"));
  pattern.frames.forEach((frame, index) => {
    const show = () => flashCells.forEach((cell, position) => cell.classList.toggle("is-lit", frame.includes(position)));
    if (index === 0) show();
    else flashTimers.push(window.setTimeout(show, index * pattern.stepMs));
  });
  flashTimers.push(window.setTimeout(clearReelFlash, pattern.frames.length * pattern.stepMs));
}

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
  bet: 0,
  replay: false,
  totalIn: 0,
  totalOut: 0,
  lastPayout: 0,
  shotoTarget: 0,
  shotoShown: 0,
  flashChoice: "auto",
  effects: null,
  plannedFlash: "none",
};

function random16Bit() {
  const value = new Uint16Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

function drawFlag(lotteryValue, bet = 3) {
  const flag = LOTTERY_TABLE.find((entry) => lotteryValue < entry.upper).flag;
  // 1枚掛けの歯車抽選区間は暫定的にハズレへ割り当てる。
  return bet === 1 && flag === "gear" ? "none" : flag;
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
  game.flag = drawFlag(game.lotteryValue, game.bet);
  // デバッグ指定は次の1ゲームで消費する。成立後の停止制御は通常と共通。
  if (SMALL_ROLES.includes(forcedRole.value) || forcedRole.value === "none") {
    game.flag = game.bet === 1 && forcedRole.value === "gear" ? "none" : forcedRole.value;
  }
  forcedRole.value = "random";
  // 初回の列挙・探索を回転中の停止入力から切り離す。
  prepareStopControl(game.flag, game.bet);
  game.replay = false;
  game.lastPayout = 0;
  updateMedalDisplay();
  game.stopped = [false, false, false];
  game.gearMiss = false;
  game.result = "none";
  clearReelFlash();
  game.flashChoice = flashSelect.value;
  flashSelect.value = "auto";
  setRoleLamp("none");
  clockPanel.hidden = true;
  game.effects = selectGameEffects(game.flag, { warning: warningSelect.value, shoto: shotoSelect.value, clock: clockSelect.value });
  game.shotoTarget = game.effects.shoto;
  game.plannedFlash = selectReelFlash(game.flag, game.flashChoice, game.shotoTarget, game.effects.clock);
  effectStatus.textContent = `予告音${game.effects.warning === "on" ? "あり" : "なし"}・${game.shotoTarget}消灯${game.effects.adjusted ? "（指定を法則に合わせて調整）" : ""}`;
  warningSelect.value = "auto";
  shotoSelect.value = "auto";
  clockSelect.value = "auto";
  game.shotoShown = 0;
  shotoLamps.forEach((lamp) => lamp.classList.remove("is-shoto"));
  game.slips = [null, null, null];
  slipReadouts.forEach((readout) => { readout.textContent = "—"; });
  resultStatus.textContent = "回転中";

  const presentation = selectPresentation(game.flag);
  cabinet.dataset.presentation = presentation.name;
  updateBetControls();
  if (game.effects.warning === "on") playWarningSound();
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
  const stop = selectStopPosition(game.flag, reelIndex, pressedPosition, game.stopped, game.stopPositions, game.gearMiss, game.bet);
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
  // 止めたリールから消灯する（目標消灯数に達するまで）。
  if (game.shotoShown < game.shotoTarget) {
    shotoLamps[reelIndex]?.classList.add("is-shoto");
    game.shotoShown += 1;
  }
  if (game.stopped.every(Boolean) && game.spinTimers.every((timer) => timer === null)) {
    const wins = winningRoles(game.stopPositions, game.bet);
    game.result = wins.find((role) => SMALL_ROLES.includes(role)) ?? "none";
    cabinet.dataset.result = game.result;
    setRoleLamp(game.result);
    playReelFlash(game.plannedFlash);
    clockPanel.hidden = !game.effects.clock;
    game.lastPayout = payoutFor(game.result, game.bet);
    game.totalOut += game.lastPayout;
    game.replay = game.result === "replay";
    resultStatus.textContent = game.result === "none" ? "入賞なし" : `${SYMBOL_LABELS[game.result]}入賞${game.lastPayout ? `・${game.lastPayout}枚` : ""}`;
    game.phase = game.replay ? "ready" : "idle";
    updateMedalDisplay();
    updateBetControls();
  }
}

function updateBetControls() {
  lever.disabled = game.phase !== "ready";
  maxBet.disabled = game.phase === "spinning" || game.replay || (game.phase === "ready" && game.bet === 3);
  oneBet.disabled = game.phase !== "idle";
  forcedRole.disabled = game.phase === "spinning";
  flashSelect.disabled = game.phase === "spinning";
  flashPreview.disabled = game.phase === "spinning";
  warningSelect.disabled = game.phase === "spinning";
  shotoSelect.disabled = game.phase === "spinning";
  clockSelect.disabled = game.phase === "spinning";
  gearOption.disabled = game.bet === 1;
}

function updateMedalDisplay() {
  medalReadouts.betCount.textContent = `${game.bet}枚${game.replay ? "（再遊技）" : ""}`;
  medalReadouts.totalIn.textContent = `${game.totalIn}枚`;
  medalReadouts.totalOut.textContent = `${game.totalOut}枚`;
  const net = game.totalOut - game.totalIn;
  medalReadouts.netMedals.textContent = `${net > 0 ? "+" : ""}${net}枚`;
  medalReadouts.lastPayout.textContent = `${game.lastPayout}枚`;
}

function placeBet(bet) {
  if (game.phase === "spinning" || game.replay) return;
  const paidBet = game.phase === "ready" ? game.bet : 0;
  if (bet <= paidBet) return;
  game.totalIn += bet - paidBet;
  game.bet = bet;
  game.phase = "ready";
  if (bet === 1 && forcedRole.value === "gear") forcedRole.value = "random";
  updateMedalDisplay();
  updateBetControls();
}

maxBet.addEventListener("click", () => placeBet(3));
oneBet.addEventListener("click", () => placeBet(1));
flashPreview.addEventListener("click", () => {
  if (game.phase === "spinning") return;
  playReelFlash(flashSelect.value === "auto" ? "tick" : flashSelect.value);
});
lever.addEventListener("click", startGame);
updateBetControls();
updateMedalDisplay();
setRoleLamp("none");
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
