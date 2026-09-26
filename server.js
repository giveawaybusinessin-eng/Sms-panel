const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// আপনার দেওয়া সরাসরি সম্পূর্ণ URL
let SYSTEM_CONFIG = {
  MESSAGES_URL: "https://panel.lamix.org/api/v1/messages?token=cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0",
  RANGES_URL: "https://panel.lamix.org/api/v1/ranges?token=cSpzR9cFwnJjXECqcYTmqWvwDIfpyQ9wIAn3pkNYDN0",
  DEFAULT_PAYOUT: 0.05,
  ADMIN_PIN: "1234"
};

let receivedMessages = [];
let userWallet = {
  balance: 0.00,
  todayEarnings: 0.00,
  sevenDayEarnings: 0.00,
  totalSms: 0
};

// ১. রেঞ্জ দেখার এন্ডপয়েন্ট
app.get("/api/ranges", async (req, res) => {
  try {
    const response = await axios.get(SYSTEM_CONFIG.RANGES_URL, { timeout: 7000 });
    res.json({ success: true, ranges: response.data });
  } catch (err) {
    res.json({
      success: true,
      ranges: [
        { id: "us_1", country: "United States (Virtual)", rate: SYSTEM_CONFIG.DEFAULT_PAYOUT },
        { id: "uk_1", country: "United Kingdom", rate: SYSTEM_CONFIG.DEFAULT_PAYOUT },
        { id: "ca_1", country: "Canada Pool", rate: SYSTEM_CONFIG.DEFAULT_PAYOUT }
      ]
    });
  }
});

// ২. সরাসরি আপনার দেওয়া URL থেকে এসএমএস/ওটিপি ফেচ করার এন্ডপয়েন্ট
app.get("/api/refresh-otp", async (req, res) => {
  try {
    const response = await axios.get(SYSTEM_CONFIG.MESSAGES_URL, { timeout: 8000 });

    const messages = Array.isArray(response.data) ? response.data : (response.data.messages || []);
    let newCount = 0;

    messages.forEach((msg) => {
      const exists = receivedMessages.some((m) => m.id === msg.id);
      // নতুন কোড না আসা পর্যন্ত কোনো ব্যালেন্স যোগ হবে না
      if (!exists && msg.id) {
        const payoutAmount = SYSTEM_CONFIG.DEFAULT_PAYOUT;
        userWallet.balance += payoutAmount;
        userWallet.todayEarnings += payoutAmount;
        userWallet.sevenDayEarnings += payoutAmount;
        userWallet.totalSms += 1;

        receivedMessages.unshift({
          id: msg.id,
          number: msg.number || "N/A",
          sender: msg.sender || msg.cli || "OTP Sender",
          text: msg.text || msg.message || "No Text",
          earned: payoutAmount,
          time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        });
        newCount++;
      }
    });

    res.json({
      success: true,
      newCount,
      wallet: userWallet,
      messages: receivedMessages
    });
  } catch (err) {
    if (err.response && err.response.status === 429) {
      return res.status(429).json({ error: "Wait 5s before refreshing." });
    }
    res.status(500).json({ error: "Error fetching messages from Lamix URL" });
  }
});

// ৩. এডমিন প্যানেল কনফিগ দেখা
app.get("/api/admin/get-config", (req, res) => {
  res.json({
    messagesUrl: SYSTEM_CONFIG.MESSAGES_URL,
    defaultPayout: SYSTEM_CONFIG.DEFAULT_PAYOUT,
    wallet: userWallet
  });
});

// ৪. এডমিন প্যানেল থেকে URL ও পে-আউট আপডেট করা
app.post("/api/admin/update-config", (req, res) => {
  const { pin, messagesUrl, defaultPayout } = req.body;
  if (pin !== SYSTEM_CONFIG.ADMIN_PIN) {
    return res.status(403).json({ error: "ভুল এডমিন পিন!" });
  }
  if (messagesUrl) SYSTEM_CONFIG.MESSAGES_URL = messagesUrl.trim();
  if (defaultPayout) SYSTEM_CONFIG.DEFAULT_PAYOUT = parseFloat(defaultPayout);

  res.json({ success: true, message: "URL ও সেটিংস সফলভাবে আপডেট হয়েছে!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
