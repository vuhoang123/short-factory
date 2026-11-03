'use client';

import { useRef, useState } from 'react';
import { z } from 'zod';
import { api, errorMessage } from '../lib/api';
import { useResource } from '../lib/use-resource';
import { ErrorNotice } from './feedback';
import { getOperationKey, type OperationKeys } from '../lib/local-export';
import { playOneAudio } from '../lib/media-preview';

const catalogSchema = z.object({ items: z.array(z.object({ key: z.string(), kind: z.enum(['BACKGROUND', 'MUSIC']), name: z.string(), category: z.string(), artist: z.string(), description: z.string(), sourceUrl: z.string().url(), licenseUrl: z.string().url(), license: z.literal('CC0-1.0'), durationMs: z.number() })) });
const installedSchema = z.object({ items: z.array(z.object({ key: z.string(), kind: z.enum(['BACKGROUND', 'MUSIC']), id: z.string().uuid() })) });

export function StudioMediaCatalog({ disabled, onInstalled }: { disabled: boolean; onInstalled: (items: z.infer<typeof installedSchema>['items'], select: boolean) => void }) {
  const catalog = useResource('/studio-assets', catalogSchema);
  const [kind, setKind] = useState<'BACKGROUND' | 'MUSIC'>('BACKGROUND');
  const [category, setCategory] = useState(''); const [query, setQuery] = useState(''); const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const operationKeys = useRef<OperationKeys>({});
  const entries = catalog.data?.items ?? [];
  const categories = [...new Set(entries.filter(item => item.kind === kind).map(item => item.category))];
  const shown = entries.filter(item => item.kind === kind && (!category || item.category === category) && `${item.name} ${item.artist}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
  const playing = entries.find(item => item.key === preview);
  async function install(keys: string[], select: boolean) {
    setBusy(keys.length === 1 ? keys[0]! : 'all'); setError(''); setNotice('');
    if (select && keys[0]) setPreview(keys[0]);
    try {
      const result = await api('/studio-assets', installedSchema, { method: 'POST', body: { keys }, idempotencyKey: await getOperationKey(operationKeys.current, 'curated-media', { keys }) });
      onInstalled(result.items, select); if (select) setPreview(''); setNotice(select ? 'Đã thêm vào workspace và chọn cho video.' : `Đã thêm ${result.items.length} lựa chọn vào danh sách nền và nhạc.`);
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(''); }
  }
  return <details className="studio-catalog" id="studio-media-catalog" open><summary>Khám phá nền & nhạc miễn phí{entries.length ? ` · ${entries.length} lựa chọn` : ''}</summary>
    <div className="studio-catalog-content">
      <p className="field-help">Nền minh họa chuyển động và nhạc không lời CC0. Xem/nghe thử trước; chỉ thêm vào workspace khi bạn chọn.</p>
      {catalog.error && <ErrorNotice message={catalog.error} retry={catalog.reload} />}{error && <ErrorNotice message={error} />}{notice && <p className="notice success" role="status">{notice}</p>}
      {catalog.loading && !catalog.data ? <p role="status">Đang tải kho tài nguyên…</p> : entries.length === 0 && !catalog.error ? <p className="notice">Chạy <code>pnpm local:media:setup</code> để tải bộ CC0 một lần, rồi chọn tải lại.<button className="text-button" onClick={catalog.reload} type="button">Tải lại kho tài nguyên</button></p> : <>
        <div className="phase5-actions" role="group" aria-label="Loại tài nguyên miễn phí">{(['BACKGROUND', 'MUSIC'] as const).map(value => <button type="button" key={value} className={`button ${kind === value ? '' : 'secondary'} small`} aria-pressed={kind === value} onClick={() => { setKind(value); setCategory(''); setPreview(''); }}>{value === 'BACKGROUND' ? 'Nền chuyển động' : 'Nhạc không lời'} ({entries.filter(item => item.kind === value).length})</button>)}</div>
        <div className="studio-form-row"><label>Tìm nền hoặc nhạc<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tên bài, tác giả…" /></label><label>Phong cách tài nguyên<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Tất cả phong cách</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label></div>
        {playing && <div className="studio-catalog-preview"><strong>{playing.name}</strong>{playing.kind === 'MUSIC' ? <audio key={playing.key} aria-label={`Nghe thử ${playing.name}`} controls autoPlay onPlay={event => playOneAudio(event.currentTarget)} src={`/api/v1/studio-assets/${playing.key}/preview`} /> : <video key={playing.key} aria-label={`Xem thử ${playing.name}`} controls muted loop playsInline autoPlay poster={`/api/v1/studio-assets/${playing.key}/thumbnail`} src={`/api/v1/studio-assets/${playing.key}/preview`} />}<p className="field-help">{playing.description}</p><button className="text-button" type="button" onClick={() => setPreview('')}>Dừng xem/nghe thử</button></div>}
        <div className="studio-catalog-grid">{shown.map(item => <article className="studio-catalog-card" key={item.key}>
          {item.kind === 'BACKGROUND' && <img loading="lazy" src={`/api/v1/studio-assets/${item.key}/thumbnail`} alt={item.name} />}
          <div><strong>{item.name}</strong><p className="field-help">{item.category} · {(item.durationMs / 1000).toFixed(0)} giây · {item.artist}</p><p className="field-help"><a href={item.sourceUrl} target="_blank" rel="noreferrer">Nguồn tác giả</a> · <a href={item.licenseUrl} target="_blank" rel="noreferrer">CC0</a></p></div>
          <div className="phase5-actions"><button className="text-button" type="button" onClick={() => setPreview(item.key)}>{item.kind === 'MUSIC' ? 'Nghe thử' : 'Xem thử'}</button><button className="button secondary small" type="button" disabled={disabled || Boolean(busy)} onClick={() => void install([item.key], true)}>{busy === item.key ? 'Đang thêm…' : item.kind === 'MUSIC' ? 'Dùng nhạc này' : 'Dùng nền này'}</button></div>
        </article>)}</div>{shown.length === 0 && <p role="status">Không có tài nguyên khớp bộ lọc.</p>}
        <button className="button secondary small" type="button" disabled={disabled || Boolean(busy)} onClick={() => void install(entries.map(item => item.key), false)}>{busy === 'all' ? 'Đang thêm bộ tài nguyên…' : `Thêm toàn bộ ${entries.length} lựa chọn vào workspace`}</button>
      </>}
      <div className="studio-gameplay-sources"><strong>Tìm nền gameplay</strong>
        <p className="field-help">Các nguồn dưới đây là clip chơi game thật, chưa nằm trong bộ minh họa bên trên. Mở trang tác giả để lấy file và điều kiện sử dụng.</p>
        <ul className="field-help">
          <li><a href="https://ko-fi.com/s/3fe05014aa" target="_blank" rel="noreferrer">Minecraft Castle · Magnorbis</a> — tác giả ghi miễn phí, có bản dọc 9:16, cho phép kiếm tiền.</li>
          <li><a href="https://ko-fi.com/s/8f5586d625" target="_blank" rel="noreferrer">Minecraft parkour · Orbital</a> · <a href="https://ko-fi.com/s/a1551ff76a" target="_blank" rel="noreferrer">GTA 5 · Orbital</a> — nguồn file gốc; kiểm tra giá tại shop.</li>
          <li><a href="https://ko-fi.com/s/4b8826cbf1" target="_blank" rel="noreferrer">Minecraft đại dương · Spicy Sauce</a> — bản dọc 60fps, có điều khoản dùng thương mại.</li>
        </ul>
        <p className="field-help">File gameplay gốc thường rất lớn. Cắt/nén thành MP4 tối đa 5 phút, 20 MB rồi dùng “Thêm nền hoặc nhạc từ máy”. Link nguồn không tự tải hay thêm video vào workspace.</p>
      </div>
      <p className="field-help">Footage quay thật khác: <a href="https://www.pexels.com/search/videos/nature/" target="_blank" rel="noreferrer">Pexels</a> · <a href="https://mixkit.co/free-stock-video/" target="_blank" rel="noreferrer">Mixkit</a>. Tải file phù hợp giấy phép rồi thêm từ máy.</p>
    </div>
  </details>;
}
