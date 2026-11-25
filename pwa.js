/* Delta Properties: install-as-app + push notifications (loaded by index.html and chat.html) */
(function () {
  var API = 'https://house-hunt-server.onrender.com';
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
             set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var deferredInstall = null;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/service-worker.js').catch(function () {}); });
  }

  function b64ToU8(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }

  // Subscribe this phone and tell the server which chat it belongs to
  async function subscribe(cid) {
    var cfg = await (await fetch(API + '/api/push/key')).json();
    if (!cfg.enabled || !cfg.key) return false;
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    var want = b64ToU8(cfg.key);
    if (sub && sub.options && sub.options.applicationServerKey) {
      var have = new Uint8Array(sub.options.applicationServerKey), same = have.length === want.length;
      for (var i = 0; same && i < have.length; i++) if (have[i] !== want[i]) same = false;
      if (!same) { try { await sub.unsubscribe(); } catch (e) {} sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    var r = await fetch(API + '/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid: cid, subscription: sub.toJSON() }) });
    return r.ok;
  }

  // Must be called from a tap (iPhone requires it)
  function visitorId() {
    var id = ls.get('dp_cid');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
      ls.set('dp_cid', id);
    }
    return id;
  }
  window.dpEnablePush = async function () {
    var cid = visitorId();
    if (!cid || !pushSupported()) return false;
    try {
      var perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') return false;
      return await subscribe(cid);
    } catch (e) { return false; }
  };

  // Already allowed before? Quietly refresh the subscription on each visit.
  window.addEventListener('load', function () {
    if (pushSupported() && Notification.permission === 'granted') subscribe(visitorId()).catch(function () {});
  });

  var wantInstall = false;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; if (wantInstall) window.dpShowInstall(); });
  window.addEventListener('appinstalled', function () { deferredInstall = null; hide('dpBar'); ls.set('dp_installed', '1'); });

  function hide(id) { var el = document.getElementById(id); if (el) el.remove(); }
  function bar(id, html, bottom) {
    hide(id);
    var d = document.createElement('div'); d.id = id;
    d.style.cssText = 'position:fixed;left:10px;right:10px;' + (bottom ? 'bottom:calc(' + (document.querySelector('.bottom-nav') && getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none' ? '84px' : '12px') + ' + env(safe-area-inset-bottom,0px))' : 'top:8px') +
      ';z-index:99999;background:#14532d;color:#fff;border-radius:14px;padding:12px 14px;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);display:flex;align-items:center;gap:10px;max-width:520px;margin:0 auto';
    d.innerHTML = html; document.body.appendChild(d); return d;
  }
  var onChat = /chat\.html$/.test(location.pathname);
  var DAY = 864e5;
  var btn = 'border:none;border-radius:10px;padding:9px 14px;font-weight:700;font-size:13.5px;cursor:pointer;';

  // "Install app" banner. Stays on screen until the customer taps Install or the X (the X only hides it for 1 day).
  window.dpShowInstall = function () {
    if (isStandalone || ls.get('dp_installed')) return;
    if (Date.now() < Number(ls.get('dp_install_snooze') || 0)) return;
    var X = '<button id="dpNo" aria-label="Close" style="background:none;border:none;color:#fff;font-size:20px;padding:4px 6px">✕</button>';
    function snooze() { ls.set('dp_install_snooze', String(Date.now() + DAY)); hide('dpBar'); }
    if (deferredInstall) {
      var d = bar('dpBar', '<span style="flex:1">📲 <b>Install Delta Homes</b> on your phone for faster access and reply alerts.</span>' +
        '<button id="dpYes" style="' + btn + 'background:#fff;color:#14532d">Install</button>' + X, !onChat);
      d.querySelector('#dpYes').onclick = async function () {
        var choice = null;
        try { deferredInstall.prompt(); choice = await deferredInstall.userChoice; } catch (e) {}
        deferredInstall = null;
        if (choice && choice.outcome === 'accepted') hide('dpBar'); else snooze();
      };
      d.querySelector('#dpNo').onclick = snooze;
    } else if (isIOS) {
      var d2 = bar('dpBar', '<span style="flex:1">📲 To install: tap <b>Share</b> <span style="font-size:16px">⬆️</span> then <b>Add to Home Screen</b>. This also turns on reply alerts.</span>' + X, !onChat);
      d2.querySelector('#dpNo').onclick = snooze;
    } else {
      wantInstall = true; // Chrome has not offered install yet; show the banner the moment it does
    }
  };

  // Asks permission for notifications. kind 'chat' = reply alerts, 'home' = new-house alerts.
  // The banner stays on screen until the customer taps Turn on or the X (the X only hides it for 1 day).
  window.dpOfferPush = function (kind) {
    kind = kind || 'chat';
    if (isIOS && !isStandalone) { if (kind === 'chat') window.dpShowInstall(); return; } // iPhone only allows push once installed
    if (!pushSupported() || Notification.permission === 'denied') return;
    if (Notification.permission === 'granted') { window.dpEnablePush(); return; }
    if (Date.now() < Number(ls.get('dp_push_snooze') || 0)) return;
    var msg = kind === 'home' ? '🔔 Get an alert on your phone when new houses are listed?' : '🔔 Get a phone alert when our agent replies?';
    var d = bar('dpPushBar', '<span style="flex:1">' + msg + '</span>' +
      '<button id="dpOn" style="' + btn + 'background:#fff;color:#14532d">Turn on</button><button id="dpLater" aria-label="Close" style="background:none;border:none;color:#fff;font-size:20px;padding:4px 6px">✕</button>', false);
    d.querySelector('#dpOn').onclick = async function () {
      var ok = await window.dpEnablePush();
      if (ok) { hide('dpPushBar'); window.dpShowInstall(); return; }
      if (Notification.permission === 'denied') { hide('dpPushBar'); return; } // customer chose Block
      // customer closed the phone's permission box without choosing: keep our banner so they can tap again
    };
    d.querySelector('#dpLater').onclick = function () { ls.set('dp_push_snooze', String(Date.now() + DAY)); hide('dpPushBar'); };
  };

  // On the home page, show the install banner after the visitor has been browsing a while
  if (/(^|\/)(index\.html)?$/.test(location.pathname)) {
    setTimeout(function () { window.dpOfferPush('home'); }, 4000);
    setTimeout(window.dpShowInstall, 12000);
  }
})();
