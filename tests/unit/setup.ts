/** Test files run side by side and the JSON stores are shared files, so each worker gets its own. */
import os from "node:os";
import path from "node:path";

process.env.KIT_DATA_DIR = path.join(os.tmpdir(), `kit-test-data-${process.pid}-${process.env.VITEST_POOL_ID ?? "0"}`);
