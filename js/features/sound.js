// Sound Notification
window.KL = window.KL || {};

KL.SOUND_KEY = 'kl-sound-enabled';
KL.soundEnabled = localStorage.getItem('kl-sound-enabled') !== 'false';

window.toggleSound = function() {
  KL.soundEnabled = !KL.soundEnabled;
  localStorage.setItem(KL.SOUND_KEY, KL.soundEnabled);
  KL.updateSoundUI();
};

KL.updateSoundUI = function() {
  var btn = document.getElementById('sound-toggle');
  if (btn) {
    btn.classList.toggle('sound-enabled', KL.soundEnabled);
    btn.title = KL.soundEnabled ? 'Sound notifications: ON' : 'Sound notifications: OFF';
  }
};

KL.playNotificationSound = function(success) {
  if (!KL.soundEnabled) return;
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.15;

    if (success) {
      osc.frequency.value = 523;
      osc.type = 'sine';
      osc.start(ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.stop(ctx.currentTime + 0.5);
    } else {
      osc.frequency.value = 440;
      osc.type = 'triangle';
      osc.start(ctx.currentTime);
      osc.frequency.setValueAtTime(330, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.stop(ctx.currentTime + 0.6);
    }
  } catch (e) {}
};
