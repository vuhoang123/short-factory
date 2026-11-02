"""Build the local extension without redistributing the user's capture engine source."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / '.data' / 'source-capture'
manifest = json.loads((DATA / 'engine.json').read_text(encoding='utf-8'))
engine = Path(manifest['engine'])
for name, checksum in manifest['hashes'].items():
    if hashlib.sha256((engine / 'app' / name).read_bytes()).hexdigest() != checksum:
        raise RuntimeError('CAPTURE_ENGINE_CHANGED: review and rerun local:capture:setup')
os.environ['COMMENT_DATA_DIR'] = str(DATA / 'engine-settings')
sys.path.insert(0, str(engine))
from app.source_capture import SOURCE_NODES, SOURCE_GEOMETRY  # noqa: E402
from app.facebook import FACEBOOK_DOM_HELPERS  # noqa: E402
from app.threads import THREADS_DOM_HELPERS  # noqa: E402

destination = DATA / 'extension'
destination.mkdir(parents=True, exist_ok=True)
for source in (ROOT / 'browser-extension').iterdir():
    if source.is_file() and source.suffix in {'.js', '.json', '.html', '.css'}:
        shutil.copyfile(source, destination / source.name)

read = r'''input => {
  const visible = e => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const clean = s => (s || '').trim();
  __HELPERS__
  const nodes = (__SOURCE_NODES__)(input);
  const roots = nodes.filter(node => node.main);
  if (roots.length !== 1) return {error:'CAPTURE_POST_NOT_IDENTIFIED'};
  const root = roots[0];
  if (!root.text || root.text.length > 5000 || !root.author || root.author.length > 100) return {error:'CAPTURE_POST_TOO_LONG'};
  const warnings = ['Top react trong các bình luận đang được tải; extension không tự cuộn hoặc tải toàn bộ bài.', 'Ảnh che tên/avatar chỉ che header đã nhận diện; hãy xem lại tên xuất hiện trong nội dung hoặc ảnh đính kèm.'];
  let raw;
  if (input.platform === 'facebook') {
    const post = facebookPost();
    if (!post) return {error:'CAPTURE_POST_NOT_IDENTIFIED'};
    raw = facebookComments(post, true);
  } else raw = threadsReplies(threadsCards(), input.postCode);
  const normalized = value => value.replace(/\s+/g,' ').trim();
  const entries = [root], comments = [];
  const ranked = raw.map((entry,index) => ({...entry,index})).sort((a,b) => {
    if (a.reaction_count == null && b.reaction_count != null) return 1;
    if (a.reaction_count != null && b.reaction_count == null) return -1;
    return (b.reaction_count ?? 0)-(a.reaction_count ?? 0) || a.index-b.index;
  });
  for (const entry of ranked) {
    if (!entry.text || entry.text.length > 2000 || !entry.author || entry.author.length > 100) continue;
    const matches = nodes.filter(node => !node.main && normalized(node.text) === normalized(entry.text) && normalized(node.author) === normalized(entry.author));
    if (matches.length !== 1 || entries.some(item => item.key === matches[0].key)) continue;
    const node = matches[0];
    entries.push(node);
    comments.push({author:entry.author,text:entry.text,reaction_count:entry.reaction_count ?? null,captureKey:node.key});
    if (comments.length >= 30) break;
  }
  if (raw.length > comments.length) warnings.push('Chỉ giữ tối đa 30 bình luận khớp duy nhất với thẻ đang hiển thị; nội dung quá dài/không khớp được bỏ qua.');
  return {post:{platform:input.platform,author:root.author,text:root.text,comments,warnings,comment_pool_size:raw.length},entries};
}'''.replace('__HELPERS__', FACEBOOK_DOM_HELPERS + THREADS_DOM_HELPERS).replace('__SOURCE_NODES__', SOURCE_NODES)
(destination / 'engine.js').write_text(f'// Generated from hash-verified local engine. Do not redistribute without its license.\nexport const readSource = {read};\nexport const sourceGeometry = {SOURCE_GEOMETRY};\n', encoding='utf-8')
print(f'Current-browser extension ready: {destination}')
