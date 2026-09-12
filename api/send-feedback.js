export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, replyEmail } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Missing message' });
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL,
        to: process.env.FEEDBACK_EMAIL || process.env.FROM_EMAIL,
        reply_to: replyEmail || undefined,
        subject: 'Feedback / erro reportado — DossiêDoc',
        text: `Mensagem:\n\n${message}\n\n${replyEmail ? 'E-mail pra resposta: ' + replyEmail : 'Sem e-mail pra resposta informado.'}`
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Resend API error:', errText);
      return res.status(500).json({ error: 'Could not send feedback' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-feedback.js error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
