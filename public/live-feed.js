// public/live-feed.js — Sticky trust panel + real events

(function(){
  const TRUST_TITLE = 'Customer Support Live Chat';
  const TRUST_MESSAGE = '24/7 · Response usually under 5 minute';
  const TRUST_DELAY_MS = 3000;
  const EVENT_VISIBLE_MS = 6000;   // how long a real event stays before trust returns
  const MIN_GAP_MS = 3000;

  let lastShownAt = 0;
  let trustShown = false;
  let currentPopup = null;
  let revertTimer = null;

  function ensureContainer(){
    let c = document.getElementById('__live_feed');
    if (c) return c;
    c = document.createElement('div');
    c.id = '__live_feed';
    c.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:99998;' +
      'display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(c);
    return c;
  }

  function liveDot(){
    return '<span style="display:inline-block;width:10px;height:10px;' +
           'background:#2F855A;border-radius:50%;' +
           'box-shadow:0 0 0 0 rgba(47,133,90,.7);' +
           'animation:__live_pulse 1.8s infinite;flex-shrink:0;"></span>';
  }

  function ensureKeyframes(){
    if (document.getElementById('__live_kf')) return;
    const style = document.createElement('style');
    style.id = '__live_kf';
    style.textContent = '@keyframes __live_pulse{' +
      '0%{box-shadow:0 0 0 0 rgba(47,133,90,.7)}' +
      '70%{box-shadow:0 0 0 10px rgba(47,133,90,0)}' +
      '100%{box-shadow:0 0 0 0 rgba(47,133,90,0)}}';
    document.head.appendChild(style);
  }

  function buildPopup(){
    const c = ensureContainer();
    const el = document.createElement('div');
    el.style.cssText =
      'background:#003D82;color:#fff;padding:12px 16px;border-radius:12px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.22);' +
      'font-family:Inter,system-ui,sans-serif;font-size:13.5px;' +
      'max-width:340px;display:flex;align-items:center;gap:10px;' +
      'transform:translateY(20px);opacity:0;' +
      'transition:transform .35s ease,opacity .35s ease;';
    c.appendChild(el);
    return el;
  }

  function render(iconHtml, text){
    ensureKeyframes();
    if (!currentPopup) {
      currentPopup = buildPopup();
      requestAnimationFrame(() => {
        currentPopup.style.transform = 'translateY(0)';
        currentPopup.style.opacity = '1';
      });
    }
    currentPopup.innerHTML = iconHtml + '<span>' + text + '</span>';
  }

  function showTrust(){
    render(liveDot(), '<b>' + TRUST_TITLE + '</b><br>' + TRUST_MESSAGE);
  }

  const EVENT_MAP = {
    join:      ['<span style="font-size:18px">💬</span>', 'A customer just started a chat'],
    refund:    ['<span style="font-size:18px">💰</span>', 'A refund request was submitted'],
    delay:     ['<span style="font-size:18px">✈️</span>', 'A flight delay case was opened'],
    baggage:   ['<span style="font-size:18px">🧳</span>', 'A baggage issue was reported'],
    complaint: ['<span style="font-size:18px">📢</span>', 'A complaint was filed'],
    change:    ['<span style="font-size:18px">🔄</span>', 'A flight change was requested'],
    status:    ['<span style="font-size:18px">🛫</span>', 'A flight status enquiry was made'],
    resolved:  ['<span style="font-size:18px">✅</span>', 'A customer chat was resolved']
  };

  function showEvent(type){
    const m = EVENT_MAP[type];
    if (!m) return;
    const now = Date.now();
    if (now - lastShownAt < MIN_GAP_MS) {
      // too soon — queue for later
      setTimeout(() => showEvent(type), MIN_GAP_MS);
      return;
    }
    lastShownAt = now;
    render(m[0], m[1]);
    // after a while, revert to the trust panel
    clearTimeout(revertTimer);
    revertTimer = setTimeout(showTrust, EVENT_VISIBLE_MS);
  }

  window.CSS_LiveFeed = {
    onEvent: showEvent,
    showTrust: showTrust,
    loadRecent: async function(){
      try {
        const r = await fetch('/api/activity');
        const data = await r.json();
        if (!data.events || !data.events.length) return;
        const recent = data.events.slice(-1);
        recent.forEach(e => showEvent(e.type));
      } catch(e){}
    }
  };

  // Show trust panel after a short delay, and keep it visible
  setTimeout(() => {
    if (!trustShown) {
      trustShown = true;
      showTrust();
    }
  }, TRUST_DELAY_MS);
})();