'use client';

import { useId, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiError, errorMessage } from '../lib/api';
import { ErrorNotice } from './feedback';

export function StudioAssetUpload({ disabled, onUploaded }: { disabled: boolean; onUploaded: (kind: 'BACKGROUND' | 'MUSIC', id: string) => void }) {
  const [kind, setKind] = useState<'BACKGROUND' | 'MUSIC'>('BACKGROUND');
  const [basis, setBasis] = useState<'OWNED' | 'LICENSED' | 'CONSENTED'>('OWNED');
  const evidenceHelpId = useId();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = data.get('file');
    setError(''); setNotice('');
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) { setError('Chọn file dưới 20 MB.'); return; }
    const mime = file.type || (file.name.toLowerCase().endsWith('.wav') ? 'audio/wav' : file.name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : '');
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/${kind === 'MUSIC' ? 'music' : 'backgrounds'}`, { method: 'POST', credentials: 'same-origin', headers: {
        'Content-Type': mime, 'X-Asset-Encoding': 'uri', 'Idempotency-Key': crypto.randomUUID(), 'X-Asset-Name': encodeURIComponent(String(data.get('name') || file.name)),
        'X-Rights-Basis': String(data.get('basis')), 'X-Rights-Attested': data.get('attested') === 'on' ? 'true' : 'false', 'X-Rights-Evidence': encodeURIComponent(String(data.get('evidence') || '')),
      }, body: file });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = z.object({ message: z.string(), code: z.string().optional(), requestId: z.string().optional() }).safeParse(body);
        throw new ApiError(failure.success ? failure.data.message : 'Không tải được file. Thử lại hoặc chọn file khác.', response.status, failure.success ? failure.data.code : undefined, failure.success ? failure.data.requestId : undefined);
      }
      const asset = z.object({ id: z.string().uuid() }).safeParse(body);
      if (!asset.success) throw new ApiError('Dịch vụ trả về kết quả tải lên không hợp lệ. Tải lại trang rồi kiểm tra danh sách nền và nhạc.', 502, 'INVALID_RESPONSE');
      onUploaded(kind, asset.data.id); form.reset(); setBasis('OWNED'); setNotice('Đã tải lên và chọn cho video.');
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <details className="panel form-panel studio-upload-panel"><summary>Thêm nền hoặc nhạc từ máy</summary><p className="field-help">Nền: ảnh hoặc MP4 H.264 1–300 giây. Nhạc: WAV PCM16 1–600 giây. Mỗi file tối đa 20 MB; âm thanh của video nền được tắt.</p>
    {error && <ErrorNotice message={error} />}{notice && <p className="notice success" role="status">{notice}</p>}
    <form className="form-stack" onSubmit={upload}><fieldset disabled={disabled || busy} className="studio-fields"><label>Loại tài nguyên<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="BACKGROUND">Ảnh / video nền</option><option value="MUSIC">Nhạc nền</option></select></label><label>File từ máy<input key={kind} name="file" type="file" accept={kind === 'MUSIC' ? 'audio/wav,.wav' : 'image/png,image/jpeg,image/webp,video/mp4,.mp4'} required /></label><label>Tên hiển thị<input name="name" required maxLength={120} /></label><label>Quyền sử dụng<select name="basis" value={basis} onChange={event => setBasis(event.target.value as typeof basis)}><option value="OWNED">Tôi sở hữu</option><option value="LICENSED">Có giấy phép</option><option value="CONSENTED">Có sự đồng ý</option></select></label><div className="studio-upload-evidence"><label>Bằng chứng quyền<input name="evidence" maxLength={2000} required={basis !== 'OWNED'} aria-describedby={evidenceHelpId} placeholder="Tham chiếu giấy phép hoặc sự đồng ý…" /></label><p id={evidenceHelpId} className="field-help">{basis === 'OWNED' ? 'Không bắt buộc khi bạn sở hữu file.' : 'Bắt buộc: nhập tham chiếu giấy phép hoặc sự đồng ý cho phép dùng file này.'}</p></div><label className="checkbox-label"><input type="checkbox" name="attested" required /><span>Tôi có quyền dùng file này trong video của workspace.</span></label><button className="button secondary small">{busy ? 'Đang kiểm tra file…' : 'Tải lên và chọn'}</button></fieldset></form>
  </details>;
}
