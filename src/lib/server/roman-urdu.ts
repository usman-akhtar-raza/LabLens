// Urdu usually leaves short vowels unwritten. Use familiar spellings for
// common words, and fall back to transliterating unfamiliar ones.
const words = new Map(Object.entries({
  کیا: "kya", ہے: "hai", ہیں: "hain", میں: "mein", بارے: "baaray",
  مجھے: "mujhe", میری: "meri", میرے: "mere", میرا: "mera", آپ: "aap",
  کا: "ka", کی: "ki", کے: "ke", کو: "ko", سے: "se", پر: "par",
  یہ: "yeh", وہ: "woh", اور: "aur", یا: "ya", بھی: "bhi", نہیں: "nahi",
  اس: "is", ان: "in", تو: "to", جو: "jo", اگر: "agar", پھر: "phir",
  کیوں: "kyun", کیسے: "kaise", کتنا: "kitna", کتنی: "kitni", کتنے: "kitne",
  مطلب: "matlab", بتائیں: "batayein", بتاؤ: "batao", بتاتا: "batata",
  کرتا: "karta", کرتی: "karti", کرتے: "karte", ہوتا: "hota",
  ہوتی: "hoti", ہوتے: "hote", ہونا: "hona", چاہیے: "chahiye",
  جانا: "jana", جاتا: "jata", جاتی: "jati", ناپتا: "naapta", ناپتی: "naapti",
  خون: "khoon", سفید: "safed", سرخ: "surkh", خلیے: "khaliye",
  خلیات: "khaliyaat", تعداد: "tadaad", مقدار: "miqdaar", سائز: "size",
  فرق: "farq", زیادہ: "zyada", کم: "kam", نارمل: "normal", رینج: "range",
  رپورٹ: "report", ٹیسٹ: "test", بلڈ: "blood", کاؤنٹ: "count",
  لیول: "level", فیصد: "feesad", ہیموگلوبن: "hemoglobin", پلیٹلیٹس: "platelets",
  میزر: "measure", میژر: "measure",
}));

const phrases = new Map(Object.entries({
  "سی بی سی": "CBC",
  "ڈبلیو بی سی": "WBC",
  "آر بی سی": "RBC",
  "آر ڈی ڈبلیو": "RDW",
  "ایم سی وی": "MCV",
  "ایم سی ایچ": "MCH",
  "ایم سی ایچ سی": "MCHC",
}));

const letters: Readonly<Record<string, string>> = {
  ا: "a", آ: "aa", ب: "b", پ: "p", ت: "t", ٹ: "t", ث: "s", ج: "j",
  چ: "ch", ح: "h", خ: "kh", د: "d", ڈ: "d", ذ: "z", ر: "r", ڑ: "r",
  ز: "z", ژ: "zh", س: "s", ش: "sh", ص: "s", ض: "z", ط: "t", ظ: "z",
  ع: "a", غ: "gh", ف: "f", ق: "q", ک: "k", گ: "g", ل: "l", م: "m",
  ن: "n", ں: "n", و: "o", ہ: "h", ھ: "h", ء: "'", ی: "i", ے: "e",
  ئ: "y", ؤ: "o", "َ": "a", "ِ": "i", "ُ": "u", "ْ": "", "ّ": "",
  "ً": "an", "ٍ": "in", "ٌ": "un", "ٰ": "a",
};

export function toRomanUrdu(text: string): string {
  if (!/\p{Script=Arabic}/u.test(text)) return text;

  const normalized = text.normalize("NFC")
    .replace(/[كيىهۀأإ]/g, (letter) => ({
      ك: "ک", ي: "ی", ى: "ی", ه: "ہ", ۀ: "ہ", أ: "ا", إ: "ا",
    })[letter] ?? letter)
    .replace(/[ـ\u200c\u200d]/g, "");

  return normalized.replace(/(?:(?=\p{Script_Extensions=Arabic})[\p{L}\p{M}])+(?:[ \t]+(?:(?=\p{Script_Extensions=Arabic})[\p{L}\p{M}])+)*/gu,
    (run) => {
      // Match whole words so abbreviated terms do not replace part of a word.
      const expanded = run.replace(/(^|[ \t])(ایم[ \t]+سی[ \t]+ایچ[ \t]+سی|آر[ \t]+ڈی[ \t]+ڈبلیو|ڈبلیو[ \t]+بی[ \t]+سی|ایم[ \t]+سی[ \t]+ایچ|ایم[ \t]+سی[ \t]+وی|سی[ \t]+بی[ \t]+سی|آر[ \t]+بی[ \t]+سی)(?=$|[ \t])/g,
        (_, space: string, phrase: string) => space + (phrases.get(phrase.replace(/[ \t]+/g, " ")) ?? phrase));
      return expanded.replace(/(?:(?=\p{Script_Extensions=Arabic})[\p{L}\p{M}])+/gu,
        (word) => words.get(word.replace(/\p{M}/gu, "")) ?? Array.from(word, (letter) => letters[letter] ?? letter).join(""));
    })
    .replace(/[؟،؛۔٪]/g, (mark) => ({ "؟": "?", "،": ",", "؛": ";", "۔": ".", "٪": "%" })[mark] ?? mark)
    .replace(/[۰-۹٠-٩]/g, (digit) => String(digit.charCodeAt(0) & 15));
}
