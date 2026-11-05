import { StudioWorkbench } from '../../../components/studio-workbench';
import { studioSelection } from '../../../lib/studio';

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selection = (() => { try { return studioSelection(params); } catch { return null; } })();
  if (!selection) return <div className="notice error" role="alert">Link Studio không hợp lệ. <a href="/studio">Mở lại Studio</a></div>;
  return <StudioWorkbench key={JSON.stringify(params)} {...selection} importMode={params.mode === 'import'} videosView={params.view === 'videos'} />;
}
