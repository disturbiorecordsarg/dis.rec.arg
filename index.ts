// =========================================================
// Edge Function: enviar-qr
// Genera un ticket (código QR) por cada asistente de una
// "entrada" y envía un mail real con las imágenes de QR
// adjuntas, usando Resend. Marca la entrada como 'enviado'.
//
// Deploy:
//   supabase functions deploy enviar-qr
//
// Variables de entorno necesarias (Supabase > Project Settings > Edge Functions):
//   SUPABASE_URL              (ya viene seteada por defecto)
//   SUPABASE_SERVICE_ROLE_KEY (ya viene seteada por defecto)
//   RESEND_API_KEY            (la generás en resend.com)
//   MAIL_FROM                 (ej: "Disturbio Records <entradas@tudominio.com>")
// =========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const MAIL_FROM = Deno.env.get("MAIL_FROM") || "Disturbio Records <onboarding@resend.dev>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function fetchQrPng(texto: string): Promise<Uint8Array> {
  // Servicio público gratuito de generación de QR (sin API key).
  // Si preferís generarlo sin depender de un tercero, se puede
  // reemplazar por una librería QR nativa de Deno.
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(texto)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("No se pudo generar el QR");
  return new Uint8Array(await resp.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente con el JWT del usuario que llama, para verificar que es "maestro"
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente admin (service role) para leer/escribir sin restricciones de RLS
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: rolRow } = await supabaseAdmin
      .from("staff_roles")
      .select("rol")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!rolRow || rolRow.rol !== "maestro") {
      return new Response(JSON.stringify({ error: "Solo la cuenta maestra puede enviar QR" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { entrada_id } = await req.json();
    if (!entrada_id) {
      return new Response(JSON.stringify({ error: "Falta entrada_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: entrada, error: entradaErr } = await supabaseAdmin
      .from("entradas")
      .select("*, eventos(nombre, fecha, lugar)")
      .eq("id", entrada_id)
      .single();

    if (entradaErr || !entrada) {
      return new Response(JSON.stringify({ error: "Entrada no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (entrada.estado === "enviado") {
      return new Response(JSON.stringify({ error: "El QR de esta entrada ya fue enviado" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const asistentes: string[] = entrada.asistentes || [entrada.titular];

    // 1) Crear (o reutilizar) los tickets en la base
    const { data: existentes } = await supabaseAdmin
      .from("tickets")
      .select("*")
      .eq("entrada_id", entrada_id);

    let tickets = existentes || [];
    if (tickets.length === 0) {
      const nuevos = asistentes.map((nombre, i) => ({
        entrada_id,
        evento_id: entrada.evento_id,
        nombre,
        codigo: `DISTURBIO-VOLVI-${entrada_id}-${i + 1}`,
      }));
      const { data: creados, error: insertErr } = await supabaseAdmin
        .from("tickets")
        .insert(nuevos)
        .select();
      if (insertErr) throw insertErr;
      tickets = creados || [];
    }

    // 2) Generar las imágenes QR y armar los adjuntos del mail
    const attachments = [];
    for (const t of tickets) {
      const png = await fetchQrPng(t.codigo);
      attachments.push({
        filename: `QR-${t.nombre.replace(/\s+/g, "_")}.png`,
        content: toBase64(png),
      });
    }

    // 3) Armar y enviar el mail con Resend
    const evento = entrada.eventos;
    const listaAsistentes = asistentes
      .map((n, i) => `<li>${n} — adjunto <strong>QR-${i + 1}</strong></li>`)
      .join("");

    const html = `
      <div style="font-family: sans-serif; line-height:1.5;">
        <h2>¡Tu entrada para ${evento?.nombre ?? "el evento"}!</h2>
        <p>Hola ${entrada.titular}, acá tenés tu entrada con QR para ingresar.</p>
        <p><strong>Fecha:</strong> ${evento?.fecha ?? ""}<br/>
           <strong>Lugar:</strong> ${evento?.lugar ?? ""}</p>
        <p>Asistentes:</p>
        <ul>${listaAsistentes}</ul>
        <p>Cada persona debe mostrar su QR (impreso o desde el celular) en la puerta.
           Cada código es válido para un solo ingreso.</p>
        <p>Nos vemos ahí. — Disturbio Records</p>
      </div>
    `;

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [entrada.email],
        subject: `Tu entrada — ${evento?.nombre ?? "Disturbio Records"}`,
        html,
        attachments,
      }),
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      throw new Error(`Resend error: ${errText}`);
    }

    // 4) Marcar la entrada como enviada
    await supabaseAdmin
      .from("entradas")
      .update({ estado: "enviado" })
      .eq("id", entrada_id);

    return new Response(
      JSON.stringify({ ok: true, tickets: tickets.map((t) => ({ nombre: t.nombre, codigo: t.codigo })) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
