const msg = document.getElementById('msg');
const btn = document.getElementById('btn');

async function ask() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg.className = 'ok';
    msg.textContent = 'Готово! Доступ выдан. Вернитесь на вкладку с багом и нажмите 🎤 ещё раз. Эта вкладка закроется сама.';
    btn.hidden = true;
    setTimeout(() => window.close(), 2500);
  } catch (e) {
    msg.className = 'err';
    msg.textContent = 'Доступ не выдан (' + (e.message || e.name) + '). Нажмите на значок 🔒/камеры в адресной строке, разрешите микрофон и попробуйте снова.';
  }
}
btn.onclick = ask;
ask();
