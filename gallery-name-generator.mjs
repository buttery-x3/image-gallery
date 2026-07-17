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

const katakanaByMora = new Map(Object.entries({
  a: "ア", i: "イ", u: "ウ", e: "エ", o: "オ",
  ka: "カ", ki: "キ", ku: "ク", ke: "ケ", ko: "コ",
  ga: "ガ", gi: "ギ", gu: "グ", ge: "ゲ", go: "ゴ",
  sa: "サ", shi: "シ", su: "ス", se: "セ", so: "ソ",
  za: "ザ", ji: "ジ", zu: "ズ", ze: "ゼ", zo: "ゾ",
  ta: "タ", chi: "チ", tsu: "ツ", te: "テ", to: "ト",
  da: "ダ", di: "ヂ", du: "ヅ", de: "デ", do: "ド",
  na: "ナ", ni: "ニ", nu: "ヌ", ne: "ネ", no: "ノ",
  ha: "ハ", hi: "ヒ", fu: "フ", he: "ヘ", ho: "ホ",
  ba: "バ", bi: "ビ", bu: "ブ", be: "ベ", bo: "ボ",
  pa: "パ", pi: "ピ", pu: "プ", pe: "ペ", po: "ポ",
  ma: "マ", mi: "ミ", mu: "ム", me: "メ", mo: "モ",
  ya: "ヤ", yu: "ユ", yo: "ヨ",
  ra: "ラ", ri: "リ", ru: "ル", re: "レ", ro: "ロ",
  wa: "ワ", wo: "ヲ",
  kya: "キャ", kyu: "キュ", kyo: "キョ",
  gya: "ギャ", gyu: "ギュ", gyo: "ギョ",
  sha: "シャ", shu: "シュ", sho: "ショ",
  ja: "ジャ", ju: "ジュ", jo: "ジョ",
  cha: "チャ", chu: "チュ", cho: "チョ",
  nya: "ニャ", nyu: "ニュ", nyo: "ニョ",
  hya: "ヒャ", hyu: "ヒュ", hyo: "ヒョ",
  bya: "ビャ", byu: "ビュ", byo: "ビョ",
  pya: "ピャ", pyu: "ピュ", pyo: "ピョ",
  mya: "ミャ", myu: "ミュ", myo: "ミョ",
  rya: "リャ", ryu: "リュ", ryo: "リョ",
  fa: "ファ", fi: "フィ", fe: "フェ", fo: "フォ",
}));

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
const moraByLength = [...middleMora].sort((left, right) => right.length - left.length);

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

function splitRomanizedMora(value) {
  const normalized = value.toLocaleLowerCase("en-US");
  const result = [];
  let offset = 0;
  while (offset < normalized.length) {
    const mora = moraByLength.find((candidate) => normalized.startsWith(candidate, offset));
    if (!mora) throw new Error(`Could not parse generated name at "${normalized.slice(offset)}".`);
    result.push(mora);
    offset += mora.length;
  }
  return result;
}

function namePart(middleCount) {
  const selected = [pick(weightedInitialMora)];
  for (let index = 0; index < middleCount; index += 1) {
    selected.push(pick(weightedMiddleMora, selected.at(-1)));
  }
  selected.push(pick(endingMora, selected.at(-1)));
  return {
    filePart: selected.join(""),
    mora: selected.flatMap(splitRomanizedMora),
  };
}

function capitalizedRomanization(mora) {
  const value = mora.join("");
  return value.charAt(0).toLocaleUpperCase("en-US") + value.slice(1);
}

function katakana(mora) {
  return mora.map((part) => {
    const value = katakanaByMora.get(part);
    if (!value) throw new Error(`No katakana mapping exists for "${part}".`);
    return value;
  }).join("");
}

function lengthPairs() {
  const pairs = [];
  for (let given = 1; given <= 5; given += 1) {
    for (let family = 2; family <= 4; family += 1) pairs.push({ given, family });
  }
  for (let index = pairs.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [pairs[index], pairs[swapIndex]] = [pairs[swapIndex], pairs[index]];
  }
  return pairs;
}

function availableShortName(givenMora, familyMora, usedShortNames) {
  for (const lengths of lengthPairs()) {
    if (givenMora.length < lengths.given || familyMora.length < lengths.family) continue;
    const given = givenMora.slice(0, lengths.given);
    const family = familyMora.slice(0, lengths.family);
    const en = `${capitalizedRomanization(given)} ${capitalizedRomanization(family)}`;
    const ja = `${katakana(given)}・${katakana(family)}`;
    const comparisonName = en.toLocaleLowerCase("en-US");
    if (usedShortNames.has(comparisonName)) continue;
    return { comparisonName, shortName: { en, ja } };
  }
  return undefined;
}

export function generateJapaneseFantasyName(usedNames = new Set(), usedShortNames = new Set()) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const given = namePart(7);
    const family = namePart(8);
    const fileStem = `${given.filePart}-${family.filePart}`;
    const comparisonName = fileStem.toLocaleLowerCase("en-US");
    if (usedNames.has(comparisonName)) continue;

    const display = availableShortName(given.mora, family.mora, usedShortNames);
    if (!display) continue;
    usedNames.add(comparisonName);
    usedShortNames.add(display.comparisonName);
    return { fileStem, shortName: display.shortName };
  }
  throw new Error("Could not generate a unique fantasy name.");
}

export function generateShortNameForStem(fileStem, usedShortNames = new Set()) {
  if (!/^[a-z]+-[a-z]+$/.test(fileStem)) {
    throw new Error("The filename stem is not a generated Japanese fantasy name.");
  }
  const [givenPart, familyPart] = fileStem.split("-");
  const display = availableShortName(
    splitRomanizedMora(givenPart),
    splitRomanizedMora(familyPart),
    usedShortNames,
  );
  if (!display) throw new Error("Could not generate a unique short name for the filename stem.");
  usedShortNames.add(display.comparisonName);
  return display.shortName;
}
