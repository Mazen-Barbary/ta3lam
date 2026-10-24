/* Swipe / drag support for the 3D tracks carousel.
   Add after your existing carousel script, before </body>:  <script src="carousel-swipe.js"></script> */
(function () {
  function init() {
    const stage = document.getElementById('carouselStage');
    if (!stage) return;
    const zone = stage.parentElement;
    const STEP = 60, GAIN = 1.6, THRESH = 6;

    const st = document.createElement('style');
    st.textContent =
      '.carousel-perspective{touch-action:pan-y;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}' +
      '.carousel-perspective.is-dragging{cursor:grabbing}' +
      '.carousel-perspective *{-webkit-user-drag:none}' +
      '.carousel-perspective:focus-visible{outline:2px solid #2196F3;outline-offset:6px;border-radius:16px}';
    document.head.appendChild(st);
    zone.tabIndex = 0;

    const radius = () => (window.innerWidth <= 768 ? 270 : 400);
    const degPerPx = () => (180 / (Math.PI * radius())) * GAIN;

    function shownAngle() {
      try {
        const m = new DOMMatrix(getComputedStyle(stage).transform);
        return Math.atan2(-m.m13, m.m11) * 180 / Math.PI;
      } catch (e) { return 0; }
    }
    function targetAngle() {
      const mt = /rotateY\((-?[\d.]+)deg\)/.exec(stage.style.transform || '');
      return mt ? parseFloat(mt[1]) : shownAngle();
    }
    function go(angle) {
      if (typeof setTrackAngle === 'function') setTrackAngle(angle);
      else {
        stage.style.animation = 'none';
        stage.style.transition = 'transform 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)';
        stage.style.transform = 'rotateY(' + angle + 'deg)';
      }
    }

    // Highlight the matching number button via the .is-active class defined in the page CSS
    const dots = Array.prototype.slice.call(document.querySelectorAll('.step-indicators button'));
    function markActive() {
      const mt = /rotateY\((-?[\d.]+)deg\)/.exec(stage.style.transform || '');
      if (!mt || !dots.length) return;
      const i = ((Math.round(-parseFloat(mt[1]) / STEP) % 6) + 6) % 6;
      dots.forEach(function (b, k) { b.classList.toggle('is-active', k === i); });
    }
    new MutationObserver(markActive).observe(stage, { attributes: true, attributeFilter: ['style'] });
    markActive();

    let down = false, engaged = false, id = null, x0 = 0, a0 = 0, angle = 0, samples = [];

    zone.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = true; engaged = false; id = e.pointerId; x0 = e.clientX; samples = [];
    });
    zone.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== id) return;
      if (!engaged) {
        if (Math.abs(e.clientX - x0) < THRESH) return;
        engaged = true;
        a0 = shownAngle();
        stage.style.animation = 'none';
        stage.style.transition = 'none';
        stage.style.transform = 'rotateY(' + a0 + 'deg)';
        x0 = e.clientX;
        zone.classList.add('is-dragging');
        try { zone.setPointerCapture(id); } catch (err) {}
      }
      angle = a0 + (e.clientX - x0) * degPerPx();
      stage.style.transform = 'rotateY(' + angle + 'deg)';
      const now = performance.now();
      samples.push({ t: now, a: angle });
      while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
    });
    function end(e) {
      if (!down || (e && e.pointerId !== id)) return;
      down = false;
      if (!engaged) return;
      engaged = false;
      zone.classList.remove('is-dragging');
      let v = 0;
      if (samples.length > 1) {
        const f = samples[0], l = samples[samples.length - 1];
        if (l.t > f.t) v = (l.a - f.a) / (l.t - f.t);
      }
      let target = Math.round((angle + v * 250) / STEP) * STEP;
      if (target === Math.round(a0 / STEP) * STEP && Math.abs(angle - a0) > 18)
        target += (angle > a0 ? 1 : -1) * STEP;
      target = Math.max(angle - 3 * STEP, Math.min(angle + 3 * STEP, target));
      go(target);
    }
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    // keyboard: arrows (next = left in RTL, same as the buttons)
    zone.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      go(Math.round(targetAngle() / STEP) * STEP + (e.key === 'ArrowLeft' ? -STEP : STEP));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();