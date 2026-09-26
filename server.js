const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const USERS_FILE = path.join(__dirname, "users.json");

let SYSTEM_CONFIG = {
  MESSAGES_URL: "https://panel.lamix.org/api/v1/messages?token=cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0",
  RANGES_URL: "https://panel.lamix.org/api/v1/ranges?token=cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0",
  TOKEN: "cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0",
  DEFAULT_PAYOUT: 0.05,
  ADMIN_USER: "admin",
  ADMIN_PASS: "admin1234"
};

// ইউজার ডাটাবেজ সংরক্ষণ
let users = {};
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    }
  } catch (e) {
    users = {};
  }
}
function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (e) {}
}
loadUsers();

// ডিফল্ট ইউজার ব্যাকআপ
if (!users["test101"]) {
  users["test101"] = { username: "test101", password: "123", balance: 0.00, todayEarnings: 0.00, sevenDayEarnings: 0.00, totalSms: 0, numbers: [] };
}
if (!users["user1"]) {
  users["user1"] = { username: "user1", password: "123", balance: 0.00, todayEarnings: 0.00, sevenDayEarnings: 0.00, totalSms: 0, numbers: [] };
}
saveUsers();

let receivedMessages = [];

// প্রতিদিন সন্ধ্যা ৬:০০ টায় অটো রিসেট
let lastResetDate = "";
setInterval(() => {
  const now = new Date();
  const bdtDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" }));
  const hour = bdtDate.getHours();
  const minute = bdtDate.getMinutes();
  const dateKey = bdtDate.toDateString();

  if (hour === 18 && minute === 0 && lastResetDate !== dateKey) {
    lastResetDate = dateKey;
    Object.keys(users).forEach(u => {
      users[u].numbers = [];
    });
    saveUsers();
  }
}, 30000);

// ================= ১. ইনস্ট্যান্ট লগইন সিস্টেম ================= //
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "ইউজারনেম ও পাসওয়ার্ড দিন" });
  }

  const uKey = username.trim().toLowerCase();
  const cleanPass = password.trim();

  // ক) ইউজার আগে থেকে থাকলে পাসওয়ার্ড মিলিয়ে লগইন
  if (users[uKey]) {
    if (users[uKey].password === cleanPass) {
      return res.json({ success: true, user: users[uKey] });
    } else {
      return res.status(401).json({ error: "ভুল পাসওয়ার্ড! সঠিক পাসওয়ার্ড দিন।" });
    }
  }

  // খ) নতুন লামিক্স ক্লায়েন্ট হলে ইনস্ট্যান্ট একাউন্ট তৈরি ও লগইন
  users[uKey] = {
    username: username.trim(),
    password: cleanPass,
    balance: 0.00,
    todayEarnings: 0.00,
    sevenDayEarnings: 0.00,
    totalSms: 0,
    numbers: []
  };
  saveUsers();

  return res.json({ success: true, user: users[uKey] });
});

// প্রোফাইল সিঙ্ক
app.get("/api/user/profile/:username", (req, res) => {
  const uKey = req.params.username && req.params.username.trim().toLowerCase();
  const user = users[uKey];
  if (user) {
    return res.json({ success: true, user });
  }
  res.status(404).json({ error: "ইউজার পাওয়া যায়নি" });
});

// ২. লামিক্সের আসল পে-আউট রেটসহ রেঞ্জ লোড
app.get("/api/ranges", async (req, res) => {
  try {
    const response = await axios.get(SYSTEM_CONFIG.RANGES_URL, { timeout: 5000 });
    let raw = response.data;
    let list = Array.isArray(raw) ? raw : (raw.ranges || raw.data || []);
    
    const formatted = list.map(r => {
      let realRate = r.payout ?? r.rate ?? r.price ?? r.client_price ?? r.client_rate ?? r.cost ?? r.amount ?? r.tariff;
      if (!realRate || isNaN(parseFloat(realRate)) || parseFloat(realRate) <= 0) {
        realRate = SYSTEM_CONFIG.DEFAULT_PAYOUT;
      }
      return {
        ...r,
        name: r.name || r.country || "Custom Range",
        rate: parseFloat(realRate)
      };
    });

    if (formatted.length > 0) return res.json({ success: true, ranges: formatted });
  } catch (err) {}

  res.json({ success: true, ranges: [] });
});

// ৩. নম্বর বরাদ্দ
app.post("/api/allocate", (req, res) => {
  const { username, countryName, countryCode, rate, quantity } = req.body;
  const user = users[username && username.trim().toLowerCase()];
  if (!user) return res.status(401).json({ error: "ইউজার পাওয়া যায়নি" });

  const qty = parseInt(quantity) || 10;
  const finalRange = countryName ? countryName.trim() : "Custom Range";
  
  let finalCode = countryCode ? countryCode.toString().trim() : "+972";
  if (!finalCode.startsWith("+")) finalCode = "+" + finalCode;

  const finalRate = parseFloat(rate) > 0 ? parseFloat(rate) : SYSTEM_CONFIG.DEFAULT_PAYOUT;

  let newNumbers = [];
  for (let i = 0; i < qty; i++) {
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const numObj = {
      number: `${finalCode}${randomSuffix}`,
      range: finalRange,
      country: finalRange,
      code: finalCode,
      payout: finalRate,
      date: new Date().toLocaleDateString()
    };
    user.numbers.unshift(numObj);
    newNumbers.push(numObj);
  }

  saveUsers();
  res.json({ success: true, allNumbers: user.numbers });
});

// ৪. রিপ্লেস
app.post("/api/replace-numbers", (req, res) => {
  const { username, country, action } = req.body;
  const user = users[username && username.trim().toLowerCase()];
  if (!user) return res.status(401).json({ error: "ইউজার পাওয়া যায়নি" });

  const countryLower = (country || "").trim().toLowerCase();
  const matched = user.numbers.filter(n => (n.range || n.country || "").trim().toLowerCase() === countryLower);
  const qty = matched.length;

  if (qty === 0) {
    return res.status(400).json({ error: "কোনো নম্বর পাওয়া যায়নি!" });
  }

  const sample = matched[0];
  const finalCode = sample.code || "+972";
  const finalRate = sample.payout || SYSTEM_CONFIG.DEFAULT_PAYOUT;
  const finalRange = sample.range || sample.country;

  user.numbers = user.numbers.filter(n => (n.range || n.country || "").trim().toLowerCase() !== countryLower);

  if (action === "replace") {
    let freshNumbers = [];
    for (let i = 0; i < qty; i++) {
      const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
      freshNumbers.push({
        number: `${finalCode}${randomSuffix}`,
        range: finalRange,
        country: finalRange,
        code: finalCode,
        payout: finalRate,
        date: new Date().toLocaleDateString()
      });
    }
    user.numbers = [...freshNumbers, ...user.numbers];
  }

  saveUsers();
  res.json({
    success: true,
    message: action === "replace" ? `${qty} টি নম্বর রিপ্লেস হয়েছে!` : `${qty} টি নম্বর রিলিজ হয়েছে!`,
    allNumbers: user.numbers
  });
});

// ৫. সিঙ্গেল রিপ্লেস
app.post("/api/replace-single", (req, res) => {
  const { username, targetNumber } = req.body;
  const user = users[username && username.trim().toLowerCase()];
  if (!user) return res.status(401).json({ error: "ইউজার পাওয়া যায়নি" });

  const idx = user.numbers.findIndex(n => n.number === targetNumber);
  if (idx === -1) return res.status(404).json({ error: "নম্বরটি পাওয়া যায়নি" });

  const old = user.numbers[idx];
  const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
  const freshNum = {
    number: `${old.code || "+972"}${randomSuffix}`,
    range: old.range || old.country,
    country: old.country,
    code: old.code || "+972",
    payout: old.payout,
    date: new Date().toLocaleDateString()
  };

  user.numbers[idx] = freshNum;
  saveUsers();
  res.json({ success: true, newNumber: freshNum, allNumbers: user.numbers });
});

// ৬. ক্লিয়ার
app.post("/api/clear-numbers", (req, res) => {
  const { username } = req.body;
  const user = users[username && username.trim().toLowerCase()];
  if (!user) return res.status(401).json({ error: "ইউজার পাওয়া যায়নি" });
  user.numbers = [];
  saveUsers();
  res.json({ success: true, allNumbers: [] });
});

// ৭. ওটিপি রিফ্রেশ
app.post("/api/refresh-otp", async (req, res) => {
  const { username } = req.body;
  const user = users[username && username.trim().toLowerCase()];
  if (!user) return res.status(401).json({ error: "ইউজার পাওয়া যায়নি" });

  try {
    const response = await axios.get(SYSTEM_CONFIG.MESSAGES_URL, { timeout: 8000 });
    const messages = Array.isArray(response.data) ? response.data : (response.data.messages || []);
    let newCount = 0;

    messages.forEach(msg => {
      const exists = receivedMessages.some(m => m.id === msg.id);
      if (!exists && msg.id) {
        const matchedNum = user.numbers.find(n => n.number === msg.number);
        const payout = matchedNum ? (matchedNum.payout || SYSTEM_CONFIG.DEFAULT_PAYOUT) : SYSTEM_CONFIG.DEFAULT_PAYOUT;

        user.balance += payout;
        user.todayEarnings += payout;
        user.sevenDayEarnings += payout;
        user.totalSms += 1;

        receivedMessages.unshift({
          id: msg.id,
          number: msg.number || (user.numbers[0] ? user.numbers[0].number : "Active Range"),
          sender: msg.sender || msg.cli || "OTP Service",
          text: msg.text || msg.message || "Code: " + Math.floor(100000 + Math.random() * 900000),
          earned: payout,
          time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        });
        newCount++;
      }
    });

    saveUsers();
    res.json({ success: true, newCount, user, messages: receivedMessages });
  } catch (err) {
    res.json({ success: true, newCount: 0, user, messages: receivedMessages });
  }
});

// এডমিন রাউটস
app.post("/api/admin/login", (req, res) => {
  const { user, pass } = req.body;
  if (user === SYSTEM_CONFIG.ADMIN_USER && pass === SYSTEM_CONFIG.ADMIN_PASS) {
    res.json({ success: true, config: SYSTEM_CONFIG, users: Object.values(users) });
  } else {
    res.status(401).json({ error: "ভুল এডমিন আইডি বা পাসওয়ার্ড!" });
  }
});

app.post("/api/admin/create-user", (req, res) => {
  const { adminUser, adminPass, newUsername, newPassword } = req.body;
  if (adminUser !== SYSTEM_CONFIG.ADMIN_USER || adminPass !== SYSTEM_CONFIG.ADMIN_PASS) {
    return res.status(401).json({ error: "অননুমোদিত!" });
  }
  const key = newUsername.trim().toLowerCase();
  users[key] = {
    username: newUsername.trim(),
    password: newPassword.trim(),
    balance: 0.00,
    todayEarnings: 0.00,
    sevenDayEarnings: 0.00,
    totalSms: 0,
    numbers: []
  };
  saveUsers();
  res.json({ success: true, message: `ইউজার '${newUsername}' তৈরি হয়েছে!`, users: Object.values(users) });
});

app.post("/api/admin/delete-user", (req, res) => {
  const { adminUser, adminPass, targetUser } = req.body;
  if (adminUser !== SYSTEM_CONFIG.ADMIN_USER || adminPass !== SYSTEM_CONFIG.ADMIN_PASS) {
    return res.status(401).json({ error: "অননুমোদিত!" });
  }
  const key = targetUser && targetUser.trim().toLowerCase();
  if (users[key]) {
    delete users[key];
    saveUsers();
    return res.json({ success: true, message: "ইউজার মুছে ফেলা হয়েছে!", users: Object.values(users) });
  }
  res.status(404).json({ error: "ইউজার পাওয়া যায়নি" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
