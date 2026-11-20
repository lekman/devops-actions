/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Detects a JVM project at a directory: which build tool owns it, and
 * which Java version it asks for.
 *
 * Consumed by language-detect, whose outputs gate the jvm-quality and
 * jvm-audit actions.
 */
export type JvmBuildTool = "gradle" | "maven";
/** Java version used when the project pins none. */
export declare const DEFAULT_JAVA_VERSION = "17";
export interface JvmInfo {
    buildTool: JvmBuildTool;
    /** Java feature release, e.g. "21". */
    javaVersion: string;
    /** Where the version came from, e.g. ".java-version", or "default". */
    javaVersionSource: string;
}
/**
 * Decide which build tool owns the directory, or null when neither does.
 *
 * Gradle wins when both are present, because a Gradle build that keeps a
 * pom.xml beside it uses it for publishing, not for building.
 *
 * @param root Absolute path to the project directory.
 */
export declare function detectBuildTool(root: string): JvmBuildTool | null;
/**
 * Read the JVM side of a directory, or null when it holds no JVM build.
 *
 * @param root Absolute path to the project directory.
 */
export declare function detectJvm(root: string): JvmInfo | null;
/**
 * Turn a version as tools write it into a Java feature release.
 *
 * mise and asdf prefix a vendor (`temurin-17.0.21+9`, `corretto-21.0.5`),
 * and Java 8 is often written `1.8`. Only the feature release is kept,
 * because the quality action installs Temurin, and a patch level from
 * another vendor names a build Temurin does not publish.
 *
 * @param raw Version as written in a file.
 * @returns The feature release, or "" when none can be read.
 */
export declare function normaliseJavaVersion(raw: string): string;
/**
 * Resolve the Java version, first match wins:
 *
 *   1. `.java-version`
 *   2. a `java` line in `.tool-versions`
 *   3. `[tools] java` in `mise.toml` or `.mise.toml`
 *   4. the Gradle toolchain (`jvmToolchain(21)`, `JavaLanguageVersion.of(21)`)
 *   5. the Maven compiler release (`maven.compiler.release`, `<release>`)
 *   6. {@link DEFAULT_JAVA_VERSION}
 *
 * @param root Absolute path to the project directory.
 * @param buildTool The build tool, which decides where step 4 or 5 looks.
 */
export declare function detectJavaVersion(root: string, buildTool: JvmBuildTool): {
    version: string;
    source: string;
};
/**
 * Read the toolchain version from a Gradle build script, Kotlin or Groovy.
 *
 * @param script Build script contents.
 */
export declare function gradleToolchainVersion(script: string): string;
/**
 * Read the compiler release from a pom.xml. `maven.compiler.release` is
 * the property Maven documents; `<release>` on the compiler plugin and
 * the older `source`/`target` pair and `java.version` are read after it.
 *
 * @param pom pom.xml contents.
 */
export declare function mavenReleaseVersion(pom: string): string;
