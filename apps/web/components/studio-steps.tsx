export const studioSteps = ['Nguồn bài', 'Lời đọc', 'Nền & nhạc', 'Xuất video'] as const;

export function StudioSteps({ active, onSelect, hasScript = false }: { active: number; onSelect?: (step: number) => void; hasScript?: boolean }) {
  return <ol className="studio-steps" aria-label="Các bước tạo video">{studioSteps.map((label, index) => <li key={label} aria-current={active === index ? 'step' : undefined}>{onSelect ? <button type="button" disabled={index > 1 && !hasScript} onClick={() => onSelect(index)}><span>{index + 1}</span>{label}</button> : <span className="studio-step-label"><span>{index + 1}</span>{label}</span>}</li>)}</ol>;
}

export function StudioPreviewEmpty() {
  return <aside className="studio-preview-column import-preview"><div className="preview-heading"><h2>Video của bạn</h2><span className="preview-format">9:16 · MP4</span></div><div className="preview-placeholder"><svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true"><rect x="9" y="3" width="26" height="38" rx="5" stroke="currentColor" strokeWidth="2" /><path d="m19 16 10 6-10 6z" fill="currentColor" /></svg><strong>Bắt đầu từ<br />một bài viết</strong><p>Ảnh nguồn và lời đọc sẽ xuất hiện ở đây sau khi bạn nhập bài.</p></div><p className="field-help">Xem trước thay đổi ngay khi chỉnh. MP4 được tạo ở máy local.</p></aside>;
}
