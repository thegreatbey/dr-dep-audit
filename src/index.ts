#!/usr/bin/env node
import { Command } from "commander";
import path from "path";
import fs from "fs/promises";
import yaml from "js-yaml";

type SeverityLevel = "none" | "low" | "moderate" | "high" | "critical";

async function loadConfig(cwd: string): Promise<{ severity?: SeverityLevel; exclude?: string[] }> {
  const tryFiles = [
    "dep-audit.json",
    "dep-audit.yaml",
    "dep-audit.yml",
    ".dep-auditrc",
  ].map((p) => path.resolve(cwd, p));

  for (const p of tryFiles) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      if (p.endsWith(".yaml") || p.endsWith(".yml")) {
        const data = yaml.load(raw) as unknown;
        if (data && typeof data === "object") return data;
      } else {
        return JSON.parse(raw);
      }
    } catch {
      // ignore missing/invalid files, continue
    }
  }
  return {};
}

(async () => {
  const program = new Command();
  program
    .name("dep-audit")
    .description("Audit npm dependencies for vulnerabilities and outdated packages")
    .option("-p, --path <path>", "Project path", process.cwd())
    .option("-s, --severity <level>", "Minimum severity to report (low|moderate|high|critical)", "low")
    .option("-x, --exclude <list>", "Comma-separated packages to exclude", "")
    .option("--gha", "Emit GitHub Actions annotations", false)
    .parse(process.argv);

  const cli = program.opts<{ path: string; severity: string; exclude: string; gha: boolean }>();

  const cfg = await loadConfig(cli.path);
  const severity = (cli.severity || cfg.severity || "low") as SeverityLevel;
  const exclude = (cli.exclude ? cli.exclude.split(",") : (cfg.exclude || [])).map((s) => s.trim()).filter(Boolean);

  try {
    const { auditDependencies } = await import("./audit.js");
    const code = await auditDependencies(path.resolve(cli.path), {
      severity,
      exclude,
      githubAnnotations: !!cli.gha,
    });
    process.exit(code);
  } catch (err) {
    console.error("Unexpected error:", err);
    process.exit(1);
  }
})();
