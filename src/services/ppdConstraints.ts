import { readFile } from "node:fs/promises";

// ─── Types ──────────────────────────────────────────────────

interface Constraint {
  label: string;
  conditions: { option: string; value: string }[];
}

export interface ConstraintViolation {
  rule: string;
  conflicting: { option: string; value: string }[];
  message: string;
}

// ─── Cache ──────────────────────────────────────────────────

let constraintCache: Map<string, Constraint[]> | null = null;

// ─── PPD Parser ─────────────────────────────────────────────

function parseStandardConstraint(line: string): Constraint | null {
  // Format: *UIConstraints: *OptionA ValueA *OptionB ValueB
  const match = line.match(/^\*UIConstraints:\s+\*(\S+)\s+(\S+)\s+\*(\S+)\s+(\S+)/);
  if (!match) return null;
  const [, opt1, val1, opt2, val2] = match;
  return {
    label: `${opt1}=${val1} ↔ ${opt2}=${val2}`,
    conditions: [
      { option: opt1, value: val1 },
      { option: opt2, value: val2 },
    ],
  };
}

function parseCupsConstraint(line: string): Constraint | null {
  // Format: *cupsUIConstraints LABEL: "*OptionA ValueA  *OptionB ValueB  [*OptionC ValueC ...]"
  const match = line.match(/^\*cupsUIConstraints\s+(\S+):\s+"(.+)"/);
  if (!match) return null;
  const [, label, body] = match;
  const pairs = body.match(/\*(\S+)\s+(\S+)/g);
  if (!pairs || pairs.length < 2) return null;

  const conditions = pairs.map((p) => {
    const m = p.match(/\*(\S+)\s+(\S+)/);
    return m ? { option: m[1], value: m[2] } : null;
  }).filter((c): c is { option: string; value: string } => c !== null);

  return { label, conditions };
}

async function loadConstraints(ppdPath: string): Promise<Constraint[]> {
  const content = await readFile(ppdPath, "utf-8");
  const lines = content.split("\n");
  const constraints: Constraint[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("*cupsUIConstraints")) {
      const c = parseCupsConstraint(trimmed);
      if (c) constraints.push(c);
    } else if (trimmed.startsWith("*UIConstraints")) {
      const c = parseStandardConstraint(trimmed);
      if (c) constraints.push(c);
    }
  }

  return constraints;
}

async function getConstraints(printer: string): Promise<Constraint[]> {
  if (constraintCache?.has(printer)) {
    return constraintCache.get(printer)!;
  }

  const ppdPath = `/etc/cups/ppd/${printer}.ppd`;
  try {
    const constraints = await loadConstraints(ppdPath);
    if (!constraintCache) constraintCache = new Map();
    constraintCache.set(printer, constraints);
    return constraints;
  } catch {
    return [];
  }
}

// ─── Installed hardware defaults ────────────────────────────

function getInstalledOptions(): Record<string, string> {
  // Baked from the actual TASKalfa 6054ci configuration
  // These are the "hardware installed" options that are always in effect
  return {
    Option17: "DF7150",    // Document finisher
    Option21: "True",      // Punch unit
    Option22: "True",      // Folding unit
    Option23: "True",      // Inner shift tray
    Option24: "False",     // Z-Fold unit (not installed)
    Option25: "False",     // Mailbox (not installed)
    Option28: "True",      // Inserter
  };
}

// ─── Known over-strict PPD constraints ──────────────────────
// Linux 用 PPD は排紙先 FLDTRAY を Z折りユニット(Option24)依存として記述しているが、
// 実機 (TASKalfa 6054ci + DF-7150 + 中折りユニット) では Option22=True のみで
// FLDTRAY への排紙と三つ折りが正常に動作する。
//
// 2026-09-16 実機検証:
//   A4 / 白黒 / 両面長辺とじ / 三つ折り / 印刷面を外側 / FLDTRAY 排紙 を
//   60 件以上出力して全て正常。10 ページ (両面 5 枚) の 5 枚まとめ折りも成功。
//   macOS 用 PPD では同じ制約が Option22 依存で記述されており、
//   Linux 用 PPD 側の記述が実機の能力より厳しいと判断した。
//
// このリストに載せた組み合わせは制約違反として報告しない。
const KNOWN_OVERSTRICT: { option: string; value: string }[][] = [
  [
    { option: "OutputBin", value: "FLDTRAY" },
    { option: "Option24", value: "False" },
  ],
];

function constraintKey(conditions: { option: string; value: string }[]): string {
  return conditions
    .map((c) => `${c.option}=${c.value}`)
    .sort()
    .join("|");
}

function isKnownOverstrict(conditions: { option: string; value: string }[]): boolean {
  const target = constraintKey(conditions);
  return KNOWN_OVERSTRICT.some((rule) => constraintKey(rule) === target);
}

// ─── Constraint checker ─────────────────────────────────────

export async function checkConstraints(
  userOptions: Record<string, string>,
  printer = "TASKalfa-6054ci",
): Promise<{
  violations: ConstraintViolation[];
  checkedConstraints: number;
  applicableConstraints: number;
}> {
  const constraints = await getConstraints(printer);

  // Merge user options with installed hardware defaults
  // User options override defaults (e.g., if user somehow specifies Option17)
  const installedOpts = getInstalledOptions();
  const mergedOptions: Record<string, string> = { ...installedOpts, ...userOptions };

  const violations: ConstraintViolation[] = [];
  let applicableCount = 0;

  for (const constraint of constraints) {
    // A constraint is violated if ALL its conditions match the merged options
    const allMatch = constraint.conditions.every(
      (cond) => mergedOptions[cond.option] === cond.value
    );

    // Only count as "applicable" if at least one condition involves a user option
    const involvesUserOption = constraint.conditions.some(
      (cond) => cond.option in userOptions
    );

    if (!involvesUserOption) continue;
    applicableCount++;

    if (allMatch) {
      // Build human-readable message
      const userParts = constraint.conditions
        .filter((c) => c.option in userOptions)
        .map((c) => `${c.option}=${c.value}`);
      const hwParts = constraint.conditions
        .filter((c) => !(c.option in userOptions) && c.option in installedOpts)
        .map((c) => `${c.option}=${c.value} (hardware)`);

      const message = buildViolationMessage(constraint.conditions, userOptions, installedOpts);

      violations.push({
        rule: constraint.label,
        conflicting: constraint.conditions,
        message,
      });
    }
  }

  // Deduplicate (UIConstraints are often listed in both directions A↔B and B↔A)
  const seen = new Set<string>();
  const dedupedViolations = violations.filter((v) => {
    const key = v.conflicting
      .map((c) => `${c.option}=${c.value}`)
      .sort()
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // PPD の記述が実機の能力より厳しい既知の組み合わせを除外する
  const filteredViolations = dedupedViolations.filter(
    (v) => !isKnownOverstrict(v.conflicting),
  );

  return {
    violations: filteredViolations,
    checkedConstraints: constraints.length,
    applicableConstraints: applicableCount,
  };
}

// ─── Human-readable messages ────────────────────────────────

const OPTION_LABELS: Record<string, string> = {
  Stpl: "ステープル", Scnt: "ステープル方法", Pnch: "パンチ",
  KCBooklet: "中綴じ製本", Fold: "製本折り", FldA: "折りモード",
  FldB: "折り面", BiFldB: "二つ折り面", FldC: "折り方向", FldD: "折り方法",
  ZFldC: "Z折り方向", ZFldD: "Z折り方法", BFpS: "二つ折り方法",
  PageSize: "用紙サイズ", PageRegion: "用紙サイズ", InputSlot: "給紙トレイ",
  MediaType: "用紙種類", Duplex: "両面", ColorModel: "カラー",
  OutputBin: "排紙先", Option17: "フィニッシャー",
  Option21: "パンチユニット", Option22: "折りユニット",
  Option23: "インナーシフトトレイ", Option24: "Z折りユニット",
  Option28: "インサーター",
};

function labelFor(option: string, value: string): string {
  const label = OPTION_LABELS[option] || option;
  return `${label}(${value})`;
}

function buildViolationMessage(
  conditions: { option: string; value: string }[],
  userOptions: Record<string, string>,
  installedOpts: Record<string, string>,
): string {
  const userParts: string[] = [];
  const hwParts: string[] = [];

  for (const c of conditions) {
    if (c.option in userOptions) {
      userParts.push(labelFor(c.option, c.value));
    } else if (c.option in installedOpts) {
      hwParts.push(labelFor(c.option, c.value));
    }
  }

  if (hwParts.length > 0) {
    return `${userParts.join(" + ")} は ${hwParts.join(" + ")} の構成では使用できません`;
  }
  return `${userParts.join(" と ")} は同時に指定できません`;
}
