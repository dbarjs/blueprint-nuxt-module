# ADR 0012 — Numeric semantics for spec 0.1: binary64, integer cents, decimal-representation rounding

Status: proposed (2026-09-10). Layer: kernel. Turns handoff section 4.3
("a spec that only warns is not a spec") into decisions with fixtures.

## Context

The insurance case passed homologation with floating point and many
decimal places, but with one engine on one runtime. Reproducibility across
runtimes is a property of the spec and is guaranteed by fixtures, or not at
all. The health quote recorded the pressure directly: a chain of factors
(`12900 × 0.85 × 0.9`) can land on a half and rounding decides a cent.

Probing the current evaluator while writing this ADR found one deviation
worth a decision: `round` implements "half-up" with `Math.round`, which
rounds halves toward +∞, so `round(-2.5)` gives `-2` and `round(-1.5)`
gives `-1`. The handoff says explicitly never to inherit the language
default; it was inherited.

## Decision

### 1. Number model: binary64, declared

All arithmetic is IEEE 754 binary64. `+`, `-`, `*`, `/`, `%`, `min`, `max`,
`abs`, `floor`, `ceil` and `clamp` are bit-exact across conformant
implementations by the standard. Integers are exact up to 2⁵³ − 1; a result
above that is an error (`INTEGER_OVERFLOW`), not a silent loss. A decimal
model (decimal128, half-even, the FEEL/DMN choice) is a future spec
version, not an option of this one.

### 2. Domain: no non-finite values, no negative zero

Division by zero, `NaN`, `Infinity` and `-0` are errors (`DIVISION_BY_ZERO`,
`NOT_A_NUMBER`), never values; `-0` is normalized to `0` on output. JSON
cannot carry them and canonicalization (ADR 0013) must never meet them.
Already implemented for division and non-numeric arithmetic.

### 3. Money is integer cents

Totals, prices, fees and premiums are integers in the minor unit. Rates and
factors may be decimals. Multiplying cents by a factor produces a decimal
that **must** pass through `round` (or `percentOf`) before it is stored,
compared or displayed as money. `validate` warns when a definition typed
`number` and named like money (`total`, `fee`, `premium`, `price`, `amount`)
is not integer on every test; a warning, because the heuristic is a
heuristic.

### 4. Rounding: two decisions, both explicit

- **Representation:** `round` operates on the **shortest decimal
  representation** of the binary64 value (the ECMAScript `Number#toString`
  digits), not on the binary expansion. `round(1.005, 2)` is `1.01`, which is
  what the analyst's spreadsheet says. Implemented today.
- **Mode:** `half-up` means **half away from zero** (`round(2.5) = 3`,
  `round(-2.5) = -3`). `half-even` is banker's rounding on the same
  representation (`round(2.5) = 2`, `round(3.5) = 4`, `round(-2.5) = -2`).
  `floor` and `ceil` are toward −∞ and +∞. `half-down` (toward zero) is
  added for completeness. Default mode is `half-up`. The current
  implementation deviates for negative halves and is corrected with this
  ADR's fixtures.

`percentOf(cents, percent)` is defined as `round(cents × percent / 100, 0, "half-up")`
and is the recommended way to apply a percentage to money.

### 5. Order and iteration

- `+` and `*` with more than two arguments fold left to right; `sum`
  accumulates left to right; no pairwise or compensated summation.
- Iteration is over arrays only. `keys`, `values` and `groupBy` produce
  keys in **canonical order** (sorted by UTF-16 code units, the order of
  the canonical document, ADR 0013), whatever order the runtime's object
  model keeps them in. A fixture with keys `"10"` and `"2"` pins it:
  `"10"` before `"2"`. JavaScript engines cannot rely on `Object.keys`,
  which puts integer-like keys first in numeric order; they sort.

### 6. Transcendental functions are outside the kernel

`pow` with non-integer exponent, `exp`, `log`, `sqrt` and trigonometry are
**not** kernel operators in 0.1. `pow` with an integer exponent is
exponentiation by squaring (bit-exact). A distribution that needs
actuarial functions declares an operator vocabulary
(`ops.actuarial@1`), with the handoff's rule: every result is rounded to a
declared number of digits immediately after the call, so the observable
output is exact and fixtures are bit-exact.

### 7. Chains of factors: reproducible is not the same as expected

`12900 × 0.85 × 0.9` is `9868.5` in binary64 today (the health quote's
fear was not realised in this particular case), but `a × b × c` and
`a × c × b` may differ in the last bit for other values. The spec does
not hide this; it pins the order (left to right) and makes the result
reproducible. To make it **match the spreadsheet**, authors round at the
points the business rounds, and the kernel offers one exact tool for
rates: `scale(value, numerator, denominator, mode?)`, integer-exact
`value × numerator / denominator` rounded with the mode
(`scale(12900, 85, 100)` = `10965` exactly). Proposed, not yet implemented;
the health quote would express `dependentRate: 0.35` as
`{ "num": 35, "den": 100 }` with it.

### 8. `format` is presentational and partly locale-dependent

`format` for `currency`, `number`, `integer` and `percent` is **normative
for `en-US`** (the corpus locale): grouping by three, the given decimals,
`$` prefix for USD, `-` sign. Other locales and all date and time formats
are runtime-provided (`Intl` here) and marked `LOCALE_DEPENDENT` by
`validate` when they appear in a test expectation; such expectations are
exported to the corpus only with `locale: "en-US"`. Trees containing them
are compared with the text of those nodes masked in cross-runtime
fixtures.

### 9. Fixtures are bit-exact

Expected numbers are written as canonical strings (`"0.30000000000000004"`
for `0.1 + 0.2`) and compared as strings after canonical serialization.
No tolerance. The numeric package is a **conformance level of its own**:
an engine may pass the kernel and not `numeric`, and say so.

## Alternatives considered

- **Decimal now.** Correct in the long run, expensive in every engine
  language today, and unvalidated by the case. Future spec version.
- **Tolerance in fixtures.** Hides the drift the fixtures exist to catch;
  legally, "within 1e-9" is not "identical".
- **Keep JavaScript's half toward +∞.** Simplest for this engine, wrong for
  Java, Python and C engines and for every analyst.

## Fixtures required

`0.1 + 0.2`; `round(1.005, 2)`; `round(2.5)`, `round(-2.5)`, `round(-1.5)`
in every mode; `percentOf(37102, 1)` (the restaurant's `371.025 → 371`);
`12900 × 0.85 × 0.9` and its `round`; `scale(12900, 85, 100)`; `sum` over
`[1e16, 1, -1e16]` (order sensitivity, expected `0`); keys `"10"` and `"2"`;
`2 ** 53` and `2 ** 53 + 1` (`INTEGER_OVERFLOW`); `1 / 0`; `format` of
`19710` cents as `"$197.10"`.

## Consequences

- `roundDecimal` changes for negative halves; every document test still
  passes (no negative money in the four documents), and the new fixtures
  pin the behaviour.
- `scale`, `half-down` and `INTEGER_OVERFLOW` are new; small.
- `validate` gains the `LOCALE_DEPENDENT` and money-integer warnings.
- The `obj`-options pressure from the health quote (`format` cannot take
  an options object) is resolved by allowing a third argument that is a
  plain object of scalars, treated as options, not as an operator.
