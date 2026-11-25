/* Clinical Physiological KG & World Model Interactive Navigator — Pure English, Zero Overlaps */
(function () {
  "use strict";

  const DATA = window.KG_DATA;
  if (!DATA) {
    document.body.innerHTML = "<p style='padding:24px;font-family:sans-serif'>Error: data.js not loaded.</p>";
    return;
  }

  const COLORS = {
    ink: "#111827",
    ink2: "#374151",
    muted: "#6b7280",
    hairline: "#e5e7eb",
    steel: "#1d4e78",
    cardinal: "#8c1515",
    ochre: "#8a5a10",
    slate: "#64748b",
  };

  const NODE_TYPE_STYLE = {
    drug:                 { color: "#1d4e78", label: "Drug",              r: 7.2 },
    observed_variable:    { color: "#8c1515", label: "Vital Sign",        r: 8.0 },
    latent_physiological: { color: "#8a5a10", label: "Physiology",        r: 6.8 },
    state:                { color: "#1f2937", label: "Clinical State",    r: 6.2 },
    receptor:             { color: "#4b6b94", label: "Receptor",          r: 5.8 },
    intervention:         { color: "#3d5a45", label: "Intervention",      r: 6.0 },
    drug_class:           { color: "#64748b", label: "Drug Class",        r: 5.2 },
    derived_variable:     { color: "#7f4f24", label: "Derived Metric",    r: 5.4 },
    clinical_quantity:    { color: "#6b7280", label: "Lab / Quantity",    r: 4.8 },
    organ_system:         { color: "#334155", label: "Organ System",      r: 6.0 },
    protein:              { color: "#94a3b8", label: "Protein",           r: 3.4 },
    side_effect:          { color: "#a8a29e", label: "Side Effect",       r: 3.2 },
    adverse_effect:       { color: "#a8a29e", label: "Side Effect",       r: 3.2 },
  };

  let ACTIVE_VIEW = "pipeline";

  const nodeById = new Map();
  const adjOut = new Map();
  const adjIn = new Map();
  const hypersByNode = new Map();

  DATA.nodes.forEach((n) => {
    nodeById.set(n.id, n);
    adjOut.set(n.id, []);
    adjIn.set(n.id, []);
    hypersByNode.set(n.id, []);
  });
  DATA.edges.forEach((e) => {
    if (adjOut.has(e.s)) adjOut.get(e.s).push(e);
    if (adjIn.has(e.t)) adjIn.get(e.t).push(e);
  });
  DATA.hyperedges.forEach((h) => {
    h.members.forEach((m) => {
      if (hypersByNode.has(m.node)) hypersByNode.get(m.node).push(h);
    });
  });

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------- Navigation & Global Search ----------------
  function switchView(viewName) {
    ACTIVE_VIEW = viewName;
    document.querySelectorAll(".nav-tab").forEach((b) => b.classList.toggle("active", b.dataset.view === viewName));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + viewName));
    if (viewName === "explorer") resizeGraphCanvas();
    else if (viewName === "pipeline") resizePipeCanvas();
    else if (viewName === "conflicts") resizeReversalCanvas();
    else if (viewName === "model") resizeModelCanvas();
  }
  document.querySelectorAll(".nav-tab").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));

  // Fullscreen Presentation Mode + Keyboard Slide Navigation (ArrowLeft / ArrowRight)
  const VIEW_ORDER = ["pipeline", "explorer", "ledger", "conflicts", "model"];
  const btnPresent = document.getElementById("btnPresent");
  if (btnPresent) {
    btnPresent.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
    document.addEventListener("fullscreenchange", () => {
      btnPresent.textContent = document.fullscreenElement ? "Exit" : "Present";
      setTimeout(() => { resizePipeCanvas(); resizeGraphCanvas(); resizeReversalCanvas(); resizeModelCanvas(); }, 120);
    });
  }
  window.addEventListener("keydown", (ev) => {
    if (document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (ev.key === "ArrowRight" || ev.key === "PageDown") {
      if (ACTIVE_VIEW === "pipeline" && pipeState.idx < DATA.stages.length - 1) {
        stopPipePlay(); setPipeStage(pipeState.idx + 1);
      } else if (ACTIVE_VIEW === "model" && modelState.idx < MODEL_STAGES.length - 1) {
        stopModelPlay(); setModelStage(modelState.idx + 1);
      } else {
        const idx = VIEW_ORDER.indexOf(ACTIVE_VIEW);
        if (idx < VIEW_ORDER.length - 1) switchView(VIEW_ORDER[idx + 1]);
      }
    } else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
      if (ACTIVE_VIEW === "pipeline" && pipeState.idx > 0) {
        stopPipePlay(); setPipeStage(pipeState.idx - 1);
      } else if (ACTIVE_VIEW === "model" && modelState.idx > 0) {
        stopModelPlay(); setModelStage(modelState.idx - 1);
      } else {
        const idx = VIEW_ORDER.indexOf(ACTIVE_VIEW);
        if (idx > 0) switchView(VIEW_ORDER[idx - 1]);
      }
    }
  });

  const gSearch = document.getElementById("globalSearch");
  const gDrop = document.getElementById("globalSearchResults");
  gSearch.addEventListener("input", () => {
    const q = gSearch.value.trim().toLowerCase();
    if (!q) { gDrop.classList.add("hidden"); return; }
    const hits = DATA.nodes.filter((n) =>
      n.id.toLowerCase().includes(q) ||
      n.label.toLowerCase().includes(q) ||
      (n.synonyms || []).some((s) => s.toLowerCase().includes(q))
    ).sort((a, b) => b.sdeg - a.sdeg || b.deg - a.deg).slice(0, 14);
    gDrop.innerHTML = hits.length
      ? hits.map((n) => `<div class="search-item" data-nid="${esc(n.id)}"><span class="si-name">${esc(n.id)}</span><span class="si-meta">${esc(n.type)} · deg ${n.deg}</span></div>`).join("")
      : `<div class="search-item"><span class="si-meta">No matching node</span></div>`;
    gDrop.classList.remove("hidden");
  });
  gDrop.addEventListener("click", (ev) => {
    const row = ev.target.closest(".search-item");
    if (!row || !row.dataset.nid) return;
    gDrop.classList.add("hidden");
    gSearch.value = "";
    jumpToNodeInExplorer(row.dataset.nid);
  });
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".global-search-wrap")) gDrop.classList.add("hidden");
  });

  function jumpToNodeInExplorer(nid, targetEdgeIdx = null) {
    switchView("explorer");
    const n = nodeById.get(nid);
    if (!n) return;
    if (!graphState.visibleNodeIds.has(nid)) {
      if (n.tier === "core_1m_causal") selectPreset("core", false);
      else selectPreset("full", false);
    }
    graphState.selectedNode = nid;
    graphState.selectedEdge = targetEdgeIdx;
    graphState.pathHighlight = null;
    focusCameraOnNode(nid, 2.2);
    if (targetEdgeIdx !== null) renderEdgeInspector(DATA.edges[targetEdgeIdx]);
    else renderNodeInspector(n);
  }

  // ============================================================================
  // VIEW 01: CONTINUOUS LIVING GRAPH CONSTRUCTION (PURE WHITE, ZERO OVERLAPS)
  // ============================================================================
  const pipeCanvas = document.getElementById("pipelineCanvas");
  const pipeCtx = pipeCanvas.getContext("2d");
  const pipeState = {
    idx: 0,
    stageAnim: 1,
    playing: false,
    timer: null,
    dispNodes: 68,
    dispEdges: 333,
    dispHypers: 0,
    w: 1100,
    h: 470,
    t: 0,
  };

  // Mathematically spaced 4-column physiological backbone + Step-4 Equation Store column (zero collisions)
  const EVO_NODES = [
    // Col 1: Drugs
    { id: "norepinephrine",  lbl: "norepinephrine",  x: 0.085, y: 0.19, type: "drug", born: 0 },
    { id: "epinephrine",     lbl: "epinephrine",     x: 0.085, y: 0.40, type: "drug", born: 0 },
    { id: "dexmedetomidine", lbl: "dexmedetomidine", x: 0.085, y: 0.59, type: "drug", born: 0 },
    { id: "ketamine",        lbl: "ketamine",        x: 0.085, y: 0.77, type: "drug", born: 0 },
    { id: "sevoflurane",     lbl: "sevoflurane",     x: 0.085, y: 0.91, type: "drug", born: 4 },
    { id: "class_vol",       lbl: "volatile_anaesthetic", x: 0.245, y: 0.91, type: "drug_class", born: 5, danglingAt: 4 },

    // Col 2: Receptors (appear at Step 3)
    { id: "ADRA1", lbl: "ADRA1", x: 0.275, y: 0.19, type: "receptor", born: 2 },
    { id: "ADRB2", lbl: "ADRB2", x: 0.275, y: 0.40, type: "receptor", born: 2 },
    { id: "CHRN",  lbl: "CHRN",  x: 0.275, y: 0.62, type: "receptor", born: 2, ghostAfter: 2 },
    { id: "GRIN",  lbl: "GRIN",  x: 0.275, y: 0.79, type: "receptor", born: 2, ghostAfter: 2 },

    // Col 3: Physiology & Vital Signs
    { id: "SVR",        lbl: "SVR",        x: 0.485, y: 0.15, type: "latent_physiological", born: 0 },
    { id: "MAP",        lbl: "MAP",        x: 0.485, y: 0.34, type: "observed_variable",    born: 0 },
    { id: "DBP",        lbl: "DBP",        x: 0.485, y: 0.52, type: "observed_variable",    born: 0 },
    { id: "HR",         lbl: "HR",         x: 0.485, y: 0.70, type: "observed_variable",    born: 0 },
    { id: "CVP",        lbl: "CVP",        x: 0.485, y: 0.87, type: "observed_variable",    born: 0 },
    { id: "vent_drive", lbl: "vent_drive", x: 0.390, y: 0.62, type: "latent_physiological", born: 2, ghostAfter: 2 },

    // Col 4: Clinical States
    { id: "septic_shock",   lbl: "septic_shock",   x: 0.695, y: 0.23, type: "state", born: 1 },
    { id: "hypovolemia",    lbl: "hypovolemia",    x: 0.695, y: 0.47, type: "state", born: 1 },
    { id: "cardiac_arrest", lbl: "cardiac_arrest", x: 0.695, y: 0.67, type: "state", born: 2 },
    { id: "pain",           lbl: "pain",           x: 0.695, y: 0.81, type: "state", born: 1, ghostAfter: 1 },
    { id: "orphan_mondo",   lbl: "MONDO:0002243",  x: 0.695, y: 0.91, type: "adverse_effect", born: 1, prunedAt: 5 },
  ];

  // Clean non-overlapping edges with dedicated label offsets
  const EVO_EDGES = [
    // Step 2 (index 1): Clinical literature & 2nd-pass check
    { s: "norepinephrine",  t: "MAP", sign:  1, born: 1, curve: -22, dupAt: 4 },
    { s: "dexmedetomidine", t: "MAP", sign: -1, born: 1, curve:  16, tagAt4: "maintenance (−1)", tagDy: 12 },
    { s: "ketamine",        t: "MAP", sign:  1, born: 1, curve: -18, conflictAt: 3, conflictLbl: "⚠ opposing cohort (sign kept)", confDy: -10 },
    { s: "septic_shock",    t: "MAP", sign: -1, born: 1, curve: -10 },
    { s: "septic_shock",    t: "CVP", sign: -1, born: 1, curve:  32, conflictAt: 3, conflictLbl: "⚠ post-fluid artefact (sign kept)", confDy: 10 },
    { s: "hypovolemia",     t: "CVP", sign: -1, born: 1, curve:  14 },
    { s: "pain",            t: "HR",  sign:  1, born: 1, curve:  12, droppedAt: 1, dropLbl: "✕ Removed (PADIS guideline)" },

    // Step 3 (index 2): Receptors, state progressions & salvage
    { s: "norepinephrine", t: "ADRA1",          sign:  1, born: 2, curve:  0 },
    { s: "ADRA1",          t: "SVR",            sign:  1, born: 2, curve: -4 },
    { s: "SVR",            t: "MAP",            sign:  1, born: 2, curve:  0 },
    { s: "epinephrine",    t: "ADRB2",          sign:  1, born: 2, curve:  0 },
    { s: "ADRB2",          t: "DBP",            sign: -1, born: 2, curve: -6 },
    { s: "hypovolemia",    t: "cardiac_arrest", sign:  0, born: 2, curve:  0, salvageAt: 2, salvageLbl: "Kept link; timing cleared", salDx: 4, salDy: 0 },
    { s: "CHRN",           t: "vent_drive",     sign: -1, born: 2, curve:  0, droppedAt: 2, dropLbl: "✕ Removed (muscle ≠ CNS)", dropDy: -14 },
    { s: "GRIN",           t: "MAP",            sign:  1, born: 2, curve: 14, droppedAt: 2, dropLbl: "✕ Removed (not NMDA)", dropDy: 14 },

    // Step 5 (index 4): FDA dual reversals & perioperative OR
    { s: "epinephrine",     t: "DBP", sign: -1, born: 4, curve: -28, revLbl: "low dose β2 (−1)", revDy: -11 },
    { s: "epinephrine",     t: "DBP", sign:  1, born: 4, curve:  28, revLbl: "high dose α1 (+1)", revDy: 13 },
    { s: "dexmedetomidine", t: "MAP", sign:  1, born: 4, curve: -28, revLbl: "loading bolus (+1)", revDy: -11 },
    { s: "ketamine",        t: "MAP", sign: -1, born: 4, curve:  28, revLbl: "catecholamine-depleted (−1)", revDy: 14 },
    { s: "sevoflurane",     t: "SVR", sign: -1, born: 4, curve: -24 },
    { s: "sevoflurane",     t: "class_vol", sign: 0, born: 4, curve: 0, danglingAt: 4 },
  ];

  const evoNodeById = new Map(EVO_NODES.map((n) => [n.id, n]));

  const PRIMEKG_DOTS = Array.from({ length: 40 }, (_, k) => {
    const kept = k < 12;
    const drugIds = ["norepinephrine", "epinephrine", "dexmedetomidine", "ketamine"];
    const ang = (k * 2.39996) % (Math.PI * 2);
    return {
      kept,
      anchor: drugIds[k % drugIds.length],
      ang,
      dist: kept ? 22 + (k % 3) * 6 : 58 + (k % 5) * 20,
      startX: 0.02 + ((k * 37) % 100) * 0.0018,
      startY: 0.16 + ((k * 53) % 100) * 0.007,
    };
  });

  function buildStepper() {
    const el = document.getElementById("stageStepper");
    el.innerHTML = DATA.stages.map((st, i) => `
      <button class="step-btn ${i === pipeState.idx ? "active" : ""} ${i < pipeState.idx ? "passed" : ""}" data-idx="${i}">
        <span class="step-num">STEP 0${i + 1}</span>
        <span class="step-short">${esc(st.short)}</span>
        <span class="step-stat">${st.nodes} nodes · ${st.edges} edges</span>
      </button>
    `).join("");
    el.querySelectorAll(".step-btn").forEach((b) => {
      b.addEventListener("click", () => {
        stopPipePlay();
        setPipeStage(Number(b.dataset.idx));
      });
    });
  }

  function setPipeStage(i) {
    pipeState.idx = (i + DATA.stages.length) % DATA.stages.length;
    pipeState.stageAnim = 0;
    buildStepper();
    renderStageDetail(pipeState.idx);
  }

  function renderStageDetail(i) {
    const st = DATA.stages[i];
    document.getElementById("stageTitle").textContent = st.title;
    document.getElementById("stageSummary").textContent = st.summary;
    document.getElementById("stageSources").textContent = "Sources: " + st.sources.join("  ·  ");
    document.getElementById("stageInputs").innerHTML = st.inputs.map((x) => `<li>${esc(x)}</li>`).join("");
    document.getElementById("stageRules").innerHTML = st.rules.map((r) => `<li>${esc(r)}</li>`).join("");
    document.getElementById("stageOutput").textContent = st.output;
    if (st.sample_io) {
      document.getElementById("stageSampleIO").innerHTML =
        `<span class="io-in">BEFORE ▸ ${esc(st.sample_io.in)}</span>` +
        `<span class="io-out">AFTER  ▸ ${esc(st.sample_io.out)}</span>`;
    }
    document.getElementById("stageMetrics").innerHTML = `
      <div class="im-item"><span class="im-val">${st.nodes.toLocaleString()}</span><span class="im-lbl">Nodes</span></div>
      <div class="im-item"><span class="im-val">${st.edges.toLocaleString()}</span><span class="im-lbl">Edges</span></div>
      <div class="im-item"><span class="im-val">${st.hyperedges}</span><span class="im-lbl">Hyperedges</span></div>
      <div class="im-item"><span class="im-val" style="color:${st.conflicts ? COLORS.cardinal : COLORS.ink}">${st.conflicts}</span><span class="im-lbl">Conflicts Logged</span></div>
    `;
    document.getElementById("stageHighlightLinks").innerHTML = st.highlight_nodes.map((nid) =>
      `<button class="node-link-btn" data-jump="${esc(nid)}">${esc(nid)} →</button>`
    ).join("");
    document.querySelectorAll("#stageHighlightLinks .node-link-btn").forEach((b) => {
      b.addEventListener("click", () => jumpToNodeInExplorer(b.dataset.jump));
    });
  }

  function stopPipePlay() {
    pipeState.playing = false;
    clearInterval(pipeState.timer);
    pipeState.timer = null;
    document.getElementById("btnPipePlay").textContent = "▶ Play";
  }

  document.getElementById("btnPipePlay").addEventListener("click", () => {
    if (pipeState.playing) {
      stopPipePlay();
    } else {
      pipeState.playing = true;
      document.getElementById("btnPipePlay").textContent = "❚❚ Pause";
      if (pipeState.idx === DATA.stages.length - 1) setPipeStage(0);
      pipeState.timer = setInterval(() => {
        if (pipeState.idx >= DATA.stages.length - 1) stopPipePlay();
        else setPipeStage(pipeState.idx + 1);
      }, 4200);
    }
  });
  document.getElementById("btnPipePrev").addEventListener("click", () => { stopPipePlay(); setPipeStage(pipeState.idx - 1); });
  document.getElementById("btnPipeNext").addEventListener("click", () => { stopPipePlay(); setPipeStage(pipeState.idx + 1); });

  function resizePipeCanvas() {
    const rect = pipeCanvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pipeState.w = Math.max(700, rect.width);
    pipeState.h = Math.max(430, rect.height);
    pipeCanvas.width = pipeState.w * dpr;
    pipeCanvas.height = pipeState.h * dpr;
    pipeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function easeOutCubic(x) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3); }

  // Helper: crisp text directly on white canvas with subtle white halo (ZERO colored background box!)
  function drawHaloText(ctx, text, x, y, color, font, align = "center") {
    ctx.font = font;
    ctx.textAlign = align;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // Helper: sleek directional arrowhead on quadratic Bezier
  function drawArrowOnQuad(ctx, ax, ay, mx, my, bx, by, color, tPos = 0.86, sz = 5.5) {
    const u = 1 - tPos;
    const px = u*u*ax + 2*u*tPos*mx + tPos*tPos*bx;
    const py = u*u*ay + 2*u*tPos*my + tPos*tPos*by;
    const tx = 2*u*(mx - ax) + 2*tPos*(bx - mx);
    const ty = 2*u*(my - ay) + 2*tPos*(by - my);
    const ang = Math.atan2(ty, tx);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - sz * Math.cos(ang - 0.42), py - sz * Math.sin(ang - 0.42));
    ctx.lineTo(px - sz * Math.cos(ang + 0.42), py - sz * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();
  }

  function drawPipelineFrame() {
    if (ACTIVE_VIEW !== "pipeline") return;
    const ctx = pipeCtx;
    const W = pipeState.w, H = pipeState.h;
    const S = pipeState.idx;
    const st = DATA.stages[S];
    pipeState.t += 0.016;
    if (pipeState.stageAnim < 1) pipeState.stageAnim = Math.min(1, pipeState.stageAnim + 0.022);
    const anim = easeOutCubic(pipeState.stageAnim);

    pipeState.dispNodes += (st.nodes - pipeState.dispNodes) * 0.14;
    pipeState.dispEdges += (st.edges - pipeState.dispEdges) * 0.14;
    pipeState.dispHypers += (st.hyperedges - pipeState.dispHypers) * 0.14;

    ctx.clearRect(0, 0, W, H);

    // Full canvas dedicated to ONE continuous spacious living graph (zero duplicate stepper header!)
    const gTop = 44, gBot = H - 38;
    const posOf = (n) => ({ x: n.x * W, y: gTop + (n.y - 0.12) * ((gBot - gTop) / 0.84) });

    // Clean column headers (pure typography, zero shading)
    const cols = [
      { x: 0.085, lbl: "DRUGS" },
      { x: 0.275, lbl: S >= 2 ? "RECEPTORS" : "" },
      { x: 0.485, lbl: "PHYSIOLOGY & VITALS" },
      { x: 0.695, lbl: S >= 1 ? "CLINICAL STATES" : "" },
      { x: 0.890, lbl: "CUMULATIVE SCALE" },
    ];
    cols.forEach((c) => {
      if (c.lbl) drawHaloText(ctx, c.lbl, c.x * W, 20, COLORS.muted, "600 10px ui-monospace, Consolas, monospace");
    });

    // ---- Step 1+: PrimeKG satellite halo around drugs ----
    PRIMEKG_DOTS.forEach((d) => {
      const anch = evoNodeById.get(d.anchor);
      if (!anch) return;
      const ap = posOf(anch);
      if (d.kept) {
        const p = S === 0 ? anim : 1;
        const tx = ap.x + Math.cos(d.ang) * d.dist;
        const ty = ap.y + Math.sin(d.ang) * d.dist;
        const cx = d.startX * W + (tx - d.startX * W) * p;
        const cy = (gTop + d.startY * (gBot - gTop)) + (ty - (gTop + d.startY * (gBot - gTop))) * p;
        ctx.beginPath();
        ctx.moveTo(ap.x, ap.y); ctx.lineTo(cx, cy);
        ctx.strokeStyle = S === 0 ? "rgba(29,78,120,0.24)" : "rgba(148,163,184,0.18)";
        ctx.lineWidth = 0.85;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = S === 0 ? COLORS.steel : "#cbd5e1";
        ctx.fill();
      } else if (S === 0) {
        const rejectT = Math.min(1, pipeState.stageAnim * 1.15);
        const cx = d.startX * W + 115 * rejectT;
        const cy = gTop + d.startY * (gBot - gTop) + Math.sin(d.ang) * 26 * rejectT;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(140,21,21,${Math.max(0.05, 0.48 * (1 - rejectT))})`;
        ctx.fill();
      }
    });
    if (S === 0) {
      drawHaloText(ctx, "✕ >99.9% non-ICU PrimeKG triples discarded", W * 0.24, H - 54, COLORS.cardinal, "600 10.5px -apple-system, Arial, sans-serif", "left");
    }

    // ---- Step 5+: Subtle Context-Modifier Hyperedge Contour (no heavy fill!) ----
    if (S >= 4) {
      const hAlpha = S === 4 ? anim : 1;
      const pNE = posOf(evoNodeById.get("norepinephrine"));
      const pSS = posOf(evoNodeById.get("septic_shock"));
      const pMAP = posOf(evoNodeById.get("MAP"));
      ctx.save();
      ctx.globalAlpha = 0.58 * hAlpha;
      ctx.strokeStyle = COLORS.ochre;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pNE.x - 26, pNE.y - 22);
      ctx.quadraticCurveTo(pMAP.x, pNE.y - 46, pSS.x + 28, pSS.y - 22);
      ctx.quadraticCurveTo(pSS.x + 22, pMAP.y + 30, pMAP.x, pMAP.y + 24);
      ctx.quadraticCurveTo(pNE.x - 18, pMAP.y + 8, pNE.x - 26, pNE.y - 22);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      drawHaloText(ctx, "Context hyperedge: septic shock blunts NE pressor response", W * 0.60, 42, COLORS.ochre, "600 10px -apple-system, Arial, sans-serif");
      ctx.restore();
    }

    // ---- Clean minimalist live numerical readout on right across all 6 steps ----
    const rx = W * 0.89;
    drawHaloText(ctx, `${Math.round(pipeState.dispNodes)}`, rx, 118, COLORS.ink, "700 24px ui-monospace, Consolas, monospace");
    drawHaloText(ctx, "NODES", rx, 136, COLORS.muted, "600 9.5px ui-monospace, Consolas, monospace");
    drawHaloText(ctx, `${Math.round(pipeState.dispEdges)}`, rx, 188, COLORS.steel, "700 24px ui-monospace, Consolas, monospace");
    drawHaloText(ctx, "EDGES", rx, 206, COLORS.muted, "600 9.5px ui-monospace, Consolas, monospace");
    drawHaloText(ctx, `${Math.round(pipeState.dispHypers)}`, rx, 256, COLORS.ochre, "700 20px ui-monospace, Consolas, monospace");
    drawHaloText(ctx, "HYPEREDGES", rx, 274, COLORS.muted, "600 9.5px ui-monospace, Consolas, monospace");
    if (S >= 3) {
      drawHaloText(ctx, "17", rx, 322, COLORS.cardinal, "700 20px ui-monospace, Consolas, monospace");
      drawHaloText(ctx, "CONFLICTS LOGGED", rx, 340, COLORS.muted, "600 9.5px ui-monospace, Consolas, monospace");
      if (S === 3) {
        drawHaloText(ctx, "872 studies attached", rx, 376, COLORS.steel, "600 10px -apple-system, Arial, sans-serif");
        drawHaloText(ctx, "112 flagged (audit only)", rx, 392, COLORS.ochre, "600 10px -apple-system, Arial, sans-serif");
      }
    }

    // ---- Draw Continuous Edges (Zero Text Background Boxes) ----
    const pendingLabels = [];
    EVO_EDGES.forEach((e, ei) => {
      if (S < e.born) return;
      if (e.droppedAt !== undefined && S > e.droppedAt) return;

      const sn = evoNodeById.get(e.s);
      const tn = evoNodeById.get(e.t);
      if (!sn || !tn) return;
      const a = posOf(sn);
      const b = posOf(tn);

      const isNew = S === e.born;
      const isDroppingNow = e.droppedAt === S;
      const isDanglingNow = e.danglingAt === S;
      const isSalvagedNow = e.salvageAt === S;
      const isConflict = e.conflictAt !== undefined && S >= e.conflictAt;

      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const curve = (e.curve || 0) * (isNew ? anim : 1);
      const mx = (a.x + b.x) / 2 - (dy / dist) * curve;
      const my = (a.y + b.y) / 2 + (dx / dist) * curve;

      let stroke = e.sign > 0 ? COLORS.steel : (e.sign < 0 ? COLORS.cardinal : COLORS.slate);
      let lw = isNew ? 2.2 : 1.35;
      let alpha = isNew ? anim : 0.68;
      let dashed = e.sign < 0;

      if (isDroppingNow) {
        stroke = COLORS.cardinal;
        lw = 1.9;
        dashed = true;
        alpha = Math.max(0.22, 1.0 - Math.max(0, pipeState.stageAnim - 0.35) * 1.05);
      } else if (isDanglingNow) {
        stroke = COLORS.cardinal;
        dashed = true;
        lw = 1.9;
      } else if (isSalvagedNow) {
        stroke = COLORS.ochre;
        lw = 2.2;
      } else if (S === 5 && e.danglingAt === 4) {
        stroke = COLORS.steel;
        lw = 2.2;
        dashed = false;
      }

      // Duplicate edge ghost at Step 5 that snaps & merges cleanly at Step 6
      if (e.dupAt === 4 && (S === 4 || S === 5)) {
        const sep = S === 4 ? 11 : 11 * (1 - anim);
        if (sep > 0.6) {
          ctx.save();
          ctx.globalAlpha = S === 4 ? 0.6 : 0.6 * (1 - anim);
          ctx.strokeStyle = COLORS.ochre;
          ctx.lineWidth = 1.4;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(mx, my - sep, b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
          if (S === 4) pendingLabels.push({ txt: "24 duplicate edges", x: W * 0.38, y: my - sep - 8, col: COLORS.ochre });
        }
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      if (dashed) ctx.setLineDash([5, 3.5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!isDroppingNow && !isDanglingNow && dist > 32) {
        drawArrowOnQuad(ctx, a.x, a.y, mx, my, b.x, b.y, stroke, 0.84, isNew ? 6 : 4.8);
      }

      // Smooth flowing causal dot on active signed edges
      if (!isDroppingNow && !isDanglingNow && (e.sign === 1 || e.sign === -1)) {
        const u = (pipeState.t * 0.42 + ei * 0.19) % 1;
        const v = 1 - u;
        const px = v*v*a.x + 2*v*u*mx + u*u*b.x;
        const py = v*v*a.y + 2*v*u*my + u*u*b.y;
        ctx.beginPath();
        ctx.arc(px, py, isNew ? 3.0 : 2.1, 0, Math.PI * 2);
        ctx.fillStyle = stroke;
        ctx.fill();
      }
      ctx.restore();

      // Queue non-overlapping pure-text labels (rendered on top after nodes, zero boxes!)
      const lx = mx + (e.salDx || 0);
      const ly = my;
      if (isDroppingNow && e.dropLbl) {
        pendingLabels.push({ txt: e.dropLbl, x: lx, y: ly + (e.dropDy || -9), col: COLORS.cardinal });
      } else if (isSalvagedNow && e.salvageLbl) {
        pendingLabels.push({ txt: e.salvageLbl, x: lx, y: ly + (e.salDy || 0), col: COLORS.ochre });
      } else if (isConflict && S === 3 && e.conflictLbl) {
        pendingLabels.push({ txt: e.conflictLbl, x: lx, y: ly + (e.confDy || 0), col: COLORS.cardinal });
      } else if (S === 4 && e.revLbl) {
        const ySlots = { "loading bolus (+1)": 0.42, "low dose β2 (−1)": 0.49, "high dose α1 (+1)": 0.56, "catecholamine-depleted (−1)": 0.69 };
        const sy = gTop + ((ySlots[e.revLbl] || 0.55) - 0.12) * ((gBot - gTop) / 0.84);
        pendingLabels.push({ txt: e.revLbl, x: W * 0.38, y: sy, col: stroke });
      } else if (S === 4 && e.tagAt4) {
        const sy = gTop + (0.625 - 0.12) * ((gBot - gTop) / 0.84);
        pendingLabels.push({ txt: e.tagAt4, x: W * 0.38, y: sy, col: stroke });
      } else if (isDanglingNow) {
        pendingLabels.push({ txt: "dangling link", x: lx, y: ly - 9, col: COLORS.cardinal });
      } else if (S === 5 && e.danglingAt === 4) {
        pendingLabels.push({ txt: "✓ link repaired", x: lx, y: ly - 9, col: COLORS.steel });
      } else if (S === 5 && e.dupAt === 4) {
        pendingLabels.push({ txt: "✓ 24 duplicates merged", x: W * 0.38, y: ly - 11, col: COLORS.steel });
      }
    });

    // Step 6: Delicate vertical audit scan hairline
    if (S === 5 && pipeState.stageAnim < 0.98) {
      const scanX = W * (0.04 + 0.76 * anim);
      ctx.save();
      ctx.strokeStyle = "rgba(29,78,120,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(scanX, 34); ctx.lineTo(scanX, H - 36);
      ctx.stroke();
      ctx.restore();
    }

    // ---- Draw Refined Editorial Nodes ----
    EVO_NODES.forEach((n) => {
      const isDanglingGhost = n.danglingAt === S;
      if (S < n.born && !isDanglingGhost) return;
      if (n.ghostAfter !== undefined && S > n.ghostAfter) return;
      if (n.prunedAt !== undefined && S > n.prunedAt) return;

      const p = posOf(n);
      const stN = NODE_TYPE_STYLE[n.type] || { color: COLORS.slate, r: 6 };
      const isNew = S === n.born;
      const isPruning = n.prunedAt === S;

      let alpha = isNew ? anim : 1.0;
      const r = (n.type === "observed_variable" ? 8.5 : 7.0) * (isNew ? (0.45 + 0.55 * anim) : 1);
      if (isPruning) alpha = Math.max(0.18, 1.0 - Math.max(0, pipeState.stageAnim - 0.25) * 1.1);

      ctx.save();
      ctx.globalAlpha = alpha;

      // Clean double-ring editorial node style
      if (isNew && S > 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4.5 + Math.sin(pipeState.t * 3.5) * 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(29,78,120,0.32)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (isDanglingGhost) {
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.setLineDash([2.5, 2.5]);
        ctx.strokeStyle = COLORS.cardinal;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = isPruning ? COLORS.cardinal : stN.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }

      const labelTxt = isDanglingGhost ? "missing class?" : (isPruning ? "✕ MONDO:0002243 (pruned)" : n.lbl);
      const lCol = (isDanglingGhost || isPruning) ? COLORS.cardinal : COLORS.ink;
      drawHaloText(ctx, labelTxt, p.x, p.y - r - 5, lCol, isNew ? "700 11px -apple-system, Arial, sans-serif" : "600 10.5px -apple-system, Arial, sans-serif");
      ctx.restore();
    });

    // Draw queued edge labels cleanly on top (pure halo text, ZERO background boxes!)
    pendingLabels.forEach((lb) => {
      drawHaloText(ctx, lb.txt, lb.x, lb.y, lb.col, "600 10px -apple-system, Arial, sans-serif");
    });

    // Final Step 6 crisp summary line in bottom-right
    if (S === 5) {
      ctx.save();
      ctx.globalAlpha = anim;
      drawHaloText(ctx, "✓ Final Audited Clinical KG · 985 nodes · 3,964 edges · 152 hyperedges · 0 structural defects", W - 12, H - 11, COLORS.steel, "600 11px ui-monospace, Consolas, monospace", "right");
      ctx.restore();
    }
  }

  // ============================================================================
  // VIEW 02: INTERACTIVE GRAPH EXPLORER (985 NODES, 3,964 EDGES)
  // ============================================================================
  const graphCanvas = document.getElementById("graphCanvas");
  const gCtx = graphCanvas.getContext("2d");

  const PRESETS = [
    { id: "core",         lbl: "Clinical Core (Active)",     badge: "262N" },
    { id: "full",         lbl: "Full KG Topology",           badge: "985N" },
    { id: "vasopressors", lbl: "Vasopressors → Hemodynamics",badge: "Sub"  },
    { id: "reversals",    lbl: "Dose / Phase Sign Reversals",badge: "8×2"  },
    { id: "conflicts",    lbl: "All 17 Logged Conflicts",    badge: "17"   },
    { id: "sepsis",       lbl: "Septic Shock Cascade",       badge: "Sub"  },
    { id: "vitaldb",      lbl: "Perioperative OR Extension", badge: "OR"   },
  ];

  const graphState = {
    preset: "core",
    visibleNodeIds: new Set(),
    visibleEdges: [],
    positions: new Map(),
    targets: new Map(),
    cam: { x: 0, y: 0, scale: 0.72 },
    camTarget: { x: 0, y: 0, scale: 0.72 },
    w: 900, h: 650,
    hoveredNode: null, hoveredEdge: null,
    selectedNode: null, selectedEdge: null,
    draggingNode: null, panning: false,
    lastMouse: { x: 0, y: 0 }, dragMoved: false,
    pulsePhase: 0, pathHighlight: null,
  };

  DATA.nodes.forEach((n) => {
    const p = n.pCore || n.pFull;
    graphState.positions.set(n.id, { x: p[0] * 420, y: p[1] * 420 });
    graphState.targets.set(n.id, { x: p[0] * 420, y: p[1] * 420 });
  });

  function renderPresets() {
    const el = document.getElementById("presetList");
    el.innerHTML = PRESETS.map((p) => `
      <button class="preset-btn ${p.id === graphState.preset ? "active" : ""}" data-preset="${p.id}">
        <span>${p.lbl}</span><small>${p.badge}</small>
      </button>
    `).join("");
    el.querySelectorAll(".preset-btn").forEach((b) => b.addEventListener("click", () => selectPreset(b.dataset.preset, true)));
  }

  function renderNodeLegend() {
    const show = ["drug", "observed_variable", "latent_physiological", "state", "receptor", "intervention", "drug_class", "protein"];
    document.getElementById("nodeLegend").innerHTML = show.map((t) => {
      const s = NODE_TYPE_STYLE[t];
      return `<div class="nl-item"><span class="nl-dot" style="background:${s.color}"></span><span>${s.label}</span></div>`;
    }).join("");
  }

  function layoutSubsetCleanly(nids) {
    const layers = {
      drug: 0, intervention: 0, drug_class: 0,
      receptor: 1, protein: 1,
      latent_physiological: 2,
      observed_variable: 3, derived_variable: 3, clinical_quantity: 3,
      state: 4, organ_system: 4, adverse_effect: 4,
    };
    const buckets = [[], [], [], [], []];
    Array.from(nids).forEach((id) => {
      const n = nodeById.get(id);
      buckets[layers[n ? n.type : "state"] ?? 2].push(id);
    });
    const nonEmpty = buckets.map((b, i) => ({ b, i })).filter((o) => o.b.length > 0);
    const xSpan = Math.min(740, Math.max(460, nonEmpty.length * 170));
    nonEmpty.forEach((col, ci) => {
      const x = nonEmpty.length === 1 ? 0 : -xSpan / 2 + (ci / (nonEmpty.length - 1)) * xSpan;
      col.b.sort((a, b) => (nodeById.get(b)?.sdeg || 0) - (nodeById.get(a)?.sdeg || 0));
      const ySpan = Math.min(540, Math.max(120, (col.b.length - 1) * 58));
      col.b.forEach((id, ri) => {
        const y = col.b.length === 1 ? 0 : -ySpan / 2 + (ri / (col.b.length - 1)) * ySpan;
        graphState.targets.set(id, { x, y });
      });
    });
  }

  function selectPreset(presetId, resetSelection = true) {
    graphState.preset = presetId;
    if (resetSelection) {
      graphState.selectedNode = null;
      graphState.selectedEdge = null;
      graphState.pathHighlight = null;
      document.getElementById("pathSummary").classList.add("hidden");
    }
    renderPresets();

    const nSet = new Set();
    let eList = [];
    if (presetId === "full") {
      DATA.nodes.forEach((n) => { nSet.add(n.id); graphState.targets.set(n.id, { x: n.pFull[0] * 560, y: n.pFull[1] * 560 }); });
      eList = DATA.edges;
      graphState.camTarget = { x: 0, y: 0, scale: 0.54 };
    } else if (presetId === "core") {
      DATA.nodes.forEach((n) => {
        if (n.tier === "core_1m_causal") {
          nSet.add(n.id);
          const p = n.pCore || n.pFull;
          graphState.targets.set(n.id, { x: p[0] * 460, y: p[1] * 460 });
        }
      });
      eList = DATA.edges.filter((e) => nSet.has(e.s) && nSet.has(e.t));
      graphState.camTarget = { x: 0, y: 0, scale: 0.68 };
    } else if (presetId === "vasopressors") {
      ["norepinephrine", "epinephrine", "phenylephrine", "vasopressin", "dopamine", "dobutamine", "milrinone",
        "receptor:ADRA1", "receptor:ADRB1", "receptor:ADRB2", "receptor:AVPR1A", "receptor:PDE3",
        "SVR", "CO", "contractility", "MAP", "SBP", "DBP", "HR", "CVP", "PAWP"].forEach((id) => { if (nodeById.has(id)) nSet.add(id); });
      eList = DATA.edges.filter((e) => nSet.has(e.s) && nSet.has(e.t) && (e.sign === 1 || e.sign === -1 || e.r.includes("agonist") || e.r.includes("activation") || e.r.includes("inhibitor")));
      layoutSubsetCleanly(nSet);
      graphState.camTarget = { x: 0, y: 0, scale: 0.92 };
    } else if (presetId === "reversals") {
      const pairKeys = new Set(DATA.reversals.map((r) => r.src + "->" + r.dst));
      eList = DATA.edges.filter((e) => pairKeys.has(e.s + "->" + e.t));
      eList.forEach((e) => { nSet.add(e.s); nSet.add(e.t); });
      ["receptor:ADRA1", "receptor:ADRB2", "receptor:ADRA2"].forEach((rid) => { if (nodeById.has(rid)) nSet.add(rid); });
      eList = DATA.edges.filter((e) => nSet.has(e.s) && nSet.has(e.t) && (pairKeys.has(e.s + "->" + e.t) || e.t.startsWith("receptor:") || e.s.startsWith("receptor:")));
      layoutSubsetCleanly(nSet);
      graphState.camTarget = { x: 0, y: 0, scale: 1.05 };
    } else if (presetId === "conflicts") {
      eList = DATA.edges.filter((e) => e.confs && e.confs.length > 0);
      eList.forEach((e) => { nSet.add(e.s); nSet.add(e.t); });
      layoutSubsetCleanly(nSet);
      graphState.camTarget = { x: 0, y: 0, scale: 0.95 };
    } else if (presetId === "sepsis") {
      ["sepsis", "septic_shock", "refractory_septic_shock", "vasoplegic_syndrome", "metabolic_acidosis", "hypovolemia", "MODS", "death",
        "norepinephrine", "vasopressin", "hydrocortisone", "epinephrine", "crystalloid", "antibiotics",
        "SVR", "CO", "MAP", "HR", "CVP", "lactate", "RR", "SBP"].forEach((id) => { if (nodeById.has(id)) nSet.add(id); });
      eList = DATA.edges.filter((e) => nSet.has(e.s) && nSet.has(e.t));
      layoutSubsetCleanly(nSet);
      graphState.camTarget = { x: 0, y: 0, scale: 0.88 };
    } else if (presetId === "vitaldb") {
      ["sevoflurane", "desflurane", "remifentanil", "propofol", "phenylephrine", "ephedrine", "norepinephrine",
        "class:volatile_anaesthetic", "vent_peep", "PEEP", "mechanical_ventilation", "intrathoracic_pressure",
        "SVR", "PVR", "CO", "CVP", "MAP", "SBP", "DBP", "HR", "RR", "SpO2", "hypotension"].forEach((id) => { if (nodeById.has(id)) nSet.add(id); });
      eList = DATA.edges.filter((e) => nSet.has(e.s) && nSet.has(e.t));
      layoutSubsetCleanly(nSet);
      graphState.camTarget = { x: 0, y: 0, scale: 0.9 };
    }

    graphState.visibleNodeIds = nSet;
    graphState.visibleEdges = eList;
    const nS = eList.filter((e) => e.sign === 1 || e.sign === -1).length;
    document.getElementById("graphStatusText").textContent = `Showing ${nSet.size} nodes · ${eList.length} edges (${nS} signed causal) · 152 hyperedges indexed`;
    if (resetSelection) renderDefaultInspector();
  }

  function resizeGraphCanvas() {
    const rect = graphCanvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    graphState.w = Math.max(400, rect.width);
    graphState.h = Math.max(400, rect.height);
    graphCanvas.width = graphState.w * dpr;
    graphCanvas.height = graphState.h * dpr;
    gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen(wx, wy) {
    return { x: (wx - graphState.cam.x) * graphState.cam.scale + graphState.w / 2, y: (wy - graphState.cam.y) * graphState.cam.scale + graphState.h / 2 };
  }
  function screenToWorld(sx, sy) {
    return { x: (sx - graphState.w / 2) / graphState.cam.scale + graphState.cam.x, y: (sy - graphState.h / 2) / graphState.cam.scale + graphState.cam.y };
  }
  function focusCameraOnNode(nid, zoom = 1.9) {
    const p = graphState.targets.get(nid) || graphState.positions.get(nid);
    if (p) graphState.camTarget = { x: p.x, y: p.y, scale: zoom };
  }

  function getFilteredEdges() {
    const showPos = document.getElementById("fltPos").checked;
    const showNeg = document.getElementById("fltNeg").checked;
    const showOth = document.getElementById("fltOther").checked;
    return graphState.visibleEdges.filter((e) => e.sign === 1 ? showPos : (e.sign === -1 ? showNeg : showOth));
  }

  function drawGraphFrame() {
    if (ACTIVE_VIEW !== "explorer") return;
    const ctx = gCtx;
    const W = graphState.w, H = graphState.h;
    graphState.pulsePhase = (graphState.pulsePhase + 0.008) % 1;

    graphState.cam.x += (graphState.camTarget.x - graphState.cam.x) * 0.14;
    graphState.cam.y += (graphState.camTarget.y - graphState.cam.y) * 0.14;
    graphState.cam.scale += (graphState.camTarget.scale - graphState.cam.scale) * 0.14;

    graphState.visibleNodeIds.forEach((id) => {
      if (id === graphState.draggingNode) return;
      const cur = graphState.positions.get(id), tgt = graphState.targets.get(id);
      if (cur && tgt) { cur.x += (tgt.x - cur.x) * 0.14; cur.y += (tgt.y - cur.y) * 0.14; }
    });

    ctx.clearRect(0, 0, W, H);
    const edges = getFilteredEdges();
    const showPulses = document.getElementById("fltPulses").checked;
    const showLabels = document.getElementById("fltLabels").checked;

    let focusNodes = null, focusEdgeIdxs = null;
    if (graphState.pathHighlight) {
      focusNodes = graphState.pathHighlight.nodes;
      focusEdgeIdxs = graphState.pathHighlight.edges;
    } else if (graphState.selectedNode) {
      focusNodes = new Set([graphState.selectedNode]);
      focusEdgeIdxs = new Set();
      edges.forEach((e) => {
        if (e.s === graphState.selectedNode || e.t === graphState.selectedNode) {
          focusNodes.add(e.s); focusNodes.add(e.t); focusEdgeIdxs.add(e.i);
        }
      });
    } else if (graphState.selectedEdge !== null) {
      const se = DATA.edges[graphState.selectedEdge];
      if (se) { focusNodes = new Set([se.s, se.t]); focusEdgeIdxs = new Set([se.i]); }
    }

    const pairCounts = new Map();
    edges.forEach((e) => { const k = e.s < e.t ? `${e.s}|${e.t}` : `${e.t}|${e.s}`; pairCounts.set(k, (pairCounts.get(k) || 0) + 1); });
    const pairSeen = new Map();
    const isFull = graphState.preset === "full";
    const edgeLabels = [];

    edges.forEach((e) => {
      const ps = graphState.positions.get(e.s), pt = graphState.positions.get(e.t);
      if (!ps || !pt) return;
      const a = worldToScreen(ps.x, ps.y), b = worldToScreen(pt.x, pt.y);
      if ((a.x < -80 && b.x < -80) || (a.x > W + 80 && b.x > W + 80) || (a.y < -80 && b.y < -80) || (a.y > H + 80 && b.y > H + 80)) return;

      const isFocus = !focusEdgeIdxs || focusEdgeIdxs.has(e.i);
      const isSelected = graphState.selectedEdge === e.i || graphState.hoveredEdge === e.i;
      const k = e.s < e.t ? `${e.s}|${e.t}` : `${e.t}|${e.s}`;
      const totalP = pairCounts.get(k) || 1;
      const idxP = pairSeen.get(k) || 0;
      pairSeen.set(k, idxP + 1);

      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1;
      let curve = totalP > 1 ? (idxP - (totalP - 1) / 2) * 34 : ((e.sign === 1 || e.sign === -1) ? Math.min(16, dist * 0.07) : 0);
      const mx = (a.x + b.x) / 2 - (dy / dist) * curve;
      const my = (a.y + b.y) / 2 + (dx / dist) * curve;

      let stroke = "#d4dae3", alpha = isFull ? 0.20 : 0.34, lw = isFull ? 0.7 : 1.0;
      if (e.sign === 1) { stroke = COLORS.steel; alpha = isFull ? 0.34 : 0.60; lw = isFull ? 1.0 : 1.4; }
      else if (e.sign === -1) { stroke = COLORS.cardinal; alpha = isFull ? 0.34 : 0.62; lw = isFull ? 1.0 : 1.4; }
      if (e.confs && e.confs.length > 0 && graphState.preset === "conflicts") { stroke = COLORS.cardinal; alpha = 0.85; lw = 1.9; }
      if (focusEdgeIdxs) { alpha = isFocus ? 0.92 : 0.05; lw = isFocus ? Math.max(lw, 2.0) : 0.6; }
      if (isSelected) { alpha = 1.0; lw = 2.8; }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      if (e.sign === -1) ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if ((e.sign === 1 || e.sign === -1 || isFocus) && (!isFull || isFocus) && dist > 26) {
        drawArrowOnQuad(ctx, a.x, a.y, mx, my, b.x, b.y, stroke, 0.84, isSelected ? 7.2 : 5.2);
      }

      if (showPulses && (e.sign === 1 || e.sign === -1) && (!isFull || isFocus) && isFocus && dist > 30) {
        const pT = (graphState.pulsePhase + (e.i * 0.137)) % 1;
        const u = 1 - pT;
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = stroke;
        ctx.beginPath();
        ctx.arc(u*u*a.x + 2*u*pT*mx + pT*pT*b.x, u*u*a.y + 2*u*pT*my + pT*pT*b.y, focusEdgeIdxs ? 3.0 : 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if ((graphState.preset === "reversals" || isSelected || (graphState.pathHighlight && isFocus)) && dist > 60) {
        const tag = e.sign === 1 ? `+1 ${e.cond ? "(" + e.cond.slice(0, 20) + ")" : e.r}`
                  : e.sign === -1 ? `−1 ${e.cond ? "(" + e.cond.slice(0, 20) + ")" : e.r}` : e.r;
        edgeLabels.push({ txt: tag, x: mx, y: my - 4, col: e.sign === 1 ? COLORS.steel : (e.sign === -1 ? COLORS.cardinal : COLORS.ochre) });
      }
    });

    const labelsToDraw = [];
    graphState.visibleNodeIds.forEach((id) => {
      const n = nodeById.get(id), p = graphState.positions.get(id);
      if (!n || !p) return;
      const sc = worldToScreen(p.x, p.y);
      if (sc.x < -40 || sc.x > W + 40 || sc.y < -40 || sc.y > H + 40) return;

      const style = NODE_TYPE_STYLE[n.type] || { color: COLORS.slate, r: 4.5 };
      const r = Math.max(2.6, (style.r * (isFull ? 0.72 : 1.0) + Math.min(4.2, Math.sqrt(n.sdeg) * 0.65)) * Math.min(1.5, Math.max(0.7, graphState.cam.scale)));
      const isSel = graphState.selectedNode === id, isHov = graphState.hoveredNode === id;
      const isFoc = !focusNodes || focusNodes.has(id);

      ctx.save();
      ctx.globalAlpha = isFoc ? 1.0 : 0.12;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();
      ctx.lineWidth = isSel ? 2.4 : (isHov ? 2.0 : 1.3);
      ctx.strokeStyle = isSel ? COLORS.ink : "#ffffff";
      ctx.stroke();
      if (isSel) {
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.cardinal;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      ctx.restore();

      const shouldLabel = showLabels && (
        isSel || isHov || (focusNodes && isFoc) ||
        (!isFull && graphState.visibleNodeIds.size <= 45) ||
        (n.sdeg >= 8 && graphState.cam.scale >= 0.62) ||
        (n.tier === "core_1m_causal" && graphState.cam.scale >= 1.15)
      );
      if (shouldLabel && isFoc) labelsToDraw.push({ text: id, x: sc.x, y: sc.y - r - 4, bold: isSel || isHov || n.type === "observed_variable" });
    });

    edgeLabels.forEach((lb) => drawHaloText(ctx, lb.txt, lb.x, lb.y, lb.col, "600 10px ui-monospace, Consolas, monospace"));
    labelsToDraw.forEach((lb) => drawHaloText(ctx, lb.text, lb.x, lb.y, lb.bold ? COLORS.ink : COLORS.ink2, lb.bold ? "700 11.5px -apple-system, Arial, sans-serif" : "500 10.5px -apple-system, Arial, sans-serif"));
    drawMinimap();
  }

  // ---------------- Interactive Corner Minimap Navigator ----------------
  const miniCanvas = document.getElementById("minimapCanvas");
  const miniCtx = miniCanvas ? miniCanvas.getContext("2d") : null;
  let miniBounds = { minX: -500, maxX: 500, minY: -500, maxY: 500 };
  let miniDragging = false;

  function drawMinimap() {
    if (!miniCtx || ACTIVE_VIEW !== "explorer") return;
    const MW = miniCanvas.width, MH = miniCanvas.height;
    miniCtx.clearRect(0, 0, MW, MH);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    graphState.visibleNodeIds.forEach((id) => {
      const p = graphState.positions.get(id);
      if (!p) return;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    if (!isFinite(minX)) return;
    const pad = 70;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    miniBounds = { minX, maxX, minY, maxY };

    const sx = (wx) => ((wx - minX) / Math.max(1, maxX - minX)) * (MW - 16) + 8;
    const sy = (wy) => ((wy - minY) / Math.max(1, maxY - minY)) * (MH - 20) + 14;

    graphState.visibleNodeIds.forEach((id) => {
      const n = nodeById.get(id), p = graphState.positions.get(id);
      if (!n || !p) return;
      const st = NODE_TYPE_STYLE[n.type] || { color: COLORS.slate };
      miniCtx.fillStyle = st.color;
      miniCtx.globalAlpha = n.tier === "core_1m_causal" ? 0.85 : 0.35;
      miniCtx.fillRect(sx(p.x) - 1, sy(p.y) - 1, 2.2, 2.2);
    });
    miniCtx.globalAlpha = 1;

    // Live viewport rectangle
    const tl = screenToWorld(0, 0), br = screenToWorld(graphState.w, graphState.h);
    const vx0 = Math.max(2, sx(tl.x)), vy0 = Math.max(2, sy(tl.y));
    const vx1 = Math.min(MW - 2, sx(br.x)), vy1 = Math.min(MH - 2, sy(br.y));
    miniCtx.strokeStyle = COLORS.steel;
    miniCtx.lineWidth = 1.4;
    miniCtx.strokeRect(vx0, vy0, Math.max(8, vx1 - vx0), Math.max(6, vy1 - vy0));
  }

  function panFromMinimap(ev) {
    const rect = miniCanvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const wx = miniBounds.minX + ((mx - 8) / (miniCanvas.width - 16)) * (miniBounds.maxX - miniBounds.minX);
    const wy = miniBounds.minY + ((my - 14) / (miniCanvas.height - 20)) * (miniBounds.maxY - miniBounds.minY);
    graphState.camTarget.x = wx;
    graphState.camTarget.y = wy;
  }
  if (miniCanvas) {
    miniCanvas.addEventListener("mousedown", (ev) => { miniDragging = true; panFromMinimap(ev); });
    window.addEventListener("mousemove", (ev) => { if (miniDragging) panFromMinimap(ev); });
    window.addEventListener("mouseup", () => { miniDragging = false; });
  }

  document.getElementById("btnExportPng").addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = `clinical_kg_${graphState.preset}.png`;
    a.href = graphCanvas.toDataURL("image/png");
    a.click();
  });

  function hitTestNode(sx, sy) {
    let best = null, bestD = 16;
    graphState.visibleNodeIds.forEach((id) => {
      const p = graphState.positions.get(id);
      if (!p) return;
      const sc = worldToScreen(p.x, p.y);
      const d = Math.hypot(sc.x - sx, sc.y - sy);
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }

  function hitTestEdge(sx, sy) {
    let best = null, bestD = 9;
    getFilteredEdges().forEach((e) => {
      const ps = graphState.positions.get(e.s), pt = graphState.positions.get(e.t);
      if (!ps || !pt) return;
      const a = worldToScreen(ps.x, ps.y), b = worldToScreen(pt.x, pt.y);
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      if (l2 < 10) return;
      const t = Math.max(0.1, Math.min(0.9, ((sx - a.x) * dx + (sy - a.y) * dy) / l2));
      const d = Math.hypot(sx - (a.x + t * dx), sy - (a.y + t * dy));
      if (d < bestD) { bestD = d; best = e; }
    });
    return best;
  }

  const tooltip = document.getElementById("graphTooltip");
  graphCanvas.addEventListener("mousedown", (ev) => {
    const rect = graphCanvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    graphState.lastMouse = { x: sx, y: sy };
    graphState.dragMoved = false;
    const hit = hitTestNode(sx, sy);
    if (hit) graphState.draggingNode = hit;
    else graphState.panning = true;
  });

  window.addEventListener("mousemove", (ev) => {
    if (ACTIVE_VIEW !== "explorer") return;
    const rect = graphCanvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    if (graphState.draggingNode) {
      const wp = screenToWorld(sx, sy);
      graphState.positions.set(graphState.draggingNode, { x: wp.x, y: wp.y });
      graphState.targets.set(graphState.draggingNode, { x: wp.x, y: wp.y });
      graphState.dragMoved = true;
      return;
    }
    if (graphState.panning) {
      const dx = sx - graphState.lastMouse.x, dy = sy - graphState.lastMouse.y;
      if (Math.hypot(dx, dy) > 2) graphState.dragMoved = true;
      graphState.cam.x -= dx / graphState.cam.scale;
      graphState.cam.y -= dy / graphState.cam.scale;
      graphState.camTarget.x = graphState.cam.x;
      graphState.camTarget.y = graphState.cam.y;
      graphState.lastMouse = { x: sx, y: sy };
      return;
    }
    if (sx >= 0 && sy >= 0 && sx <= rect.width && sy <= rect.height) {
      const hn = hitTestNode(sx, sy);
      graphState.hoveredNode = hn;
      if (hn) {
        graphState.hoveredEdge = null;
        const n = nodeById.get(hn);
        tooltip.innerHTML = `<b>${esc(n.id)}</b> (${esc(n.type)})<br/>${esc(n.label)}<br/><span style="opacity:.75">${esc(n.tier)} · deg ${n.deg}</span>`;
        tooltip.style.left = Math.min(rect.width - 260, sx + 14) + "px";
        tooltip.style.top = Math.max(8, sy - 12) + "px";
        tooltip.classList.remove("hidden");
      } else {
        const he = hitTestEdge(sx, sy);
        graphState.hoveredEdge = he ? he.i : null;
        if (he) {
          const sTxt = he.sign === 1 ? "+1" : (he.sign === -1 ? "−1" : (he.sign === 0 ? "0" : "·"));
          tooltip.innerHTML = `<b>${esc(he.s)}</b> —[${esc(he.r)} ${sTxt}]→ <b>${esc(he.t)}</b>${he.cond ? "<br/>Condition: " + esc(he.cond) : ""}${he.confs.length ? "<br/><span style='color:#fca5a5'>⚠ Logged conflict</span>" : ""}`;
          tooltip.style.left = Math.min(rect.width - 280, sx + 14) + "px";
          tooltip.style.top = Math.max(8, sy - 12) + "px";
          tooltip.classList.remove("hidden");
        } else tooltip.classList.add("hidden");
      }
    }
  });

  window.addEventListener("mouseup", (ev) => {
    if (ACTIVE_VIEW !== "explorer") { graphState.draggingNode = null; graphState.panning = false; return; }
    const wasDrag = graphState.dragMoved;
    graphState.draggingNode = null;
    graphState.panning = false;
    if (wasDrag) return;
    const rect = graphCanvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return;
    const hn = hitTestNode(sx, sy);
    if (hn) {
      graphState.selectedNode = hn; graphState.selectedEdge = null; graphState.pathHighlight = null;
      renderNodeInspector(nodeById.get(hn));
    } else {
      const he = hitTestEdge(sx, sy);
      if (he) {
        graphState.selectedEdge = he.i; graphState.selectedNode = null; graphState.pathHighlight = null;
        renderEdgeInspector(he);
      }
    }
  });

  graphCanvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    graphState.camTarget.scale = Math.max(0.25, Math.min(4.2, graphState.camTarget.scale * (ev.deltaY < 0 ? 1.15 : 0.87)));
  }, { passive: false });

  document.getElementById("btnZoomIn").addEventListener("click", () => { graphState.camTarget.scale = Math.min(4.2, graphState.camTarget.scale * 1.25); });
  document.getElementById("btnZoomOut").addEventListener("click", () => { graphState.camTarget.scale = Math.max(0.25, graphState.camTarget.scale * 0.8); });
  document.getElementById("btnZoomReset").addEventListener("click", () => selectPreset(graphState.preset, false));
  document.getElementById("btnResetSelection").addEventListener("click", () => {
    graphState.selectedNode = null; graphState.selectedEdge = null; graphState.pathHighlight = null;
    document.getElementById("pathSummary").classList.add("hidden");
    renderDefaultInspector();
  });

  function initPathTracer() {
    const drugsAndStates = DATA.nodes.filter((n) => (n.type === "drug" || n.type === "state" || n.type === "intervention") && n.sdeg >= 1).sort((a, b) => b.sdeg - a.sdeg);
    const vitals = DATA.nodes.filter((n) => (n.type === "observed_variable" || n.type === "latent_physiological") && n.sdeg >= 1).sort((a, b) => b.sdeg - a.sdeg);
    const selS = document.getElementById("pathSrc"), selD = document.getElementById("pathDst");
    selS.innerHTML = drugsAndStates.map((n) => `<option value="${esc(n.id)}">${esc(n.id)} (${esc(n.type)})</option>`).join("");
    selD.innerHTML = vitals.map((n) => `<option value="${esc(n.id)}">${esc(n.id)}</option>`).join("");
    selS.value = "epinephrine"; selD.value = "DBP";
    document.getElementById("btnTracePath").addEventListener("click", () => traceMechanisticPaths(selS.value, selD.value));
    document.getElementById("btnClearPath").addEventListener("click", () => { graphState.pathHighlight = null; document.getElementById("pathSummary").classList.add("hidden"); });
  }

  function traceMechanisticPaths(src, dst) {
    const pathNodes = new Set([src, dst]), pathEdges = new Set(), lines = [];
    (adjOut.get(src) || []).forEach((e) => {
      if (e.t === dst) {
        pathEdges.add(e.i);
        const s = e.sign === 1 ? "+1" : (e.sign === -1 ? "−1" : (e.sign === 0 ? "0" : e.r));
        lines.push(`<b>Direct:</b> ${src} —[${s}]→ ${dst}${e.cond ? " <i>(" + esc(e.cond) + ")</i>" : ""}`);
      }
    });
    (adjOut.get(src) || []).forEach((e1) => {
      const mid = e1.t;
      if (mid === dst || mid === src) return;
      (adjOut.get(mid) || []).forEach((e2) => {
        if (e2.t === dst && (e2.sign === 1 || e2.sign === -1)) {
          pathNodes.add(mid); pathEdges.add(e1.i); pathEdges.add(e2.i);
          lines.push(`<b>2-hop:</b> ${src} → <u>${mid}</u> → ${dst} (${e1.r} · ${e2.sign > 0 ? "+1" : "−1"})`);
        }
      });
    });
    pathNodes.forEach((id) => graphState.visibleNodeIds.add(id));
    const visSet = new Set(graphState.visibleEdges.map((e) => e.i));
    pathEdges.forEach((ei) => { if (!visSet.has(ei)) graphState.visibleEdges.push(DATA.edges[ei]); });
    graphState.pathHighlight = { nodes: pathNodes, edges: pathEdges };
    graphState.selectedNode = null; graphState.selectedEdge = null;
    const sumEl = document.getElementById("pathSummary");
    sumEl.innerHTML = lines.length ? lines.slice(0, 10).map((l) => `<div class="path-row">${l}</div>`).join("") : `<div class="path-row">No direct or 2-hop causal path found.</div>`;
    sumEl.classList.remove("hidden");
    const ps = graphState.positions.get(src), pd = graphState.positions.get(dst);
    if (ps && pd) graphState.camTarget = { x: (ps.x + pd.x) / 2, y: (ps.y + pd.y) / 2, scale: 1.25 };
    const firstE = Array.from(pathEdges)[0];
    if (firstE !== undefined) renderEdgeInspector(DATA.edges[firstE]);
  }

  let rightTabMode = "stats";   // "stats" | "inspector"
  let statsScope = "full";      // "full" | "view"

  function setRightTab(mode) {
    rightTabMode = mode;
    document.getElementById("tabRightStats").classList.toggle("active", mode === "stats");
    document.getElementById("tabRightInsp").classList.toggle("active", mode === "inspector");
    if (mode === "stats") renderStatisticsPanel();
    else if (graphState.selectedEdge !== null) renderEdgeInspector(DATA.edges[graphState.selectedEdge]);
    else if (graphState.selectedNode) renderNodeInspector(nodeById.get(graphState.selectedNode));
    else renderInspectorOverview();
  }
  document.getElementById("tabRightStats").addEventListener("click", () => setRightTab("stats"));
  document.getElementById("tabRightInsp").addEventListener("click", () => setRightTab("inspector"));

  function renderDefaultInspector() {
    setRightTab("stats");
  }

  function renderStatisticsPanel() {
    const useView = statsScope === "view";
    const nodes = useView ? DATA.nodes.filter((n) => graphState.visibleNodeIds.has(n.id)) : DATA.nodes;
    const edges = useView ? graphState.visibleEdges : DATA.edges;
    const nPos = edges.filter((e) => e.sign === 1).length;
    const nNeg = edges.filter((e) => e.sign === -1).length;
    const nConf = edges.reduce((acc, e) => acc + (e.confs ? e.confs.length : 0), 0);
    const avgDeg = nodes.length ? ((edges.length * 2) / nodes.length).toFixed(2) : "0.00";

    // Node type counts
    const typeCounts = {};
    const tierCounts = { core_1m_causal: 0, clinical_context: 0, biomedical_background: 0 };
    nodes.forEach((n) => {
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
      if (tierCounts[n.tier] !== undefined) tierCounts[n.tier]++;
    });
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const maxType = sortedTypes.length ? sortedTypes[0][1] : 1;

    // Provenance groups
    let provLit = 0, provPrime = 0, provOnto = 0;
    edges.forEach((e) => {
      const o = (e.orig || "").toLowerCase();
      if (o.includes("primekg")) provPrime++;
      else if (o.includes("hpo") || o.includes("mondo") || o.includes("hetionet")) provOnto++;
      else provLit++;
    });
    const maxProv = Math.max(1, provLit, provPrime, provOnto);

    // Top clinical hubs by signed causal degree
    const hubs = [...nodes].sort((a, b) => b.sdeg - a.sdeg || b.deg - a.deg).slice(0, 10);

    document.getElementById("inspectorBody").innerHTML = `
      <div class="scope-toggle">
        <button class="scope-btn ${!useView ? "active" : ""}" data-sc="full">Full KG (985N)</button>
        <button class="scope-btn ${useView ? "active" : ""}" data-sc="view">Current View (${graphState.visibleNodeIds.size}N)</button>
      </div>

      <div class="stat-grid-2">
        <div class="sg-item"><span class="sg-val">${nodes.length.toLocaleString()}</span><span class="sg-lbl">Nodes (0 orphans)</span></div>
        <div class="sg-item"><span class="sg-val">${edges.length.toLocaleString()}</span><span class="sg-lbl">Edges (0 duplicates)</span></div>
        <div class="sg-item"><span class="sg-val"><span class="badge-pos">+${nPos}</span> / <span class="badge-neg">−${nNeg}</span></span><span class="sg-lbl">Signed Causal (${nPos + nNeg})</span></div>
        <div class="sg-item"><span class="sg-val">${useView ? "—" : DATA.meta.n_hyperedges}</span><span class="sg-lbl">Hyperedges (25 context)</span></div>
        <div class="sg-item"><span class="sg-val">${avgDeg}</span><span class="sg-lbl">Mean Degree</span></div>
        <div class="sg-item"><span class="sg-val" style="color:${nConf ? COLORS.cardinal : COLORS.ink}">${nConf}</span><span class="sg-lbl">Logged Conflicts</span></div>
      </div>

      <div class="insp-subhead">Active Tiers</div>
      ${[
        ["Core Causal", tierCounts.core_1m_causal, COLORS.steel],
        ["Clinical Context", tierCounts.clinical_context, COLORS.ochre],
        ["Biomedical Bg.", tierCounts.biomedical_background, "#94a3b8"],
      ].map(([lbl, cnt, col]) => `
        <div class="bar-row">
          <span class="bar-lbl">${lbl}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(cnt / Math.max(1, nodes.length)) * 100}%;background:${col}"></div></div>
          <span class="bar-num">${cnt}</span>
        </div>`).join("")}

      <div class="insp-subhead">Edge Provenance</div>
      ${[
        ["PrimeKG / SIDER", provPrime, "#94a3b8"],
        ["Clinical & FDA Lit.", provLit, COLORS.steel],
        ["HPO / MONDO", provOnto, COLORS.ochre],
      ].map(([lbl, cnt, col]) => `
        <div class="bar-row">
          <span class="bar-lbl">${lbl}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(cnt / maxProv) * 100}%;background:${col}"></div></div>
          <span class="bar-num">${cnt}</span>
        </div>`).join("")}

      <div class="insp-subhead">Node Types (${sortedTypes.length})</div>
      ${sortedTypes.map(([t, cnt]) => {
        const st = NODE_TYPE_STYLE[t] || { color: COLORS.slate, label: t };
        return `<div class="bar-row">
          <span class="bar-lbl">${esc(st.label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(cnt / maxType) * 100}%;background:${st.color}"></div></div>
          <span class="bar-num">${cnt}</span>
        </div>`;
      }).join("")}

      <div class="insp-subhead">Top Clinical Hubs (Click to Focus)</div>
      <div class="edge-mini-list">
        ${hubs.map((h) => `
          <div class="edge-mini-row" data-qnode="${esc(h.id)}">
            <span><b>${esc(h.id)}</b> <span class="badge-muted">(${esc((NODE_TYPE_STYLE[h.type] || {}).label || h.type)})</span></span>
            <span class="em-rel">${h.sdeg} causal · ${h.deg} tot</span>
          </div>`).join("")}
      </div>
    `;
    document.querySelectorAll("#inspectorBody [data-sc]").forEach((b) => b.addEventListener("click", () => {
      statsScope = b.dataset.sc;
      renderStatisticsPanel();
    }));
    document.querySelectorAll("#inspectorBody [data-qnode]").forEach((row) => row.addEventListener("click", () => jumpToNodeInExplorer(row.dataset.qnode)));
  }

  function renderInspectorOverview() {
    const m = DATA.meta;
    document.getElementById("inspectorBody").innerHTML = `
      <h3 class="insp-title">Clinical Physiological KG</h3>
      <div class="insp-id">Audited Clinical Knowledge Graph · ${esc(m.date)}</div>
      <p style="font-size:12.5px;color:#374151;margin-top:0">
        Click any <b>node</b> or <b>directed edge</b> on the canvas to inspect its verbatim literature quotes, clickable DailyMed / PubMed citations, quantitative studies, and logged conflicts.
      </p>
      <div class="insp-subhead">Quick Spotlights</div>
      <div class="edge-mini-list">
        <div class="edge-mini-row" data-qnode="epinephrine"><span><b>epinephrine</b> · Low β2 vs. High α1</span><span class="badge-ochre">Reversal →</span></div>
        <div class="edge-mini-row" data-qnode="dexmedetomidine"><span><b>dexmedetomidine</b> · Loading vs. Maintenance</span><span class="badge-ochre">Reversal →</span></div>
        <div class="edge-mini-row" data-qnode="ketamine"><span><b>ketamine</b> · Normal vs. Depleted</span><span class="badge-neg">Conflict →</span></div>
        <div class="edge-mini-row" data-qnode="septic_shock"><span><b>septic_shock</b> · Post-Fluid CVP Conflict</span><span class="badge-neg">Conflict →</span></div>
        <div class="edge-mini-row" data-qnode="norepinephrine"><span><b>norepinephrine</b> · Direct vs. Baroreflex</span><span class="badge-pos">Hub →</span></div>
      </div>`;
    document.querySelectorAll("[data-qnode]").forEach((row) => row.addEventListener("click", () => jumpToNodeInExplorer(row.dataset.qnode)));
  }

  function renderNodeInspector(n) {
    rightTabMode = "inspector";
    document.getElementById("tabRightStats").classList.remove("active");
    document.getElementById("tabRightInsp").classList.add("active");
    const outE = adjOut.get(n.id) || [], inE = adjIn.get(n.id) || [], hyps = hypersByNode.get(n.id) || [];
    const tierClass = n.tier === "core_1m_causal" ? "badge-pos" : (n.tier === "clinical_context" ? "badge-ochre" : "badge-muted");
    const edgeRowHtml = (e, dir) => {
      const other = dir === "out" ? e.t : e.s, arrow = dir === "out" ? "→" : "←";
      const sBadge = e.sign === 1 ? `<span class="badge-pos">+1</span>` : (e.sign === -1 ? `<span class="badge-neg">−1</span>` : `<span class="badge-muted">${esc(e.r)}</span>`);
      return `<div class="edge-mini-row" data-eidx="${e.i}"><div><span>${arrow} <b>${esc(other)}</b>${e.confs.length ? `<span class="badge-neg"> ⚠</span>` : ""}</span>${e.cond ? `<span class="em-cond">${esc(e.cond)}</span>` : ""}</div><span class="em-rel">${sBadge}</span></div>`;
    };
    const sortE = (arr) => [...arr].sort((a, b) => (b.confs.length - a.confs.length) || (Math.abs(b.sign || 0) - Math.abs(a.sign || 0)));
    document.getElementById("inspectorBody").innerHTML = `
      <h3 class="insp-title">${esc(n.label)}</h3>
      <div class="insp-id">ID: ${esc(n.id)} · Type: ${esc(n.type)}</div>
      <div class="insp-meta-line"><span class="${tierClass}">${esc(n.tier)}</span><span>Deg: ${n.deg} (${n.sdeg} signed)</span></div>
      ${n.synonyms.length ? `<div style="font-size:11.5px;color:#6b7280;margin-bottom:8px">Synonyms: ${esc(n.synonyms.join(", "))}</div>` : ""}
      ${n.note ? `<div class="quote-block">${esc(n.note)}</div>` : ""}
      <div class="insp-subhead">Outgoing Edges (${outE.length})</div>
      <div class="edge-mini-list">${sortE(outE).slice(0, 18).map((e) => edgeRowHtml(e, "out")).join("") || "<span class='badge-muted'>None</span>"}</div>
      <div class="insp-subhead">Incoming Edges (${inE.length})</div>
      <div class="edge-mini-list">${sortE(inE).slice(0, 14).map((e) => edgeRowHtml(e, "in")).join("") || "<span class='badge-muted'>None</span>"}</div>
      ${hyps.length ? `<div class="insp-subhead">Hyperedges (${hyps.length})</div>${hyps.slice(0, 8).map((h) => `<div class="quote-block"><b>${esc(h.id)}</b> <span class="badge-ochre">[${esc(h.r)}]</span>${h.cond ? `<div style="font-size:11px;color:#8a5a10">Condition: ${esc(h.cond)}</div>` : ""}<div style="font-size:11px;margin-top:3px;font-family:var(--font-mono)">${h.members.map((m) => `${esc(m.node)}:${esc(m.role)}${m.val ? "(" + esc(m.val) + ")" : ""}`).join(" · ")}</div>${h.srcs[0]?.quote ? `<span class="quote-cite">“${esc(h.srcs[0].quote)}”</span>` : ""}</div>`).join("")}` : ""}`;
    document.querySelectorAll("#inspectorBody [data-eidx]").forEach((row) => row.addEventListener("click", () => {
      const idx = Number(row.dataset.eidx);
      graphState.selectedEdge = idx;
      renderEdgeInspector(DATA.edges[idx]);
    }));
  }

  function renderEdgeInspector(e) {
    rightTabMode = "inspector";
    document.getElementById("tabRightStats").classList.remove("active");
    document.getElementById("tabRightInsp").classList.add("active");
    const sTxt = e.sign === 1 ? "+1 (increases)" : (e.sign === -1 ? "−1 (decreases)" : (e.sign === 0 ? "0 (no effect)" : e.r));
    const sCls = e.sign === 1 ? "badge-pos" : (e.sign === -1 ? "badge-neg" : "badge-muted");
    document.getElementById("inspectorBody").innerHTML = `
      <h3 class="insp-title">${esc(e.s)} → ${esc(e.t)}</h3>
      <div class="insp-id">Edge #${e.i} · ${esc(e.cat || e.r)}</div>
      <div class="insp-meta-line"><span class="${sCls}">${esc(sTxt)}</span><span>Grade: <b>${esc(e.st || "—")}</b></span><span>Check: ${esc(e.chk || "—")}</span></div>
      ${e.cond ? `<div class="quote-block" style="border-left-color:${COLORS.ochre}"><b>Condition:</b> ${esc(e.cond)}</div>` : ""}
      ${e.confs.length ? `<div class="insp-subhead" style="color:${COLORS.cardinal}">⚠ Attached Conflicts (${e.confs.length}) — Sign Preserved</div>${e.confs.map((c) => `<div class="quote-block conflict-block"><span class="pill-tag pill-drop">${esc(c.kind.toUpperCase())}</span> · <b>${esc(c.item_id)}</b><div style="margin-top:4px">${esc(c.finding)}</div></div>`).join("")}` : ""}
      <div class="insp-subhead">Verbatim Literature Provenance (${e.srcs.length})</div>
      ${e.srcs.length ? e.srcs.map((s) => `<div class="quote-block">${s.quote ? `“${esc(s.quote)}”` : "<i>Structured ontology record</i>"}<span class="quote-cite"><b>${esc(s.id)}</b> — ${esc(s.cite)}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">Open Source ↗</a>` : ""}</span></div>`).join("") : "<p class='badge-muted'>Derived from structured biomedical ontology (PrimeKG / HPO / MONDO).</p>"}
      ${e.quant.length ? `<div class="insp-subhead">Quantitative Clinical Studies (${e.quant.length})</div>${e.quant.map((q) => `<div class="quote-block" style="border-left-color:${q.train ? COLORS.steel : COLORS.ochre}"><b>${esc(q.id)}</b> · <span class="pill-tag ${q.train ? "pill-keep" : "pill-corr"}">${q.train ? "train=true" : "flagged · train=false"}</span><div style="margin-top:3px">${esc(q.qty)}: <span class="cell-mono">${esc(q.val)}</span></div>${q.pop ? `<span class="quote-cite">Population: ${esc(q.pop)}</span>` : ""}</div>`).join("")}` : ""}
      <div style="margin-top:14px;display:flex;gap:12px"><button class="btn-link" data-gn="${esc(e.s)}">Inspect ${esc(e.s)} →</button><button class="btn-link" data-gn="${esc(e.t)}">Inspect ${esc(e.t)} →</button></div>`;
    document.querySelectorAll("#inspectorBody [data-gn]").forEach((b) => b.addEventListener("click", () => jumpToNodeInExplorer(b.dataset.gn)));
  }

  // ============================================================================
  // VIEW 03: KEEP VS DROP AUDIT LEDGER
  // ============================================================================
  let activeLedgerTab = "dropped";

  function renderFunnel() {
    const steps = [
      { num: "GATE 01", title: "Seed Drug Whitelist", pct: 100, stat: "8.1M PrimeKG rows → 33/35 drugs", desc: "Keep only protein targets and SIDER side effects matching the 35 ICU drugs; discard >99.9% unrelated rows." },
      { num: "GATE 02", title: "2nd-Pass Verbatim Check", pct: 78, stat: "15 removed · 55+ corrected", desc: "Remove unsupported or mis-targeted biology (pain→HR, CHRN→ventilation_drive); replace paraphrases verbatim." },
      { num: "GATE 03", title: "Quantitative & Quality Filter", pct: 62, stat: "1,163 items → 872 kept · 112 flagged", desc: "Attach 872 clinical items to KG; drop 291 non-graph formulas; exclude 112 flagged studies from training." },
      { num: "GATE 04", title: "FDA XML <15w Assert", pct: 32, stat: "877 mined → 43 kept (4.9%)", desc: "Exact substring check against cached FDA XML labels; 95.1% of auto-mined candidate sentences rejected." },
      { num: "GATE 05", title: "Zero-Defect Final Audit", pct: 18, stat: "0 orphans · 0 dangling · 0 dups", desc: "Pruned 1 unlinked orphan, reconnected 4 PMID nodes, fixed 2 dangling refs, merged 24 duplicate edges." },
    ];
    document.getElementById("funnelStrip").innerHTML = steps.map((s) => `
      <div class="funnel-step">
        <div class="fs-num">${s.num}</div><div class="fs-title">${s.title}</div>
        <div class="fs-bar-bg"><div class="fs-bar-fill" style="width:${s.pct}%"></div></div>
        <div class="fs-stat">${s.stat}</div><div class="fs-desc">${s.desc}</div>
      </div>`).join("");
    document.getElementById("cntDropped").textContent = `(${DATA.dropped.length})`;
    document.getElementById("cntCorrected").textContent = `(${DATA.corrected.length}+)`;
    document.getElementById("cntFlagged").textContent = `(112)`;
  }

  function renderLedgerTable() {
    const q = (document.getElementById("ledgerSearch").value || "").trim().toLowerCase();
    const wrap = document.getElementById("ledgerContent");
    if (activeLedgerTab === "dropped") {
      const rows = DATA.dropped.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
      wrap.innerHTML = `<table class="booktabs"><thead><tr><th style="width:190px">Step</th><th style="width:240px">Removed Candidate</th><th style="width:110px">Action</th><th>Independent Reviewer Justification</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="cell-mono">${esc(r.stage)}</td><td class="cell-mono"><b>${esc(r.claim)}</b></td><td><span class="pill-tag pill-drop">REMOVED</span></td><td>${esc(r.reason)}</td></tr>`).join("")}</tbody></table>`;
    } else if (activeLedgerTab === "corrected") {
      const rows = DATA.corrected.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
      wrap.innerHTML = `<table class="booktabs"><thead><tr><th style="width:200px">Step</th><th style="width:230px">Item</th><th style="width:220px">Correction Applied</th><th>Audit Comment</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="cell-mono">${esc(r.stage)}</td><td class="cell-mono"><b>${esc(r.claim)}</b></td><td><span class="pill-tag pill-corr">${esc(r.fix)}</span></td><td>${esc(r.reason)}</td></tr>`).join("")}</tbody></table>`;
    } else if (activeLedgerTab === "flagged") {
      const rows = DATA.v4_flagged.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
      wrap.innerHTML = `<p style="margin:0 0 10px;color:#374151;font-size:12.5px">Out of <b>1,163</b> twice-checked quantitative items: <b>802</b> verified, <b>249</b> corrected, and <b>112</b> flagged (kept for human audit, excluded from model training). Showing 30 samples:</p><table class="booktabs"><thead><tr><th style="width:140px">Item ID</th><th style="width:90px">Batch</th><th style="width:170px">Subject</th><th style="width:240px">Quantity</th><th>Audit Note</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="cell-mono"><b>${esc(r.id)}</b></td><td class="cell-mono">${esc(r.file)}</td><td class="cell-mono">${esc(r.subject)}</td><td>${esc(r.quantity)}</td><td><span class="pill-tag pill-corr">audit only</span> · ${esc(r.note)}</td></tr>`).join("")}</tbody></table>`;
    } else if (activeLedgerTab === "v6funnel") {
      wrap.innerHTML = `<table class="booktabs"><thead><tr><th style="width:240px">Funnel Stage</th><th style="width:120px">Count</th><th style="width:130px">Share</th><th>Concrete Filtering Criteria</th></tr></thead><tbody>
        <tr><td class="cell-mono"><b>1. Auto-mined FDA sentences</b></td><td class="cell-mono"><b>${DATA.meta.v6_candidates}</b></td><td class="cell-mono">100.0%</td><td>Scanned 31 DailyMed SPL XML labels for CVP, PAP, ICP, RR, elderly, renal, CHF, shock, and acidosis mentions.</td></tr>
        <tr><td class="cell-mono"><b>2. Rejected non-causal / noise</b></td><td class="cell-mono" style="color:${COLORS.cardinal}"><b>−${DATA.meta.v6_candidates - 43}</b></td><td class="cell-mono" style="color:${COLORS.cardinal}">95.1% dropped</td><td>Rejected animal-only studies, generic monitoring reminders, and non-directional post-marketing lists.</td></tr>
        <tr><td class="cell-mono"><b>3. Verified Monitored-Channel Edges</b></td><td class="cell-mono" style="color:${COLORS.steel}"><b>+18 edges</b></td><td class="cell-mono">2.1%</td><td>Exact &lt;15-word substring in cached XML: e.g. nitroglycerin → CVP/PAP/PAWP (−1), ketamine → ICP (+1), propofol → ICP (−1).</td></tr>
        <tr><td class="cell-mono"><b>4. Verified Context-Modifier Hyperedges</b></td><td class="cell-mono" style="color:${COLORS.steel}"><b>+25 hyperedges</b></td><td class="cell-mono">2.8%</td><td>Patient-state effect modifiers: elderly sensitivity, renal clearance prolongation, catecholamine hyporesponsiveness in shock/acidosis.</td></tr>
      </tbody></table>`;
    } else if (activeLedgerTab === "v8clean") {
      wrap.innerHTML = `<table class="booktabs"><thead><tr><th style="width:200px">Audit Check</th><th style="width:260px">Affected Entities</th><th>Resolution</th></tr></thead><tbody>${DATA.v8_cleanup.map((r) => `<tr><td><span class="pill-tag ${r.category.includes("Pruned") ? "pill-drop" : "pill-keep"}">${esc(r.category)}</span></td><td class="cell-mono"><b>${esc(r.item)}</b></td><td>${esc(r.action)}</td></tr>`).join("")}</tbody></table>`;
    }
  }

  document.querySelectorAll(".subtab").forEach((b) => b.addEventListener("click", () => {
    activeLedgerTab = b.dataset.ledger;
    document.querySelectorAll(".subtab").forEach((x) => x.classList.toggle("active", x === b));
    renderLedgerTable();
  }));
  document.getElementById("ledgerSearch").addEventListener("input", renderLedgerTable);

  // ============================================================================
  // VIEW 04: CONFLICT RESOLUTION LAB
  // ============================================================================
  const REVERSAL_CASES = [
    {
      id: "epi_dbp", title: "Epinephrine → DBP", drug: "epinephrine", target: "DBP",
      regimes: [
        { btn: "Low Dose (β2 Vasodilation)", sign: -1, mech: "ADRB2 → SVR ↓", cond: "low dose (beta2-mediated vasodilation)", quote: "Decreases in systemic vascular resistance and diastolic blood pressure are observed at low doses", cite: "FDA DailyMed: ADRENALIN (epinephrine), Section 12.2", explain: "At low infusion doses, higher β2-adrenergic affinity produces peripheral vasodilation and lower SVR, decreasing DBP (−1)." },
        { btn: "Higher Dose (α1 Vasoconstriction)", sign: 1, mech: "ADRA1 → SVR ↑", cond: "higher dose (alpha1-mediated vasoconstriction)", quote: "α1-mediated peripheral vasoconstriction at higher doses leading to increase in diastolic blood pressure", cite: "FDA DailyMed: ADRENALIN (epinephrine), Section 12.2", explain: "At higher doses, α1-mediated peripheral vasoconstriction dominates, raising SVR and flipping DBP to increase (+1)." },
      ],
    },
    {
      id: "dex_map", title: "Dexmedetomidine → MAP", drug: "dexmedetomidine", target: "MAP",
      regimes: [
        { btn: "Loading Bolus (Initial Phase)", sign: 1, mech: "Peripheral α2B → Vasoconstriction", cond: "loading dose", quote: "Transient hypertension has been observed primarily during the loading dose in association with the initial peripheral vasoconstrictive effects", cite: "FDA DailyMed: PRECEDEX (dexmedetomidine), Section 5.2", explain: "Rapid loading infusion transiently stimulates peripheral vascular α2B receptors, causing brief hypertension (+1)." },
        { btn: "Maintenance Infusion", sign: -1, mech: "Central α2A → Sympatholysis", cond: "maintenance infusion", quote: "clinically significant episodes of bradycardia, sinus arrest, and hypotension have been associated with PRECEDEX infusion", cite: "FDA DailyMed: PRECEDEX (dexmedetomidine), Section 5.2", explain: "During steady maintenance infusion, central α2A sympatholysis dominates, lowering MAP, SBP, and DBP (−1)." },
      ],
    },
    {
      id: "ket_map", title: "Ketamine → MAP / HR", drug: "ketamine", target: "MAP",
      regimes: [
        { btn: "Intact Sympathetic Tone", sign: 1, mech: "Sympathetic Catecholamine Release ↑", cond: "usual: transient rise after induction", quote: "Elevation of blood pressure begins shortly after injection, reaches a maximum within a few minutes", cite: "FDA DailyMed: KETALAR (ketamine), Section 12.2", explain: "With intact sympathetic reserve, central catecholamine release produces a transient increase in MAP and HR (+1)." },
        { btn: "Catecholamine-Depleted Shock", sign: -1, mech: "Direct Myocardial Depression ↓", cond: "catecholamine-depleted states or severe LV dysfunction", quote: "In catecholamine-depleted patients, direct myocardial depressant effects may predominate, causing hypotension", cite: "JACC Adv 2026 (PMC13531622) + FDA KETALAR", explain: "When endogenous catecholamines are depleted in severe shock, direct negative inotropy is unmasked, causing hypotension (−1)." },
      ],
    },
  ];

  const revCanvas = document.getElementById("reversalCanvas");
  const revCtx = revCanvas.getContext("2d");
  const revState = { caseIdx: 0, regimeIdx: 0, t: 0, w: 600, h: 250 };

  function initReversalLab() {
    const tabs = document.getElementById("reversalDrugTabs");
    tabs.innerHTML = REVERSAL_CASES.map((c, i) => `<button class="pill-btn ${i === 0 ? "active" : ""}" data-rc="${i}">${esc(c.title)}</button>`).join("");
    tabs.querySelectorAll(".pill-btn").forEach((b) => b.addEventListener("click", () => {
      revState.caseIdx = Number(b.dataset.rc); revState.regimeIdx = 0;
      tabs.querySelectorAll(".pill-btn").forEach((x, k) => x.classList.toggle("active", k === revState.caseIdx));
      renderReversalExplain();
    }));
    document.getElementById("btnRegimeA").addEventListener("click", () => { revState.regimeIdx = 0; renderReversalExplain(); });
    document.getElementById("btnRegimeB").addEventListener("click", () => { revState.regimeIdx = 1; renderReversalExplain(); });
    renderReversalExplain();
  }

  function renderReversalExplain() {
    const c = REVERSAL_CASES[revState.caseIdx], rA = c.regimes[0], rB = c.regimes[1], activeR = c.regimes[revState.regimeIdx];
    const btnA = document.getElementById("btnRegimeA"), btnB = document.getElementById("btnRegimeB");
    btnA.textContent = rA.btn + (rA.sign > 0 ? "  (+1)" : "  (−1)");
    btnB.textContent = rB.btn + (rB.sign > 0 ? "  (+1)" : "  (−1)");
    btnA.className = "regime-btn " + (revState.regimeIdx === 0 ? ("active " + (rA.sign > 0 ? "pos" : "neg")) : "");
    btnB.className = "regime-btn " + (revState.regimeIdx === 1 ? ("active " + (rB.sign > 0 ? "pos" : "neg")) : "");
    const isPos = activeR.sign > 0;
    document.getElementById("reversalExplain").innerHTML = `
      <div class="col-kicker">Active KG Edge in Selected Regime</div>
      <div style="font-family:var(--font-mono);font-size:14px;font-weight:700;margin-bottom:8px;color:${isPos ? COLORS.steel : COLORS.cardinal}">
        ${esc(c.drug)} —[${isPos ? "increases (+1)" : "decreases (−1)"}]→ ${esc(c.target)}
      </div>
      <div style="font-size:12px;margin-bottom:8px"><b>Condition:</b> <span class="cell-mono">${esc(activeR.cond)}</span></div>
      <p style="margin:0 0 12px;color:#374151;font-size:13px">${esc(activeR.explain)}</p>
      <div class="quote-block" style="border-left-color:${isPos ? COLORS.steel : COLORS.cardinal}">
        “${esc(activeR.quote)}”<span class="quote-cite">${esc(activeR.cite)}</span>
      </div>
      <button class="btn-link" id="btnJumpRevGraph">Inspect both edges in Graph Explorer →</button>`;
    document.getElementById("btnJumpRevGraph").addEventListener("click", () => {
      switchView("explorer"); selectPreset("reversals", true); jumpToNodeInExplorer(c.drug);
    });
  }

  function resizeReversalCanvas() {
    const rect = revCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    revState.w = Math.max(400, rect.width); revState.h = Math.max(230, rect.height);
    revCanvas.width = revState.w * dpr; revCanvas.height = revState.h * dpr;
    revCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawReversalFrame() {
    if (ACTIVE_VIEW !== "conflicts") return;
    const ctx = revCtx, W = revState.w, H = revState.h;
    revState.t = (revState.t + 0.012) % 1;
    ctx.clearRect(0, 0, W, H);
    const c = REVERSAL_CASES[revState.caseIdx];
    const xL = W * 0.16, xM = W * 0.50, xR = W * 0.84, yC = H * 0.50;

    c.regimes.forEach((reg, idx) => {
      const isAct = idx === revState.regimeIdx;
      const yBranch = idx === 0 ? yC - 60 : yC + 60;
      const col = reg.sign > 0 ? COLORS.steel : COLORS.cardinal;
      ctx.save();
      ctx.globalAlpha = isAct ? 1.0 : 0.22;
      ctx.strokeStyle = col;
      ctx.lineWidth = isAct ? 2.4 : 1.2;
      if (reg.sign < 0) ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xL + 38, yC);
      ctx.quadraticCurveTo(xM, yBranch, xR - 38, yC);
      ctx.stroke();
      ctx.setLineDash([]);
      if (isAct) {
        for (let k = 0; k < 3; k++) {
          const u = (revState.t + k / 3) % 1, v = 1 - u;
          ctx.beginPath();
          ctx.arc(v*v*(xL+38) + 2*v*u*xM + u*u*(xR-38), v*v*yC + 2*v*u*yBranch + u*u*yC, 3.8, 0, Math.PI * 2);
          ctx.fillStyle = col; ctx.fill();
        }
      }
      // Clean pure halo text (ZERO background box!)
      const lbl = `${reg.mech}  (${reg.sign > 0 ? "+1" : "−1"})`;
      drawHaloText(ctx, lbl, xM, idx === 0 ? yBranch - 10 : yBranch + 16, col, isAct ? "700 11.5px ui-monospace, Consolas, monospace" : "500 11px ui-monospace, Consolas, monospace");
      ctx.restore();
    });

    [[xL, c.drug, COLORS.steel], [xR, c.target, COLORS.ink]].forEach(([x, lbl, col]) => {
      ctx.beginPath(); ctx.arc(x, yC, 32, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
      drawHaloText(ctx, lbl.slice(0, 14), x, yC + 4, col, "700 11.5px -apple-system, Arial, sans-serif");
    });
  }

  let activeConflictKind = "all";
  function renderConflictsTable() {
    const rows = DATA.conflicts.filter((c) => activeConflictKind === "all" || c.kind === activeConflictKind);
    const kindStyle = (k) => k === "apparent" ? "pill-keep" : (k === "conditional" ? "pill-corr" : "pill-drop");
    document.getElementById("conflictsTableWrap").innerHTML = `
      <table class="booktabs"><thead><tr><th style="width:120px">Kind</th><th style="width:190px">KG Edge (Sign Kept)</th><th style="width:165px">Item ID</th><th>Conflicting Finding &amp; Clinical Audit Explanation</th><th style="width:90px">Graph</th></tr></thead>
      <tbody>${rows.map((c) => `<tr><td><span class="pill-tag ${kindStyle(c.kind)}">${esc(c.kind)}</span></td><td class="cell-mono"><b>${esc(c.src)} → ${esc(c.dst)}</b> <span class="${c.kg_sign > 0 ? "badge-pos" : (c.kg_sign < 0 ? "badge-neg" : "badge-muted")}">[${c.kg_sign > 0 ? "+1" : c.kg_sign}]</span></td><td class="cell-mono">${esc(c.item_id)}</td><td>${esc(c.finding)}</td><td><button class="btn-link" data-csrc="${esc(c.src)}">Inspect →</button></td></tr>`).join("")}</tbody></table>`;
    document.querySelectorAll("#conflictsTableWrap [data-csrc]").forEach((b) => b.addEventListener("click", () => {
      switchView("explorer"); selectPreset("conflicts", false);
      const eMatch = DATA.edges.find((e) => e.s === b.dataset.csrc && e.confs.length > 0);
      jumpToNodeInExplorer(b.dataset.csrc, eMatch ? eMatch.i : null);
    }));
  }

  document.querySelectorAll("#conflictKindTabs .pill-btn").forEach((b) => b.addEventListener("click", () => {
    activeConflictKind = b.dataset.ckind;
    document.querySelectorAll("#conflictKindTabs .pill-btn").forEach((x) => x.classList.toggle("active", x === b));
    renderConflictsTable();
  }));

  function renderClaimsCrossCheck() {
    const cl = DATA.claims;
    document.getElementById("claimsCrossCheck").innerHTML = `
      <div class="claims-summary-col">
        <div class="col-kicker">Internal Pathway Audit</div>
        <div class="cs-row"><span>Total Derived KG Claims</span><b>${cl.kg_claims}</b></div>
        <div class="cs-row"><span>Direct Causal Edges</span><b>${cl.direct_claims}</b></div>
        <div class="cs-row"><span>2-Hop Receptor / Mechanism Chains</span><b>${cl.mech_chains}</b></div>
        <div class="cs-row"><span>Reflex Feedback Chains</span><b>${cl.reflex_chains}</b></div>
        <div class="cs-row"><span class="badge-ochre">Direct vs. Reflex Opposite Signs</span><b class="badge-ochre">${cl.direct_vs_reflex_opposite}</b></div>
        <div class="cs-row"><span class="badge-ochre">Phase / Ventilator Scope Differences</span><b class="badge-ochre">${cl.scope_differences}</b></div>
        <div class="cs-row"><span class="badge-neg">Clinical vs. Resting Reference Diff</span><b class="badge-neg">${cl.range_differences}</b></div>
      </div>
      <div>
        <table class="booktabs"><thead><tr><th style="width:130px">Category</th><th style="width:155px">Pair</th><th style="width:210px">Primary Pathway</th><th style="width:210px">Competing Pathway / Scope</th><th>Resolution</th></tr></thead>
        <tbody>${cl.examples.map((ex) => `<tr><td><span class="pill-tag ${ex.kind.includes("Reference") ? "pill-drop" : "pill-corr"}">${esc(ex.kind)}</span></td><td class="cell-mono"><b>${esc(ex.pair)}</b></td><td>${esc(ex.kg)}</td><td>${esc(ex.law)}</td><td>${esc(ex.resolution)}</td></tr>`).join("")}</tbody></table>
      </div>`;
  }

  // ============================================================================
  // VIEW 05: END-TO-END CLINICAL WORLD MODEL ANIMATION (5 STEPS)
  // ============================================================================
  const MODEL_STAGES = [
    {
      short: "Inputs & Context",
      sub: "Vitals + Drugs",
      title: "01 · Multi-Channel Patient Vitals & Clinical Interventions",
      summary: "At each 1-minute step, the model observes multi-channel physiological vitals (MAP, SBP, DBP, HR, CVP, RR, SpO2) over the historical window alongside active interventions (vasopressors, sedatives, fluids, PEEP, volatile anesthetics).",
      bullets: [
        "Unified representation across ICU (MIMIC-III) and Operating Room (VitalDB) cohorts.",
        "Separates observed physiological trajectories y(1:T) from future candidate intervention schedules a(T:T+H).",
        "Preserves continuous dosing rates and bolus events so counterfactual interventions can be queried cleanly."
      ],
      ioIn: "Historical vitals y(1:T) + Active interventions a(1:T+H)",
      ioOut: "Encoded physiological context state z_t",
      guarantee: "Zero manual diagnosis labels required at test time—operates directly on bedside waveforms and pump rates."
    },
    {
      short: "Base World Model",
      sub: "Latent Rollout",
      title: "02 · Pure Neural Latent World Model (Counterfactual Rollout)",
      summary: "A lightweight latent dynamical world model rolls forward multi-step physiological trajectories (z_t → Δz_t → ŷ_{t+1:t+H}) conditioned on any planned intervention sequence—predicting both factual evolution and counterfactual drug responses.",
      bullets: [
        "Pure base dynamics architecture: zero extra graph heads, zero extra input dimensions, zero inference overhead.",
        "Supports open-loop multi-horizon forecasting (+1 min to +30 min) under arbitrary drug titration schedules.",
        "Learns shared patient-specific latent hemodynamics directly from longitudinal ICU & OR trajectories."
      ],
      ioIn: "Latent state z_t + Candidate intervention schedule a(t:t+H)",
      ioOut: "Multi-horizon vital forecasts ŷ(t+1:t+H)",
      guarantee: "Identical clean architecture across training and deployment—no graph lookup needed during inference."
    },
    {
      short: "Neural KG Prior",
      sub: "Training Only",
      title: "03 · Differentiable KG Diffusion & Hypergraph Context Critic",
      summary: "Strictly inside the training loop, two differentiable operators read the audited 985-node KG (zero regexes, zero hardcoded drug names) to derive continuous action priors, physiological subspace Jacobians, and patient-state modulation gates.",
      bullets: [
        "Typed Signed Graph Diffusion: A(θ) = Σ softplus(θ_r) Ã_r, M(θ,γ) = Σ γ^(k−1) A(θ)^k — superposes multi-receptor pathways and transfers to unseen OOD drugs.",
        "Latent-to-Observed Jacobian J_KG = M[obs, latents] captures coupled hemodynamic directions (SVR, CO, preload → MAP, DBP, HR).",
        "Hypergraph Context Critic attends over patient-state & dose-reversal hyperedges (septic shock, elderly, acidosis, co-drugs) to output smooth modulation gate g_ψ ∈ (0.45, 1.60)."
      ],
      ioIn: "Audited 985-node KG (edges + 152 hyperedges)",
      ioOut: "Context-gated action prior g_ψ · M_act  +  Subspace Jacobian J_KG",
      guarantee: "Stage-1 calibration fits (θ, γ, ψ) strictly on training data, then freezes the KG teacher to prevent data leakage."
    },
    {
      short: "All-in-Loss Training",
      sub: "Counterfactual",
      title: "04 · Differentiable All-in-Loss Counterfactual Supervision",
      summary: "Rather than hard-wiring brittle rules into the network, all KG knowledge supervises the pure Base World Model purely through differentiable training losses—combining factual accuracy with counterfactual directional fidelity and physiological consistency.",
      bullets: [
        "Factual Forecast Loss (L_data): minimizes multi-horizon prediction error on real observed ICU / OR trajectories.",
        "Counterfactual Action-Prior Loss (L_act): perturbs drug inputs (+Δa vs. 0) during training and aligns predicted response ŷ(a+Δa) − ŷ(a) with g_ψ · M_act.",
        "Trajectory Consistency Loss (L_traj): projects multi-channel shifts Δŷ onto the KG physiological Jacobian J_KG and enforces clinical ordering (e.g. SBP > MAP > DBP)."
      ],
      ioIn: "L_total = L_data + λ_act · L_act(KG) + λ_traj · L_traj(KG)",
      ioOut: "Gradients backpropagate strictly into Base World Model weights",
      guarantee: "Distills 985-node clinical knowledge into smooth neural weights—eliminating brittle hand-coded rules."
    },
    {
      short: "Zero-Overhead OOD",
      sub: "Deployment",
      title: "05 · Detached Zero-Overhead Inference & Clinical Crisis Generalization",
      summary: "At deployment, the entire KG Prior Engine is cleanly detached. Only the trained Base World Model runs—delivering fast, zero-overhead forecasts that generalize reliably to unseen clinical crises, rare drug combinations, and cross-hospital transfer.",
      bullets: [
        "0 extra inference parameters, 0 graph-query latency—runs at full native neural speed at the bedside.",
        "Counterfactual intervention directions remain physiologically faithful even in rare crisis states (shock, hypotension, titration).",
        "Transfers cleanly across clinical environments (MIMIC-III ICU → VitalDB Operating Room) out-of-distribution."
      ],
      ioIn: "Bedside patient vitals + Planned intervention (KG Engine detached)",
      ioOut: "Physiologically faithful 1–30 min vital trajectories (0 overhead)",
      guarantee: "Outperforms frontier LLMs and open-source time-series foundation models on 1-min clinical crisis OOD benchmarks."
    },
  ];

  const modelCanvas = document.getElementById("modelCanvas");
  const mCtx = modelCanvas ? modelCanvas.getContext("2d") : null;
  const modelState = { idx: 0, anim: 1, playing: false, timer: null, w: 1100, h: 470, t: 0 };

  function buildModelStepper() {
    const el = document.getElementById("modelStepper");
    if (!el) return;
    el.innerHTML = MODEL_STAGES.map((st, i) => `
      <button class="step-btn ${i === modelState.idx ? "active" : ""} ${i < modelState.idx ? "passed" : ""}" data-midx="${i}">
        <span class="step-num">STEP 0${i + 1}</span>
        <span class="step-short">${esc(st.short)}</span>
        <span class="step-stat">${esc(st.sub)}</span>
      </button>
    `).join("");
    el.querySelectorAll(".step-btn").forEach((b) => b.addEventListener("click", () => {
      stopModelPlay();
      setModelStage(Number(b.dataset.midx));
    }));
  }

  function setModelStage(i) {
    modelState.idx = (i + MODEL_STAGES.length) % MODEL_STAGES.length;
    modelState.anim = 0;
    buildModelStepper();
    const st = MODEL_STAGES[modelState.idx];
    document.getElementById("modelStageTitle").textContent = st.title;
    document.getElementById("modelStageSummary").textContent = st.summary;
    document.getElementById("modelStageBullets").innerHTML = st.bullets.map((b) => `<li>${esc(b)}</li>`).join("");
    document.getElementById("modelStageIO").innerHTML =
      `<span class="io-in">INPUT  ▸ ${esc(st.ioIn)}</span><span class="io-out">OUTPUT ▸ ${esc(st.ioOut)}</span>`;
    document.getElementById("modelStageGuarantee").textContent = st.guarantee;
  }

  function stopModelPlay() {
    modelState.playing = false;
    clearInterval(modelState.timer);
    modelState.timer = null;
    const bp = document.getElementById("btnModelPlay");
    if (bp) bp.textContent = "▶ Play";
  }

  const btnMP = document.getElementById("btnModelPlay");
  if (btnMP) {
    btnMP.addEventListener("click", () => {
      if (modelState.playing) stopModelPlay();
      else {
        modelState.playing = true;
        btnMP.textContent = "❚❚ Pause";
        if (modelState.idx === MODEL_STAGES.length - 1) setModelStage(0);
        modelState.timer = setInterval(() => {
          if (modelState.idx >= MODEL_STAGES.length - 1) stopModelPlay();
          else setModelStage(modelState.idx + 1);
        }, 4200);
      }
    });
    document.getElementById("btnModelPrev").addEventListener("click", () => { stopModelPlay(); setModelStage(modelState.idx - 1); });
    document.getElementById("btnModelNext").addEventListener("click", () => { stopModelPlay(); setModelStage(modelState.idx + 1); });
  }

  function resizeModelCanvas() {
    if (!modelCanvas) return;
    const rect = modelCanvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    modelState.w = Math.max(700, rect.width);
    modelState.h = Math.max(430, rect.height);
    modelCanvas.width = modelState.w * dpr;
    modelCanvas.height = modelState.h * dpr;
    mCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawModelFrame() {
    if (ACTIVE_VIEW !== "model" || !mCtx) return;
    const ctx = mCtx, W = modelState.w, H = modelState.h, S = modelState.idx;
    modelState.t += 0.016;
    if (modelState.anim < 1) modelState.anim = Math.min(1, modelState.anim + 0.024);
    const anim = easeOutCubic(modelState.anim);
    ctx.clearRect(0, 0, W, H);

    // Coordinates of the unified end-to-end architecture (pure hairline editorial style, zero filled boxes!)
    const xIn = W * 0.13, xWM = W * 0.44, xOut = W * 0.80;
    const yTop = H * 0.27;     // Forward Inference Highway (always active)
    const yBot = H * 0.72;     // KG Prior & Loss Engine (Training Only -> fades & detaches at Step 5!)

    // Clean horizontal lane divider (Training-only zone below)
    ctx.save();
    ctx.strokeStyle = COLORS.hairline;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W * 0.04, H * 0.50); ctx.lineTo(W * 0.96, H * 0.50); ctx.stroke();
    ctx.setLineDash([]);
    drawHaloText(ctx, "INFERENCE HIGHWAY (ACTIVE AT TRAINING & DEPLOYMENT)", W * 0.05, H * 0.48, COLORS.steel, "600 9.5px ui-monospace, Consolas, monospace", "left");
    drawHaloText(ctx, S === 4 ? "TRAINING-ONLY KG ENGINE (DETACHED AT DEPLOYMENT — 0 OVERHEAD)" : "ALL-IN-LOSS KG SUPERVISION ENGINE (TRAINING ONLY)", W * 0.05, H * 0.535, S === 4 ? COLORS.muted : COLORS.ochre, "600 9.5px ui-monospace, Consolas, monospace", "left");
    ctx.restore();

    const drawNodeOutline = (cx, cy, rw, rh, title, sub, col, active, dashed = false, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      // Zero-box Swiss editorial top hairline only (no rectangle frame!)
      ctx.strokeStyle = active ? col : "#cbd5e1";
      ctx.lineWidth = active ? 2.6 : 1.0;
      if (dashed) ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(cx - rw / 2, cy - rh / 2 + 12);
      ctx.lineTo(cx + rw / 2, cy - rh / 2 + 12);
      ctx.stroke();
      ctx.setLineDash([]);
      drawHaloText(ctx, title, cx, cy - 6, active ? COLORS.ink : COLORS.muted, "700 13px Georgia, serif");
      drawHaloText(ctx, sub, cx, cy + 13, active ? col : COLORS.muted, "500 10px ui-monospace, Consolas, monospace");
      ctx.restore();
    };

    const drawFlowArrow = (x1, y1, x2, y2, col, active, dashed = false, alpha = 1, pulse = true) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = active ? col : "#d1d5db";
      ctx.lineWidth = active ? 2.0 : 1.1;
      if (dashed) ctx.setLineDash([5, 3.5]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(y2 - y1, x2 - x1), sz = 6;
      ctx.fillStyle = active ? col : "#d1d5db";
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - sz * Math.cos(ang - 0.42), y2 - sz * Math.sin(ang - 0.42));
      ctx.lineTo(x2 - sz * Math.cos(ang + 0.42), y2 - sz * Math.sin(ang + 0.42));
      ctx.closePath(); ctx.fill();
      if (active && pulse) {
        const u = (modelState.t * 0.55) % 1;
        ctx.beginPath();
        ctx.arc(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, 3.3, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
      }
      ctx.restore();
    };

    // ---- TOP LANE: Inputs -> Base World Model -> Forecasts ----
    // Mini live waveform inside Inputs block
    drawNodeOutline(xIn, yTop, 176, 86, "Patient Inputs", "Vitals y(1:T) + Drugs a(t)", COLORS.steel, S >= 0);
    ctx.save();
    ctx.strokeStyle = COLORS.steel; ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let k = 0; k <= 36; k++) {
      const px = (xIn - 64) + (k / 36) * 128;
      const py = yTop + 28 + Math.sin(k * 0.45 + modelState.t * 2.5) * 6;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    const wmActive = S >= 1;
    drawNodeOutline(xWM, yTop, 224, 92, "Base Latent World Model", "z_t → Δz_t → ŷ(t+1:t+H)", COLORS.steel, wmActive);
    drawFlowArrow(xIn + 90, yTop, xWM - 114, yTop, COLORS.steel, wmActive, false, wmActive ? 1 : 0.35);

    const outActive = S >= 1;
    drawNodeOutline(xOut, yTop, 214, 92, S === 4 ? "OOD Crisis Forecast" : "Predicted Trajectories", S === 4 ? "0 Extra Params · 0 Latency" : "Factual ŷ(a) & Counterfactual ŷ(a+Δa)", S === 4 ? COLORS.steel : COLORS.ink, outActive);
    drawFlowArrow(xWM + 114, yTop, xOut - 109, yTop, COLORS.steel, outActive, false, outActive ? 1 : 0.35);

    // Mini predicted vital fan inside Output block when active
    if (outActive) {
      ctx.save();
      const ox0 = xOut - 70, oy0 = yTop + 27;
      ctx.strokeStyle = COLORS.steel; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const px = ox0 + (k / 24) * 140;
        const py = oy0 - Math.sin((k / 24) * 1.4) * 10;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (S >= 3) {
        ctx.strokeStyle = COLORS.cardinal; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) {
          const px = ox0 + (k / 24) * 140;
          const py = oy0 + Math.sin((k / 24) * 1.4) * 8;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ---- BOTTOM LANE (Training Only): Audited KG -> Diffusion & Context Critic -> All-in-Loss -> Gradients ----
    const kgAlpha = S < 2 ? 0.14 : (S === 4 ? Math.max(0.14, 1 - anim * 0.86) : (S === 2 ? anim : 1));
    const lossAlpha = S < 3 ? 0.14 : (S === 4 ? Math.max(0.14, 1 - anim * 0.86) : (S === 3 ? anim : 1));

    const xKG = W * 0.15, xDiff = W * 0.44, xLoss = W * 0.77;
    drawNodeOutline(xKG, yBot, 184, 82, "Audited Clinical KG", "985 Nodes · 3,964 Edges · 152 H", COLORS.ochre, S === 2 || S === 3, S === 4, kgAlpha);
    drawNodeOutline(xDiff, yBot, 246, 86, "Neural KG Prior Engine", "Signed Diffusion M_act + Context Gate g_ψ", COLORS.ochre, S === 2 || S === 3, S === 4, kgAlpha);
    drawFlowArrow(xKG + 94, yBot, xDiff - 125, yBot, COLORS.ochre, S === 2 || S === 3, S === 4, kgAlpha);

    drawNodeOutline(xLoss, yBot, 238, 86, "All-in-Loss Objective", "L_data + λ·L_act(Δa) + λ·L_traj(J_KG)", COLORS.cardinal, S === 3, S === 4, lossAlpha);
    drawFlowArrow(xDiff + 125, yBot, xLoss - 121, yBot, COLORS.ochre, S === 3, S === 4, lossAlpha);

    // Forecast -> Loss vertical connector
    drawFlowArrow(xOut, yTop + 48, xLoss + 24, yBot - 45, COLORS.cardinal, S === 3, true, lossAlpha);

    // Curved Gradient Backpropagation arrow from Loss -> Base World Model (Step 4!)
    if (S >= 3) {
      ctx.save();
      ctx.globalAlpha = lossAlpha;
      ctx.strokeStyle = COLORS.cardinal;
      ctx.lineWidth = S === 3 ? 2.2 : 1.1;
      ctx.setLineDash([6, 3.5]);
      ctx.beginPath();
      ctx.moveTo(xLoss - 60, yBot - 45);
      ctx.quadraticCurveTo(xWM + 140, H * 0.50, xWM + 25, yTop + 48);
      ctx.stroke();
      ctx.setLineDash([]);
      if (S === 3) {
        const u = (modelState.t * 0.55) % 1, v = 1 - u;
        const bx = v*v*(xLoss-60) + 2*v*u*(xWM+140) + u*u*(xWM+25);
        const by = v*v*(yBot-45) + 2*v*u*(H*0.50) + u*u*(yTop+48);
        ctx.beginPath(); ctx.arc(bx, by, 3.6, 0, Math.PI * 2); ctx.fillStyle = COLORS.cardinal; ctx.fill();
        drawHaloText(ctx, "Counterfactual Gradients (dL/dθ)", xWM + 145, H * 0.50 - 10, COLORS.cardinal, "700 10.5px -apple-system, Arial, sans-serif");
      }
      ctx.restore();
    }

    // Step 5 Detached Scissors / Clean Deployment Stamp
    if (S === 4) {
      ctx.save();
      ctx.globalAlpha = anim;
      drawHaloText(ctx, "✕ Detached at test time — 0 graph latency, 0 extra parameters", W * 0.48, yBot - 58, COLORS.cardinal, "700 11px -apple-system, Arial, sans-serif");
      drawHaloText(ctx, "✓ Pure World Model generalizes OOD (MIMIC-III ICU → VitalDB OR)", W - 16, H - 12, COLORS.steel, "600 11px ui-monospace, Consolas, monospace", "right");
      ctx.restore();
    }
  }

  function tick() {
    drawPipelineFrame();
    drawGraphFrame();
    drawReversalFrame();
    drawModelFrame();
    requestAnimationFrame(tick);
  }
  window.addEventListener("resize", () => { resizePipeCanvas(); resizeGraphCanvas(); resizeReversalCanvas(); resizeModelCanvas(); });

  buildStepper();
  setPipeStage(0);
  buildModelStepper();
  setModelStage(0);
  renderNodeLegend();
  initPathTracer();
  selectPreset("core", true);
  initReversalLab();
  renderFunnel();
  renderLedgerTable();
  renderConflictsTable();
  renderClaimsCrossCheck();
  resizePipeCanvas();
  resizeGraphCanvas();
  resizeReversalCanvas();
  resizeModelCanvas();
  requestAnimationFrame(tick);
})();
