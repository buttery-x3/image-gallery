import { randomInt } from "node:crypto";

const middleMora = [
  "a", "i", "u", "e", "o",
  "ka", "ki", "ku", "ke", "ko", "ga", "gi", "gu", "ge", "go",
  "sa", "shi", "su", "se", "so", "za", "ji", "zu", "ze", "zo",
  "ta", "chi", "tsu", "te", "to", "da", "di", "du", "de", "do",
  "na", "ni", "nu", "ne", "no",
  "ha", "hi", "fu", "he", "ho", "ba", "bi", "bu", "be", "bo", "pa", "pi", "pu", "pe", "po",
  "ma", "mi", "mu", "me", "mo", "ya", "yu", "yo", "ra", "ri", "ru", "re", "ro", "wa", "wo",
  "kya", "kyu", "kyo", "gya", "gyu", "gyo", "sha", "shu", "sho", "ja", "ju", "jo",
  "cha", "chu", "cho", "nya", "nyu", "nyo", "hya", "hyu", "hyo", "bya", "byu", "byo",
  "pya", "pyu", "pyo", "mya", "myu", "myo", "rya", "ryu", "ryo", "fa", "fi", "fe", "fo",
];

const initialMora = middleMora.filter((mora) => !["a", "i", "u", "e", "o", "wo"].includes(mora));
const commonMora = middleMora.filter(
  (mora) => (mora.length <= 2 || ["shi", "chi", "tsu"].includes(mora)) &&
    !["a", "i", "u", "e", "o", "di", "du", "wo"].includes(mora),
);
const weightedMiddleMora = [
  ...commonMora, ...commonMora, ...commonMora, ...commonMora, ...commonMora, ...commonMora,
  ...middleMora,
];
const weightedInitialMora = [...commonMora, ...commonMora, ...commonMora, ...initialMora];
const endingMora = [
  "ra", "ri", "ru", "re", "ro", "na", "ni", "nu", "ne", "no",
  "ma", "mi", "mu", "me", "mo", "ya", "yu", "yo", "ka", "ki",
  "ku", "ke", "ko", "sa", "shi", "su", "se", "so", "ta", "chi",
  "tsu", "te", "to", "mori", "nagi", "hara", "kura", "hane", "yume", "zora",
];

function pick(values, previous) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = values[randomInt(values.length)];
    const consecutiveComplexMora = candidate.length > 3 && (previous?.length ?? 0) > 3;
    if (
      candidate !== previous && !consecutiveComplexMora &&
      !(candidate.length === 1 && previous?.length === 1)
    ) return candidate;
  }
  return values[randomInt(values.length)];
}

function namePart(middleCount) {
  const mora = [pick(weightedInitialMora)];
  for (let index = 0; index < middleCount; index += 1) mora.push(pick(weightedMiddleMora, mora.at(-1)));
  mora.push(pick(endingMora, mora.at(-1)));
  return mora.join("");
}

export function generateJapaneseFantasyName(usedNames = new Set()) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const name = `${namePart(7)}-${namePart(8)}`;
    const comparisonName = name.toLocaleLowerCase("en-US");
    if (usedNames.has(comparisonName)) continue;
    usedNames.add(comparisonName);
    return name;
  }
  throw new Error("Could not generate a unique fantasy name.");
}
