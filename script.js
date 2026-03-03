const arena = document.getElementById("arena");
const promptEl = document.getElementById("prompt");
const helperText = document.getElementById("helperText");
const levelLabel = document.getElementById("levelLabel");
const timerLabel = document.getElementById("timerLabel");
const difficultyLabel = document.getElementById("difficultyLabel");
const seedLabel = document.getElementById("seedLabel");
const runProgressFill = document.getElementById("runProgressFill");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const muteBtn = document.getElementById("muteBtn");
const scareBtn = document.getElementById("scareBtn");
const loadingScreen = document.getElementById("loadingScreen");
const loadingFill = document.getElementById("loadingFill");
const loadingText = document.getElementById("loadingText");
const scareLayer = document.getElementById("scareLayer");
const scareFrame = document.getElementById("scareFrame");
const scareCaption = document.getElementById("scareCaption");
const shell = document.querySelector(".shell");

const LEVELS = [
  lvl1,
  lvl2,
  lvl3,
  lvl4,
  lvl5,
  lvl6,
  lvl7,
  lvl8,
  lvl9,
  lvl10,
  lvl11,
  lvl12,
  lvl13,
  lvl14,
  lvl15,
  lvl16,
  lvl17,
  lvl18,
  lvl19,
  lvl20,
  lvl21,
  lvl22,
  lvl23,
  lvl24
];

const TOTAL_LEVELS = LEVELS.length;

let level = 0;
let locked = true;
let fail = false;
let levelTimeout = null;
let timerInterval = null;
let cleanups = [];
let stateTimeout = null;
let scareHideTimeout = null;
let currentDifficulty = 1;
let runSeed = 0;
let rng = Math.random;
let soundOn = true;
let scareOn = true;
let audioCtx = null;
let cachedNoiseBuffer = null;

const runStats = {
  clears: 0,
  deaths: 0,
  streak: 0
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand() {
  return rng();
}

function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function addCleanup(fn) {
  cleanups.push(fn);
}

function runCleanups() {
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore cleanup errors during transitions.
    }
  });
  cleanups = [];
}

function setPrompt(text, className = "") {
  promptEl.textContent = text;
  promptEl.className = className;
}

function setHelper(text) {
  helperText.textContent = text;
}

function note(text) {
  const p = document.createElement("p");
  p.className = "note";
  p.textContent = text;
  return p;
}

function statusLine(text) {
  const p = document.createElement("p");
  p.className = "status-line";
  p.textContent = text;
  return p;
}

function clearArena() {
  runCleanups();
  arena.innerHTML = "";
  arena.className = "arena";
}

function setShellState(kind) {
  shell.classList.remove("state-ok", "state-bad");
  if (!kind) return;
  shell.classList.add(kind === "ok" ? "state-ok" : "state-bad");
  if (stateTimeout) clearTimeout(stateTimeout);
  stateTimeout = setTimeout(() => shell.classList.remove("state-ok", "state-bad"), 420);
}

function computeDifficulty() {
  const levelFactor = 1 + Math.max(0, level - 1) * 0.035;
  const streakFactor = 1 + Math.min(0.3, runStats.streak * 0.02);
  const deathRelief = 1 - Math.min(0.24, runStats.deaths * 0.018);
  const raw = levelFactor * streakFactor * deathRelief;
  return Math.max(0.78, Math.min(1.9, Number(raw.toFixed(2))));
}

function scaledTime(baseSeconds) {
  return Math.max(0.55, Number((baseSeconds / currentDifficulty).toFixed(2)));
}

function scaledInterval(baseMs) {
  return Math.max(95, Math.round(baseMs / currentDifficulty));
}

function updateDifficultyLabel() {
  difficultyLabel.textContent = `Difficulty x${currentDifficulty.toFixed(2)}`;
}

function updateRunProgress() {
  const completed = Math.max(0, Math.min(TOTAL_LEVELS, level - 1));
  runProgressFill.style.width = `${(completed / TOTAL_LEVELS) * 100}%`;
}

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  if (!cachedNoiseBuffer) {
    const duration = 2;
    const size = Math.floor(audioCtx.sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    cachedNoiseBuffer = buffer;
  }
}

function playTone(freq, duration = 0.1, type = "sine", gain = 0.03, sweepTo = null) {
  if (!soundOn) return;
  ensureAudio();

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freq), now);
  if (sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), now + duration);
  }

  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function playNoise(duration = 0.22, gain = 0.02, bandFreq = 900, highpassFreq = 80) {
  if (!soundOn) return;
  ensureAudio();

  const now = audioCtx.currentTime;
  const source = audioCtx.createBufferSource();
  source.buffer = cachedNoiseBuffer;

  const highpass = audioCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = highpassFreq;

  const band = audioCtx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = bandFreq;
  band.Q.value = 1.2;

  const amp = audioCtx.createGain();
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(highpass);
  highpass.connect(band);
  band.connect(amp);
  amp.connect(audioCtx.destination);

  source.start(now);
  source.stop(now + duration + 0.03);
}

function sfxPress() {
  playTone(560, 0.055, "triangle", 0.02);
}

function sfxLevelStart() {
  playTone(360, 0.07, "sine", 0.022);
  setTimeout(() => playTone(430, 0.08, "sine", 0.02), 55);
}

function sfxSuccess() {
  playTone(520, 0.08, "triangle", 0.04);
  setTimeout(() => playTone(700, 0.11, "triangle", 0.042), 70);
  setTimeout(() => playTone(910, 0.12, "triangle", 0.038), 135);
}

function sfxFail() {
  playTone(210, 0.18, "sawtooth", 0.06, 130);
  setTimeout(() => playNoise(0.24, 0.03, 500, 60), 55);
}

function sfxWarn() {
  playTone(950, 0.04, "square", 0.015);
}

function sfxJumpScare() {
  playTone(75, 0.6, "sawtooth", 0.08, 38);
  setTimeout(() => playTone(52, 0.48, "triangle", 0.07, 34), 70);
  setTimeout(() => playNoise(0.72, 0.08, 430, 40), 20);
}

function createScareFrameData() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#090b0f");
  bg.addColorStop(1, "#1b1f24");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 24000; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const v = 45 + Math.random() * 70;
    const a = Math.random() * 0.06;
    ctx.fillStyle = `rgba(${v}, ${v}, ${v + 8}, ${a})`;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.53);
  ctx.scale(1, 1.08);
  const head = ctx.createRadialGradient(0, -20, 42, 0, 0, 250);
  head.addColorStop(0, "rgba(220, 220, 228, 0.92)");
  head.addColorStop(0.45, "rgba(144, 148, 156, 0.93)");
  head.addColorStop(1, "rgba(24, 27, 32, 0.95)");
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.ellipse(0, 0, 170, 218, 0, 0, Math.PI * 2);
  ctx.fill();

  const eyeSocket = "rgba(8, 9, 12, 0.86)";
  ctx.fillStyle = eyeSocket;
  ctx.beginPath();
  ctx.ellipse(-62, -38, 42, 26, -0.07, 0, Math.PI * 2);
  ctx.ellipse(62, -38, 42, 26, 0.07, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(228, 232, 238, 0.95)";
  ctx.beginPath();
  ctx.ellipse(-62, -38, 17, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(62, -38, 17, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(11, 12, 15, 0.95)";
  ctx.beginPath();
  ctx.arc(-62, -38, 7, 0, Math.PI * 2);
  ctx.arc(62, -38, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(8, 8, 10, 0.92)";
  ctx.beginPath();
  ctx.moveTo(-65, 56);
  ctx.quadraticCurveTo(0, 82, 65, 56);
  ctx.quadraticCurveTo(0, 114, -65, 56);
  ctx.fill();

  ctx.strokeStyle = "rgba(70, 20, 20, 0.55)";
  ctx.lineWidth = 2.8;
  for (let i = 0; i < 18; i += 1) {
    const x = -120 + Math.random() * 240;
    const y = 20 + Math.random() * 175;
    const dx = -18 + Math.random() * 36;
    const dy = 18 + Math.random() * 35;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
  ctx.restore();

  const vig = ctx.createRadialGradient(
    canvas.width * 0.5,
    canvas.height * 0.53,
    canvas.width * 0.22,
    canvas.width * 0.5,
    canvas.height * 0.53,
    canvas.width * 0.62
  );
  vig.addColorStop(0, "rgba(0, 0, 0, 0)");
  vig.addColorStop(1, "rgba(0, 0, 0, 0.78)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.84);
}

function hideScareLayer(immediate = false) {
  scareLayer.classList.remove("show");
  if (scareHideTimeout) clearTimeout(scareHideTimeout);

  if (immediate) {
    scareLayer.hidden = true;
    return;
  }

  scareHideTimeout = setTimeout(() => {
    scareLayer.hidden = true;
  }, 220);
}

function triggerJumpScare({ message = "KEEP LOOKING", duration = 900 } = {}) {
  return new Promise((resolve) => {
    if (!scareOn || fail) {
      resolve();
      return;
    }

    const previousLock = locked;
    locked = true;

    scareCaption.textContent = message;
    scareFrame.style.backgroundImage = `url("${createScareFrameData()}")`;
    scareLayer.hidden = false;
    requestAnimationFrame(() => scareLayer.classList.add("show"));

    sfxJumpScare();

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      hideScareLayer();
      if (!fail) locked = previousLock;
      resolve();
    };

    const t = setTimeout(done, duration);
    addCleanup(() => {
      clearTimeout(t);
      hideScareLayer(true);
      resolve();
    });
  });
}

function stopTimers() {
  if (levelTimeout) clearTimeout(levelTimeout);
  if (timerInterval) clearInterval(timerInterval);
  levelTimeout = null;
  timerInterval = null;
  timerLabel.textContent = "Time: --";
  timerLabel.classList.remove("urgent");
}

function startCountdown(seconds, onExpire, onTick, opts = {}) {
  stopTimers();
  const warn = opts.warn !== false;
  const warningAt = opts.warningAt ?? 1.4;

  const totalMs = seconds * 1000;
  const deadline = Date.now() + totalMs;
  let lastWhole = Number.MAX_SAFE_INTEGER;

  const tick = () => {
    const leftMs = Math.max(0, deadline - Date.now());
    const left = leftMs / 1000;
    timerLabel.textContent = `Time: ${left.toFixed(1)}s`;

    if (warn && left <= warningAt) timerLabel.classList.add("urgent");
    else timerLabel.classList.remove("urgent");

    if (warn) {
      const whole = Math.ceil(left);
      if (whole !== lastWhole && whole > 0 && whole <= 3) {
        lastWhole = whole;
        sfxWarn();
      }
    }

    if (onTick) onTick(left, seconds);
  };

  tick();
  timerInterval = setInterval(tick, 80);
  levelTimeout = setTimeout(() => {
    stopTimers();
    onExpire();
  }, totalMs);
}

function lose(reason) {
  if (fail) return;
  fail = true;
  locked = true;
  runStats.deaths += 1;
  runStats.streak = 0;
  stopTimers();
  hideScareLayer(true);
  setShellState("bad");
  sfxFail();
  setPrompt(`Failed: ${reason}`, "fail");
  setHelper("Press Retry. Take a breath, then read the instruction one word at a time.");
  restartBtn.hidden = false;
}

function maybeInterLevelScare(next) {
  if (!scareOn || level < 8 || rand() >= 0.11) {
    next();
    return;
  }

  const lines = ["IT IS WATCHING", "DO NOT TRUST EASY BUTTONS", "STAY FOCUSED"];
  triggerJumpScare({ message: pick(lines), duration: 760 }).then(next);
}

function continueAfter(ms = 500) {
  if (fail) return;
  locked = true;
  runStats.clears += 1;
  runStats.streak += 1;
  setShellState("ok");
  sfxSuccess();

  maybeInterLevelScare(() => {
    const t = setTimeout(() => {
      if (!fail) nextLevel();
    }, ms);
    addCleanup(() => clearTimeout(t));
  });
}

function winRun() {
  stopTimers();
  locked = true;
  updateRunProgress();
  setShellState("ok");
  sfxSuccess();
  setPrompt("Run complete. You survived all 24 levels.", "win");
  setHelper("Use Retry for a new seed and new level variants.");
  restartBtn.hidden = false;
}

function safeButton(label, onClick, cls = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.className = `${cls} big`.trim();
  btn.addEventListener("click", () => {
    if (locked || fail) return;
    sfxPress();
    onClick();
  });
  return btn;
}

function trapButton(label, reason, cls = "") {
  return safeButton(label, () => lose(reason), cls);
}

function createDialButton(label, onPress, segments = 40) {
  const shellDial = document.createElement("div");
  shellDial.className = "dial-shell";
  shellDial.style.setProperty("--seg-count", String(segments));

  const ring = document.createElement("div");
  ring.className = "dial-ring";
  const segEls = [];

  for (let i = 0; i < segments; i += 1) {
    const seg = document.createElement("span");
    seg.className = "dial-seg active";
    seg.style.setProperty("--i", String(i));
    ring.appendChild(seg);
    segEls.push(seg);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dial-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    if (locked || fail) return;
    sfxPress();
    onPress();
  });

  shellDial.append(ring, btn);

  return {
    root: shellDial,
    button: btn,
    setText(text) {
      btn.textContent = text;
    },
    setProgress(ratio) {
      const normalized = Math.max(0, Math.min(1, ratio));
      const activeCount = Math.round(normalized * segments);
      segEls.forEach((seg, idx) => seg.classList.toggle("active", idx < activeCount));
    }
  };
}

function nextLevel() {
  if (fail) return;
  level += 1;

  if (level > TOTAL_LEVELS) {
    winRun();
    return;
  }

  currentDifficulty = computeDifficulty();
  updateDifficultyLabel();
  updateRunProgress();

  levelLabel.textContent = `Level ${level}/${TOTAL_LEVELS}`;
  clearArena();
  locked = false;
  sfxLevelStart();

  const handler = LEVELS[level - 1];
  if (!handler) {
    winRun();
    return;
  }

  handler();
}

function initRunSeed() {
  runSeed = Math.floor(100000 + Math.random() * 900000);
  seedLabel.textContent = `Seed ${runSeed}`;
  rng = mulberry32(runSeed);
}

function resetRun() {
  ensureAudio();
  stopTimers();
  runCleanups();
  hideScareLayer(true);

  level = 0;
  fail = false;
  locked = false;
  runStats.clears = 0;
  runStats.streak = 0;

  initRunSeed();

  levelLabel.textContent = `Level 1/${TOTAL_LEVELS}`;
  runProgressFill.style.width = "0%";
  restartBtn.hidden = true;

  setPrompt("Press start when ready.");
  setHelper("Read instructions slowly. Visual effects are smooth and no flashing is used.");

  currentDifficulty = 1;
  updateDifficultyLabel();

  clearArena();
  nextLevel();
}

function bootLoading() {
  const steps = [
    "Loading visuals...",
    "Tuning sound layers...",
    "Mapping puzzle variants...",
    "Calibrating scare system...",
    "Finalizing run seed..."
  ];

  let i = 0;
  startBtn.disabled = true;

  const advance = () => {
    loadingText.textContent = steps[Math.min(i, steps.length - 1)];
    loadingFill.style.width = `${Math.min(100, ((i + 1) / steps.length) * 100)}%`;
    i += 1;

    if (i < steps.length) {
      setTimeout(advance, 320);
      return;
    }

    setTimeout(() => {
      loadingScreen.classList.add("hidden");
      setTimeout(() => {
        loadingScreen.hidden = true;
        startBtn.disabled = false;
      }, 320);
    }, 380);
  };

  advance();
}
function lvl1() {
  const pairs = [
    ["CLICK ME", "DO NOT CLICK"],
    ["PRESS", "DONT PRESS"],
    ["YES", "NO"]
  ];
  const [trap, safe] = pick(pairs);

  setPrompt(`Click the button that says ${safe}.`);
  setHelper("Do not guess by position. Read label text only.");
  arena.classList.add("center");

  const wrap = document.createElement("div");
  wrap.className = "center";
  wrap.style.gap = "12px";
  wrap.append(trapButton(trap, "You clicked the bait."), safeButton(safe, () => continueAfter()));
  arena.appendChild(wrap);
}

function lvl2() {
  const needed = rand() < 0.55 ? 2 : 3;
  setPrompt(`${needed === 2 ? "Double" : "Triple"}-click the center button before time ends.`);
  setHelper("Button text may lie. Count your clicks exactly.");
  arena.classList.add("center");

  let clicks = 0;
  const dial = createDialButton(needed === 2 ? "ONCE" : "TWICE", () => {
    clicks += 1;
    if (clicks === needed) {
      stopTimers();
      continueAfter(220);
    }
  });

  arena.appendChild(dial.root);
  startCountdown(
    scaledTime(3.5),
    () => lose("Not enough clicks before timeout."),
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl3() {
  setPrompt("Do nothing. Any click or key press fails this level.");
  setHelper("Hands off mouse and keyboard.");
  arena.classList.add("center");

  const dial = createDialButton("DO NOTHING", () => lose("Input was forbidden."));
  arena.append(dial.root, note("Auto-pass when timer ends."));

  const keyTrap = (ev) => {
    ev.preventDefault();
    lose("Any key press counts as input.");
  };

  window.addEventListener("keydown", keyTrap);
  addCleanup(() => window.removeEventListener("keydown", keyTrap));

  startCountdown(
    scaledTime(4),
    () => continueAfter(130),
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl4() {
  const palette = ["red", "blue", "green", "yellow", "orange", "purple"];
  const order = shuffle(palette).slice(0, 3);

  setPrompt(`Press circles in order: ${order.map((c) => c.toUpperCase()).join(" -> ")}`);
  setHelper("Circles are all visible. Only order matters.");

  const grid = document.createElement("div");
  grid.className = "grid";
  let idx = 0;

  shuffle(palette).forEach((color) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dot";
    b.style.background = color;
    b.title = color;
    b.addEventListener("click", () => {
      if (locked || fail) return;
      sfxPress();
      if (color !== order[idx]) {
        lose(`Wrong order. Expected ${order[idx].toUpperCase()}.`);
        return;
      }
      idx += 1;
      if (idx === order.length) continueAfter();
    });
    grid.appendChild(b);
  });

  arena.append(grid);
}

function lvl5() {
  let values = Array.from({ length: 6 }, () => randInt(-18, 15));
  while (new Set(values).size !== values.length) values = Array.from({ length: 6 }, () => randInt(-18, 15));
  const minVal = Math.min(...values);

  setPrompt("Pick the smallest number by value.");
  setHelper("Negative values are smaller than positive values.");

  const grid = document.createElement("div");
  grid.className = "grid";

  shuffle(values).forEach((n) => {
    const b = safeButton(String(n), () => {
      if (n === minVal) continueAfter();
      else lose("That was not the smallest value.");
    });
    grid.appendChild(b);
  });

  arena.append(grid);
}

function lvl6() {
  const length = rand() < 0.52 ? 5 : 6;
  const code = Array.from({ length }, () => String(randInt(0, 9))).join("");

  setPrompt("Memory test: memorize this code.");
  setHelper("The code appears briefly, then disappears.");

  const text = statusLine(code);
  text.style.fontSize = "3rem";
  text.style.marginTop = "90px";
  arena.appendChild(text);

  const reveal = setTimeout(() => {
    if (fail) return;
    clearArena();
    setPrompt("Enter the code by clicking digits in order. No backspace.");
    setHelper("One wrong digit fails instantly.");

    let typed = "";
    const status = statusLine("Input: _");
    const grid = document.createElement("div");
    grid.className = "grid";

    for (let d = 0; d <= 9; d += 1) {
      const digit = String(d);
      const b = safeButton(digit, () => {
        typed += digit;
        status.textContent = `Input: ${typed}`;
        if (!code.startsWith(typed)) {
          lose("Wrong memory sequence.");
          return;
        }
        if (typed === code) continueAfter();
      });
      grid.appendChild(b);
    }

    arena.append(status, grid);
  }, scaledTime(1.55) * 1000);

  addCleanup(() => clearTimeout(reveal));
}

function lvl7() {
  setPrompt("Click the moving MOVE button. Static MOVE buttons are traps.");
  setHelper("All targets are clear. Movement is the only rule.");

  const target = safeButton("MOVE", () => continueAfter());
  target.style.position = "absolute";
  target.style.left = "12px";
  target.style.top = "145px";

  const decoyA = trapButton("MOVE", "That MOVE was static.", "big");
  decoyA.style.position = "absolute";
  decoyA.style.right = "20px";
  decoyA.style.bottom = "20px";

  const decoyB = trapButton("MOVE", "That MOVE was static.", "big");
  decoyB.style.position = "absolute";
  decoyB.style.left = "20px";
  decoyB.style.top = "20px";

  let x = 12;
  let vx = 2.6 + currentDifficulty * 1.1;
  const mover = setInterval(() => {
    if (fail || locked) return;
    x += vx;
    if (x < 0 || x > arena.clientWidth - 150) vx *= -1;
    target.style.left = `${x}px`;
  }, 16);

  addCleanup(() => clearInterval(mover));
  arena.append(target, decoyA, decoyB);

  startCountdown(scaledTime(5.3), () => lose("Time ran out."));
}

function lvl8() {
  const modes = [
    { text: "EVEN", pass: (n) => n % 2 === 0 },
    { text: "DIVISIBLE BY 3", pass: (n) => n % 3 === 0 },
    { text: "GREATER THAN 5", pass: (n) => n > 5 }
  ];
  const mode = pick(modes);

  setPrompt(`Press center only when Count is ${mode.text}.`);
  setHelper("Count updates continuously. Wait for a valid state.");
  arena.classList.add("center");

  let count = randInt(1, 9);
  const status = statusLine(`Count: ${count}`);
  const dial = createDialButton(`PRESS WHEN ${mode.text}`, () => {
    if (mode.pass(count)) {
      stopTimers();
      continueAfter();
    } else {
      lose(`Count ${count} did not match the rule.`);
    }
  });

  const ticker = setInterval(() => {
    if (fail || locked) return;
    count = (count % 9) + 1;
    status.textContent = `Count: ${count}`;
  }, scaledInterval(470));

  addCleanup(() => clearInterval(ticker));
  arena.append(dial.root, status);

  startCountdown(
    scaledTime(8),
    () => lose("No correct press in time."),
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl9() {
  const targetHold = randInt(860, 1340);
  const tolerance = 210;

  setPrompt(`Hold center near ${targetHold}ms (+/-${tolerance}ms), then release.`);
  setHelper("Press and hold carefully. Release timing matters.");
  arena.classList.add("center");

  let downAt = 0;
  const dial = createDialButton("HOLD", () => {});
  const status = statusLine("Press and hold");

  const onDown = () => {
    if (locked || fail) return;
    downAt = Date.now();
    status.textContent = "Holding...";
  };

  const onUp = () => {
    if (locked || fail || !downAt) return;
    const ms = Date.now() - downAt;
    downAt = 0;
    if (Math.abs(ms - targetHold) <= tolerance) {
      stopTimers();
      continueAfter();
    } else {
      lose(`Hold was ${ms}ms. Target was ${targetHold}ms.`);
    }
  };

  dial.button.addEventListener("pointerdown", onDown);
  dial.button.addEventListener("pointerup", onUp);

  arena.append(dial.root, status);

  startCountdown(
    scaledTime(6),
    () => lose("You ran out of time for the hold task."),
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl10() {
  const need = randInt(2, 5);
  setPrompt(`Click center exactly ${need} times. More clicks fail.`);
  setHelper("Stop immediately after the target count.");
  arena.classList.add("center");

  let clicks = 0;
  const dial = createDialButton(`0 / ${need}`, () => {
    clicks += 1;
    if (clicks > need) {
      lose("Too many clicks.");
      return;
    }
    dial.setText(`${clicks} / ${need}`);
    if (clicks === need) {
      stopTimers();
      continueAfter(220);
    }
  });

  arena.appendChild(dial.root);

  startCountdown(
    scaledTime(4.2),
    () => {
      if (clicks === need) continueAfter(100);
      else lose(`Needed ${need}, got ${clicks}.`);
    },
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl11() {
  const targetWord = pick(["LEFT", "RIGHT"]);
  const leftText = rand() < 0.5 ? "LEFT" : "RIGHT";
  const rightText = leftText === "LEFT" ? "RIGHT" : "LEFT";

  setPrompt(`Click ${targetWord}.`);
  setHelper("Text matters. Screen side does not.");

  const row = document.createElement("div");
  row.className = "row";

  const leftButton = safeButton(leftText, () => {
    if (leftText === targetWord) continueAfter();
    else lose("Wrong label selected.");
  });

  const rightButton = safeButton(rightText, () => {
    if (rightText === targetWord) continueAfter();
    else lose("Wrong label selected.");
  });

  row.append(leftButton, rightButton);
  arena.append(row);
}

function lvl12() {
  const waitTime = scaledTime(randInt(4, 6));
  const clickWindow = scaledTime(1.1);

  setPrompt("Wait until the ring is empty, then click during the short window.");
  setHelper("Early click fails. Late click fails.");
  arena.classList.add("center");

  let phase = "wait";
  const dial = createDialButton("WAIT", () => {
    if (phase === "wait") {
      lose("Too early.");
      return;
    }
    stopTimers();
    continueAfter(180);
  });

  const status = statusLine("Do not click yet");
  arena.append(dial.root, status);

  startCountdown(
    waitTime,
    () => {
      if (fail) return;
      phase = "go";
      dial.setText("CLICK");
      status.textContent = "Now";
      startCountdown(
        clickWindow,
        () => lose("You missed the click window."),
        (left, total) => dial.setProgress(left / total)
      );
    },
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl13() {
  const size = randInt(6, 8);
  const labels = Array.from({ length: size }, (_, i) => `SAFE ${i + 1}`);
  const forbidden = pick(labels);

  setPrompt(`Click every button once except ${forbidden}.`);
  setHelper("Do not click the forbidden label and do not double-click any safe one.");

  const grid = document.createElement("div");
  grid.className = "grid";
  const clicked = new Set();

  shuffle(labels).forEach((label) => {
    const b = safeButton(label, () => {
      if (label === forbidden) {
        lose("You clicked the forbidden button.");
        return;
      }
      if (clicked.has(label)) {
        lose("Do not click any safe button twice.");
        return;
      }
      clicked.add(label);
      b.disabled = true;
      if (clicked.size === size - 1) continueAfter();
    });
    grid.appendChild(b);
  });

  arena.append(grid);
}

function lvl14() {
  const requireMatch = rand() < 0.5;
  setPrompt(`Press center only when WORD and COLOR ${requireMatch ? "MATCH" : "DO NOT MATCH"}.`);
  setHelper("Read the word and the color separately.");
  arena.classList.add("center");

  const colors = ["red", "blue", "green", "orange"];
  const display = statusLine("BLUE");
  display.style.fontSize = "2.2rem";

  let isMatch = false;
  const dial = createDialButton(requireMatch ? "MATCH" : "MISMATCH", () => {
    if ((requireMatch && isMatch) || (!requireMatch && !isMatch)) {
      stopTimers();
      continueAfter();
    } else {
      lose("Pressed on the wrong state.");
    }
  });

  const ticker = setInterval(() => {
    if (fail || locked) return;
    const word = pick(colors);
    const paint = pick(colors);
    display.textContent = word.toUpperCase();
    display.style.color = paint;
    isMatch = word === paint;
  }, scaledInterval(430));

  addCleanup(() => clearInterval(ticker));
  arena.append(dial.root, display);

  startCountdown(
    scaledTime(8),
    () => lose("No valid press before timeout."),
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl15() {
  const sequences = [
    [" ", " ", "Enter"],
    ["ArrowUp", "ArrowUp", "Enter"],
    ["ArrowLeft", "ArrowRight", "Enter"]
  ];
  const sequence = pick(sequences);
  const labels = sequence.map((key) => (key === " " ? "SPACE" : key));

  setPrompt(`Keyboard only: ${labels.join(" -> ")}. Mouse click fails.`);
  setHelper("Keep hands on keyboard only.");
  arena.classList.add("center");

  const dial = createDialButton("NO CLICK", () => lose("Mouse click was forbidden."));
  const status = statusLine(`Sequence: ${labels.map(() => "_").join(" ")}`);
  let i = 0;

  const onKey = (ev) => {
    if (locked || fail) return;
    const expected = sequence[i];
    if (ev.key !== expected) {
      lose(`Wrong key. Expected ${labels[i]}.`);
      return;
    }

    i += 1;
    status.textContent = `Sequence: ${labels.map((_, idx) => (idx < i ? "OK" : "_")).join(" ")}`;
    if (i === sequence.length) {
      stopTimers();
      continueAfter(180);
    }
  };

  window.addEventListener("keydown", onKey);
  addCleanup(() => window.removeEventListener("keydown", onKey));

  arena.append(dial.root, status);

  startCountdown(
    scaledTime(5),
    () => lose("Keyboard sequence timed out."),
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl16() {
  const targetColor = pick(["green", "red", "blue"]);

  setPrompt("Three-phase trial. Phase 1: do not click until timer ends.");
  setHelper("Phase changes are shown in the prompt text.");
  arena.classList.add("center");

  let phase = 1;
  let phase2Clicks = 0;

  const dial = createDialButton("WAIT", () => {
    if (phase === 1) {
      lose("Too early for phase 1.");
      return;
    }

    if (phase === 2) {
      phase2Clicks += 1;
      if (phase2Clicks === 2) {
        stopTimers();
        renderPhase3();
      }
      return;
    }

    lose("Center click is disabled in phase 3.");
  });

  const status = statusLine("Phase 1: no input");
  arena.append(dial.root, status);

  function renderPhase3() {
    clearArena();
    setPrompt(`Phase 3: click the button whose TEXT COLOR is ${targetColor.toUpperCase()}.`);
    setHelper("Ignore words, use text color only.");

    const row = document.createElement("div");
    row.className = "row";

    const a = safeButton("SAFE", () => {
      if (a.style.color === targetColor) continueAfter(220);
      else lose("Wrong color target.");
    });

    const b = safeButton("SAFE", () => {
      if (b.style.color === targetColor) continueAfter(220);
      else lose("Wrong color target.");
    });

    const colors = shuffle(["green", "red", "blue", "black"]);
    a.style.color = colors[0];
    b.style.color = colors[1];

    row.append(a, b);
    arena.append(row);
  }

  startCountdown(
    scaledTime(2.8),
    () => {
      if (fail) return;
      phase = 2;
      phase2Clicks = 0;
      setPrompt("Phase 2: double-click center quickly.");
      setHelper("Need exactly 2 clicks before timeout.");
      status.textContent = "Need 2 clicks";
      dial.setText("DOUBLE");
      startCountdown(
        scaledTime(1.5),
        () => lose("Phase 2 failed."),
        (left, total) => dial.setProgress(left / total)
      );
    },
    (left, total) => dial.setProgress(left / total)
  );
}

function lvl17() {
  const letters = ["A", "B", "C", "D"];
  const sequence = Array.from({ length: 5 }, () => pick(letters));

  setPrompt("Memory extension: memorize this letter sequence.");
  setHelper("You must click letters in the same order.");

  const reveal = statusLine(sequence.join(" "));
  reveal.style.fontSize = "2.7rem";
  reveal.style.marginTop = "95px";
  arena.appendChild(reveal);

  const t = setTimeout(() => {
    if (fail) return;

    clearArena();
    setPrompt("Enter the sequence now.");
    setHelper("One mistake fails instantly.");

    let typed = "";
    const status = statusLine("Input: _");
    const row = document.createElement("div");
    row.className = "row";

    letters.forEach((ltr) => {
      const b = safeButton(ltr, () => {
        typed += ltr;
        status.textContent = `Input: ${typed}`;
        const expectedPrefix = sequence.join("").slice(0, typed.length);
        if (typed !== expectedPrefix) {
          lose("Wrong sequence order.");
          return;
        }
        if (typed.length === sequence.length) continueAfter();
      });
      row.appendChild(b);
    });

    arena.append(status, row);
  }, scaledTime(1.9) * 1000);

  addCleanup(() => clearTimeout(t));
}

function lvl18() {
  const delay = scaledTime(2.4 + rand() * 1.8);
  const windowTime = scaledTime(1.2);

  setPrompt("Do not click until GO appears. Then click immediately.");
  setHelper("Early click is instant fail.");
  arena.classList.add("center");

  let stage = "wait";
  const dial = createDialButton("WAIT", () => {
    if (stage === "wait") {
      lose("You clicked before GO.");
      return;
    }
    stopTimers();
    continueAfter(140);
  });

  const status = statusLine("Waiting...");
  arena.append(dial.root, status);

  const goTimeout = setTimeout(() => {
    if (fail) return;
    stage = "go";
    dial.setText("GO");
    status.textContent = "GO NOW";
    startCountdown(
      windowTime,
      () => lose("Too slow after GO."),
      (left, total) => dial.setProgress(left / total)
    );
  }, delay * 1000);

  addCleanup(() => clearTimeout(goTimeout));
  startCountdown(delay, () => {}, (left, total) => dial.setProgress(left / total), { warn: false });
}

function lvl19() {
  function isPrime(n) {
    if (n < 2) return false;
    for (let i = 2; i * i <= n; i += 1) {
      if (n % i === 0) return false;
    }
    return true;
  }

  let values = Array.from({ length: 9 }, () => randInt(2, 31));
  const primes = values.filter(isPrime);
  if (primes.length < 3) values = [2, 3, 5, 4, 6, 8, 9, 10, 12].map((n) => n + randInt(0, 2));

  const finalValues = shuffle(values);
  const primeSet = new Set(finalValues.filter(isPrime));

  setPrompt("Click every PRIME number exactly once.");
  setHelper("Composite numbers are traps.");

  const clicked = new Set();
  const grid = document.createElement("div");
  grid.className = "grid";

  finalValues.forEach((n) => {
    const b = safeButton(String(n), () => {
      if (!isPrime(n)) {
        lose(`${n} is not prime.`);
        return;
      }

      if (clicked.has(n)) {
        lose("Prime buttons must be clicked once only.");
        return;
      }

      clicked.add(n);
      b.disabled = true;

      if (clicked.size === primeSet.size) continueAfter();
    });
    grid.appendChild(b);
  });

  arena.append(grid);
}

function lvl20() {
  const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const pretty = {
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT"
  };
  const opposite = {
    ArrowUp: "ArrowDown",
    ArrowDown: "ArrowUp",
    ArrowLeft: "ArrowRight",
    ArrowRight: "ArrowLeft"
  };

  const seq = Array.from({ length: 4 }, () => pick(arrows));

  setPrompt("Keyboard challenge: press the OPPOSITE arrow for each cue.");
  setHelper("Cue updates after each correct key.");
  arena.classList.add("center");

  let idx = 0;
  const cue = statusLine(`Cue: ${pretty[seq[idx]]}`);
  cue.style.fontSize = "2rem";
  const progress = statusLine("Progress: _ _ _ _");

  const onKey = (ev) => {
    if (locked || fail) return;
    const expected = opposite[seq[idx]];
    if (ev.key !== expected) {
      lose(`Wrong key. Expected ${pretty[expected]}.`);
      return;
    }

    idx += 1;
    progress.textContent = `Progress: ${Array.from({ length: 4 }, (_, i) => (i < idx ? "OK" : "_")).join(" ")}`;

    if (idx === seq.length) {
      stopTimers();
      continueAfter();
      return;
    }

    cue.textContent = `Cue: ${pretty[seq[idx]]}`;
  };

  window.addEventListener("keydown", onKey);
  addCleanup(() => window.removeEventListener("keydown", onKey));

  arena.append(cue, progress);

  startCountdown(scaledTime(6), () => lose("Arrow sequence timed out."));
}

function lvl21() {
  setPrompt("Reflex trial: stay calm after the scare, then click BREATHE quickly.");
  setHelper("This level includes a short jumpscare and reaction check.");
  arena.classList.add("center");

  let armed = false;
  const status = statusLine("Prepare...");
  const breathe = safeButton("BREATHE", () => {
    if (!armed) {
      lose("Too early.");
      return;
    }
    stopTimers();
    continueAfter();
  });

  breathe.disabled = true;
  arena.append(breathe, status);

  const start = setTimeout(() => {
    triggerJumpScare({ message: "DO NOT BLINK", duration: 980 }).then(() => {
      if (fail) return;
      armed = true;
      breathe.disabled = false;
      status.textContent = "Click BREATHE now";
      startCountdown(scaledTime(1.4), () => lose("Too slow to recover."));
    });
  }, scaledTime(1.6) * 1000);

  addCleanup(() => clearTimeout(start));
}

function lvl22() {
  setPrompt("Click the only button with a SOLID border.");
  setHelper("All labels are misleading. Border style is the rule.");

  const labels = ["SAFE", "SAFE", "SAFE", "SAFE", "SAFE", "SAFE"];
  const solidIndex = randInt(0, labels.length - 1);

  const grid = document.createElement("div");
  grid.className = "grid";

  labels.forEach((label, idx) => {
    const b = safeButton(label, () => {
      if (idx === solidIndex) continueAfter();
      else lose("Wrong border style.");
    });

    if (idx === solidIndex) {
      b.style.borderStyle = "solid";
      b.style.borderWidth = "3px";
    } else {
      b.style.borderStyle = "dashed";
      b.style.borderWidth = "2px";
    }

    grid.appendChild(b);
  });

  arena.append(grid, note("Solid border means continuous line. Dashed border has gaps."));
}

function lvl23() {
  const digits = Array.from({ length: 5 }, () => String(randInt(0, 9)));
  const reverse = [...digits].reverse().join("");

  setPrompt("Memorize digits and enter them in REVERSE order.");
  setHelper("The reverse order requirement is strict.");

  const reveal = statusLine(digits.join(" "));
  reveal.style.fontSize = "2.8rem";
  reveal.style.marginTop = "94px";
  arena.appendChild(reveal);

  const t = setTimeout(() => {
    if (fail) return;
    clearArena();

    setPrompt("Enter reverse order now.");
    setHelper("Example: 1 2 3 becomes 3 2 1.");

    let typed = "";
    const status = statusLine("Input: _");
    const grid = document.createElement("div");
    grid.className = "grid";

    for (let d = 0; d <= 9; d += 1) {
      const s = String(d);
      const b = safeButton(s, () => {
        typed += s;
        status.textContent = `Input: ${typed}`;
        if (!reverse.startsWith(typed)) {
          lose("Wrong reverse sequence.");
          return;
        }
        if (typed === reverse) continueAfter();
      });
      grid.appendChild(b);
    }

    arena.append(status, grid);
  }, scaledTime(1.8) * 1000);

  addCleanup(() => clearTimeout(t));
}

function lvl24() {
  setPrompt("Final level phase 1: click center only when timer is between 1.8s and 1.2s.");
  setHelper("After phase 1, a final scare and choice will appear.");
  arena.classList.add("center");

  let phase = 1;
  let lastLeft = 0;

  const dial = createDialButton("TIMING", () => {
    if (phase !== 1) {
      lose("Wrong phase action.");
      return;
    }

    if (lastLeft <= 1.8 && lastLeft >= 1.2) {
      stopTimers();
      phase = 2;
      triggerJumpScare({ message: "FINAL TEST", duration: 980 }).then(() => {
        if (fail) return;
        renderChoicePhase();
      });
    } else {
      lose("Click was outside the allowed timing window.");
    }
  });

  const status = statusLine("Allowed window: 1.8s to 1.2s");
  arena.append(dial.root, status);

  function renderChoicePhase() {
    clearArena();
    setPrompt("Final choice: click EXIT.");
    setHelper("Words can lie. Read every label carefully.");

    const labels = shuffle(["EXIT", "STAY", "WAIT", "TRAP"]);
    const row = document.createElement("div");
    row.className = "grid";

    labels.forEach((label) => {
      const b = safeButton(label, () => {
        if (label === "EXIT") continueAfter(260);
        else lose("Wrong final choice.");
      });
      row.appendChild(b);
    });

    arena.append(row);
  }

  startCountdown(
    scaledTime(3.8),
    () => lose("You missed the timing click."),
    (left, total) => {
      lastLeft = left;
      dial.setProgress(left / total);
    }
  );
}

muteBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  muteBtn.textContent = soundOn ? "Sound On" : "Sound Off";
  if (soundOn) {
    ensureAudio();
    playTone(700, 0.06, "triangle", 0.03);
  }
});

scareBtn.addEventListener("click", () => {
  scareOn = !scareOn;
  scareBtn.textContent = scareOn ? "Jumpscares On" : "Jumpscares Off";
});

startBtn.addEventListener("click", resetRun);
restartBtn.addEventListener("click", resetRun);

levelLabel.textContent = `Level 1/${TOTAL_LEVELS}`;
difficultyLabel.textContent = "Difficulty x1.00";
seedLabel.textContent = "Seed ----";
setPrompt("Press start when ready.");
setHelper("Read instructions slowly. Visual effects are smooth and no flashing is used.");

bootLoading();
