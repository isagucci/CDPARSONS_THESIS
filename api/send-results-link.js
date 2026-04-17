const RESEND_API_URL = "https://api.resend.com/emails";

function isValidEmail(value) {
  const v = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

module.exports = async (req, res) => {
  const method = (req && req.method) || "GET";
  if (method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESULTS_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    return res.status(500).json({ ok: false, error: "Email service is not configured." });
  }

  const body = (req && req.body) || {};
  const email = String(body.email || "").trim();
  const resultUrl = String(body.resultUrl || "").trim();

  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "Invalid email address." });
  }
  if (!resultUrl || !/^https?:\/\//.test(resultUrl)) {
    return res.status(400).json({ ok: false, error: "Invalid results link." });
  }

  const payload = {
    from: fromEmail,
    to: [email],
    subject: "Your Climate Comfort results",
    text: "Here is your Climate Comfort results link:\n\n" + resultUrl
  };

  try {
    const resendRes = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify(payload)
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return res.status(502).json({ ok: false, error: "Email provider error.", detail: errText });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "Failed to send email." });
  }
};
