import path from 'path';
import { extractStudentIdentityFromOmr } from '../src/services/omr.service';
import fs from 'fs';

const repoRoot = path.resolve(__dirname, '..', '..');
const files = [
  'test/Mixed/22521000_mcq_identity.png',
  'test/Mixed/22521001_mcq_identity.png',
  'test/Mixed/22521002_mcq_identity.png',
  'test/Mixed/22521003_mcq_identity.png',
].map((p) => path.join(repoRoot, p));

(async () => {
  const outDir = path.join(repoRoot, 'test', 'debugOutputs');
  await fs.promises.rm(outDir, { recursive: true, force: true });
  await fs.promises.mkdir(outDir, { recursive: true });

  const dumpScores = process.argv.includes('--dump-scores');

  for (const f of files) {
    try {
      // eslint-disable-next-line no-console
      console.log('Running OMR on', f);
      const basename = path.basename(f).replace(/\s+/g, '_');
      const warpOut = path.join(outDir, `${basename}.warped.png`);
      const overlayOut = path.join(outDir, `${basename}.overlay.png`);
      const r = await extractStudentIdentityFromOmr(f, { exportWarpPath: warpOut, exportOverlayPath: overlayOut, dumpScores: dumpScores });
      // eslint-disable-next-line no-console
      console.log('Requested warp export to', warpOut);
      const exists = fs.existsSync(warpOut);
      // eslint-disable-next-line no-console
      console.log('Warp file exists:', exists);
      // eslint-disable-next-line no-console
      console.log('Requested overlay export to', overlayOut);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(r, null, 2));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error on', f, err);
    }
  }
})();
