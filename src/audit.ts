/* eslint-disable @typescript-eslint/no-unused-vars */
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import ncu from "npm-check-updates";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";

const execPromise = util.promisify(exec);

type SeverityLevel = "none" | "low" | "moderate" | "high" | "critical";

type Vulnerability = {
  name?: string;
  severity: SeverityLevel | string;
  via?: Array<string | { title?: string; source?: string; url?: string }>;
  effects?: string[];
  range?: string;
  fixAvailable?: boolean | { name: string; version: string };
};

type AuditResult = {
  vulnerabilities: Record<string, Vulnerability>;
  metadata?: {
    vulnerabilities?: Partial<Record<SeverityLevel, number>>;
  };
};

// ---- helpers for safe narrowing ----
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function has<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}
function isExecError(e: unknown): e is { stdout?: string; stderr?: string; message?: string } {
  return typeof e === "object" && e !== null && ("stdout" in e || "stderr" in e || "message" in e);
}

function normalizeAuditJson(raw: unknown): AuditResult | null {
  if (!raw) return null;

  // npm v7+ shape
  if (has(raw, "vulnerabilities") && isObject(raw.vulnerabilities)) {
    return {
      vulnerabilities: raw.vulnerabilities as Record<string, Vulnerability>,
      metadata: has(raw, "metadata") ? (raw.metadata as AuditResult["metadata"]) : undefined,
    };
  }

  // npm v6 "advisories" shape → flatten to a simple record keyed by module name
  if (has(raw, "advisories") && isObject(raw.advisories)) {
    const vulns: Record<string, Vulnerability> = {};
    const advisories = raw.advisories as Record<string, unknown>;
    for (const advRaw of Object.values(advisories)) {
      const adv = advRaw as {
        module_name?: string;
        name?: string;
        severity?: string;
        title?: string;
        url?: string;
        vulnerable_versions?: string;
        fixAvailable?: boolean;
      };
      const name = adv.module_name || adv.name || "unknown";
      const severity: SeverityLevel =
        (adv.severity?.toLowerCase() as SeverityLevel) || "moderate";
      vulns[name] = {
        name,
        severity,
        via: [{ title: adv.title ?? "", url: adv.url ?? "" }],
        range: adv.vulnerable_versions,
        fixAvailable: !!adv.fixAvailable,
      };
    }
    return { vulnerabilities: vulns };
  }

  return null;
}

export async function runNpmAudit(projectPath: string): Promise<AuditResult | null> {
  try {
    const { stdout } = await execPromise("npm audit --json", { cwd: projectPath });
    const json = JSON.parse(stdout);
    return normalizeAuditJson(json);
  } catch (error: unknown) {
    const message = isExecError(error) ? String(error.stdout ?? error.stderr ?? "") : "";
    try {
      const parsed = JSON.parse(message);
      return normalizeAuditJson(parsed);
    } catch {
      console.error("Failed to run npm audit:", isExecError(error) ? error.message : String(error));
      return null;
    }
  }
}

export async function checkOutdatedDependencies(projectPath: string): Promise<Record<string, string> | null> {
  const spinner = ora("Checking for outdated dependencies...").start();
  try {
    const upgraded = await ncu.run({ cwd: projectPath });
    spinner.succeed("Checked outdated dependencies.");
    return upgraded as Record<string, string>;
  } catch (error) {
    spinner.fail("Failed to check outdated dependencies.");
    console.error(error);
    return null;
  }
}

function getDependenciesBadgeUrl(isUpToDate: boolean): string {
  return isUpToDate
    ? "https://img.shields.io/badge/dependencies-up_to_date-brightgreen"
    : "https://img.shields.io/badge/dependencies-out_of_date-yellow";
}

function getVulnerabilitiesBadgeUrl(maxSeverity: SeverityLevel): string {
  const colorMap: Record<SeverityLevel, string> = {
    none: "brightgreen",
    low: "yellowgreen",
    moderate: "orange",
    high: "red",
    critical: "red",
  };
  return `https://img.shields.io/badge/vulnerabilities-${maxSeverity}-${colorMap[maxSeverity] || "lightgrey"}`;
}

const severityOrder: SeverityLevel[] = ["none", "low", "moderate", "high", "critical"];
const sevColor: Record<SeverityLevel, (s: string) => string> = {
  none: (s) => s,
  low: (s) => chalk.yellow(s),
  moderate: (s) => chalk.hex("#FFA500")(s),
  high: (s) => chalk.red(s),
  critical: (s) => chalk.bgRed.white(s),
};

function maxSeverityOf(vulns: Vulnerability[]): SeverityLevel {
  let max: SeverityLevel = "none";
  for (const v of vulns) {
    const sev = (String(v.severity || "none").toLowerCase() as SeverityLevel);
    if (severityOrder.indexOf(sev) > severityOrder.indexOf(max)) {
      max = sev;
    }
  }
  return max;
}

export async function auditDependencies(
  projectPath: string,
  options: { severity: SeverityLevel; exclude: string[]; githubAnnotations?: boolean }
): Promise<number> {
  console.log(chalk.cyan(`Running npm audit on ${projectPath}…`));

  const result = await runNpmAudit(projectPath);
  if (!result) {
    console.error(chalk.red("Could not obtain audit results."));
    return 1;
  }

  // Filter out excluded packages
  const excludeSet = new Set(options.exclude.map((s) => s.trim()).filter(Boolean));
  const entries = Object.entries(result.vulnerabilities || {}).filter(([name]) => !excludeSet.has(name));

  const vulns = entries.map(([name, v]) => ({ name, ...v }));

  if (vulns.length === 0) {
    console.log(chalk.green("\nNo vulnerabilities found! 🎉"));
  } else {
    console.log(chalk.yellow("\nVulnerabilities:"));

    const table = new Table({
      head: ["Package", "Severity", "Details"],
      colWidths: [28, 12, 80],
      wordWrap: true,
    });

    for (const v of vulns) {
      const sev = (String(v.severity || "none").toLowerCase() as SeverityLevel);
      const color = sevColor[sev] || ((s: string) => s);
      const details =
        (v.via || [])
          .map((x) => (typeof x === "string" ? x : (x.title || x.source || "")))
          .filter(Boolean)
          .slice(0, 3)
          .join(" • ") || "-";

      table.push([chalk.bold(v.name || "-"), color(sev.toUpperCase()), details]);
    }

    console.log(table.toString());
  }

  // Outdated
  const outdated = await checkOutdatedDependencies(projectPath);
  console.log(chalk.cyan("\nDependency status badges: (use Badge URLs in your README or docs):"));
  const depBadge = getDependenciesBadgeUrl(!outdated || Object.keys(outdated).length === 0);
  const maxSev = maxSeverityOf(vulns);
  const vulnBadge = getVulnerabilitiesBadgeUrl(maxSev);
  console.log(`  Dependencies: ${depBadge}`);
  console.log(`  Vulnerabilities: ${vulnBadge}`);

  if (outdated && Object.keys(outdated).length > 0) {
    console.log(chalk.yellow("\nOutdated Packages:"));
    const t = new Table({ head: ["Package", "Latest Version"], colWidths: [30, 20] });
    for (const [pkg, latest] of Object.entries(outdated)) {
      t.push([pkg, latest]);
    }
    console.log(t.toString());
  } else {
    console.log(chalk.green("\nAll dependencies are up to date."));
  }

  // Optional: GitHub annotations for each vulnerability
  if (options.githubAnnotations) {
    for (const v of vulns) {
      const sev = (String(v.severity || "none").toLowerCase() as SeverityLevel);
      const msg = `Vulnerability in ${v.name}: severity=${sev}`;
      // ::warning|error :: message  (annotations without file/line)
      const level = sev === "critical" || sev === "high" ? "error" : "warning";
      console.log(`::${level} ::${msg}`);
    }
  }

  // Exit code policy: fail on high/critical
  const shouldFail = vulns.some((v) => {
    const sev = (String(v.severity || "none").toLowerCase() as SeverityLevel);
    return sev === "high" || sev === "critical";
  });

  if (shouldFail) {
    console.error(chalk.red("\n❌ High/Critical vulnerabilities found."));
    return 1;
  }

  return 0;
}