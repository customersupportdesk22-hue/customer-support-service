// public/live-feed.js — Honest activity popup
// Shows trust panel once, then real events only.

(function(){
  const TRUST_MESSAGE = 'Online 24/7 · Response under 1 minute';
  const VISIBLE_MS = 5000;            // each popup stays 5s
  const MIN_GAP_MS = 6000;            // min gap between popups
  const TRUST_DELAY_MS = 3000;        // delay before trust panel appears

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

  function showPopup(emoji, text){
    const c = ensureContainer();
    const el = document.createElement('div');
    el.style.cssText =
      'background:#003D82;color:#fff;padding:12px 16px;border-radius:12px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.22);' +
      'font-family:Inter,system-ui,sans-serif;font-size:13.5px;' +
      'max-width:340px;display:flex;align-items:center;gap:10px;' +
      'transform:translateY(20px);opacity:0;' +
      'transition:transform .35s ease,opacity .35s ease;';
    el.innerHTML = '<span style="font-size:18px">' + emoji + '</span><span>' + text + '</span>';
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

  function pushEvent(emoji, text){
    queue.push({ emoji, text });
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
    showPopup(next.emoji, next.text);
    setTimeout(() => { showing = false; drain(); }, VISIBLE_MS + 500);
  }

  function showTrustPanel(){
    if (trustShown) return;
    trustShown = true;
    pushEvent('✅', '<b>Customer Support Service</b><br>' + TRUST_MESSAGE);
  }

  const EVENT_MAP = {
    join:      ['💬', 'A customer just started a chat'],
    refund:    ['💰', 'A refund request was submitted'],
    delay:     ['✈️', 'A flight delay case was opened'],
    baggage:   ['🧳', 'A baggage issue was reported'],
    complaint: ['📢', 'A complaint was filed'],
    change:    ['🔄', 'A flight change was requested'],
    status:    ['🛫', 'A flight status enquiry was made'],
    resolved:  ['✅', 'A customer chat was resolved']
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

  // Auto-trigger trust panel after a short delay
  setTimeout(showTrustPanel, TRUST_DELAY_MS);
})();