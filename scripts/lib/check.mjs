// Shared harness for the scripts/check-*.mjs family.
//
// These scripts are the project's entire test framework — there is no vitest or
// jest — and each one used to declare its own identical `check()`, `failures`
// counter and exit-code tail. Thirteen copies meant any harness improvement was
// a thirteen-file edit that nothing enforced, so in practice none ever happened.
//
// Usage:
//   const { check, done } = createChecker();
//   check("label", cond, "optional detail");
//   done("All X checks passed.", (n) => `${n} X check(s) failed.`);

export function createChecker() {
  let failures = 0;

  function check(label, cond, detail = "") {
    console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failures++;
    return !!cond;
  }

  // Prints the summary line and exits non-zero when anything failed.
  function done(okMessage, failMessage) {
    console.log(failures === 0 ? `\n${okMessage}` : `\n${failMessage(failures)}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  return { check, done, failureCount: () => failures };
}
