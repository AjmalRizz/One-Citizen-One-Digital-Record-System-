const https = require('https');

// Curated high-precision dictionary for Sri Lankan names
const NAME_DICTIONARY = {
  // Islamic Sri Lankan Names
  'wasim': { si: 'වසීම්', ta: 'வசீம்' },
  'waseem': { si: 'වසීම්', ta: 'வசீம்' },
  'bari': { si: 'බාරි', ta: 'பாரி' },
  'ahmad': { si: 'අහ්මද්', ta: 'அஹ்மத்' },
  'ahmadh': { si: 'අහ්මද්', ta: 'அஹ்மத்' },
  'ahmed': { si: 'අහ්මඩ්', ta: 'அஹ்மத்' },
  'bilaal': { si: 'බිලාල්', ta: 'பிலால்' },
  'bilal': { si: 'බිලාල්', ta: 'பிலால்' },
  'yumna': { si: 'යුම්නා', ta: 'யும்னா' },
  'fathima': { si: 'ෆාතිමා', ta: 'பாத்திமா' },
  'fatima': { si: 'ෆාතිමා', ta: 'பாத்திமா' },
  'mohamed': { si: 'මොහොමඩ්', ta: 'முகமது' },
  'mohammed': { si: 'මොහොමඩ්', ta: 'முகமது' },
  'muhammad': { si: 'මුහම්මද්', ta: 'முஹம்மது' },
  'rizwan': { si: 'රිස්වාන්', ta: 'ரிஸ்வான்' },
  'raaid': { si: 'රායිඩ්', ta: 'ராயித்' },
  'hana': { si: 'හනා', ta: 'ஹனா' },
  'hilmy': { si: 'හිල්මි', ta: 'ஹில்மி' },
  'fazil': { si: 'ෆාසිල්', ta: 'பாசில்' },
  'farhan': { si: 'ෆර්හාන්', ta: 'பர்ஹான்' },
  'aslam': { si: 'අස්ලම්', ta: 'அஸ்லம்' },
  'imran': { si: 'ඉම්රාන්', ta: 'இம்ரான்' },
  'nabeel': { si: 'නබීල්', ta: 'நபீல்' },
  'zackariya': { si: 'සකරියා', ta: 'சக்கரியா' },
  'aisha': { si: 'අයිෂා', ta: 'ஆயிஷா' },
  'mariyam': { si: 'මරියම්', ta: 'மரியம்' },
  'zainab': { si: 'සයිනබ්', ta: 'ஜைனப்' },

  // Sinhalese Names
  'malith': { si: 'මලිත්', ta: 'மலித்' },
  'kasun': { si: 'කසුන්', ta: 'கசுன்' },
  'perera': { si: 'පෙරේරා', ta: 'பெரேரா' },
  'silva': { si: 'සිල්වා', ta: 'சில்வா' },
  'fernando': { si: 'ප්‍රනාන්දු', ta: 'பெர்னாண்டோ' },
  'dissanayake': { si: 'දිසානායක', ta: 'திஸாநாயக்க' },
  'dissanayaka': { si: 'දිසානායක', ta: 'திஸாநாயக்க' },
  'bandara': { si: 'බණ්ඩාර', ta: 'பண்டார' },
  'senanayake': { si: 'සේනානායක', ta: 'சேனாநாயக்க' },
  'jayawardena': { si: 'ජයවර්ධන', ta: 'ஜயவர்தன' },
  'jayawardene': { si: 'ජයවර්ධන', ta: 'ஜயவர்தன' },
  'rajapaksa': { si: 'රාජපක්ෂ', ta: 'ராஜபக்ஷ' },
  'wickramasinghe': { si: 'වික්‍රමසිංහ', ta: 'விக்ரமசிங்க' },
  'kavindu': { si: 'කවිඳු', ta: 'கவிந்து' },
  'chaminda': { si: 'චමින්ද', ta: 'சமிந்த' },
  'nuwan': { si: 'නුවන්', ta: 'நுவன்' },
  'saman': { si: 'සමන්', ta: 'சமன்' },
  'sunil': { si: 'සුනිල්', ta: 'சுனில்' },
  'ruwan': { si: 'රුවන්', ta: 'ருவன்' },
  'anura': { si: 'අනුර', ta: 'அனுர' },
  'kamal': { si: 'කමල්', ta: 'கமல்' },
  'nimal': { si: 'නිමල්', ta: 'நிமல்' },
  'kumara': { si: 'කුමාර', ta: 'குமார' },
  'kushani': { si: 'කුෂානි', ta: 'குஷானி' },
  'nadeesha': { si: 'නදීෂා', ta: 'நதீஷா' },
  'dilshan': { si: 'දිල්ෂාන්', ta: 'தில்ஷான்' },
  'lahiru': { si: 'ලහිරු', ta: 'லகிரு' },
  'pradeep': { si: 'ප්‍රදීප්', ta: 'பிரதீப்' },
  'saputhanthri': { si: 'සපුතන්ත්‍රී', ta: 'சபுதந்த்ரி' },

  // Tamil Names
  'kumar': { si: 'කුමාර්', ta: 'குமார்' },
  'selvam': { si: 'සෙල්වම්', ta: 'செல்வம்' },
  'rajan': { si: 'රාජන්', ta: 'ராஜன்' },
  'suresh': { si: 'සුරේෂ්', ta: 'சுரேஷ்' },
  'vijay': { si: 'විජය', ta: 'விஜய்' },
  'shankar': { si: 'ශංකර්', ta: 'சங்கர்' },
  'priya': { si: 'ප්‍රියා', ta: 'பிரியா' },
  'shanthi': { si: 'ශාන්ති', ta: 'சாந்தி' },
  'lakshmi': { si: 'ලක්ෂ්මි', ta: 'லட்சுமி' },
  'muthu': { si: 'මුතු', ta: 'முத்து' },
  'sivakumar': { si: 'සිවකුමාර්', ta: 'சிவகுமார்' },
  'kanesan': { si: 'ගනේෂන්', ta: 'கணேசன்' },
  'murugan': { si: 'මුරුගන්', ta: 'முருகன்' },
  'lingam': { si: 'ලිංගම්', ta: 'லிங்கம்' }
};

/**
 * Call Google Input Tools transliteration API as fallback for arbitrary words
 */
function fetchInputTools(word, langCode) {
  return new Promise((resolve) => {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(word)}&itc=${langCode}-t-i0-und&num=1`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed[0] === 'SUCCESS' && parsed[1] && parsed[1][0] && parsed[1][0][1] && parsed[1][0][1][0]) {
            resolve(parsed[1][0][1][0]);
            return;
          }
        } catch (e) {
          // ignore error
        }
        resolve(null);
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Phonetic Transliteration Fallback if network is unavailable
 */
function phoneticTransliterateSinhala(word) {
  if (!word) return '';
  const w = word.toLowerCase();
  if (NAME_DICTIONARY[w]) return NAME_DICTIONARY[w].si;

  const map = [
    { en: 'sh', si: 'ෂ' },
    { en: 'th', si: 'ත්' },
    { en: 'ch', si: 'ච' },
    { en: 'dh', si: 'ද්' },
    { en: 'ph', si: 'ෆ' },
    { en: 'kh', si: 'ඛ' },
    { en: 'gh', si: 'ඝ' },
    { en: 'aa', si: 'ආ' },
    { en: 'ee', si: 'ඊ' },
    { en: 'oo', si: 'ඌ' },
    { en: 'a', si: 'අ' },
    { en: 'b', si: 'බ' },
    { en: 'c', si: 'ක' },
    { en: 'd', si: 'ද' },
    { en: 'e', si: 'එ' },
    { en: 'f', si: 'ෆ' },
    { en: 'g', si: 'ග' },
    { en: 'h', si: 'හ' },
    { en: 'i', si: 'ඉ' },
    { en: 'j', si: 'ජ' },
    { en: 'k', si: 'ක' },
    { en: 'l', si: 'ල' },
    { en: 'm', si: 'ම' },
    { en: 'n', si: 'න' },
    { en: 'o', si: 'ඔ' },
    { en: 'p', si: 'ප' },
    { en: 'q', si: 'ක' },
    { en: 'r', si: 'ර' },
    { en: 's', si: 'ස' },
    { en: 't', si: 'ත' },
    { en: 'u', si: 'උ' },
    { en: 'v', si: 'ව' },
    { en: 'w', si: 'ව' },
    { en: 'x', si: 'ක්ස්' },
    { en: 'y', si: 'ය' },
    { en: 'z', si: 'ස්' }
  ];

  let res = '';
  let i = 0;
  while (i < w.length) {
    let matched = false;
    for (const rule of map) {
      if (w.slice(i, i + rule.en.length) === rule.en) {
        res += rule.si;
        i += rule.en.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      res += w[i];
      i++;
    }
  }
  return res;
}

function phoneticTransliterateTamil(word) {
  if (!word) return '';
  const w = word.toLowerCase();
  if (NAME_DICTIONARY[w]) return NAME_DICTIONARY[w].ta;

  const map = [
    { en: 'sh', ta: 'ஷ' },
    { en: 'th', ta: 'த' },
    { en: 'ch', ta: 'ச' },
    { en: 'dh', ta: 'த' },
    { en: 'ph', ta: 'ப' },
    { en: 'aa', ta: 'ஆ' },
    { en: 'ee', ta: 'ஈ' },
    { en: 'oo', ta: 'ஊ' },
    { en: 'a', ta: 'அ' },
    { en: 'b', ta: 'ப' },
    { en: 'c', ta: 'க' },
    { en: 'd', ta: 'ட' },
    { en: 'e', ta: 'எ' },
    { en: 'f', ta: 'ப' },
    { en: 'g', ta: 'க' },
    { en: 'h', ta: 'ஹ' },
    { en: 'i', ta: 'இ' },
    { en: 'j', ta: 'ஜ' },
    { en: 'k', ta: 'க' },
    { en: 'l', ta: 'ல' },
    { en: 'm', ta: 'ம' },
    { en: 'n', ta: 'ந' },
    { en: 'o', ta: 'ஒ' },
    { en: 'p', ta: 'ப' },
    { en: 'q', ta: 'க' },
    { en: 'r', ta: 'ர' },
    { en: 's', ta: 'ச' },
    { en: 't', ta: 'த' },
    { en: 'u', ta: 'உ' },
    { en: 'v', ta: 'வ' },
    { en: 'w', ta: 'வ' },
    { en: 'x', ta: 'க்ஸ்' },
    { en: 'y', ta: 'ய' },
    { en: 'z', ta: 'ஸ' }
  ];

  let res = '';
  let i = 0;
  while (i < w.length) {
    let matched = false;
    for (const rule of map) {
      if (w.slice(i, i + rule.en.length) === rule.en) {
        res += rule.ta;
        i += rule.en.length;
        break;
      }
    }
    if (!matched) {
      res += w[i];
      i++;
    }
  }
  return res;
}

/**
 * Main translation & transliteration orchestrator
 */
async function translateNameToSinhalaAndTamil(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { sinhala: '', tamil: '' };
  }

  const trimmed = fullName.trim();
  if (!trimmed) {
    return { sinhala: '', tamil: '' };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const sinhalaParts = [];
  const tamilParts = [];

  for (const word of words) {
    const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (!cleanWord) continue;

    // 1. Check curated high-precision dictionary
    if (NAME_DICTIONARY[cleanWord]) {
      sinhalaParts.push(NAME_DICTIONARY[cleanWord].si);
      tamilParts.push(NAME_DICTIONARY[cleanWord].ta);
      continue;
    }

    // 2. Fetch via Google Input Tools transliteration
    const [siRemote, taRemote] = await Promise.all([
      fetchInputTools(cleanWord, 'si'),
      fetchInputTools(cleanWord, 'ta')
    ]);

    sinhalaParts.push(siRemote || phoneticTransliterateSinhala(cleanWord));
    tamilParts.push(taRemote || phoneticTransliterateTamil(cleanWord));
  }

  return {
    sinhala: sinhalaParts.join(' '),
    tamil: tamilParts.join(' ')
  };
}

module.exports = {
  translateNameToSinhalaAndTamil,
  NAME_DICTIONARY
};
