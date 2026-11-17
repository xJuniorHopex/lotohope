// Función PROGRAMADA: corre sola cada miércoles y sábado de noche (hora RD)
// y registra el Loto en Firestore. No hace nada si ya está al día.
import { sincronizar } from './lib/loto.mjs';

export default async () => {
  const log = await sincronizar();
  console.log(JSON.stringify(log));
  return new Response(JSON.stringify(log), { headers: { 'content-type': 'application/json' } });
};

// Horario en UTC: domingo y jueves de 1:00 a 5:59 AM UTC = miércoles y sábado de 9:00 PM a 1:59 AM en RD.
// Cada 20 minutos hasta que encuentre el resultado.
export const config = { schedule: '*/20 1-5 * * 0,4' };
