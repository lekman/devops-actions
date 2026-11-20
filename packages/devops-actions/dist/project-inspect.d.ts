/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Reads a JVM or .NET project's own configuration so the quality actions
 * know which checks the project already runs for itself.
 *
 * The rule is that a repository's own configuration wins. The actions
 * ship defaults (ktlint, detekt, google-java-format, an 80% coverage
 * floor, a C# .editorconfig) for projects that configure none. A project
 * that applies its own plugin for one of those runs it through its build,
 * and the action's default for that check stands down rather than running
 * a second, differently configured copy.
 *
 * Detection reads build files as text, so it recognises the usual ways of
 * applying a plugin (plugin id, version catalog entry, Maven artifact id).
 * A plugin applied some other way, for example from a convention plugin
 * published elsewhere, is not seen. The action then runs its default as
 * well, which can only add a check, never remove one.
 */
export interface JvmProject {
    /** Any .kt or .kts file, so ktlint and detekt have something to read. */
    kotlinSources: boolean;
    /** Any .java file, so google-java-format has something to read. */
    javaSources: boolean;
    /** The build applies ktlint itself (ktlint-gradle, kotlinter, Spotless). */
    ownsKtlint: boolean;
    /** The build applies detekt itself. */
    ownsDetekt: boolean;
    /** The build formats Java itself (Spotless with a Java formatter). */
    ownsJavaFormat: boolean;
    /** The build declares its own coverage rule (Kover bound, JaCoCo rule). */
    ownsCoverageFloor: boolean;
    /**
     * Gradle tasks that run the project's own coverage rule, for the action
     * to name on the command line: koverVerify, jacocoTestCoverageVerification.
     */
    gradleVerifyTasks: string[];
    /** The project's detekt configuration, relative to the root, or "". */
    detektConfig: string;
}
/**
 * Inspect a JVM project directory.
 *
 * @param root Absolute path to the directory holding the build.
 * @param files Paths below `root`, from listFiles.
 */
export declare function inspectJvm(root: string, files: readonly string[]): JvmProject;
export interface DotnetProject {
    /**
     * The solution or project the dotnet commands run against, relative to
     * the root: the one solution at the root, else the one project at the
     * root. "" when there is neither, or more than one, and the action has
     * to build a solution from `projects`.
     */
    target: string;
    /** Every project file below the root, relative to it. */
    projects: string[];
    /** "vstest" or "mtp", from the nearest global.json. */
    testRunner: string;
    /** Absolute path of the nearest global.json, or "" when there is none. */
    globalJson: string;
    /** SDK channels the projects target, for setup-dotnet. */
    frameworkChannels: string[];
    /** An .editorconfig sits at the root or above it, up to the checkout. */
    hasEditorconfig: boolean;
    /** A project sets coverlet's `<Threshold>`. */
    ownsCoverageFloor: boolean;
    /** A project names its own run settings with `RunSettingsFilePath`. */
    ownsRunSettings: boolean;
    /** A test project references coverlet.collector. */
    usesCoverletCollector: boolean;
}
/**
 * Inspect a .NET directory.
 *
 * @param root Absolute path to the directory.
 * @param files Paths below `root`, from listFiles.
 * @param stopAt Highest folder to look in for global.json and .editorconfig.
 */
export declare function inspectDotnet(root: string, files: readonly string[], stopAt?: string): DotnetProject;
/** Render an inspection as GitHub Actions `key=value` output lines. */
export declare function formatJvmOutputs(p: JvmProject): string;
/** Render an inspection as GitHub Actions output lines. */
export declare function formatDotnetOutputs(p: DotnetProject): string;
