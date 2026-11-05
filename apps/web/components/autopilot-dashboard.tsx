'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api, errorMessage } from '../lib/api';
import { channelSchema, mayAdmin, mayEdit, mayReview, paginated, sourceSchema, unknownResponseSchema } from '../lib/contracts';
import { useSession } from './app-shell';
import { EmptyState, ErrorNotice, StatusBadge } from './feedback';
import { commaList, DataDetails, formatTime, formatUsd, Stat, usePhase5Resource } from './phase5-shared';

const ruleSchema = z.object({ id: z.string(), channelId: z.string(), version: z.number(), status: z.string(), config: z.record(z.string(), z.unknown()), channel: z.object({ id: z.string(), name: z.string() }) });
const runSchema = z.object({ id: z.string(), entityId: z.string(), status: z.string(), currentStep: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(), input: z.unknown(), output: z.unknown() });
const automationSchema = z.object({ rules: z.array(ruleSchema), runs: z.array(runSchema), summary: z.object({ activeRules: z.number(), running: z.number(), queued: z.number(), pendingApproval: z.number(), scheduled: z.number(), failed: z.number(), estimatedSpendUsd: z.number(), billedSpendUsd: z.number().nullable() }) });
const runDetailSchema = runSchema.extend({ steps: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), startedAt: z.string().nullable(), completedAt: z.string().nullable(), errorCode: z.string().nullable(), output: z.unknown() })) });
const profilesSchema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), provider: z.string(), language: z.string() })) });
const accountsSchema = z.object({ items: z.array(z.object({ id: z.string(), displayName: z.string(), platform: z.string(), status: z.string() })) });
const approvalsSchema = z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), mediaAssetId: z.string().nullable(), story: z.object({ post: z.object({ title: z.string().nullable(), body: z.string(), rights: z.array(z.object({ reviewStatus: z.string(), basis: z.string() })) }) }).nullable(), qualityReport: z.unknown(), targetPlatforms: z.array(z.string()) })) });
const usageSchema = z.object({ dailyEstimatedUsd: z.number(), monthlyEstimatedUsd: z.number(), reservedUsd: z.number(), billedUsd: z.number().nullable(), byStage: z.array(z.object({ stage: z.string(), estimatedUsd: z.number(), units: z.number() })), alerts: z.array(z.string()) });
const budgetSchema = z.object({ dailyLimitUsd: z.number(), monthlyLimitUsd: z.number(), warningThreshold: z.number() });
const channelsSchema = paginated(channelSchema);
const sourcesSchema = paginated(sourceSchema);
const defaultConfig: Record<string, unknown> = { mode: 'MANUAL', sourceIds: [], topics: [], languages: ['vi'], minScore: 55, dailyLimit: 3, weeklyLimit: 15, accountDailyLimit: 2, postingTimes: ['09:00'], timezone: 'Asia/Ho_Chi_Minh', targetPlatforms: ['YOUTUBE'], accountIds: [], templateId: 'SocialCommentary', voiceProfileId: '', subtitlePreset: 'ClassicCaption', backgroundCategories: [], durationSec: 40, minQualityScore: 80, exclusions: [], commentCount: 3, commentDurationSec: 20, requireApproval: true, autoPublishAuthorized: false, dailyBudgetUsd: 5, monthlyBudgetUsd: 50, estimatedRunCostUsd: 0.1, intervalMinutes: 60, cooldownMinutes: 60 };
function textValue(config: Record<string, unknown>, key: string, fallback = '') { const value = config[key]; return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback; }
function listValue(config: Record<string, unknown>, key: string) { return Array.isArray(config[key]) ? config[key].filter((value): value is string => typeof value === 'string') : []; }

export function AutopilotDashboard() {
  const { role } = useSession();
  const automation = usePhase5Resource('/automation', automationSchema, 10000);
  const channels = usePhase5Resource('/channels?limit=100', channelsSchema);
  const sources = usePhase5Resource('/sources?limit=100', sourcesSchema);
  const voices = usePhase5Resource('/voice-profiles', profilesSchema);
  const accounts = usePhase5Resource('/automation/accounts', accountsSchema);
  const approvals = usePhase5Resource('/automation/approvals', approvalsSchema, 15000);
  const usage = usePhase5Resource('/usage', usageSchema, 15000);
  const budget = usePhase5Resource('/budget-policy', budgetSchema);
  const [channelId, setChannelId] = useState('');
  const [runId, setRunId] = useState('');
  const [runRevision, setRunRevision] = useState(0);
  const [run, setRun] = useState<z.infer<typeof runDetailSchema> | null>(null);
  const [runError, setRunError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<unknown>(null);
  const rule = automation.data?.rules.find((item) => item.channelId === channelId);
  const config = { ...defaultConfig, ...rule?.config };
  useEffect(() => { if (!channelId && channels.data?.items[0]) setChannelId(channels.data.items[0].id); }, [channelId, channels.data]);
  useEffect(() => {
    if (!runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setRun((current) => current?.id === runId ? current : null); setRunError('');
    const load = async () => {
      let keepPolling = true;
      try {
        const next = await api(`/automation/runs/${runId}`, runDetailSchema, { signal: controller.signal });
        if (!active) return;
        setRun(next); setRunError('');
        keepPolling = !['SUCCEEDED', 'FAILED_PERMANENT', 'CANCELLED', 'BLOCKED'].includes(next.status);
      }
      catch (failure) { if (active) setRunError(errorMessage(failure)); }
      finally { if (active && keepPolling) timer = setTimeout(() => { void load(); }, 6000); }
    };
    void load();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [runId, runRevision]);

  async function mutate(path: string, body: unknown, message: string, method = 'POST') {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(path, unknownResponseSchema, { method, body });
      setNotice(message); automation.reload(); approvals.reload(); usage.reload(); budget.reload();
      if (runId && path.startsWith(`/automation/runs/${runId}/`)) setRunRevision((value) => value + 1);
      return result;
    } catch (failure) { setError(errorMessage(failure)); return null; }
    finally { setBusy(false); }
  }
  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const next = { ...config };
    for (const key of ['mode', 'timezone', 'templateId', 'voiceProfileId', 'subtitlePreset']) next[key] = String(form.get(key));
    for (const key of ['minScore', 'dailyLimit', 'weeklyLimit', 'accountDailyLimit', 'durationSec', 'minQualityScore', 'commentCount', 'commentDurationSec', 'dailyBudgetUsd', 'monthlyBudgetUsd', 'estimatedRunCostUsd', 'intervalMinutes', 'cooldownMinutes']) next[key] = Number(form.get(key));
    for (const key of ['topics', 'languages', 'postingTimes', 'backgroundCategories', 'exclusions']) next[key] = commaList(form.get(key));
    for (const key of ['sourceIds', 'accountIds', 'targetPlatforms']) next[key] = form.getAll(key).map(String);
    next.requireApproval = form.get('requireApproval') === 'on'; next.autoPublishAuthorized = form.get('autoPublishAuthorized') === 'on';
    await mutate(`/channels/${channelId}/automation`, { expectedVersion: rule?.version ?? 0, config: next }, 'A new rule version was saved. Existing runs keep their original settings.', 'PUT');
  }
  async function startRun(dryRun: boolean) {
    const result = await mutate(`/channels/${channelId}/automation/run`, { dryRun }, dryRun ? 'Dry run evaluated without starting production.' : 'Automation run queued.');
    if (dryRun) setDryRunResult(result);
    else { const parsed = z.object({ runId: z.string().optional(), id: z.string().optional() }).safeParse(result); if (parsed.success) setRunId(parsed.data.runId ?? parsed.data.id ?? ''); }
  }
  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await mutate('/budget-policy', { dailyLimitUsd: Number(form.get('dailyLimitUsd')), monthlyLimitUsd: Number(form.get('monthlyLimitUsd')), warningThreshold: Number(form.get('warningThreshold')) }, 'Workspace budget limits saved.', 'PUT');
  }

  return <>
    <div className="page-heading"><div><h1>Tự động hóa nội dung</h1><p>Thiết lập quy tắc cho kênh, theo dõi tiến độ và duyệt kết quả.</p></div><Link className="button secondary" href="/analytics">Xem số liệu →</Link></div>
    {error && <ErrorNotice message={error} />}{runError && <ErrorNotice message={runError} />}{notice && <div className="notice success" role="status">{notice}</div>}
    {automation.error && <ErrorNotice message={automation.error} retry={automation.reload} />}
    {automation.loading && !automation.data ? <p role="status" className="loading-state">Đang tải hoạt động tự động hóa…</p> : automation.data && <div className="metrics-grid"><Stat title="Kênh đang bật" value={automation.data.summary.activeRules} /><Stat title="Đang chạy / chờ" value={`${automation.data.summary.running} / ${automation.data.summary.queued}`} /><Stat title="Chờ duyệt" value={automation.data.summary.pendingApproval} /><Stat title="Đã lên lịch / lỗi" value={`${automation.data.summary.scheduled} / ${automation.data.summary.failed}`} /><Stat title="Chi phí ước tính" value={formatUsd(automation.data.summary.estimatedSpendUsd)} note={`Billed: ${formatUsd(automation.data.summary.billedSpendUsd)}`} /></div>}
    <div className="phase5-two-columns">
      <section className="panel form-panel"><h2>Quy tắc cho kênh</h2><p className="muted">Mỗi lượt dùng phiên bản quy tắc đã lưu tại thời điểm bắt đầu.</p>
        {channels.error && <ErrorNotice message={channels.error} retry={channels.reload} />}
        {channels.loading && !channels.data ? <p role="status">Đang tải kênh…</p> : !channels.data?.items.length ? <EmptyState title="Tạo kênh trước">Thêm kênh nội dung trước khi thiết lập tự động hóa.</EmptyState> : <>
          <label>Kênh nội dung<select value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.data.items.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
          <div className="phase5-rule-status"><StatusBadge value={rule?.status ?? 'NOT_CONFIGURED'} /><span className="field-help">{rule ? `Version ${rule.version}` : 'Chưa lưu quy tắc'}</span></div>
          {mayAdmin(role) && rule && <div className="phase5-actions">{(['ENABLE', 'DISABLE', 'PAUSE', 'RESUME'] as const).map((action) => <button className="button secondary small" key={action} disabled={busy} onClick={() => void mutate(`/channels/${channelId}/automation/control`, { action }, `${action.toLowerCase()} recorded.`)}>{action.charAt(0) + action.slice(1).toLowerCase()}</button>)}<button className="button danger small" disabled={busy} onClick={() => void mutate(`/channels/${channelId}/automation/control`, { action: 'EMERGENCY_STOP' }, 'Emergency stop recorded. New work is blocked for this channel.')}>Dừng khẩn cấp</button></div>}
          {mayEdit(role) && <div className="phase5-actions"><button className="button secondary small" disabled={busy || !rule} onClick={() => void startRun(true)}>Chạy thử</button><button className="button small" disabled={busy || !rule} onClick={() => void startRun(false)}>Chạy một lượt</button></div>}
          {mayAdmin(role) ? <form key={`${channelId}:${rule?.version ?? 0}:${voices.data ? 'voices-ready' : 'loading-voices'}`} className="form-stack" onSubmit={saveRule}>
            <label>Chế độ tự động hóa<select name="mode" defaultValue={textValue(config, 'mode')}><option value="MANUAL">Thủ công</option><option value="SEMI_AUTO">Bán tự động · duyệt trước khi đăng</option><option value="FULL_AUTO">Tự động · chỉ đích đã được cấp phép</option></select></label>
            <p className="field-help">Full auto still enforces video review, rights, account permissions and required creator actions.</p>
            <fieldset className="phase5-fieldset"><legend>Nguồn được dùng</legend>{sources.error && <ErrorNotice message={sources.error} retry={sources.reload} />}{sources.data?.items.length ? sources.data.items.map((source) => <label className="checkbox-label" key={source.id}><input name="sourceIds" type="checkbox" value={source.id} defaultChecked={listValue(config, 'sourceIds').includes(source.id)} /><span>{source.sourceKey} · {source.platform}{!source.enabled ? ' · disabled' : ''}</span></label>) : <p className="field-help">No configured sources. Add an authorized source on the Sources page.</p>}</fieldset>
            <div className="phase5-form-grid"><label>Chủ đề cho phép<input name="topics" defaultValue={listValue(config, 'topics').join(', ')} placeholder="work, family, daily life" /></label><label>Ngôn ngữ<input name="languages" defaultValue={listValue(config, 'languages').join(', ')} placeholder="vi, en" /></label><label>Điểm tối thiểu để chọn bài<input name="minScore" type="number" min="0" max="100" defaultValue={textValue(config, 'minScore')} required /></label><label>Điểm chất lượng tối thiểu<input name="minQualityScore" type="number" min="0" max="100" defaultValue={textValue(config, 'minQualityScore')} required /></label></div>
            <label>Từ khóa và chủ đề loại trừ<input name="exclusions" defaultValue={listValue(config, 'exclusions').join(', ')} placeholder="Ngăn cách bằng dấu phẩy" /></label>
            <div className="phase5-form-grid"><label>Mẫu video<select name="templateId" defaultValue={textValue(config, 'templateId')}><option value="SocialCommentary">Bình luận xã hội</option><option value="RedditStory">Kể chuyện Reddit</option></select></label><label>Giọng đọc<select name="voiceProfileId" defaultValue={textValue(config, 'voiceProfileId') || voices.data?.items[0]?.id} required><option value="">Chọn giọng đọc</option>{voices.data?.items.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.language}{voice.provider === 'mock' ? ' · test tone' : ''}</option>)}</select></label><label>Phụ đề<select name="subtitlePreset" defaultValue={textValue(config, 'subtitlePreset')}><option value="ClassicCaption">Phụ đề thường</option><option value="KaraokeHighlight">Tô sáng từng từ</option></select></label><label>Thời lượng mục tiêu · giây<input name="durationSec" type="number" min="10" max="120" defaultValue={textValue(config, 'durationSec')} required /></label><label>Bình luận mỗi bài<input name="commentCount" type="number" min="0" max="8" defaultValue={textValue(config, 'commentCount')} required /></label><label>Thời lượng đọc bình luận · giây<input name="commentDurationSec" type="number" min="0" max="120" defaultValue={textValue(config, 'commentDurationSec')} required /></label></div>
            <label>Nhóm nền<input name="backgroundCategories" defaultValue={listValue(config, 'backgroundCategories').join(', ')} placeholder="Comma-separated approved library categories" /></label>
            <div className="phase5-form-grid"><label>Số video tối đa mỗi ngày<input name="dailyLimit" type="number" min="1" max="100" defaultValue={textValue(config, 'dailyLimit')} required /></label><label>Số video tối đa mỗi tuần<input name="weeklyLimit" type="number" min="1" max="700" defaultValue={textValue(config, 'weeklyLimit')} required /></label><label>Hạn mức ngày mỗi tài khoản<input name="accountDailyLimit" type="number" min="1" max="100" defaultValue={textValue(config, 'accountDailyLimit')} required /></label><label>Khoảng nghỉ tài khoản · phút<input name="cooldownMinutes" type="number" min="1" defaultValue={textValue(config, 'cooldownMinutes')} required /></label><label>Khoảng chạy · phút<input name="intervalMinutes" type="number" min="1" defaultValue={textValue(config, 'intervalMinutes')} required /></label><label>Giờ ưu tiên<input name="postingTimes" defaultValue={listValue(config, 'postingTimes').join(', ')} placeholder="09:00, 18:30" required /></label></div>
            <label>Múi giờ đăng<input name="timezone" defaultValue={textValue(config, 'timezone')} required placeholder="Asia/Ho_Chi_Minh" /></label>
            <fieldset className="phase5-fieldset"><legend>Nền tảng sử dụng</legend>{['YOUTUBE', 'FACEBOOK', 'TIKTOK'].map((platform) => <label key={platform} className="checkbox-label"><input type="checkbox" name="targetPlatforms" value={platform} defaultChecked={listValue(config, 'targetPlatforms').includes(platform)} /><span>{platform}{platform === 'TIKTOK' ? ' · manual handoff by default' : ''}</span></label>)}</fieldset>
            <fieldset className="phase5-fieldset"><legend>Tài khoản đích</legend>{accounts.error && <ErrorNotice message={accounts.error} retry={accounts.reload} />}{accounts.data?.items.length ? accounts.data.items.map((account) => <label className="checkbox-label" key={account.id}><input type="checkbox" name="accountIds" value={account.id} defaultChecked={listValue(config, 'accountIds').includes(account.id)} /><span>{account.displayName} · {account.platform} · {account.status}</span></label>) : <p className="field-help">No authorized destination accounts are available. Production can still stop at the review gate.</p>}</fieldset>
            <label className="checkbox-label"><input name="requireApproval" type="checkbox" defaultChecked={config.requireApproval !== false} /><span>Yêu cầu duyệt trước khi đăng</span></label><label className="checkbox-label"><input name="autoPublishAuthorized" type="checkbox" defaultChecked={config.autoPublishAuthorized === true} /><span>Authorize automatic scheduling after all mandatory reviews and platform checks pass</span></label>
            <div className="phase5-form-grid"><label>Hạn mức ngày của kênh · USD<input type="number" name="dailyBudgetUsd" min="0" step="0.01" defaultValue={textValue(config, 'dailyBudgetUsd')} required /></label><label>Hạn mức tháng của kênh · USD<input type="number" name="monthlyBudgetUsd" min="0" step="0.01" defaultValue={textValue(config, 'monthlyBudgetUsd')} required /></label><label>Giữ trước mỗi lượt · USD<input type="number" name="estimatedRunCostUsd" min="0" step="0.001" defaultValue={textValue(config, 'estimatedRunCostUsd')} required /></label></div>
            <button className="button" disabled={busy || !voices.data?.items.length}>{busy ? 'Saving…' : 'Lưu phiên bản quy tắc'}</button>
          </form> : <p className="field-help">Workspace owners and admins manage automation rules and emergency controls.</p>}
          <DataDetails value={dryRunResult} label="Kết quả chạy thử và các điều kiện" />
        </>}
      </section>
      <div>
        <section className="panel"><div className="panel-heading"><div><h2>Theo dõi công việc</h2><p>Theo dõi từng giai đoạn, lượt thử lại và kết quả của workspace.</p></div><button className="text-button" onClick={automation.reload}>Làm mới</button></div>{automation.data?.runs.length ? <div className="phase5-run-list">{automation.data.runs.map((item) => <button className={`phase5-run-button${runId === item.id ? ' selected' : ''}`} key={item.id} onClick={() => setRunId(item.id)}><span><strong>{automation.data?.rules.find((entry) => entry.channelId === item.entityId)?.channel.name ?? 'Channel workflow'}</strong><small>{item.currentStep?.replaceAll('_', ' ') ?? 'Queued'} · {formatTime(item.createdAt)}</small></span><StatusBadge value={item.status} /></button>)}</div> : <EmptyState title="Chưa có lượt tự động hóa">Save a rule, then evaluate a dry run or start a production run.</EmptyState>}
          {run && <div className="phase5-run-detail"><div className="phase5-actions"><StatusBadge value={run.status} />{mayEdit(role) && <button className="button secondary small" disabled={busy} onClick={() => void mutate(`/automation/runs/${run.id}/cancel`, {}, 'Cancellation requested.')}>Hủy lượt</button>}{mayAdmin(role) && <button className="button secondary small" disabled={busy || !['FAILED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'NEEDS_ACTION'].includes(run.status)} onClick={() => void mutate(`/automation/runs/${run.id}/retry`, {}, 'The failed workflow was queued for recovery.')}>Thử lại bước lỗi</button>}</div><ol className="stage-list">{run.steps.map((step) => <li key={step.id} className={step.status === 'SUCCEEDED' ? 'done' : step.status === 'RUNNING' ? 'active' : ''}><div><strong>{step.name.replaceAll('_', ' ')}</strong><small>{step.startedAt && step.completedAt ? `${Math.max(0, Math.round((Date.parse(step.completedAt) - Date.parse(step.startedAt)) / 1000))} sec` : step.startedAt ? `Started ${formatTime(step.startedAt)}` : 'Not started'}{step.errorCode ? ` · ${step.errorCode}` : ''}</small><DataDetails value={step.output} label="Kết quả từng bước" /></div><span>{step.status}</span></li>)}</ol><DataDetails value={run.input} label="Cấu hình đã chốt" /><DataDetails value={run.output} label="Selection, quality and output artifacts" /></div>}
        </section>
        <section className="panel form-panel"><h2>Chi phí và hạn mức</h2><p className="muted">Estimates and reservations are tracked separately from billed costs.</p>{usage.error && <ErrorNotice message={usage.error} retry={usage.reload} />}{usage.data && <><dl className="phase5-definition-list"><div><dt>Ước tính hôm nay</dt><dd>{formatUsd(usage.data.dailyEstimatedUsd)}</dd></div><div><dt>Ước tính tháng này</dt><dd>{formatUsd(usage.data.monthlyEstimatedUsd)}</dd></div><div><dt>Đã giữ cho công việc đang chạy</dt><dd>{formatUsd(usage.data.reservedUsd)}</dd></div><div><dt>Chi phí đã tính</dt><dd>{formatUsd(usage.data.billedUsd)}</dd></div></dl>{usage.data.alerts.map((alert) => <p className="notice warning" key={alert}>{alert.replaceAll('_', ' ')}</p>)}{usage.data.byStage.length > 0 && <div className="table-scroll"><table><thead><tr><th>Giai đoạn</th><th>Đơn vị</th><th>Ước tính</th></tr></thead><tbody>{usage.data.byStage.map((item) => <tr key={item.stage}><td>{item.stage.replaceAll('_', ' ')}</td><td>{item.units}</td><td>{formatUsd(item.estimatedUsd)}</td></tr>)}</tbody></table></div>}</>}{budget.error && <ErrorNotice message={budget.error} retry={budget.reload} />}{mayAdmin(role) && budget.data && <form key={JSON.stringify(budget.data)} className="form-stack" onSubmit={saveBudget}><div className="phase5-form-grid"><label>Hạn mức ngày · USD<input name="dailyLimitUsd" type="number" min="0" step="0.01" defaultValue={budget.data.dailyLimitUsd} required /></label><label>Hạn mức tháng · USD<input name="monthlyLimitUsd" type="number" min="0" step="0.01" defaultValue={budget.data.monthlyLimitUsd} required /></label></div><label>Ngưỡng cảnh báo<input name="warningThreshold" type="number" min="0.01" max="1" step="0.01" defaultValue={budget.data.warningThreshold} required /></label><button className="button secondary small" disabled={busy}>Lưu hạn mức</button></form>}</section>
      </div>
    </div>
    <section className="panel"><div className="panel-heading"><div><h2>Video chờ duyệt</h2><p>Kiểm tra nguồn, chất lượng và nơi sử dụng trước khi cho phép video tiếp tục.</p></div><Link className="text-button" href="/studio">Mở bàn biên tập →</Link></div>{approvals.error ? <ErrorNotice message={approvals.error} retry={approvals.reload} /> : approvals.loading && !approvals.data ? <p className="loading-state" role="status">Đang tải danh sách duyệt…</p> : approvals.data?.items.length ? <div className="phase5-approvals">{approvals.data.items.map((video) => <article key={video.id} className="phase5-approval"><div>{video.mediaAssetId ? <video controls playsInline preload="none" src={`/api/v1/media/${video.mediaAssetId}`} /> : <p className="muted">Chưa có bản xem trước</p>}</div><div><h3>{video.title}</h3><p className="field-help">Targets: {video.targetPlatforms.join(', ') || 'Chưa chọn nơi sử dụng'}</p>{video.story && <><p className="phase5-source-excerpt">{video.story.post.title || video.story.post.body.slice(0, 260)}</p><div className="phase5-actions">{video.story.post.rights.map((right, index) => <span key={index}><StatusBadge value={right.reviewStatus} /> <span className="field-help">{right.basis}</span></span>)}</div></>}<DataDetails value={video.qualityReport} label="Báo cáo chất lượng và kiểm tra bắt buộc" />{mayReview(role) && <div className="phase5-actions"><button className="button secondary small" disabled={busy} onClick={() => void mutate(`/videos/${video.id}/reviews`, { decision: 'REJECTED' }, 'Video rejected.')}>Không duyệt</button><button className="button small" disabled={busy || !video.mediaAssetId} onClick={() => void mutate(`/videos/${video.id}/reviews`, { decision: 'APPROVED' }, 'Review decision recorded. Rights and safety checks were reapplied.')}>Duyệt video</button></div>}</div></article>)}</div> : <EmptyState title="Chưa có video chờ duyệt">Video hoàn tất kiểm tra chất lượng sẽ xuất hiện tại đây.</EmptyState>}</section>
  </>;
}
