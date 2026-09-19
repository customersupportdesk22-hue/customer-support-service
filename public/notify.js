// public/notify.js — Shared notification helper

(function(){
  // Soft "ding" sound using Web Audio API (no sound file needed)
  function playDing(){
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      o.start(); o.stop(ctx.currentTime + 0.3);
    } catch(e){}
  }

  // Corner popup
  function showPopup(title, body){
    let box = document.getElementById('__notify_popup');
    if (!box) {
      box = document.createElement('div');
      box.id = '__notify_popup';
      box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;' +
        'background:#003D82;color:#fff;padding:12px 16px;border-radius:10px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.25);font-family:Inter,system-ui,sans-serif;' +
        'font-size:14px;max-width:320px;transition:transform .3s,opacity .3s;' +
        'transform:translateY(-100%);opacity:0;';
      document.body.appendChild(box);
    }
    box.innerHTML = '<div style="font-weight:700;margin-bottom:4px">' + title + '</div>' +
                    '<div style="font-size:13px;opacity:.9">' + body + '</div>';
    requestAnimationFrame(() => {
      box.style.transform = 'translateY(0)';
      box.style.opacity = '1';
    });
    clearTimeout(box.__t);
    box.__t = setTimeout(() => {
      box.style.transform = 'translateY(-100%)';
      box.style.opacity = '0';
    }, 4000);
  }

  // Flash tab title
  let originalTitle = document.title;
  let flashInterval = null;
  function flashTitle(msg){
    if (flashInterval) return;
    let on = false;
    flashInterval = setInterval(() => {
      document.title = on ? originalTitle : msg;
      on = !on;
    }, 1000);
    window.addEventListener('focus', stopFlash, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') stopFlash();
    });
  }
  function stopFlash(){
    if (flashInterval) clearInterval(flashInterval);
    flashInterval = null;
    document.title = originalTitle;
  }

  // Browser push notification
  let pushReady = false;
  function requestPushPermission(){
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { pushReady = true; return; }
    if (Notification.permission === 'denied') return;
    Notification.requestPermission().then(p => { pushReady = (p === 'granted'); });
  }
  function pushNotify(title, body){
    if (!pushReady) return;
    if (document.visibilityState === 'visible') return;
    try {
      new Notification(title, { body, icon: '/favicon.svg', tag: 'css-msg' });
    } catch(e){}
  }

  // Vibrate phone
  function vibrate(){
    try { if (navigator.vibrate) navigator.vibrate(120); } catch(e){}
  }

  // Master function
  window.CSS_Notify = function(title, body, opts){
    opts = opts || {};
    if (opts.sound !== false) playDing();
    if (opts.popup !== false) showPopup(title, body);
    if (opts.flash !== false) flashTitle(title);
    if (opts.push !== false) pushNotify(title, body);
    if (opts.vibrate !== false) vibrate();
  };

  window.CSS_RequestPush = requestPushPermission;
  window.CSS_StopFlash = stopFlash;
})();