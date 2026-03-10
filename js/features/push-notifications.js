// Push notifications — request permission, subscribe, manage preferences
window.KL = window.KL || {};

KL.pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;

KL.getPushPrefs = function() {
  try {
    return JSON.parse(localStorage.getItem('kl-push-prefs')) || { failures: true, dailySummary: false };
  } catch { return { failures: true, dailySummary: false }; }
};

KL.savePushPrefs = function(prefs) {
  localStorage.setItem('kl-push-prefs', JSON.stringify(prefs));
};

KL.initPushUI = function() {
  var section = document.getElementById('push-notifications-section');
  if (!section || !KL.pushSupported) return;
  section.style.display = 'block';

  KL.renderPushUI(section);
};

KL.renderPushUI = async function(section) {
  var registration = await navigator.serviceWorker.ready;
  var subscription = await registration.pushManager.getSubscription();
  var isSubscribed = !!subscription;
  var prefs = KL.getPushPrefs();

  section.innerHTML =
    '<h3>Push Notifications</h3>' +
    '<div class="push-form">' +
      (isSubscribed
        ? '<p class="push-status push-status-active">Notifications enabled</p>' +
          '<div class="push-prefs">' +
            '<label><input type="checkbox" id="push-pref-failures" ' + (prefs.failures ? 'checked' : '') + ' onchange="KL.updatePushPrefs()"> Notify on video failures</label>' +
            '<label><input type="checkbox" id="push-pref-daily" ' + (prefs.dailySummary ? 'checked' : '') + ' onchange="KL.updatePushPrefs()"> Daily summary</label>' +
          '</div>' +
          '<div class="push-actions">' +
            '<button class="btn btn-sm" onclick="KL.testPushNotification()">Test Notification</button>' +
            '<button class="btn btn-sm" onclick="KL.unsubscribePush()">Disable</button>' +
          '</div>'
        : '<p class="push-status">Get browser notifications when video checks detect failures.</p>' +
          '<button class="btn btn-sm btn-run" onclick="KL.subscribePush()">Enable Notifications</button>'
      ) +
    '</div>';
};

KL.subscribePush = async function() {
  try {
    var permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Notification permission denied. Please enable it in your browser settings.');
      return;
    }

    // Get VAPID public key from server
    var res = await fetch('/api/notifications/vapid-key');
    if (!res.ok) { alert('Push not configured on server. Set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY env vars.'); return; }
    var data = await res.json();

    var registration = await navigator.serviceWorker.ready;
    var subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: KL.urlBase64ToUint8Array(data.publicKey),
    });

    // Send subscription to server
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON(), prefs: KL.getPushPrefs() }),
    });

    var section = document.getElementById('push-notifications-section');
    KL.renderPushUI(section);
  } catch (err) {
    console.error('Push subscribe failed:', err);
    alert('Failed to enable notifications: ' + err.message);
  }
};

KL.unsubscribePush = async function() {
  try {
    var registration = await navigator.serviceWorker.ready;
    var subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
    var section = document.getElementById('push-notifications-section');
    KL.renderPushUI(section);
  } catch (err) {
    console.error('Unsubscribe failed:', err);
  }
};

KL.updatePushPrefs = function() {
  var prefs = {
    failures: document.getElementById('push-pref-failures').checked,
    dailySummary: document.getElementById('push-pref-daily').checked,
  };
  KL.savePushPrefs(prefs);
  // Update server-side preferences
  fetch('/api/notifications/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefs: prefs }),
  }).catch(function() {});
};

KL.testPushNotification = async function() {
  try {
    var res = await fetch('/api/notifications/test', { method: 'POST' });
    if (res.ok) {
      // Also show a local notification as backup
      var registration = await navigator.serviceWorker.ready;
      registration.showNotification('Test Notification', {
        body: 'Push notifications are working!',
        icon: '/icons/icon-192.png',
        tag: 'test',
      });
    }
  } catch { /* fallback to local */ }
};

KL.urlBase64ToUint8Array = function(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};
