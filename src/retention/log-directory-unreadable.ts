/**
 * Ported from storefront-lamp/core/Retention/LogDirectoryUnreadable.php. The log directory is there
 * and cannot be listed, so the sweep never happened.
 *
 * This is a type rather than a return value because the two states it separates are indistinguishable
 * from outside and opposite in meaning. A *missing* directory is a deployment that has never written
 * a log — provably nothing to expire, and `LogSweep` answers zero for it on purpose. A directory that
 * exists and cannot be opened is a sweep that produced no answer at all, and "zero files were old
 * enough" is the one thing it must never be reported as: what survives is the file that can hold
 * verbatim card numbers and Social Security Numbers, with nothing else scheduled to remove it.
 *
 * **The class name is the whole diagnostic.** `db:prune` reports a failure through `FailureDigest`,
 * which prints the exception's class and never its message, so this is named to be read as a console
 * line by an operator with no other record of the run.
 */
export class LogDirectoryUnreadable extends Error {
  static at(directory: string): LogDirectoryUnreadable {
    return new LogDirectoryUnreadable(`The log directory exists but could not be listed: ${directory}`);
  }
}
