import { getVideoMetadata } from '@remotion/renderer';
import { z } from 'zod';

process.once('message', async raw => {
  try {
    const { file } = z.object({ file: z.string() }).strict().parse(raw);
    const metadata = await getVideoMetadata(file, { logLevel: 'error' });
    process.send?.({ codec: metadata.codec, width: metadata.width, height: metadata.height, fps: metadata.fps, durationInSeconds: metadata.durationInSeconds });
  } catch { process.send?.({ error: true }); }
  finally { process.disconnect?.(); }
});
