'use client';

import { useId, useState } from 'react';
import { z } from 'zod';
import { studioPresetSettingsSchema } from '@shorts-factory/media/studio-settings';
import { api, errorMessage } from '../lib/api';
import { useResource } from '../lib/use-resource';
import { ErrorNotice } from './feedback';

const presetsSchema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), settings: studioPresetSettingsSchema })) });
export function StudioPresets({ settings, onApply, disabled }: { settings: z.infer<typeof studioPresetSettingsSchema>; onApply: (settings: z.infer<typeof studioPresetSettingsSchema>) => void; disabled: boolean }) {
  const presets = useResource('/studio-presets', presetsSchema);
  const [name, setName] = useState(''); const [selected, setSelected] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const helpId = useId();
  const selectedPreset = presets.data?.items.find(item => item.id === selected);
  async function save() {
    setSaving(true); setError(''); setNotice('');
    try { await api('/studio-presets', z.object({ id: z.string() }), { method: 'POST', body: { name, settings } }); presets.reload(); setNotice('Đã lưu bộ thiết lập trong workspace.'); }
    catch (failure) { setError(errorMessage(failure)); } finally { setSaving(false); }
  }
  return <details className="studio-preset-panel" aria-busy={presets.loading || saving}><summary>Bộ thiết lập của bạn</summary>
    {presets.error && <ErrorNotice message={presets.error} retry={presets.reload} />}{error && <ErrorNotice message={error} />}{notice && <p role="status">{notice}</p>}
    {presets.loading && !presets.data && <p className="field-help" role="status">Đang tải bộ thiết lập…</p>}
    {presets.data?.items.length === 0 && !presets.error && <p className="field-help">Chưa có bộ thiết lập. Đặt tên và lưu thiết lập hiện tại để dùng lại.</p>}
    <div className="studio-form-row"><label>Bộ thiết lập đã lưu<select value={selected} disabled={disabled || saving || presets.loading || !presets.data?.items.length} onChange={event => setSelected(event.target.value)}><option value="">Chọn bộ thiết lập</option>{presets.data?.items.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label><button className="button secondary small" type="button" disabled={disabled || saving || presets.loading || !selectedPreset} onClick={() => { if (selectedPreset) { onApply(selectedPreset.settings); setNotice(`Đã áp dụng ${selectedPreset.name}.`); } }}>Áp dụng</button></div>
    <div className="studio-form-row"><label>Tên bộ thiết lập<input name="presetName" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="Giọng kể & phụ đề của tôi" disabled={disabled || saving} aria-describedby={helpId} /></label><button className="button secondary small" type="button" onClick={() => void save()} disabled={disabled || saving || !name.trim() || !settings.voiceProfileId} aria-describedby={helpId}>{saving ? 'Đang lưu…' : 'Lưu thiết lập'}</button></div><p className="field-help" id={helpId}>Đặt tên và chọn giọng đọc trước khi lưu. Bộ thiết lập giữ giọng, phụ đề, nền và nhạc; không lưu nội dung bài hoặc bình luận. Lưu cùng tên sẽ cập nhật bộ đó.</p>
  </details>;
}
