/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Detects a .NET project below a directory: the SDK version it asks for,
 * the target frameworks its projects build for, and which test platform
 * `dotnet test` runs under.
 *
 * Consumed by language-detect and by the dotnet-quality action.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export type DotnetTestRunner = "vstest" | "mtp";

export interface DotnetInfo {
  /**
   * SDK version for actions/setup-dotnet: global.json's `sdk.version`, or
   * `<major>.<minor>.x` of the newest target framework. "" when neither
   * names one.
   */
  version: string;
  /** "global.json", "TargetFramework", or "" when no version was found. */
  versionSource: string;
  /** `<major>.<minor>.x` for every target framework, oldest first. */
  frameworkChannels: string[];
  /**
   * Test platform `dotnet test` uses. global.json opts in to the
   * Microsoft Testing Platform with `test.runner`; anything else is VSTest.
   */
  testRunner: DotnetTestRunner;
}

const PROJECT_EXTENSIONS = [".csproj", ".fsproj", ".vbproj"];
const SOLUTION_EXTENSIONS = [".sln", ".slnx"];

/** True when a path is a .NET project file. */
export function isProjectFile(path: string): boolean {
  return PROJECT_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** True when a path is a solution file. */
export function isSolutionFile(path: string): boolean {
  return SOLUTION_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Read the .NET side of a directory, or null when it holds no solution or
 * project file.
 *
 * @param root Absolute path to the directory.
 * @param files Paths below `root`, from listFiles.
 * @param stopAt Highest folder to look in for global.json, usually the
 *   repository root. The SDK reads the nearest global.json above the
 *   project, so one at the repository root applies to a project in a
 *   subfolder. Defaults to `root` alone.
 */
export function detectDotnet(
  root: string,
  files: readonly string[],
  stopAt: string = root,
): DotnetInfo | null {
  if (!files.some((f) => isProjectFile(f) || isSolutionFile(f))) return null;

  const globalJsonPath = findGlobalJson(root, stopAt);
  const globalJson = globalJsonPath
    ? readGlobalJson(globalJsonPath)
    : { sdkVersion: "", testRunner: "vstest" as const };
  const frameworkChannels = targetFrameworkChannels(root, files);
  const newest = frameworkChannels.at(-1) ?? "";

  let version = "";
  let versionSource = "";
  if (globalJson.sdkVersion) {
    version = globalJson.sdkVersion;
    versionSource = "global.json";
  } else if (newest) {
    version = newest;
    versionSource = "TargetFramework";
  }

  return {
    version,
    versionSource,
    frameworkChannels,
    testRunner: globalJson.testRunner,
  };
}

/**
 * Find the nearest global.json at `root` or above it, no higher than
 * `stopAt`. Returns its absolute path, or "" when there is none.
 *
 * @param root Absolute path to start from.
 * @param stopAt Absolute path of the highest folder to look in. Ignored
 *   when it is not `root` or one of its ancestors.
 */
export function findGlobalJson(root: string, stopAt: string = root): string {
  const top = resolve(stopAt);
  const inside = !relative(top, resolve(root)).startsWith("..");
  let dir = resolve(root);
  for (;;) {
    const candidate = resolve(dir, "global.json");
    if (existsSync(candidate)) return candidate;
    if (!inside || dir === top) return "";
    const parent = dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
}

/**
 * Read `sdk.version` and `test.runner` from a global.json. The file may
 * hold comments, which the SDK accepts and JSON.parse does not, so they
 * are removed first.
 *
 * @param path Absolute path to global.json.
 */
export function readGlobalJson(path: string): {
  sdkVersion: string;
  testRunner: DotnetTestRunner;
} {
  const none = { sdkVersion: "", testRunner: "vstest" as const };
  if (!existsSync(path)) return none;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
  } catch {
    return none;
  }
  const doc = asRecord(parsed);
  const sdk = asRecord(doc?.sdk);
  const test = asRecord(doc?.test);
  const sdkVersion = typeof sdk?.version === "string" ? sdk.version : "";
  const runner = typeof test?.runner === "string" ? test.runner : "";
  return {
    sdkVersion,
    testRunner: runner === "Microsoft.Testing.Platform" ? "mtp" : "vstest",
  };
}

/**
 * Collect `<major>.<minor>.x` channels from every `TargetFramework` and
 * `TargetFrameworks` value in the project files and `Directory.Build.props`.
 * .NET Framework (`net48`) and .NET Standard name no SDK and are skipped.
 *
 * @param root Absolute path to the directory.
 * @param files Paths below `root`.
 */
export function targetFrameworkChannels(
  root: string,
  files: readonly string[],
): string[] {
  const channels = new Set<string>();
  const sources = files.filter(
    (f) => isProjectFile(f) || f.endsWith("Directory.Build.props"),
  );
  for (const file of sources) {
    let text: string;
    try {
      text = readFileSync(resolve(root, file), "utf8");
    } catch {
      continue;
    }
    for (const tfm of readTargetFrameworks(text)) {
      const channel = channelOf(tfm);
      if (channel) channels.add(channel);
    }
  }
  return [...channels].sort(compareChannels);
}

/**
 * Read target framework monikers from MSBuild XML. Values written as a
 * property reference (`$(TargetFrameworks)`) are skipped.
 *
 * @param xml Project file contents.
 */
export function readTargetFrameworks(xml: string): string[] {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const out: string[] = [];
  const re = /<TargetFrameworks?\b[^>]*>([^<]*)<\/TargetFrameworks?>/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    for (const part of m[1].split(";")) {
      const tfm = part.trim();
      if (tfm && !tfm.includes("$(")) out.push(tfm);
    }
  }
  return out;
}

/**
 * Map a target framework moniker to an SDK channel: `net8.0` and
 * `net8.0-windows` give `8.0.x`, `netcoreapp3.1` gives `3.1.x`.
 *
 * @param tfm Target framework moniker.
 * @returns The channel, or "" for .NET Framework and .NET Standard.
 */
export function channelOf(tfm: string): string {
  const m = tfm.trim().match(/^net(?:coreapp)?(\d+)\.(\d+)/i);
  return m ? `${m[1]}.${m[2]}.x` : "";
}

function compareChannels(a: string, b: string): number {
  const [aMajor, aMinor] = a.split(".").map(Number);
  const [bMajor, bMinor] = b.split(".").map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/** Remove `//` and `/* *\/` comments that sit outside strings. */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
