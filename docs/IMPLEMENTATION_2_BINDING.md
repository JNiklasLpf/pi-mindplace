# MP2-02/03 binding status

Status: **bounded implementation; current acceptance ledger and follow-up are in [`IMPLEMENTATION_2_BINDING_REVIEW.md`](IMPLEMENTATION_2_BINDING_REVIEW.md).** The earlier acceptance table and totals in this file were historical and are superseded by that ledger. Do not claim the entire supported-language callable surface is enumerated.

## Current contract

- C# declarations/references are collected across the detected root before project-local binding. Calls, base types, and imports create edges only to real, unique project entities; ambiguous, external, dynamic, and unknown references remain diagnostic.
- C# ordinary methods and constructors, including expression-bodied methods, are callable owners. Same-type members, explicit qualified calls, static imports, and supported local functions/lambdas are resolved conservatively. Inherited unqualified calls remain unresolved: inheritance-aware member lookup, compiler semantics, assemblies, and virtual dispatch are out of scope.
- TS/JS declarations, methods, arrows, function expressions, and inline arrow/function callbacks passed as call arguments have innermost owners. Nested calls are not attributed again to an outer callable. Known unsupported forms (including object-literal methods, class/generator expressions, and selected C# property/event accessors, field-initializer callbacks, destructors, operators, conversion operators, and indexers) produce per-instance `unsupported_callable` diagnostics when they contain invocations rather than silent parent attribution. This list is not exhaustive across every grammar form.
- A C# qualified-call suffix fallback requires a complete known type qualifier, or a unique single-segment type name. A known first segment alone never licenses guessing through nonexistent qualifier components.
- Extraction cache schema 7 invalidates earlier semantic records. Legacy graph JSON remains loadable; this does not imply graph freshness.

## Regression and validation record

The authoritative issue ledger lists current regressions and exact validator evidence. This follow-up adds existing-file cases for known-head inconsistent qualifiers, inline TS/JS callbacks, C# expression-bodied methods, and unsupported C# callable diagnostics. Final validation passed: focused 32/32 and full 67/67; the isolated strict validator passed as recorded in the ledger. Prior 30 focused / 65 full totals are historical.

Remaining explicit limits: C# `global::` using forms remain untested; inherited member lookup is not implemented; callable diagnostics are bounded to known forms and not a guarantee that every grammar node has been enumerated. MP2-04 is a separate proposal in [`IMPLEMENTATION_2_FRESHNESS_DESIGN.md`](IMPLEMENTATION_2_FRESHNESS_DESIGN.md); no freshness runtime changes are authorized or included.
