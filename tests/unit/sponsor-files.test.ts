import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moduleExports, prepareSponsorFiles, shimSource, SPONSOR_PUBLIC_DIR, SPONSOR_SHIM } from "../../scripts/sponsor-files";

describe("sponsor files (Bryntum served as its own script)", () => {
  it("reads the public names from the module's export list", () => {
    expect(moduleExports("var a=1;export{AI3 as AI,Base,TaskModel2 as TaskModel};")).toEqual(["AI", "Base", "TaskModel"]);
  });

  it("re-exports each name from the global, and a default too", () => {
    const shim = shimSource(["TaskModel", "default"]);
    expect(shim).toContain("export const TaskModel = all.TaskModel;");
    expect(shim).toContain("export default all.default;");
  });

  it("covers every export of the installed Gantt module", () => {
    const pkg = path.join(process.cwd(), "node_modules", "@bryntum", "gantt");
    const names = moduleExports(fs.readFileSync(path.join(pkg, "gantt.module.js"), "utf8"));
    expect(names.length).toBeGreaterThan(1000);
    expect(names).toContain("TaskModel");
    expect(new Set(names).size).toBe(names.length);
  });

  it("writes the files with the switch on and deletes them with it off", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sponsor-files-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"));
    prepareSponsorFiles(true, root);
    expect(fs.statSync(path.join(root, SPONSOR_PUBLIC_DIR, "gantt.umd.js")).size).toBeGreaterThan(1_000_000);
    expect(fs.readFileSync(path.join(root, SPONSOR_SHIM), "utf8")).toContain("export const TaskModel = all.TaskModel;");
    prepareSponsorFiles(false, root);
    expect(fs.existsSync(path.join(root, SPONSOR_PUBLIC_DIR))).toBe(false);
    expect(fs.existsSync(path.join(root, SPONSOR_SHIM))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
