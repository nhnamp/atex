import path from 'path';
import { extractStudentIdentityFromOmr } from '../src/services/omr.service';
import fs from 'fs';

const repoRoot = path.resolve(__dirname, '..', '..');
const files = [
  'test/Mixed/Screenshot 2026-05-04 143804.png',
  'test/Mixed/Screenshot 2026-05-04 144228.png',
  'test/Mixed/Screenshot 2026-05-04 144343.png',
  'test/Mixed/Screenshot 2026-05-04 144521.png',
].map((p) => path.join(repoRoot, p));

(async () => {
  for (const f of files) {
    try {
      // eslint-disable-next-line no-console
      console.log('Running OMR on', f);
      const basename = path.basename(f).replace(/\s+/g, '_');
      const outDir = path.join(repoRoot, 'test', 'debug_output');
      await fs.promises.mkdir(outDir, { recursive: true });
      const warpOut = path.join(outDir, `${basename}.warped.png`);
      const r = await extractStudentIdentityFromOmr(f, { exportWarpPath: warpOut });
      // eslint-disable-next-line no-console
      console.log('Requested warp export to', warpOut);
      const exists = fs.existsSync(warpOut);
      // eslint-disable-next-line no-console
      console.log('Warp file exists:', exists);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(r, null, 2));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error on', f, err);
    }
  }
})();
