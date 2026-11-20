/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Converts Visual Studio TRX test results into JUnit XML.
 *
 * `dotnet test` writes TRX on both test platforms: VSTest with its built-in
 * `trx` logger, and the Microsoft Testing Platform with `--report-trx` (the
 * TRX report extension) or xUnit.net v3's own `--report-xunit-trx`. JUnit
 * is the format the rest of the shared CI reads (findings-tests, test
 * report check runs), so the dotnet-quality action converts once here
 * rather than every consumer learning TRX.
 *
 * Mapping:
 *
 *   Passed                              <testcase/>
 *   Failed                              <testcase><failure/></testcase>
 *   Error, Timeout, Aborted             <testcase><error/></testcase>
 *   NotExecuted, Inconclusive, other    <testcase><skipped/></testcase>
 *
 * Results are grouped into one `<testsuite>` per test class, named from
 * the TRX test definition. Data-driven tests that TRX nests under
 * `<InnerResults>` are reported once, by their parent result.
 */
export type CaseOutcome = "passed" | "failed" | "error" | "skipped";
export interface TestCase {
    className: string;
    name: string;
    /** Seconds. */
    time: number;
    outcome: CaseOutcome;
    message?: string;
    stackTrace?: string;
}
/** Escape text for an XML attribute or element body. */
export declare function escapeXml(text: string): string;
/** Read a TRX `hh:mm:ss.fffffff` duration as seconds. */
export declare function parseDuration(duration: string | undefined): number;
/**
 * Read the test cases from one TRX document.
 *
 * @param trx TRX file contents.
 * @returns The cases, or null when the document is not TRX.
 */
export declare function parseTrx(trx: string): TestCase[] | null;
/**
 * Render test cases as one JUnit XML document, a `<testsuite>` per class.
 *
 * @param cases Cases from one or more TRX files.
 */
export declare function toJunit(cases: readonly TestCase[]): string;
