'use client';

import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { mayEdit } from '../lib/contracts';
import { useSession } from './app-shell';
import { ErrorNotice } from './feedback';

const resultSchema = z.object({ id: z.string(), name: z.string() });
export function VoiceLibrary({ enabled, onCreated }: { enabled: boolean; onCreated: (id: string) => void }) {
  const { role } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = data.get('reference');
    if (!(file instanceof File) || file.size > 3000000) { setError('Chọn WAV PCM16 dài 3–15 giây, dưới 3 MB.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/v1/voice-profiles', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'audio/wav', 'Idempotency-Key': crypto.randomUUID(), 'X-Voice-Name': encodeURIComponent(String(data.get('name'))), 'X-Voice-Consent': data.get('consent') === 'on' ? 'true' : 'false' }, body: file });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(z.object({ message: z.string() }).safeParse(body).data?.message ?? 'Không lưu được giọng đọc.');
      const result = resultSchema.parse(body); onCreated(result.id); form.reset(); setNotice('Đã lưu và chọn giọng riêng. Worker sẽ dùng mẫu này khi tạo lời đọc; dữ liệu ở local trong workspace.');
    } catch (failure) { setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : 'Không kết nối được dịch vụ local.'); } finally { setBusy(false); }
  }
  if (!enabled) return null;
  return <details className="panel form-panel voice-library"><summary>Giọng đọc riêng · VieNeu local</summary><p className="muted">Ghi âm sạch 3–15 giây, một người nói, không nhạc nền. WAV PCM16; mẫu 5–8 giây thường là điểm bắt đầu phù hợp. Không cần huấn luyện model hay phí API.</p>{error && <ErrorNotice message={error} />}{notice && <p className="notice success" role="status">{notice}</p>}{mayEdit(role) ? <form className="form-stack" onSubmit={upload}><label>Tên giọng riêng<input name="name" required maxLength={80} placeholder="Giọng của tôi" /></label><label>Mẫu giọng WAV<input type="file" name="reference" accept="audio/wav,.wav" required /></label><label className="checkbox-label"><input type="checkbox" name="consent" required /><span>Đây là giọng của tôi hoặc người nói đã đồng ý cho tôi tạo và dùng giọng tổng hợp.</span></label><button className="button secondary small" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu và chọn giọng riêng'}</button></form> : <p className="field-help">Cần vai trò biên tập để thêm mẫu giọng.</p>}</details>;
}
