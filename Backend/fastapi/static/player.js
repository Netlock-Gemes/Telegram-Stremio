/* HRCinevon web player.
 * A vanilla port of the HR-FileStream player: controls hide while playing, the seek bar shows
 * what's buffered and seeks only on release (dragging doesn't fire a burst of range requests),
 * double tap on a side skips, press and hold plays at 2x, and the usual desktop keys work.
 */
(function () {
  "use strict";

  const SKIP = 10;
  const HIDE_AFTER = 2600;
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const HOLD_MS = 450;
  const HOLD_SPEED = 2;
  const HOLD_SLOP = 12; // a finger that moves further is scrolling, not holding

  // Lucide icons (same set as HR-FileStream), drawn at one stroke weight
  const PATHS = {
    play: '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
    back: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    fwd: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    vol2: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    vol1: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
    volx: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    pip: '<path d="M2 10h6V4"/><path d="m2 4 6 6"/><path d="M21 10V7a2 2 0 0 0-2-2h-7"/><path d="M3 14v2a2 2 0 0 0 2 2h3"/><rect x="12" y="14" width="10" height="7" rx="1"/>',
    max: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    min: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    ff: '<polygon points="13 19 22 12 13 5 13 19" fill="currentColor"/><polygon points="2 19 11 12 2 5 2 19" fill="currentColor"/>',
  };
  const icon = (name, size = 22) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

  function clock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    return h ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
  }
  function recall(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function remember(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

  /**
   * HRPlayer(mount, opts) -> { video, stage, flash(text, side), load(src, poster, title), destroy() }
   * opts: { src, poster, title, autoPlay, onTime(t, d, playing), onPause, onEnded, onLoaded(video), onFailed, failedHtml }
   */
  function HRPlayer(mount, opts) {
    opts = opts || {};
    mount.innerHTML = `
      <div class="hp-stage is-idle" tabindex="-1">
        <video class="hp-video" preload="metadata" playsinline></video>
        <button type="button" class="hp-big" aria-label="Play"><span>${icon("play", 38)}</span></button>
        <span class="hp-spin" hidden><span></span></span>
        <span class="hp-boost" hidden>${HOLD_SPEED}× ${icon("ff", 16)}</span>
        <span class="hp-toast" hidden></span>
        <div class="hp-bar">
          <div class="hp-seek" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0">
            <span class="hp-track"><span class="hp-buf"></span><span class="hp-fill"></span></span>
            <span class="hp-knob"></span>
            <span class="hp-tip" hidden></span>
          </div>
          <div class="hp-row">
            <button type="button" class="hp-btn" data-act="toggle" title="Play (k)" aria-label="Play (k)">${icon("play", 24)}</button>
            <button type="button" class="hp-btn" data-act="back" title="Back 10 seconds (j)" aria-label="Back 10 seconds (j)">${icon("back", 20)}</button>
            <button type="button" class="hp-btn" data-act="fwd" title="Forward 10 seconds (l)" aria-label="Forward 10 seconds (l)">${icon("fwd", 20)}</button>
            <div class="hp-vol">
              <button type="button" class="hp-btn" data-act="mute" title="Mute (m)" aria-label="Mute (m)">${icon("vol2", 20)}</button>
              <input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
            </div>
            <button type="button" class="hp-time" data-act="remaining" aria-label="Switch between elapsed and remaining time"><span class="hp-now">0:00</span> <span class="hp-dur">/ 0:00</span></button>
            <div class="hp-right">
              <div class="hp-speed-wrap">
                <button type="button" class="hp-btn" data-act="speed" title="Playback speed" aria-label="Playback speed" aria-expanded="false">${icon("gauge", 20)}</button>
                <ul class="hp-speeds" role="menu" hidden>
                  ${SPEEDS.map((v) => `<li><button type="button" role="menuitemradio" data-speed="${v}" aria-checked="false">${v === 1 ? "Normal" : v + "×"}</button></li>`).join("")}
                </ul>
              </div>
              <button type="button" class="hp-btn" data-act="pip" title="Picture in picture" aria-label="Picture in picture" hidden>${icon("pip", 20)}</button>
              <button type="button" class="hp-btn" data-act="fs" title="Full screen (f)" aria-label="Full screen (f)">${icon("max", 20)}</button>
            </div>
          </div>
        </div>
        <div class="hp-failed" hidden><div>
          <p class="hp-failed-title">This browser can't play this file.</p>
          <p class="hp-failed-sub">It's probably an MKV or HEVC encode. Open it in an external player instead.</p>
          <div class="hp-failed-actions"></div>
        </div></div>
      </div>`;

    const stage = mount.querySelector(".hp-stage");
    const video = stage.querySelector("video");
    const big = stage.querySelector(".hp-big");
    const spin = stage.querySelector(".hp-spin");
    const boostEl = stage.querySelector(".hp-boost");
    const toastEl = stage.querySelector(".hp-toast");
    const bar = stage.querySelector(".hp-bar");
    const seek = stage.querySelector(".hp-seek");
    const buf = stage.querySelector(".hp-buf");
    const fill = stage.querySelector(".hp-fill");
    const knob = stage.querySelector(".hp-knob");
    const tip = stage.querySelector(".hp-tip");
    const nowEl = stage.querySelector(".hp-now");
    const durEl = stage.querySelector(".hp-dur");
    const volRange = stage.querySelector(".hp-vol input");
    const speedsEl = stage.querySelector(".hp-speeds");
    const failedEl = stage.querySelector(".hp-failed");
    const btn = (act) => stage.querySelector(`[data-act="${act}"]`);

    let started = false, drag = null, target = null, pending = null, remaining = false;
    let hideTimer, tapTimer, holdTimer, toastTimer, lastTap = 0, holdFrom = null, held = null;

    // ---- helpers
    const playing = () => !video.paused && !video.ended;
    const shown = () => (drag ?? target ?? video.currentTime) || 0;

    function flash(text, side = "center") {
      toastEl.textContent = text;
      toastEl.dataset.side = side;
      toastEl.hidden = false;
      toastEl.style.animation = "none"; void toastEl.offsetWidth; toastEl.style.animation = "";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastEl.hidden = true), 900);
    }

    function setControls(on) {
      stage.classList.toggle("is-hidden", !on && playing() && speedsEl.hidden);
    }
    function showControls() {
      setControls(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (playing()) { closeSpeeds(); setControls(false); }
      }, HIDE_AFTER);
    }

    function toggle() { if (video.paused) video.play().catch(() => {}); else video.pause(); }

    function seekTo(goal) {
      if (!Number.isFinite(goal)) return;
      pending = goal; target = goal;
      video.currentTime = goal;
      paint();
    }
    function seekBy(seconds) {
      if (!Number.isFinite(video.duration)) return;
      const from = video.seeking && pending !== null ? pending : video.currentTime;
      seekTo(Math.min(Math.max(from + seconds, 0), video.duration));
      flash(seconds > 0 ? `+${seconds}s` : `${seconds}s`, seconds > 0 ? "right" : "left");
      showControls();
    }
    function changeVolume(value) {
      video.volume = Math.min(Math.max(value, 0), 1);
      video.muted = video.volume === 0;
      remember("hrp:volume", String(video.volume));
    }
    async function toggleFullscreen() {
      if (document.fullscreenElement) return document.exitFullscreen();
      if (stage.requestFullscreen) {
        await stage.requestFullscreen().catch(() => {});
        screen.orientation?.lock?.("landscape").catch(() => {});
      } else video.webkitEnterFullscreen?.(); // iPhone only offers the system player
    }
    function closeSpeeds() { speedsEl.hidden = true; btn("speed").setAttribute("aria-expanded", "false"); }

    function paint() {
      const d = video.duration || 0;
      const t = shown();
      const pct = d ? (t / d) * 100 : 0;
      fill.style.width = pct + "%";
      knob.style.left = pct + "%";
      nowEl.textContent = remaining ? `-${clock(d - t)}` : clock(t);
      durEl.textContent = `/ ${clock(d)}`;
      seek.setAttribute("aria-valuemax", String(Math.round(d)));
      seek.setAttribute("aria-valuenow", String(Math.round(t)));
      seek.setAttribute("aria-valuetext", `${clock(t)} of ${clock(d)}`);
    }
    function paintBuffered() {
      const d = video.duration;
      if (!d) return;
      let html = "";
      for (let i = 0; i < video.buffered.length; i++) {
        const s = video.buffered.start(i), e = video.buffered.end(i);
        html += `<span style="left:${(s / d) * 100}%;width:${((e - s) / d) * 100}%"></span>`;
      }
      buf.innerHTML = html;
    }
    function paintPlayState() {
      const p = !video.paused;
      const b = btn("toggle");
      b.innerHTML = icon(p ? "pause" : "play", 24);
      b.title = b.ariaLabel = p ? "Pause (k)" : "Play (k)";
      stage.classList.toggle("is-playing", p);
    }
    function paintVolume() {
      const v = video.muted ? 0 : video.volume;
      volRange.value = String(v);
      const b = btn("mute");
      b.innerHTML = icon(video.muted || video.volume === 0 ? "volx" : video.volume < 0.5 ? "vol1" : "vol2", 20);
      b.title = b.ariaLabel = video.muted ? "Unmute (m)" : "Mute (m)";
    }
    function paintSpeed() {
      const r = video.playbackRate;
      btn("speed").innerHTML = r === 1 || held !== null ? icon("gauge", 20) : `<span class="hp-rate">${r}×</span>`;
      speedsEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.speed) === r)));
    }
    function timeAt(clientX) {
      const box = seek.getBoundingClientRect();
      const share = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
      return { time: share * (video.duration || 0), x: share * box.width, share };
    }

    // ---- saved volume and speed
    const savedVolume = recall("hrp:volume");
    if (savedVolume !== null && Number.isFinite(Number(savedVolume))) video.volume = Number(savedVolume);
    const savedSpeed = Number(recall("hrp:speed"));
    if (SPEEDS.includes(savedSpeed)) video.defaultPlaybackRate = video.playbackRate = savedSpeed;
    if (document.pictureInPictureEnabled) btn("pip").hidden = false;

    // ---- video events
    video.addEventListener("play", () => { started = true; stage.classList.remove("is-idle"); paintPlayState(); showControls(); });
    video.addEventListener("pause", () => { paintPlayState(); setControls(true); opts.onPause?.(); });
    video.addEventListener("waiting", () => (spin.hidden = !started));
    ["playing", "canplay"].forEach((ev) => video.addEventListener(ev, () => (spin.hidden = true)));
    video.addEventListener("seeked", () => {
      spin.hidden = true;
      if (!video.seeking) { pending = null; target = null; paint(); }
    });
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth) stage.style.setProperty("--hp-ratio", `${video.videoWidth} / ${video.videoHeight}`);
      paint();
      opts.onLoaded?.(video);
    });
    video.addEventListener("durationchange", paint);
    video.addEventListener("timeupdate", () => { paint(); opts.onTime?.(video.currentTime, video.duration, !video.paused); });
    video.addEventListener("progress", paintBuffered);
    video.addEventListener("volumechange", paintVolume);
    video.addEventListener("ratechange", paintSpeed);
    video.addEventListener("ended", () => { setControls(true); opts.onEnded?.(); });
    video.addEventListener("error", () => {
      if (!video.currentSrc && !video.getAttribute("src")) return;
      failedEl.hidden = false; spin.hidden = true;
      opts.onFailed?.();
    });
    video.addEventListener("contextmenu", (e) => e.preventDefault()); // long press would open save-video

    // ---- stage pointer: mouse click plays, double click full screen; touch tap shows controls, double tap on a side skips
    stage.addEventListener("pointermove", (e) => e.pointerType !== "touch" && showControls());
    stage.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch" && playing()) { closeSpeeds(); setControls(false); } });

    function onScreenTap(e) {
      const box = stage.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width;
      const now = Date.now();
      const double = now - lastTap < 280;
      lastTap = now;
      if (e.pointerType === "touch") {
        if (double && (x < 0.38 || x > 0.62)) { clearTimeout(tapTimer); seekBy(x < 0.5 ? -SKIP : SKIP); return; }
        tapTimer = setTimeout(() => {
          if (!stage.classList.contains("is-hidden") && playing()) { clearTimeout(hideTimer); closeSpeeds(); setControls(false); }
          else showControls();
        }, 240);
        return;
      }
      clearTimeout(tapTimer);
      if (double) { toggleFullscreen(); return; }
      tapTimer = setTimeout(toggle, 240);
    }
    function endHold() {
      clearTimeout(holdTimer);
      holdFrom = null;
      if (held === null) return false;
      video.playbackRate = held;
      held = null;
      boostEl.hidden = true;
      paintSpeed();
      return true;
    }
    video.addEventListener("pointerdown", (e) => {
      if (video.paused || (e.pointerType === "mouse" && e.button !== 0)) return;
      holdFrom = { x: e.clientX, y: e.clientY };
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        held = video.playbackRate;
        video.playbackRate = Math.max(HOLD_SPEED, video.playbackRate);
        boostEl.hidden = false;
        clearTimeout(tapTimer); clearTimeout(hideTimer);
        closeSpeeds(); setControls(false);
        navigator.vibrate?.(12);
      }, HOLD_MS);
    });
    video.addEventListener("pointermove", (e) => {
      if (holdFrom && held === null && Math.hypot(e.clientX - holdFrom.x, e.clientY - holdFrom.y) > HOLD_SLOP) {
        clearTimeout(holdTimer); holdFrom = null;
      }
    });
    video.addEventListener("pointerup", (e) => { if (!endHold()) onScreenTap(e); });
    video.addEventListener("pointercancel", endHold);
    video.addEventListener("pointerleave", endHold);
    big.addEventListener("click", toggle);

    // ---- seek bar: drag shows the target, release seeks once
    seek.addEventListener("pointerdown", (e) => { seek.setPointerCapture(e.pointerId); drag = timeAt(e.clientX).time; seek.classList.add("is-drag"); paint(); showTip(e.clientX); });
    seek.addEventListener("pointermove", (e) => {
      if (drag !== null) { drag = timeAt(e.clientX).time; paint(); }
      if (e.pointerType !== "touch" || drag !== null) showTip(e.clientX);
    });
    seek.addEventListener("pointerleave", () => drag === null && (tip.hidden = true));
    seek.addEventListener("pointerup", (e) => {
      if (drag === null) return;
      const goal = timeAt(e.clientX).time;
      drag = null; seek.classList.remove("is-drag"); tip.hidden = true;
      seekTo(goal);
      showControls();
    });
    seek.addEventListener("pointercancel", () => { drag = null; seek.classList.remove("is-drag"); tip.hidden = true; paint(); });
    seek.addEventListener("keydown", (e) => {
      if (e.key === "Home") { e.preventDefault(); seekTo(0); }
      else if (e.key === "End" && video.duration) { e.preventDefault(); seekTo(video.duration - 1); }
    });
    function showTip(clientX) {
      if (!video.duration) return;
      const at = timeAt(clientX);
      tip.hidden = false;
      tip.style.left = at.x + "px";
      tip.textContent = clock(drag ?? at.time);
    }

    // ---- buttons
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "toggle") toggle();
      else if (act === "back") seekBy(-SKIP);
      else if (act === "fwd") seekBy(SKIP);
      else if (act === "mute") video.muted = !video.muted;
      else if (act === "remaining") { remaining = !remaining; paint(); }
      else if (act === "speed") {
        speedsEl.hidden = !speedsEl.hidden;
        b.setAttribute("aria-expanded", String(!speedsEl.hidden));
      } else if (act === "pip") {
        (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture())?.catch(() => {});
      } else if (act === "fs") toggleFullscreen();
      showControls();
    });
    speedsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-speed]");
      if (!b) return;
      const v = Number(b.dataset.speed);
      video.defaultPlaybackRate = video.playbackRate = v;
      remember("hrp:speed", String(v));
      closeSpeeds();
    });
    volRange.addEventListener("input", () => changeVolume(Number(volRange.value)));

    function onFullscreen() {
      const fs = document.fullscreenElement === stage;
      stage.classList.toggle("is-fs", fs);
      const b = btn("fs");
      b.innerHTML = icon(fs ? "min" : "max", 20);
      b.title = b.ariaLabel = fs ? "Exit full screen (f)" : "Full screen (f)";
    }
    document.addEventListener("fullscreenchange", onFullscreen);

    // ---- keyboard, as in every desktop player
    function onKey(e) {
      const t = e.target;
      if (t.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const key = e.key.toLowerCase();
      if (key === " " || key === "k") {
        if (t.closest?.("button, a") && key === " ") return;
        e.preventDefault(); toggle();
      } else if (key === "arrowleft" || key === "j") { e.preventDefault(); seekBy(-SKIP); }
      else if (key === "arrowright" || key === "l") { e.preventDefault(); seekBy(SKIP); }
      else if (key === "arrowup") { e.preventDefault(); changeVolume(video.volume + 0.05); flash(`Volume ${Math.round(video.volume * 100)}%`); }
      else if (key === "arrowdown") { e.preventDefault(); changeVolume(video.volume - 0.05); flash(`Volume ${Math.round(video.volume * 100)}%`); }
      else if (key === "m") { e.preventDefault(); video.muted = !video.muted; flash(video.muted ? "Muted" : "Sound on"); }
      else if (key === "f") { e.preventDefault(); toggleFullscreen(); }
      else if (/^[0-9]$/.test(key) && !e.shiftKey && Number.isFinite(video.duration)) { e.preventDefault(); seekTo((video.duration * Number(key)) / 10); }
      else return;
      showControls();
    }
    document.addEventListener("keydown", onKey);

    function load(src, poster, title) {
      failedEl.hidden = true;
      started = false; target = null; pending = null; drag = null;
      stage.classList.add("is-idle");
      buf.innerHTML = "";
      if (poster) video.poster = poster; else video.removeAttribute("poster");
      big.setAttribute("aria-label", `Play ${title || ""}`.trim());
      video.src = src;
      video.load();
      paint(); paintPlayState();
    }

    if (opts.failedHtml) failedEl.querySelector(".hp-failed-actions").innerHTML = opts.failedHtml;
    paintVolume(); paintSpeed();
    if (opts.src) load(opts.src, opts.poster, opts.title);

    return {
      video, stage, flash, load,
      setFailedActions(html) { failedEl.querySelector(".hp-failed-actions").innerHTML = html; },
      destroy() { document.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFullscreen); },
    };
  }

  window.HRPlayer = HRPlayer;
  window.HRPlayer.clock = clock;
})();
