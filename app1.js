(() => {
  // ---- Settings ----
  const CONFIG = {
    showSampleBadge: true,   // keep true while using made-up names
    showMs: 5000, minGapMs: 6000, maxGapMs: 14000, firstDelayMs: 2000,
    services: ['Starter Plan', 'Pro Plan', 'Website Audit', 'Trading Simulator', 'Strategy Ebook'],
    names: ['Thabo M.', 'Aisha K.', 'Sipho N.', 'Lerato D.', 'Pieter V.', 'Naledi S.', 'Kagiso P.', 'Zanele B.', 'Johan R.', 'Palesa T.'],
    cities: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Gqeberha', 'Bloemfontein', 'Midrand', 'Polokwane']
  };

  const host = document.getElementById('popupHost');
  let paused = false, timer = null;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function render() {
    const name = pick(CONFIG.names), mins = Math.floor(Math.random() * 55) + 1;
    const el = document.createElement('div');
    el.className = 'purchase-popup';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <div class="avatar">${esc(name[0])}</div>
      <div>
        <div class="fw-semibold">${esc(name)} from ${esc(pick(CONFIG.cities))}</div>
        <div class="small">purchased <strong>${esc(pick(CONFIG.services))}</strong></div>
        <div class="meta">${mins} minute${mins > 1 ? 's' : ''} ago${CONFIG.showSampleBadge ? ' · <span class="badge text-bg-warning">Sample</span>' : ''}</div>
      </div>
      <button class="btn-close close-btn" aria-label="Dismiss"></button>`;
    host.replaceChildren(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const hide = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); };
    el.querySelector('.close-btn').onclick = hide;
    setTimeout(hide, CONFIG.showMs);
  }

  function loop() {
    clearTimeout(timer);
    if (paused) return;
    timer = setTimeout(() => { render(); loop(); },
      CONFIG.minGapMs + Math.random() * (CONFIG.maxGapMs - CONFIG.minGapMs));
  }

  document.getElementById('toggleBtn').onclick = e => {
    paused = !paused;
    e.target.textContent = paused ? 'Resume popups' : 'Pause popups';
    loop();
  };
  document.getElementById('nowBtn').onclick = render;

  setTimeout(render, CONFIG.firstDelayMs);
  loop();
})();
