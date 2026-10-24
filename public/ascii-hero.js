/* ASCII hover-reveal for the hero section.
   Usage: <script src="ascii-hero.js" data-src="pic1.jpg" data-size="1.3"></script>
   Optional: data-mode="photo|ascii|particles", data-ascii="off" */
const __ASCII_SRC = document.currentScript && document.currentScript.getAttribute('data-src');
const __ASCII_OFF = document.currentScript && document.currentScript.getAttribute('data-ascii') === 'off';
const __MODE = (document.currentScript && document.currentScript.getAttribute('data-mode')) || 'photo';
const __SIZE = parseFloat(document.currentScript && document.currentScript.getAttribute('data-size')) || 1;
function __asciiHero() {
  const PART = __MODE === 'particles';
  const PHOTO = __MODE === 'photo';
  const SRC = __ASCII_SRC;
  if (!SRC) { console.warn('ascii-hero: add data-src="your-image.jpg" to the script tag.'); return; }
  const hero = document.querySelector('main > section');
  if (!hero) return;

  const st = document.createElement('style');
  st.textContent = '#asciiHero{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}' +
    'main > section:first-of-type > :not(#asciiHero){position:relative;z-index:1}';
  document.head.appendChild(st);

  const cv = document.createElement('canvas');
  cv.id = 'asciiHero';
  cv.setAttribute('aria-hidden', 'true');
  hero.prepend(cv);
  const ctx = cv.getContext('2d');

  const RAMP = " .'`,:;-~+=*";
  const DARK = '#0D47A1', ACCENT = '#2196F3', LIGHT = '#E3F2FD';   // site palette
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, FS = 13, cw = 8, chh = 14, cols = 0, rows = 0;
  let ph, lum, rev, scr, img = null, photo = null, mask = null, mctx = null;
  let px = 0, py = 0, inside = false, glow = 0, running = false, last = 0;
  let ds = 1, visible = true, resizeQ = 0, holdT = 0, lastW = 0, lastH = 0;
  const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  function layout() {
    const r = hero.getBoundingClientRect();
    W = r.width; H = r.height;
    if (!W || !H || (Math.abs(W - lastW) < 1 && Math.abs(H - lastH) < 1 && rev)) return;
    lastW = W; lastH = H;
    let dpr = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2);
    while (W * H * dpr * dpr > 9e6 && dpr > 1) dpr -= 0.25;
    ds = dpr;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    FS = W < 640 ? 8 : 9;
    ctx.font = FS + 'px "Courier New", monospace';
    cw = ctx.measureText('M').width; chh = FS * 1.1;
    if (PART) { let sp = W < 640 ? 6 : 7; while ((W / sp) * (H / sp) > 22000) sp++; cw = chh = sp; }
    cols = Math.ceil(W / cw); rows = Math.ceil(H / chh);
    rev = new Float32Array(cols * rows);
    scr = new Float32Array(cols * rows);
    ph = new Float32Array(cols * rows);
    for (let q = 0; q < ph.length; q++) ph[q] = Math.random() * 6.283;
    sample();
  }

  function sample() {
    if (!img || !cols) return;
    const o = document.createElement('canvas');
    o.width = cols; o.height = rows;
    const c = o.getContext('2d', { willReadFrequently: true });
    const s = Math.max(W / img.width, H / img.height);          // "cover" fit
    const dw = img.width * s / cw, dh = img.height * s / chh;
    c.drawImage(img, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
    photo = document.createElement('canvas'); photo.width = Math.round(W * ds); photo.height = Math.round(H * ds);
    photo.getContext('2d').drawImage(img, (W - img.width * s) / 2 * ds, (H - img.height * s) / 2 * ds, img.width * s * ds, img.height * s * ds);
    mask = document.createElement('canvas'); mask.width = photo.width; mask.height = photo.height; mctx = mask.getContext('2d');
    if (PHOTO) return;                       // plain reveal needs no pixel reading
    let d;
    try { d = c.getImageData(0, 0, cols, rows).data; }
    catch (e) { console.warn('ascii-hero: browser blocked reading the image. Serve the page from a local server or host the image on the same site (file:// blocks this).'); return; }
    lum = new Float32Array(cols * rows);
    const hist = new Float32Array(256);
    for (let i = 0; i < lum.length; i++) hist[d[i * 4]]++;
    const cdf = new Float32Array(256); let acc = 0;
    for (let k = 0; k < 256; k++) { acc += hist[k]; cdf[k] = acc / lum.length; }
    for (let i = 0; i < lum.length; i++) {
      const dark = 1 - cdf[d[i * 4]];
      lum[i] = Math.min(1, Math.max(0, (dark - 0.1) / 0.9));
    }
    if (PART) {
      const tmp = new Float32Array(lum.length), mean = new Float32Array(lum.length), R2 = 4;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let a = 0, n = 0;
        for (let k = -R2; k <= R2; k++) { const cc = c + k; if (cc >= 0 && cc < cols) { a += lum[r * cols + cc]; n++; } }
        tmp[r * cols + c] = a / n;
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let a = 0, n = 0;
        for (let k = -R2; k <= R2; k++) { const rr = r + k; if (rr >= 0 && rr < rows) { a += tmp[rr * cols + c]; n++; } }
        mean[r * cols + c] = a / n;
      }
      for (let i = 0; i < lum.length; i++)
        lum[i] = Math.min(1, Math.max(0, lum[i] * 0.4 + (lum[i] - mean[i]) * 2.4 + 0.2));
    }
  }

  function frame(t) {
    if (!visible || document.hidden) { running = false; return; }
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    ctx.clearRect(0, 0, W, H);
    glow += ((inside ? 1 : 0) - glow) * 0.12;
    const R = Math.max(coarse ? 90 : 120, Math.min(Math.min(W, H) * (W < 640 ? 0.42 : 0.3), 340)) * __SIZE;

    if (!PHOTO && glow > 0.01) {
      const g = ctx.createRadialGradient(px, py, 0, px, py, R * 1.1);
      g.addColorStop(0, 'rgba(33,150,243,' + 0.16 * glow + ')');
      g.addColorStop(1, 'rgba(33,150,243,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    if (!PART && photo && glow > 0.01) {            // the real photo fades in under the cursor
      mctx.globalCompositeOperation = 'source-over';
      mctx.clearRect(0, 0, mask.width, mask.height); mctx.drawImage(photo, 0, 0);
      const g2 = mctx.createRadialGradient(px * ds, py * ds, 0, px * ds, py * ds, R * ds);
      g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.5, 'rgba(0,0,0,1)');
      g2.addColorStop(0.75, 'rgba(0,0,0,0.5)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.globalCompositeOperation = 'destination-in';
      mctx.fillStyle = g2; mctx.fillRect(0, 0, mask.width, mask.height);
      ctx.globalAlpha = (PHOTO ? 1 : 0.85) * glow; ctx.drawImage(mask, 0, 0, W, H); ctx.globalAlpha = 1;
    }
    ctx.font = FS + 'px "Courier New", monospace';
    ctx.textBaseline = 'middle';
    let any = false;
    if (lum && !PHOTO) for (let r = 0; r < rows; r++) {
      const cy = (r + 0.5) * chh;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let target = 0;
        if (inside) {
          const dx = (c + 0.5) * cw - px, dy = cy - py;
          const q = Math.min(1, (1 - Math.sqrt(dx * dx + dy * dy) / R) * 2);
          if (q > 0) target = q * q * (3 - 2 * q);
        }
        let v = rev[i];
        if (target > v) {
          if (v < 0.02 && target > 0.05 && motion) scr[i] = 0.2 + Math.random() * 0.3;
          v += (target - v) * 0.4;
        } else v = Math.max(target, v - dt * 0.9);
        if (v < 0.015) { rev[i] = 0; continue; }
        rev[i] = v; any = true;
        if (PART) {
          const bs = lum[i];
          if (bs < 0.05) continue;
          const sc = (1 - v) * (1 - v) * 46;
          const x = (c + 0.5) * cw + Math.cos(ph[i]) * sc + Math.sin(t * 0.002 + i) * 0.7;
          const y = cy + Math.sin(ph[i]) * sc + Math.cos(t * 0.0017 + i * 1.7) * 0.7;
          ctx.globalAlpha = Math.min(1, v * 1.3) * (0.45 + 0.55 * bs);
          ctx.fillStyle = bs > 0.45 ? DARK : ACCENT;
          ctx.beginPath(); ctx.arc(x, y, cw * (0.12 + 0.3 * bs) * (0.5 + 0.5 * v), 0, 6.283); ctx.fill();
          continue;
        }
        if (__ASCII_OFF) continue;

        const base = lum[i];
        if (base < 0.04) continue;
        let k = base * (RAMP.length - 1);
        if (scr[i] > 0) { scr[i] -= dt; k = Math.random() * (RAMP.length - 1); }
        else if (motion) k += Math.sin(t * 0.004 + c * 0.35 + r * 0.25) * 0.7;
        k = Math.max(0, Math.min(RAMP.length - 1, Math.round(k)));
        const ch = RAMP[k];
        if (ch === ' ') continue;
        const core = v > 0.5;               // light glyphs over the photo, dark glyphs at the edge
        ctx.globalAlpha = core ? Math.min(1, (v - 0.4) * 2) * (0.3 + 0.55 * base) : Math.min(1, v * 1.4) * 0.6;
        ctx.fillStyle = core ? LIGHT : (k >= 3 ? DARK : ACCENT);
        ctx.fillText(ch, c * cw, cy);
      }
    }
    ctx.globalAlpha = 1;
    if (any || inside || glow > 0.01) requestAnimationFrame(frame);
    else running = false;
  }
  function kick() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } }

  function at(x, y) {
    const r = hero.getBoundingClientRect();
    px = x - r.left; py = y - r.top; inside = true; kick();
  }
  function pmove(e) { if (e.pointerType !== 'touch') { clearTimeout(holdT); at(e.clientX, e.clientY); } }
  function tmove(e) { const t = e.touches[0]; if (t) { clearTimeout(holdT); at(t.clientX, t.clientY); } }
  function tend() { clearTimeout(holdT); holdT = setTimeout(() => { inside = false; kick(); }, 700); }
  hero.addEventListener('pointermove', pmove);
  hero.addEventListener('pointerdown', pmove);
  hero.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') { inside = false; kick(); } });
  hero.addEventListener('touchstart', tmove, { passive: true });
  hero.addEventListener('touchmove', tmove, { passive: true });
  hero.addEventListener('touchend', tend, { passive: true });
  hero.addEventListener('touchcancel', tend, { passive: true });
  if ('IntersectionObserver' in window)
    new IntersectionObserver(en => { visible = en[0].isIntersecting; if (visible) kick(); }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  new ResizeObserver(() => { cancelAnimationFrame(resizeQ); resizeQ = requestAnimationFrame(() => { layout(); kick(); }); }).observe(hero);
  const im = new Image();
  im.onload = () => { img = im; sample(); };
  im.onerror = () => console.warn('ascii-hero: image failed to load: ' + SRC.slice(0, 80) + ' (is it next to index.html?)');
  if (!PHOTO && SRC.slice(0, 5) !== 'data:') im.crossOrigin = 'anonymous';
  im.src = SRC;
  layout();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __asciiHero); else __asciiHero();