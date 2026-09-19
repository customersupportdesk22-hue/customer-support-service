// public/live-feed.js — Honest activity popup with live dot

(function(){
  const TRUST_TITLE = 'Customer Support Service';
  const TRUST_MESSAGE = '24/7 · Response usually under 1 minute';
  const VISIBLE_MS = 5000;
  const MIN_GAP_MS = 6000;
  const TRUST_DELAY_MS = 3000;

  let lastShownAt = 0;
  let queue = [];
  let showing = false;
  let trustShown = false;

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

  // Animated live dot (green, pulsing)
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

  function showPopup(iconHtml, text){
    ensureKeyframes();
    const c = ensureContainer();
    const el = document.createElement('div');
    el.style.cssText =
      'background:#003D82;color:#fff;padding:12px 16px;border-radius:12px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.22);' +
      'font-family:Inter,system-ui,sans-serif;font-size:13.5px;' +
      'max-width:340px;display:flex;align-items:center;gap:10px;' +
      'transform:translateY(20px);opacity:0;' +
      'transition:transform .35s ease,opacity .35s ease;';
    el.innerHTML = iconHtml + '<span>' + text + '</span>';
    c.appendChild(el);

    requestAnimationFrame(() => {
      el.style.transform = 'translateY(0)';
      el.style.opacity = '1';
    });

    setTimeout(() => {
      el.style.transform = 'translateY(20px)';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, VISIBLE_MS);
  }

  function canShowNow(){
    return (Date.now() - lastShownAt) >= MIN_GAP_MS;
  }

  function pushEvent(iconHtml, text){
    queue.push({ iconHtml, text });
    drain();
  }

  function drain(){
    if (showing) return;
    if (!queue.length) return;
    if (!canShowNow()) {
      setTimeout(drain, MIN_GAP_MS - (Date.now() - lastShownAt));
      return;
    }
    const next = queue.shift();
    showing = true;
    lastShownAt = Date.now();
    showPopup(next.iconHtml, next.text);
    setTimeout(() => { showing = false; drain(); }, VISIBLE_MS + 500);
  }

  function showTrustPanel(){
    if (trustShown) return;
    trustShown = true;
    pushEvent(liveDot(), '<b>' + TRUST_TITLE + '</b><br>' + TRUST_MESSAGE);
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

  window.CSS_LiveFeed = {
    onEvent: function(type){
      const m = EVENT_MAP[type];
      if (!m) return;
      pushEvent(m[0], m[1]);
    },
    showTrust: showTrustPanel,
    loadRecent: async function(){
      try {
        const r = await fetch('/api/activity');
        const data = await r.json();
        if (!data.events || !data.events.length) return;
        const recent = data.events.slice(-3);
        recent.forEach(e => {
          const m = EVENT_MAP[e.type];
          if (m) pushEvent(m[0], m[1]);
        });
      } catch(e){}
    }
  };

  setTimeout(showTrustPanel, TRUST_DELAY_MS);
})();