const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let SYSTEM_CONFIG = {
  MESSAGES_URL: "https://panel.lamix.org/api/v1/messages?token=cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0",
  RANGES_URL: "https://panel.lamix.org/api/v1/ranges?token=cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0",
  TOKEN: "cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0",
  DEFAULT_PAYOUT: 0.05,
  ADMIN_USER: "admin",
  ADMIN_PASS: "admin1234"
};

let users = {
  "user1": {
    username: "user1",
    password: "123",
    balance: 0.00,
    todayEarnings: 0.00,
    sevenDayEarnings: 0.00,
    totalSms: 0,
    numbers: []
  }
};

let receivedMessages = [];

// প্রতিদিন সন্ধ্যা ৬:০০ টায় অটো রিসেট (বাংলাদেশ সময়)
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
  }
}, 30000);

// ১. লগইন
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "ইউজারনেম ও পাসওয়ার্ড দিন" });
  }

  const uKey = username.trim().toLowerCase();

  if (users[uKey] && users[uKey].password === password) {
    return res.json({ success: true, user: users[uKey] });
  }

  let lamixVerified = false;
  try {
    const clientListRes = await axios.get(`https://panel.lamix.org/api/v1/clients?token=${SYSTEM_CONFIG.TOKEN}`, { timeout: 6000 });
    const clients = Array.isArray(clientListRes.data) ? clientListRes.data : (clientListRes.data.clients || clientListRes.data.data || []);
    
    const found = clients.find(c => {
      const cUser = (c.username || c.login || c.name || "").trim().toLowerCase();
      const cPass = c.password || c.pass;
      return cUser === uKey && (!cPass || cPass === password);
    });

    if (found) lamixVerified = true;
  } catch (e1) {}

  if (!lamixVerified) {
    try {
      const lamixRes = await axios.post("https://panel.lamix.org/api/v1/auth/login", {
        username: username.trim(),
        password: password
      }, { timeout: 6000 });
      if (lamixRes.data && (lamixRes.data.token || lamixRes.data.success)) {
        lamixVerified = true;
      }
    } catch (e2) {}
  }

  if (lamixVerified) {
    if (!users[uKey]) {
      users[uKey] = {
        username: username.trim(),
        password: password,
        balance: 0.00,
        todayEarnings: 0.00,
        sevenDayEarnings: 0.00,
        totalSms: 0,
        numbers: []
      };
    } else {
      users[uKey].password = password;
    }
    return res.json({ success: true, user: users[uKey] });
  }

  res.status(401).json({ error: "ভুল ইউজারনেম বা পাসওয়ার্ড!" });
});

app.get("/api/user/profile/:username", (req, res) => {
  const uKey = req.params.username && req.params.username.trim().toLowerCase();
  const user = users[uKey];
  if (user) {
    return res.json({ success: true, user });
  }
  res.status(404).json({ error: "ইউজার পাওয়া যায়নি" });
});

// ২. লামিক্স থেকে রিয়েল রেটসহ রেঞ্জ লোড
app.get("/api/ranges", async (req, res) => {
  try {
    const response = await axios.get(SYSTEM_CONFIG.RANGES_URL, { timeout: 6000 });
    let raw = response.data;
    let list = Array.isArray(raw) ? raw : (raw.ranges || raw.data || []);
    
    // লামিক্সের আসল পে-আউট রেট বের করা
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

// ৩. নম্বর বরাদ্দ (আসল রেটসহ সেভ হবে)
app.post("/api/allocate", (req, res) => {
  const { username, countryName, countryCode, rate, quantity } = req.body;
  const user = users[username && username.trim().toLowerCase()];
  if (!user) return res.status(401).json({ error: "ইউজার পাওয়া যায়নি" });

  const qty = parseInt(quantity) || 10;
  const finalRange = countryName ? countryName.trim() : "Custom Range";
  
  let finalCode = countryCode ? countryCode.toString().trim() : "+972";
  if (!finalCode.startsWith("+")) finalCode = "+" + finalCode;

  // লামিক্সের আসল রেট
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
  res.json({ success: true, newNumber: freshNum, allNumbers: user.numbers });
});

// ৬. ক্লিয়ার
app.post("/api/clear-numbers", (req, res) => {
  const { username } = req.body;
  const user = users[username && username.trim().toLowerCase()];
  if (!user) return res.status(401).json({ error: "ইউজার পাওয়া যায়নি" });
  user.numbers = [];
  res.json({ success: true, allNumbers: [] });
});

// ৭. ওটিপি রিফ্রেশ ও ওই নম্বরের নির্দিষ্ট রেট অনুযায়ী টাকা যোগ
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
        // ওই নম্বরের নির্দিষ্ট আসল পে-আউট রেট নেওয়া
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

    res.json({ success: true, newCount, user, messages: receivedMessages });
  } catch (err) {
    res.json({ success: true, newCount: 0, user, messages: receivedMessages });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
