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

const DEFAULT_RANGES = [
  { id: "tn", country: "Tunisia LX", code: "+216", rate: 0.05 },
  { id: "us", country: "United States", code: "+1", rate: 0.08 },
  { id: "uk", country: "United Kingdom", code: "+44", rate: 0.07 },
  { id: "ca", country: "Canada", code: "+1", rate: 0.06 },
  { id: "bd", country: "Bangladesh Pool", code: "+880", rate: 0.05 },
  { id: "in", country: "India Range", code: "+91", rate: 0.04 }
];

// ১. লামিক্স ক্লায়েন্ট অ্যাকাউন্ট ভেরিফিকেশন ও লগইন
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "ইউজারনেম ও পাসওয়ার্ড দিন" });
  }

  const uKey = username.trim().toLowerCase();

  // ক) সিস্টেমে সেভ থাকলে সরাসরি লগইন
  if (users[uKey] && users[uKey].password === password) {
    return res.json({ success: true, user: users[uKey] });
  }

  // খ) লামিক্স ক্লায়েন্ট তালিকা থেকে যাচাই
  let lamixVerified = false;
  try {
    const clientListRes = await axios.get(`https://panel.lamix.org/api/v1/clients?token=${SYSTEM_CONFIG.TOKEN}`, { timeout: 6000 });
    const clients = Array.isArray(clientListRes.data) ? clientListRes.data : (clientListRes.data.clients || clientListRes.data.data || []);
    
    const found = clients.find(c => {
      const cUser = (c.username || c.login || c.name || "").trim().toLowerCase();
      const cPass = c.password || c.pass;
      return cUser === uKey && (!cPass || cPass === password);
    });

    if (found) {
      lamixVerified = true;
    }
  } catch (e1) {}

  // গ) বিকল্প লামিক্স অথ চেক
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

  res.status(401).json({ error: "ভুল ইউজারনেম বা পাসওয়ার্ড! লামিক্সে ক্লায়েন্ট একাউন্ট তৈরি করা আছে কি না যাচাই করুন।" });
});

// ইউজার প্রোফাইল সিঙ্ক
app.get("/api/user/profile/:username", (req, res) => {
  const uKey = req.params.username && req.params.username.trim().toLowerCase();
  const user = users[uKey];
  if (user) {
    return res.json({ success: true, user });
  }
  res.status(404).json({ error: "ইউজার পাওয়া যায়নি" });
});

// ২. রেঞ্জ লিস্ট
app.get("/api/ranges", async (req, res) => {
  try {
    const response = await axios.get(SYSTEM_CONFIG.RANGES_URL, { timeout: 6000 });
    let raw = response.data;
    let list = Array.isArray(raw) ? raw : (raw.ranges || raw.data || []);
    if (list.length > 0) return res.json({ success: true, ranges: list });
  } catch (err) {}
  res.json({ success: true, ranges: DEFAULT_RANGES });
});

// ৩. নম্বর বরাদ্দ (সঠিক দেশ এবং কোডসহ তৈরি হবে)
app.post("/api/allocate", (req, res) => {
  const { username, countryName, countryCode, rate, quantity } = req.body;
  const user = users[username && username.trim().toLowerCase()];
  if (!user) return res.status(401).json({ error: "ইউজার পাওয়া যায়নি" });

  const qty = parseInt(quantity) || 1;
  const finalCountry = countryName ? countryName.trim() : "Custom Pool";
  
  let finalCode = countryCode ? countryCode.toString().trim() : "+1";
  if (!finalCode.startsWith("+")) finalCode = "+" + finalCode;

  const finalRate = parseFloat(rate) || SYSTEM_CONFIG.DEFAULT_PAYOUT;

  let newNumbers = [];
  for (let i = 0; i < qty; i++) {
    // ৭ থেকে ৮ ডিজিটের র্যান্ডম নম্বর
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const numObj = {
      number: `${finalCode}${randomSuffix}`,
      country: finalCountry,
      payout: finalRate,
      date: new Date().toLocaleDateString()
    };
    user.numbers.unshift(numObj);
    newNumbers.push(numObj);
  }

  res.json({ success: true, allNumbers: user.numbers });
});

// ৪. ওটিপি রিফ্রেশ ও ব্যালেন্স যোগ
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
        const payout = SYSTEM_CONFIG.DEFAULT_PAYOUT;
        user.balance += payout;
        user.todayEarnings += payout;
        user.sevenDayEarnings += payout;
        user.totalSms += 1;

        receivedMessages.unshift({
          id: msg.id,
          number: msg.number || (user.numbers[0] ? user.numbers[0].number : "Active Pool"),
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

// ====================== [ADMIN ROUTES] ====================== //
app.post("/api/admin/login", (req, res) => {
  const { user, pass } = req.body;
  if (user === SYSTEM_CONFIG.ADMIN_USER && pass === SYSTEM_CONFIG.ADMIN_PASS) {
    res.json({ success: true, config: SYSTEM_CONFIG, users: Object.values(users) });
  } else {
    res.status(401).json({ error: "ভুল এডমিন আইডি বা পাসওয়ার্ড!" });
  }
});

app.post("/api/admin/sync-lamix-clients", async (req, res) => {
  const { adminUser, adminPass } = req.body;
  if (adminUser !== SYSTEM_CONFIG.ADMIN_USER || adminPass !== SYSTEM_CONFIG.ADMIN_PASS) {
    return res.status(401).json({ error: "অননুমোদিত!" });
  }

  try {
    const clientListRes = await axios.get(`https://panel.lamix.org/api/v1/clients?token=${SYSTEM_CONFIG.TOKEN}`, { timeout: 6000 });
    const clients = Array.isArray(clientListRes.data) ? clientListRes.data : (clientListRes.data.clients || []);
    let added = 0;
    clients.forEach(c => {
      const uKey = (c.username || c.name || "").toLowerCase();
      if (uKey && !users[uKey]) {
        users[uKey] = {
          username: c.username || c.name,
          password: c.password || "lamix123",
          balance: c.balance || 0.00,
          todayEarnings: 0.00,
          sevenDayEarnings: 0.00,
          totalSms: 0,
          numbers: []
        };
        added++;
      }
    });
    return res.json({ success: true, message: `${added} টি ক্লায়েন্ট সিঙ্ক হয়েছে!`, users: Object.values(users) });
  } catch (err) {
    return res.json({ success: false, error: "ক্লায়েন্ট এপিআই রেসপন্স দেয়নি।" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
