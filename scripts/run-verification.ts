import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalforge-verify-'));
const isolatedDbPath = path.join(tempDir, 'signalforge.db.json');
process.env.SIGNALFORGE_DB_PATH = isolatedDbPath;

try {
  const { db } = await import('../src/server/db.js');
  const { runAllVerificationTests } = await import('../src/server/tests.js');

  const resolvedDbPath = path.resolve(db.getDbPath());
  const defaultDbPath = path.resolve(process.cwd(), 'data', 'signalforge.db.json');
  if (resolvedDbPath === defaultDbPath || resolvedDbPath !== path.resolve(isolatedDbPath)) {
    throw new Error(`Test isolation breach: resolvedDbPath=${resolvedDbPath}, expected=${path.resolve(isolatedDbPath)}`);
  }

  const report = await runAllVerificationTests();
  const jsonOutPath = process.env.SIGNALFORGE_VERIFY_JSON_OUT;
  if (jsonOutPath) {
    fs.writeFileSync(jsonOutPath, JSON.stringify(report), 'utf-8');
  }
  if (!process.argv.includes('--json')) {
    console.log(
      `Verification suite (isolated DB: ${resolvedDbPath}): ${report.summary.passed}/${report.summary.total} passed; ${report.summary.failed} failed; ${report.summary.durationMs}ms.`
    );

    for (const result of report.results) {
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${result.category}: ${result.name}${result.error ? ` — ${result.error}` : ''}`);
    }
  }

  if (report.summary.failed > 0) process.exitCode = 1;
  await db.shutdownAsync();
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort temp dir cleanup
  }
}
