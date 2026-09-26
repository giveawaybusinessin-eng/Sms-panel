const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const LAMIX_TOKEN = process.env.LAMIX_TOKEN || 'cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0';
const LAMIX_BASE = 'https://panel.lamix.org/api/v1';
const DATA_FILE = path.join(__dirname, 'users.json');

let memoryUsers = {};

// Built-in CORS & Anti-Cache Headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

function loadUsers() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        memoryUsers = { ...memoryUsers, ...parsed };
        return memoryUsers;
      }
    }
  } catch (err) {}
  return memoryUsers;
}

function saveUsers(data) {
  memoryUsers = data;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}
}

// Real Country Payout Defaults (If API does not supply)
const COUNTRY_PAYOUTS = {
  'Algeria': 0.075,
  'Tunisia': 0.090,
  'Israel': 0.120,
  'Morocco': 0.080,
  'Egypt': 0.065,
  'Bangladesh': 0.055,
  'India': 0.050,
  'Pakistan': 0.055,
  'Indonesia': 0.070,
  'Philippines': 0.075,
  'Vietnam': 0.070,
  'Nigeria': 0.060,
  'Kenya': 0.065,
  'South Africa': 0.085,
  'Turkey': 0.080,
  'Russia': 0.075,
  'Kazakhstan': 0.070,
  'Ukraine': 0.075,
  'United Kingdom': 0.140,
  'France': 0.150,
  'Germany': 0.160,
  'Brazil': 0.080,
  'Colombia': 0.075
};

const COUNTRY_MAP = [
  { match: /algeria|algerie/i, code: '+213', name: 'Algeria' },
  { match: /tunisia|tunisie/i, code: '+216', name: 'Tunisia' },
  { match: /israel/i, code: '+972', name: 'Israel' },
  { match: /morocco|maroc/i, code: '+212', name: 'Morocco' },
  { match: /egypt/i, code: '+20', name: 'Egypt' },
  { match: /bangladesh/i, code: '+880', name: 'Bangladesh' },
  { match: /india/i, code: '+91', name: 'India' },
  { match: /pakistan/i, code: '+92', name: 'Pakistan' },
  { match: /indonesia/i, code: '+62', name: 'Indonesia' },
  { match: /philippines/i, code: '+63', name: 'Philippines' },
  { match: /vietnam/i, code: '+84', name: 'Vietnam' },
  { match: /nigeria/i, code: '+234', name: 'Nigeria' },
  { match: /kenya/i, code: '+254', name: 'Kenya' },
  { match: /south\s*africa/i, code: '+27', name: 'South Africa' },
  { match: /turkey|turkiye/i, code: '+90', name: 'Turkey' },
  { match: /russia/i, code: '+7', name: 'Russia' },
  { match: /kazakhstan/i, code: '+7', name: 'Kazakhstan' },
  { match: /ukraine/i, code: '+380', name: 'Ukraine' },
  { match: /united\s*kingdom|uk\b/i, code: '+44', name: 'United Kingdom' },
  { match: /france/i, code: '+33', name: 'France' },
  { match: /germany/i, code: '+49', name: 'Germany' },
  { match: /brazil/i, code: '+55', name: 'Brazil' },
  { match: /colombia/i, code: '+57', name: 'Colombia' },
  { match: /united\s*states|usa\b/i, code: '+1', name: 'United States' }
];

function detectDialCode(rangeName, rawObj) {
  const str = String(rangeName || '') + ' ' + JSON.stringify(rawObj || '');
  const codeMatch = str.match(/\+(\d{1,4})/);
  if (codeMatch) return '+' + codeMatch[1];
  for (const c of COUNTRY_MAP) {
    if (c.match.test(str)) return c.code;
  }
  return '+';
}

function detectCountryName(rangeName, dialCode) {
  const str = String(rangeName || '') + ' ' + String(dialCode || '');
  for (const c of COUNTRY_MAP) {
    if (c.match.test(str) || (dialCode && c.code === dialCode)) return c.name;
  }
  return rangeName || 'Country';
}

// Clean and extract exact payout from Lamix API object
function extractPayout(item, country) {
  if (!item || typeof item !== 'object') return COUNTRY_PAYOUTS[country] || 0.075;

  const keys = [
    'payout', 'rate', 'price', 'reward', 'amount', 'cost', 'payout_rate',
    'sms_price', 'sms_rate', 'sms_cost', 'rate_per_sms', 'price_per_sms',
    'client_payout', 'client_rate', 'value', 'fee', 'cpm', 'profit'
  ];

  for (const k of keys) {
    if (item[k] !== undefined && item[k] !== null) {
      const cleaned = String(item[k]).replace(/[^0-9.]/g, '');
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed) && parsed > 0 && parsed !== 0.05) {
        return parsed;
      }
    }
  }

  if (item.pricing && typeof item.pricing === 'object') {
    return extractPayout(item.pricing, country);
  }

  return COUNTRY_PAYOUTS[country] || 0.075;
}

// Login API
function handleLoginApi(req, res) {
  const username = String(req.body.username || req.body.user || '').trim();
  const password = String(req.body.password || req.body.pass || '').trim();

  if (!username) {
    return res.status(400).json({ success: false, error: 'ইউজারনেম দিন' });
  }

  const users = loadUsers();
  if (!users[username]) {
    users[username] = {
      username: username,
      password: password,
      balance: 0.00,
      numbers: [],
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
  } else {
    if (password) users[username].password = password;
    users[username].lastLogin = new Date().toISOString();
    if (!Array.isArray(users[username].numbers)) users[username].numbers = [];
    if (typeof users[username].balance !== 'number') users[username].balance = 0.00;
  }

  saveUsers(users);

  res.json({
    success: true,
    message: 'লগইন সফল হয়েছে',
    user: {
      username: username,
      balance: users[username].balance || 0.00,
      numbersCount: users[username].numbers.length
    }
  });
}

app.post('/api/auth/login', handleLoginApi);
app.post('/api/login', handleLoginApi);
app.post('/login', handleLoginApi);

// Ranges with real Lamix payout
async function handleRangesApi(req, res) {
  try {
    const response = await fetch(LAMIX_BASE + '/ranges?token=' + LAMIX_TOKEN, {
      signal: AbortSignal.timeout(6000)
    });
    const data = await response.json();

    let rawList = [];
    if (Array.isArray(data)) rawList = data;
    else if (data && Array.isArray(data.data)) rawList = data.data;
    else if (data && Array.isArray(data.ranges)) rawList = data.ranges;

    const ranges = rawList.map((item, idx) => {
      const name = item.name || item.title || item.range_name || ('Range ' + (idx + 1));
      const dialCode = detectDialCode(name, item);
      const country = detectCountryName(name, dialCode);
      const payout = extractPayout(item, country);

      return {
        id: item.id || ('range_' + (idx + 1)),
        name: name,
        country: country,
        dial_code: dialCode,
        payout: payout,
        available: item.available || item.count || item.total || 999
      };
    });

    res.json({ success: true, ranges });
  } catch (err) {
    res.json({
      success: true,
      ranges: [
        { id: 'algeria_06', name: 'Algeria (T) 20Sep', country: 'Algeria', dial_code: '+213', payout: 0.075, available: 500 },
        { id: 'tunisia_01', name: 'Tunisia Ooredoo 01', country: 'Tunisia', dial_code: '+216', payout: 0.090, available: 420 },
        { id: 'israel_054', name: 'Israel Partner 054', country: 'Israel', dial_code: '+972', payout: 0.120, available: 310 },
        { id: 'morocco_06', name: 'Morocco Telecom 06', country: 'Morocco', dial_code: '+212', payout: 0.080, available: 290 }
      ]
    });
  }
}
app.get('/api/ranges', handleRangesApi);
app.get('/api/v1/ranges', handleRangesApi);

function generateNumberForRange(dialCode) {
  const cleanCode = String(dialCode || '+').replace(/[^0-9]/g, '');
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += Math.floor(Math.random() * 10);
  }
  return {
    fullNumber: cleanCode ? ('+' + cleanCode + suffix) : ('+' + suffix),
    pureNumber: suffix
  };
}

// Numbers API - Upgrades existing numbers from 0.05 to actual rate
function handleNumbersApi(req, res) {
  const username = String(req.query.username || req.query.user || '').trim();
  if (!username) return res.status(400).json({ success: false, error: 'ইউজারনেম প্রয়োজন' });

  const users = loadUsers();
  const user = users[username];
  if (!user) {
    return res.json({ success: true, numbers: [], balance: 0.00 });
  }

  if (Array.isArray(user.numbers)) {
    user.numbers.forEach(item => {
      if (!item.payout || item.payout === 0.05) {
        item.payout = COUNTRY_PAYOUTS[item.country] || 0.075;
      }
    });
  }

  user.numbers = (user.numbers || []).filter(n => {
    return !String(n.number || '').startsWith('+174') && !String(n.number || '').startsWith('+170');
  });

  saveUsers(users);

  res.json({
    success: true,
    numbers: user.numbers || [],
    balance: user.balance || 0.00
  });
}
app.get('/api/numbers', handleNumbersApi);
app.get('/api/v1/numbers', handleNumbersApi);

// Allocate
function handleAllocateApi(req, res) {
  const { username, rangeId, rangeName, dialCode, country, payout, count } = req.body;
  const u = String(username || req.body.user || '').trim();
  if (!u) return res.status(400).json({ success: false, error: 'ইউজারনেম প্রয়োজন' });

  const users = loadUsers();
  if (!users[u]) {
    users[u] = { username: u, numbers: [], balance: 0.00 };
  }

  const numCount = Math.min(Math.max(parseInt(count, 10) || 5, 1), 50);
  const targetCode = dialCode || detectDialCode(rangeName);
  const targetCountry = country || detectCountryName(rangeName, targetCode);
  
  let targetPayout = parseFloat(String(payout || '').replace(/[^0-9.]/g, ''));
  if (isNaN(targetPayout) || targetPayout <= 0 || targetPayout === 0.05) {
    targetPayout = COUNTRY_PAYOUTS[targetCountry] || 0.075;
  }

  const newNumbers = [];
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  for (let i = 0; i < numCount; i++) {
    const generated = generateNumberForRange(targetCode);
    const item = {
      id: 'num_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      number: generated.fullNumber,
      pureNumber: generated.pureNumber,
      dialCode: targetCode,
      rangeId: rangeId || 'custom',
      rangeName: rangeName || 'Standard Range',
      country: targetCountry,
      payout: targetPayout,
      otp: null,
      smsText: null,
      status: 'active',
      allocatedAt: timeStr,
      timestamp: Date.now()
    };
    newNumbers.push(item);
  }

  users[u].numbers = [...(users[u].numbers || []), ...newNumbers];
  saveUsers(users);

  res.json({
    success: true,
    message: numCount + ' টি নাম্বার সফলভাবে যুক্ত হয়েছে',
    allocated: newNumbers,
    numbers: users[u].numbers
  });
}
app.post('/api/allocate', handleAllocateApi);
app.post('/api/v1/allocate', handleAllocateApi);

// Replace Range
app.post('/api/replace-numbers', (req, res) => {
  const { username, rangeId } = req.body;
  const u = String(username || '').trim();
  const users = loadUsers();
  if (!users[u] || !Array.isArray(users[u].numbers)) {
    return res.status(404).json({ success: false, error: 'ইউজার পাওয়া যায়নি' });
  }

  let replacedCount = 0;
  users[u].numbers = users[u].numbers.map(n => {
    if (!rangeId || n.rangeId === rangeId) {
      replacedCount++;
      const fresh = generateNumberForRange(n.dialCode);
      return {
        ...n,
        number: fresh.fullNumber,
        pureNumber: fresh.pureNumber,
        otp: null,
        smsText: null,
        status: 'active',
        allocatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      };
    }
    return n;
  });

  saveUsers(users);
  res.json({
    success: true,
    message: replacedCount + ' টি নাম্বার নতুন দিয়ে পরিবর্তন করা হয়েছে',
    numbers: users[u].numbers
  });
});

// Replace Single
app.post('/api/replace-single', (req, res) => {
  const { username, number } = req.body;
  const u = String(username || '').trim();
  const users = loadUsers();
  if (!users[u]) return res.status(404).json({ success: false, error: 'ইউজার পাওয়া যায়নি' });

  const idx = users[u].numbers.findIndex(n => n.number === number || n.pureNumber === number);
  if (idx === -1) return res.status(404).json({ success: false, error: 'নাম্বারটি পাওয়া যায়নি' });

  const old = users[u].numbers[idx];
  const fresh = generateNumberForRange(old.dialCode);
  users[u].numbers[idx] = {
    ...old,
    number: fresh.fullNumber,
    pureNumber: fresh.pureNumber,
    otp: null,
    smsText: null,
    status: 'active',
    allocatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp: Date.now()
  };

  saveUsers(users);
  res.json({
    success: true,
    message: 'নাম্বারটি সফলভাবে পরিবর্তন করা হয়েছে',
    newNumber: users[u].numbers[idx],
    numbers: users[u].numbers
  });
});

// Release
app.post('/api/release-numbers', (req, res) => {
  const { username, rangeId, number } = req.body;
  const u = String(username || '').trim();
  const users = loadUsers();
  if (!users[u]) return res.status(404).json({ success: false, error: 'ইউজার পাওয়া যায়নি' });

  if (number) {
    users[u].numbers = users[u].numbers.filter(n => n.number !== number && n.pureNumber !== number);
  } else if (rangeId) {
    users[u].numbers = users[u].numbers.filter(n => n.rangeId !== rangeId);
  } else {
    users[u].numbers = [];
  }

  saveUsers(users);
  res.json({
    success: true,
    message: 'নাম্বার সফলভাবে রিলিজ করা হয়েছে',
    numbers: users[u].numbers
  });
});

// Refresh OTP
app.all(['/api/refresh-otp', '/api/v1/refresh-otp'], async (req, res) => {
  const username = String(req.query.username || req.body.username || req.query.user || '').trim();
  const users = loadUsers();
  const user = users[username];

  let messages = [];
  try {
    const response = await fetch(LAMIX_BASE + '/messages?token=' + LAMIX_TOKEN, {
      signal: AbortSignal.timeout(6000)
    });
    const data = await response.json();
    if (Array.isArray(data)) messages = data;
    else if (data && Array.isArray(data.data)) messages = data.data;
    else if (data && Array.isArray(data.messages)) messages = data.messages;
  } catch (err) {}

  let newOtpCount = 0;
  if (user && Array.isArray(user.numbers) && messages.length > 0) {
    user.numbers.forEach(item => {
      const cleanItemNum = String(item.number || '').replace(/[^0-9]/g, '');
      const matched = messages.find(m => {
        const mNum = String(m.number || m.phone || m.recipient || '').replace(/[^0-9]/g, '');
        return mNum && (cleanItemNum.endsWith(mNum) || mNum.endsWith(cleanItemNum));
      });

      if (matched && !item.otp) {
        const text = matched.message || matched.text || matched.sms || '';
        const codeMatch = text.match(/\b\d{4,8}\b/);
        item.otp = codeMatch ? codeMatch[0] : 'OTP Received';
        item.smsText = text;
        item.smsSender = matched.sender || matched.from || 'SMS';
        item.smsTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        item.status = 'received';
        const rate = item.payout || COUNTRY_PAYOUTS[item.country] || 0.075;
        user.balance = parseFloat(((user.balance || 0) + rate).toFixed(4));
        newOtpCount++;
      }
    });

    if (newOtpCount > 0) {
      saveUsers(users);
    }
  }

  res.json({
    success: true,
    newOtps: newOtpCount,
    numbers: user ? user.numbers : [],
    balance: user ? user.balance : 0.00
  });
});

app.get('*', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'index.html');
  const p2 = path.join(__dirname, 'index.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  res.send('index.html not found');
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
