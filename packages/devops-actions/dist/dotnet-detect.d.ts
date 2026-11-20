/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Detects a .NET project below a directory: the SDK version it asks for,
 * the target frameworks its projects build for, and which test platform
 * `dotnet test` runs under.
 *
 * Consumed by language-detect and by the dotnet-quality action.
 */
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
/** True when a path is a .NET project file. */
export declare function isProjectFile(path: string): boolean;
/** True when a path is a solution file. */
export declare function isSolutionFile(path: string): boolean;
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
export declare function detectDotnet(root: string, files: readonly string[], stopAt?: string): DotnetInfo | null;
/**
 * Find the nearest global.json at `root` or above it, no higher than
 * `stopAt`. Returns its absolute path, or "" when there is none.
 *
 * @param root Absolute path to start from.
 * @param stopAt Absolute path of the highest folder to look in. Ignored
 *   when it is not `root` or one of its ancestors.
 */
export declare function findGlobalJson(root: string, stopAt?: string): string;
/**
 * Read `sdk.version` and `test.runner` from a global.json. The file may
 * hold comments, which the SDK accepts and JSON.parse does not, so they
 * are removed first.
 *
 * @param path Absolute path to global.json.
 */
export declare function readGlobalJson(path: string): {
    sdkVersion: string;
    testRunner: DotnetTestRunner;
};
/**
 * Collect `<major>.<minor>.x` channels from every `TargetFramework` and
 * `TargetFrameworks` value in the project files and `Directory.Build.props`.
 * .NET Framework (`net48`) and .NET Standard name no SDK and are skipped.
 *
 * @param root Absolute path to the directory.
 * @param files Paths below `root`.
 */
export declare function targetFrameworkChannels(root: string, files: readonly string[]): string[];
/**
 * Read target framework monikers from MSBuild XML. Values written as a
 * property reference (`$(TargetFrameworks)`) are skipped.
 *
 * @param xml Project file contents.
 */
export declare function readTargetFrameworks(xml: string): string[];
/**
 * Map a target framework moniker to an SDK channel: `net8.0` and
 * `net8.0-windows` give `8.0.x`, `netcoreapp3.1` gives `3.1.x`.
 *
 * @param tfm Target framework moniker.
 * @returns The channel, or "" for .NET Framework and .NET Standard.
 */
export declare function channelOf(tfm: string): string;
