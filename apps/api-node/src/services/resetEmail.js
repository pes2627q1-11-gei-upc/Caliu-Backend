// L'app permet copiar el codi directament des del correu.
export async function sendResetCode(email, token) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESET_EMAIL_FROM, to: [email], subject: 'Caliu · Recuperació de contrasenya',
      text: `Introdueix aquest codi a Caliu per canviar la contrasenya: ${token}\nCaduca en 30 minuts. Si no l’has demanat, ignora aquest missatge.`,
    }),
  });
  if (!response.ok) throw new Error('Error del servei de correu');
}
