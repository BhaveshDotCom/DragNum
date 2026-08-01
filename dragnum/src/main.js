import "./style.css";
(function () {
  "use strict";

  // ---------------- Config ----------------
  var COLS = 9;
  var INITIAL_ROWS = 6;
  var MAX_ROWS = 14;

  // ---------------- State ----------------
  var idCounter = 0;
  var grid = []; // array of { rowId, cells: [{id,value}] }
  var score = 0;
  var combo = 0;
  var comboTimer = null;
  var audioCtx = null;

  var dragging = false;
  var activePointerId = null;
  var startR = -1,
    startC = -1;
  var hoverR = -1,
    hoverC = -1,
    hoverValid = false,
    hoverOccupied = false;

  // ---------------- DOM refs ----------------
  var boardEl = document.getElementById("board");
  var scoreVal = document.getElementById("score-val");
  var comboVal = document.getElementById("combo-val");
  var comboPill = document.getElementById("combo-pill");
  var noMovesBanner = document.getElementById("no-moves-banner");
  var winOverlay = document.getElementById("win-overlay");
  var winScore = document.getElementById("win-score");

  document.documentElement.style.setProperty("--cols", COLS);

  // ---------------- Helpers: grid ----------------
  function separateDiagonalPairs(vals, cols) {
    const rows = Math.ceil(vals.length / cols);

    for (let i = 0; i < vals.length; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;

      // Check down-right
      if (r < rows - 1 && c < cols - 1) {
        const j = i + cols + 1;

        if (vals[i] === vals[j] || vals[i] + vals[j] === 10) {
          const k = Math.floor(Math.random() * vals.length);
          [vals[j], vals[k]] = [vals[k], vals[j]];
        }
      }

      // Check down-left
      if (r < rows - 1 && c > 0) {
        const j = i + cols - 1;

        if (vals[i] === vals[j] || vals[i] + vals[j] === 10) {
          const k = Math.floor(Math.random() * vals.length);
          [vals[j], vals[k]] = [vals[k], vals[j]];
        }
      }
    }
  }
  function randomValue() {
    return 1 + Math.floor(Math.random() * 9);
  }

  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // Builds `total` numbers as guaranteed equal/sum-10 pairs (plus one 0
  // "spacer" if total is odd), then shuffles their positions. This is what
  // actually makes a full clear reachable: matches always remove exactly two
  // tiles, so the board's *starting* count of real numbers has to be even,
  // and every number needs a genuine partner somewhere in the set.
  function generatePairedValues(total) {
    var vals = [];
    var pairCount = Math.floor(total / 2);
    for (var i = 0; i < pairCount; i++) {
      var a = randomValue();
      var b = Math.random() < 0.5 ? a : 10 - a;
      vals.push(a, b);
    }
    if (total % 2 === 1) vals.push(0);

    shuffleArray(vals);
    separateDiagonalPairs(vals, COLS);

    return vals;
  }

  function makeInitialGrid(n) {
    var total = n * COLS;
    var vals = generatePairedValues(total);
    var g = [];
    var idx = 0;
    for (var r = 0; r < n; r++) {
      var cells = [];
      for (var c = 0; c < COLS; c++) {
        cells.push({ id: "c" + idCounter++, value: vals[idx++] });
      }
      g.push({ rowId: "r" + idCounter++, cells: cells });
    }
    return g;
  }

  function cellAt(r, c) {
    return grid[r].cells[c];
  }
  function inBounds(r, c) {
    return r >= 0 && r < grid.length && c >= 0 && c < COLS;
  }
  function isValidPair(v1, v2) {
    return v1 === v2 || v1 + v2 === 10;
  }

  var DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  function checkConnection(r0, c0, r1, c1) {
    if (r0 === r1 && c0 === c1) return false;
    if (!inBounds(r0, c0) || !inBounds(r1, c1)) return false;
    var dr = r1 - r0,
      dc = c1 - c0;
    var straight = dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
    if (!straight) return false;
    var v0 = cellAt(r0, c0).value,
      v1 = cellAt(r1, c1).value;
    if (v0 === 0 || v1 === 0) return false;
    var stepR = dr === 0 ? 0 : dr / Math.abs(dr);
    var stepC = dc === 0 ? 0 : dc / Math.abs(dc);
    var rr = r0 + stepR,
      cc = c0 + stepC;
    while (rr !== r1 || cc !== c1) {
      if (cellAt(rr, cc).value !== 0) return false;
      rr += stepR;
      cc += stepC;
    }
    return isValidPair(v0, v1);
  }

  function nearestOccupied(r, c, dr, dc) {
    var rr = r + dr,
      cc = c + dc;
    while (inBounds(rr, cc)) {
      if (cellAt(rr, cc).value !== 0) return [rr, cc];
      rr += dr;
      cc += dc;
    }
    return null;
  }

  function findValidMove() {
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < COLS; c++) {
        if (cellAt(r, c).value === 0) continue;
        for (var i = 0; i < DIRS.length; i++) {
          var nb = nearestOccupied(r, c, DIRS[i][0], DIRS[i][1]);
          if (
            nb &&
            isValidPair(cellAt(r, c).value, cellAt(nb[0], nb[1]).value)
          ) {
            return [
              [r, c],
              [nb[0], nb[1]],
            ];
          }
        }
      }
    }
    return null;
  }

  // ---------------- Audio ----------------
  var soundOn = true;

  function getAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    }
    return audioCtx;
  }
  // Browsers start AudioContext "suspended" until a user gesture resumes it.
  // Call this on the first pointerdown/click so every later beep is audible.
  function unlockAudio() {
    var ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(function () {});
    }
  }

  function beep(freq, dur, type, gain, opts) {
    if (!soundOn) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, now);
      if (opts && opts.slideTo) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(opts.slideTo, 1),
          now + dur,
        );
      }
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain || 0.05, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch (e) {}
  }

  // two soft high notes that rise slightly with combo — the "match" chime
  function playMatchSound(comboN) {
    var step = Math.min(comboN, 8) * 40;
    beep(720 + step, 0.1, "sine", 0.07);
    setTimeout(function () {
      beep(1080 + step, 0.15, "sine", 0.05);
    }, 60);
    if (comboN >= 3) {
      setTimeout(function () {
        beep(1440 + step, 0.14, "triangle", 0.035);
      }, 115);
    }
  }
  // short downward buzz for an illegal drop
  function playErrorSound() {
    beep(220, 0.14, "sawtooth", 0.045, { slideTo: 90 });
  }
  // light tick while hovering a *valid* target during drag (fires on change only)
  function playHoverTick() {
    beep(1500, 0.045, "sine", 0.02);
  }
  // quiet click for toolbar buttons
  function playClickSound() {
    beep(500, 0.05, "square", 0.02);
  }
  // little ascending fanfare when the board clears
  function playWinSound() {
    [0, 1, 2, 3].forEach(function (i) {
      setTimeout(function () {
        beep(523.25 * Math.pow(2, (i / 12) * 4), 0.22, "triangle", 0.06);
      }, i * 100);
    });
  }

  // ---------------- Rendering ----------------
  function render() {
    boardEl.innerHTML = "";
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      var rowEl = document.createElement("div");
      rowEl.className = "row";
      rowEl.dataset.rowId = row.rowId;
      for (var c = 0; c < COLS; c++) {
        var cell = row.cells[c];
        var cellEl = document.createElement("div");
        cellEl.dataset.r = r;
        cellEl.dataset.c = c;
        cellEl.dataset.id = cell.id;
        if (cell.value === 0) {
          cellEl.className = "cell empty";
        } else {
          cellEl.className = "cell";
          cellEl.textContent = cell.value;
        }
        rowEl.appendChild(cellEl);
      }
      boardEl.appendChild(rowEl);
    }
    // svg overlay + badge (re-append, since innerHTML cleared it)
    boardEl.appendChild(svgLayer);
    boardEl.appendChild(midBadge);
  }

  // ---------------- SVG line layer ----------------
  var svgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgLayer.setAttribute("id", "line-layer");
  var glowFilter = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "defs",
  );
  glowFilter.innerHTML =
    '<filter id="glow" x="-60%" y="-60%" width="220%" height="220%">' +
    '<feGaussianBlur stdDeviation="4" result="blur"/>' +
    '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    "</filter>";
  svgLayer.appendChild(glowFilter);
  var dragLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  dragLine.setAttribute("id", "drag-line");
  dragLine.setAttribute("stroke-width", "5");
  dragLine.setAttribute("filter", "url(#glow)");
  dragLine.style.display = "none";
  svgLayer.appendChild(dragLine);

  var midBadge = document.createElement("div");
  midBadge.id = "mid-badge";

  function setLineColor(state) {
    var color =
      state === "valid"
        ? getComputedStyle(document.documentElement)
            .getPropertyValue("--mint")
            .trim()
        : state === "invalid"
          ? getComputedStyle(document.documentElement)
              .getPropertyValue("--coral")
              .trim()
          : getComputedStyle(document.documentElement)
              .getPropertyValue("--text-dimmer")
              .trim();
    dragLine.setAttribute("stroke", color);
  }

  // ---------------- Drag interaction ----------------
  function boardRect() {
    return boardEl.getBoundingClientRect();
  }

  function cellCenter(r, c) {
    var el = boardEl.querySelector(
      '.cell[data-r="' + r + '"][data-c="' + c + '"]',
    );
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var br = boardRect();
    return {
      x: rect.left + rect.width / 2 - br.left,
      y: rect.top + rect.height / 2 - br.top,
    };
  }

  function clearHoverClasses() {
    var els = boardEl.querySelectorAll(".hover-valid, .hover-invalid, .origin");
    els.forEach(function (el) {
      el.classList.remove("hover-valid", "hover-invalid", "origin");
    });
  }

  var lastHoverKey = null;

  function onPointerDown(e) {
    var cellEl = e.target.closest(".cell");
    if (!cellEl || cellEl.classList.contains("empty")) return;
    if (dragging) return; // ignore extra pointers, track only first
    unlockAudio();
    dragging = true;
    activePointerId = e.pointerId;
    startR = parseInt(cellEl.dataset.r, 10);
    startC = parseInt(cellEl.dataset.c, 10);
    hoverR = -1;
    hoverC = -1;
    hoverValid = false;
    lastHoverKey = null;

    cellEl.classList.add("origin");
    dragLine.style.display = "";
    var center = cellCenter(startR, startC);
    dragLine.setAttribute("x1", center.x);
    dragLine.setAttribute("y1", center.y);
    dragLine.setAttribute("x2", center.x);
    dragLine.setAttribute("y2", center.y);
    setLineColor("neutral");

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== activePointerId) return;
    e.preventDefault();

    var br = boardRect();
    var px = e.clientX - br.left;
    var py = e.clientY - br.top;
    dragLine.setAttribute("x2", px);
    dragLine.setAttribute("y2", py);

    var elUnder = document.elementFromPoint(e.clientX, e.clientY);
    var cellEl = elUnder ? elUnder.closest(".cell") : null;

    clearHoverClasses();
    var originEl = boardEl.querySelector(
      '.cell[data-r="' + startR + '"][data-c="' + startC + '"]',
    );
    if (originEl) originEl.classList.add("origin");

    if (cellEl && !cellEl.classList.contains("empty")) {
      var r = parseInt(cellEl.dataset.r, 10);
      var c = parseInt(cellEl.dataset.c, 10);
      if (r === startR && c === startC) {
        hoverR = -1;
        hoverC = -1;
        hoverValid = false;
        hoverOccupied = false;
        setLineColor("neutral");
        hideMidBadge();
        lastHoverKey = null;
      } else {
        hoverR = r;
        hoverC = c;
        hoverOccupied = true;
        hoverValid = checkConnection(startR, startC, r, c);
        cellEl.classList.add(hoverValid ? "hover-valid" : "hover-invalid");
        setLineColor(hoverValid ? "valid" : "invalid");
        if (hoverValid) {
          var s = cellAt(startR, startC).value,
            t = cellAt(r, c).value;
          showMidBadge(px, py, startR, startC, r, c, s === t ? "=" : "+10");
          var key = r + "," + c;
          if (key !== lastHoverKey) {
            playHoverTick();
            lastHoverKey = key;
          }
        } else {
          hideMidBadge();
          lastHoverKey = null;
        }
      }
    } else {
      hoverR = -1;
      hoverC = -1;
      hoverValid = false;
      hoverOccupied = false;
      setLineColor("neutral");
      hideMidBadge();
      lastHoverKey = null;
    }
  }

  function showMidBadge(px, py, r0, c0, r1, c1, label) {
    var c0p = cellCenter(r0, c0),
      c1p = cellCenter(r1, c1);
    var mx = (c0p.x + c1p.x) / 2,
      my = (c0p.y + c1p.y) / 2;
    midBadge.textContent = label;
    midBadge.style.left = mx + "px";
    midBadge.style.top = my + "px";
    midBadge.classList.add("show");
  }
  function hideMidBadge() {
    midBadge.classList.remove("show");
  }

  function onPointerUp(e) {
    if (!dragging || e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);

    dragLine.style.display = "none";
    hideMidBadge();
    clearHoverClasses();

    if (hoverValid && hoverR >= 0) {
      performMatch(startR, startC, hoverR, hoverC);
    } else if (hoverOccupied) {
      playErrorSound();
    }
    startR = -1;
    startC = -1;
    hoverR = -1;
    hoverC = -1;
    hoverValid = false;
    hoverOccupied = false;
  }

  boardEl.addEventListener("pointerdown", onPointerDown);

  // ---------------- Match / scoring ----------------
  function spawnParticles(x, y, color) {
    for (var i = 0; i < 8; i++) {
      var p = document.createElement("div");
      p.className = "particle";
      var angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
      var dist = 26 + Math.random() * 18;
      p.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      p.style.setProperty("--dy", Math.sin(angle) * dist + "px");
      p.style.left = x + "px";
      p.style.top = y + "px";
      p.style.background = color;
      boardEl.appendChild(p);
      (function (el) {
        setTimeout(function () {
          el.remove();
        }, 600);
      })(p);
    }
  }

  function spawnScoreFloat(x, y, text) {
    var f = document.createElement("div");
    f.className = "score-float";
    f.textContent = text;
    f.style.left = x + "px";
    f.style.top = y + "px";
    boardEl.appendChild(f);
    setTimeout(function () {
      f.remove();
    }, 720);
  }

  function bumpCombo() {
    comboPill.classList.remove("bump");
    void comboPill.offsetWidth;
    comboPill.classList.add("bump");
  }

  function performMatch(r0, c0, r1, c1) {
    var v0 = cellAt(r0, c0).value,
      v1 = cellAt(r1, c1).value;
    var c0p = cellCenter(r0, c0),
      c1p = cellCenter(r1, c1);
    var mint = getComputedStyle(document.documentElement)
      .getPropertyValue("--mint")
      .trim();

    var el0 = boardEl.querySelector(
      '.cell[data-r="' + r0 + '"][data-c="' + c0 + '"]',
    );
    var el1 = boardEl.querySelector(
      '.cell[data-r="' + r1 + '"][data-c="' + c1 + '"]',
    );
    if (el0) el0.classList.add("popping");
    if (el1) el1.classList.add("popping");

    spawnParticles(c0p.x, c0p.y, mint);
    spawnParticles(c1p.x, c1p.y, mint);

    combo += 1;
    var points = 10 + (combo - 1) * 2;
    score += points;
    var mx = (c0p.x + c1p.x) / 2,
      my = (c0p.y + c1p.y) / 2;
    spawnScoreFloat(mx, my, "+" + points + (combo > 1 ? "  ×" + combo : ""));

    playMatchSound(combo);
    bumpCombo();

    scoreVal.textContent = score;
    comboVal.textContent = "×" + combo;

    clearTimeout(comboTimer);
    comboTimer = setTimeout(function () {
      combo = 0;
      comboVal.textContent = "×0";
    }, 2600);

    setTimeout(function () {
      cellAt(r0, c0).value = 0;
      cellAt(r1, c1).value = 0;
      afterBoardChange();
    }, 230);
  }

  // ---------------- Row collapse (FLIP) ----------------
  function afterBoardChange() {
    var emptyIdx = [];
    for (var r = 0; r < grid.length; r++) {
      var allEmpty = grid[r].cells.every(function (c) {
        return c.value === 0;
      });
      if (allEmpty) emptyIdx.push(r);
    }
    if (emptyIdx.length === 0) {
      render();
      postRenderChecks();
      return;
    }
    // FLIP: capture first positions
    var rowEls = boardEl.querySelectorAll(".row");
    var firstRects = {};
    rowEls.forEach(function (el) {
      firstRects[el.dataset.rowId] = el.getBoundingClientRect();
    });

    grid = grid.filter(function (_, i) {
      return emptyIdx.indexOf(i) === -1;
    });
    render();

    var newRowEls = boardEl.querySelectorAll(".row");
    newRowEls.forEach(function (el) {
      var first = firstRects[el.dataset.rowId];
      if (!first) return;
      var last = el.getBoundingClientRect();
      var dy = first.top - last.top;
      if (Math.abs(dy) > 0.5) {
        el.style.transition = "none";
        el.style.transform = "translateY(" + dy + "px)";
        requestAnimationFrame(function () {
          el.style.transition = "transform 340ms cubic-bezier(.2,.8,.2,1)";
          el.style.transform = "";
        });
      }
    });

    postRenderChecks();
  }

  function postRenderChecks() {
    if (grid.length === 0) {
      setTimeout(showWin, 260);
      return;
    }
    var move = findValidMove();
    noMovesBanner.classList.toggle("show", !move);
    document.getElementById("add-btn").disabled = false;
  }

  // ---------------- Toolbar actions ----------------
  function addNumbers() {
    var remaining = [];
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < COLS; c++) {
        if (grid[r].cells[c].value !== 0)
          remaining.push(grid[r].cells[c].value);
      }
    }
    if (remaining.length === 0 || grid.length >= MAX_ROWS) return;
    var newRows = [];
    for (var i = 0; i < remaining.length; i += COLS) {
      var chunk = remaining.slice(i, i + COLS);
      var cells = [];
      for (var j = 0; j < COLS; j++) {
        cells.push({
          id: "c" + idCounter++,
          value: chunk[j] !== undefined ? chunk[j] : 0,
        });
      }
      newRows.push({ rowId: "r" + idCounter++, cells: cells });
      if (grid.length + newRows.length >= MAX_ROWS) break;
    }
    grid = grid.concat(newRows);
    render();
    postRenderChecks();
  }

  function shuffleBoard() {
    var vals = [];
    for (var r = 0; r < grid.length; r++)
      for (var c = 0; c < COLS; c++)
        if (grid[r].cells[c].value !== 0) vals.push(grid[r].cells[c].value);
    for (var i = vals.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = vals[i];
      vals[i] = vals[j];
      vals[j] = tmp;
    }
    var k = 0;
    for (var r2 = 0; r2 < grid.length; r2++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        if (grid[r2].cells[c2].value !== 0)
          grid[r2].cells[c2].value = vals[k++];
      }
    }
    render();
    postRenderChecks();
  }

  function showHint() {
    var move = findValidMove();
    if (!move) {
      return;
    }
    var el0 = boardEl.querySelector(
      '.cell[data-r="' + move[0][0] + '"][data-c="' + move[0][1] + '"]',
    );
    var el1 = boardEl.querySelector(
      '.cell[data-r="' + move[1][0] + '"][data-c="' + move[1][1] + '"]',
    );
    [el0, el1].forEach(function (el) {
      if (!el) return;
      el.classList.remove("hint");
      void el.offsetWidth;
      el.classList.add("hint");
    });
  }

  function restart() {
    idCounter = 0;
    score = 0;
    combo = 0;
    clearTimeout(comboTimer);
    scoreVal.textContent = "0";
    comboVal.textContent = "×0";
    grid = makeInitialGrid(INITIAL_ROWS);
    winOverlay.classList.remove("show");
    noMovesBanner.classList.remove("show");
    render();
    postRenderChecks();
  }

  function showWin() {
    winScore.textContent = score;
    winOverlay.classList.add("show");
    playWinSound();
  }

  function toggleSound() {
    soundOn = !soundOn;
    var btn = document.getElementById("sound-btn");
    btn.classList.toggle("muted", !soundOn);
    btn.innerHTML = soundOn
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>';
    if (soundOn) {
      unlockAudio();
      playClickSound();
    }
  }

  // shared click-sound + audio unlock for every toolbar button
  document
    .querySelectorAll(".toolbar .btn, #banner-add-btn, #win-restart")
    .forEach(function (btn) {
      btn.addEventListener("click", function () {
        unlockAudio();
        playClickSound();
      });
    });

  document.getElementById("add-btn").addEventListener("click", addNumbers);
  document
    .getElementById("banner-add-btn")
    .addEventListener("click", addNumbers);
  document
    .getElementById("shuffle-btn")
    .addEventListener("click", shuffleBoard);
  document.getElementById("hint-btn").addEventListener("click", showHint);
  document.getElementById("restart-btn").addEventListener("click", restart);
  document.getElementById("win-restart").addEventListener("click", restart);
  document.getElementById("sound-btn").addEventListener("click", toggleSound);

  // prevent page scroll while interacting with board on touch devices
  boardEl.addEventListener(
    "touchmove",
    function (e) {
      if (dragging) e.preventDefault();
    },
    { passive: false },
  );

  // ---------------- Boot ----------------
  restart();
})();
