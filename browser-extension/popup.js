/* global chrome */
const status = document.querySelector('#status');
const source = document.querySelector('#source');
const confirm = document.querySelector('#confirm');
const capture = document.querySelector('#capture');
const cancel = document.querySelector('#cancel');
let ready = false, busy = false;
async function refresh() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' });
    if (!result?.ok) throw new Error(result?.error ?? 'Chưa kết nối Studio.');
    ready = result.ready; busy = result.busy;
    source.textContent = result.url ?? '';
    status.textContent = result.status;
    capture.disabled = !ready || busy || !confirm.checked;
    cancel.hidden = !busy;
  } catch { status.textContent = 'Không kết nối được extension. Mở lại popup rồi thử lại.'; capture.disabled = true; }
}
confirm.addEventListener('change', () => { capture.disabled = !ready || busy || !confirm.checked; });
capture.addEventListener('click', async () => {
  capture.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'START_CAPTURE', confirmed: confirm.checked });
  if (!result?.ok) status.textContent = result?.error ?? 'Chưa bắt đầu được lượt chụp.';
  else await refresh();
});
cancel.addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'CANCEL_FROM_POPUP' }); await refresh(); });
const timer = setInterval(() => { void refresh(); }, 1000);
window.addEventListener('pagehide', () => clearInterval(timer));
void refresh();
