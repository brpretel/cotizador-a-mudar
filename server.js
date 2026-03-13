import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { Resend } from "resend";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SMTP_MODE = String(process.env.SMTP_MODE || "test").toLowerCase();
const isProductionMode = SMTP_MODE === "production";

const resend = isProductionMode ? new Resend(process.env.RESEND_API_KEY) : null;

function buildTransporter() {
  return nodemailer.createTransport({
    host: process.env.GMAIL_SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.GMAIL_SMTP_PORT || 465),
    secure: Number(process.env.GMAIL_SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.GMAIL_SMTP_USER,
      pass: process.env.GMAIL_SMTP_PASS
    }
  });
}

const transporter = !isProductionMode ? buildTransporter() : null;

if (!isProductionMode && transporter) {
  transporter.verify((error) => {
    if (error) {
      console.error("Error SMTP test:", error);
    } else {
      console.log("SMTP Gmail listo en modo test");
    }
  });
} else {
  console.log("Modo production activo: correos por Resend API");
}

app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

function money(n) {
  const num = Number(n || 0);
  return `$${num.toLocaleString("es-CO")}`;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metodoLabel(m) {
  if (m === "escalera") return "Escalera";
  if (m === "fachada_manual") return "Fachada Manual";
  if (m === "montacarga") return "Montacarga";
  return "—";
}

async function sendEmail({ to, subject, html, text, attachments = [] }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);

  if (!recipients.length) {
    throw new Error("No se proporcionaron destinatarios.");
  }

  if (isProductionMode) {
    const result = await resend.emails.send({
      from: process.env.MAIL_FROM,
      to: recipients,
      subject,
      html,
      text,
      replyTo: process.env.MAIL_REPLY_TO || process.env.ADMIN_EMAIL,
      attachments: attachments.length
        ? attachments.map((file) => ({
            filename: file.filename,
            content: Buffer.isBuffer(file.content)
              ? file.content.toString("base64")
              : file.content,
            contentType: file.contentType || "application/octet-stream"
          }))
        : undefined
    });

    if (result?.error) {
      throw new Error(result.error.message || "No se pudo enviar el correo con Resend.");
    }

    console.log(
      `Correo enviado (production): ${
        result?.data?.id || JSON.stringify(result?.data || {})
      }`
    );

    return result.data;
  }

  const from = process.env.MAIL_FROM_TEST || process.env.GMAIL_SMTP_USER;

  const info = await transporter.sendMail({
    from,
    sender: from,
    to: recipients.join(", "),
    replyTo: process.env.MAIL_REPLY_TO || process.env.ADMIN_EMAIL,
    subject,
    html,
    text,
    attachments
  });

  console.log(`Correo enviado (test): ${info.messageId}`);

  return info;
}

function buildAdminStartEmailHTML({ customer, quoteSessionId }) {
  return `
  <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
      <div style="padding:24px;background:#071a36;color:#ffffff;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;opacity:.85;">Nuevo lead</div>
        <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">El usuario inició una cotización</h1>
      </div>

      <div style="padding:24px;font-size:15px;line-height:1.7;">
        <p>Se registraron los datos iniciales del formulario.</p>

        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:16px;">
          <div><b>Nombre:</b> ${escapeHtml(customer.fullName || "—")}</div>
          <div><b>Correo:</b> ${escapeHtml(customer.email || "—")}</div>
          <div><b>Teléfono:</b> ${escapeHtml(customer.phone || "—")}</div>
          <div><b>ID sesión:</b> ${escapeHtml(quoteSessionId || "—")}</div>
        </div>
      </div>
    </div>
  </div>
  `;
}

function buildAdminStartEmailText({ customer, quoteSessionId }) {
  return `El usuario inició una cotización.

Nombre: ${customer.fullName || "—"}
Correo: ${customer.email || "—"}
Teléfono: ${customer.phone || "—"}
ID sesión: ${quoteSessionId || "—"}`;
}

function buildAdminAbandonEmailHTML({ customer, quoteSessionId, state }) {
  return `
  <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
      <div style="padding:24px;background:#7c2d12;color:#ffffff;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;opacity:.85;">Cotización incompleta</div>
        <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">El usuario no terminó la cotización</h1>
      </div>

      <div style="padding:24px;font-size:15px;line-height:1.7;">
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:16px;">
          <div><b>Nombre:</b> ${escapeHtml(customer?.fullName || "—")}</div>
          <div><b>Correo:</b> ${escapeHtml(customer?.email || "—")}</div>
          <div><b>Teléfono:</b> ${escapeHtml(customer?.phone || "—")}</div>
          <div><b>ID sesión:</b> ${escapeHtml(quoteSessionId || "—")}</div>
        </div>

        <div style="margin-top:16px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;">
          <div><b>Paso:</b> ${escapeHtml(state?.step || "—")}</div>
          <div><b>Servicio:</b> ${escapeHtml(state?.servicio || "—")}</div>
          <div><b>Fecha mudanza:</b> ${escapeHtml(state?.fechaMudanzaLabel || "—")}</div>
          <div><b>Ruta:</b> ${escapeHtml(state?.tipoRuta || "—")}</div>
          <div><b>Tipo de mudanza:</b> ${escapeHtml(state?.tipoMudanza || "—")}</div>
          <div><b>Tarifa aplicada:</b> ${escapeHtml(state?.tarifaAplicadaLabel || "—")}</div>
          <div><b>Precio por km:</b> ${state?.precioKmAplicado ? money(state.precioKmAplicado) : "—"}</div>
          <div><b>Descuento aplicado:</b> ${state?.descuentoAplicadoPct ? `${state.descuentoAplicadoPct}%` : "0%"}</div>
          <div><b>Desea bodegaje:</b> ${
            state?.deseaBodegaje === true ? "Sí" : state?.deseaBodegaje === false ? "No" : "—"
          }</div>
          <div><b>Días de bodegaje:</b> ${state?.diasBodegaje || "—"}</div>
          <div><b>Origen:</b> ${escapeHtml(state?.origenDireccion || "—")}</div>
          <div><b>Destino:</b> ${escapeHtml(state?.destinoDireccion || "—")}</div>
          <div><b>KM:</b> ${escapeHtml(String(state?.distanciaKm || "—"))}</div>
        </div>
      </div>
    </div>
  </div>
  `;
}

function buildAdminAbandonEmailText({ customer, quoteSessionId, state }) {
  return `El usuario no terminó la cotización.

Nombre: ${customer?.fullName || "—"}
Correo: ${customer?.email || "—"}
Teléfono: ${customer?.phone || "—"}
ID sesión: ${quoteSessionId || "—"}

Paso: ${state?.step || "—"}
Servicio: ${state?.servicio || "—"}
Fecha mudanza: ${state?.fechaMudanzaLabel || "—"}
Ruta: ${state?.tipoRuta || "—"}
Tipo de mudanza: ${state?.tipoMudanza || "—"}
Tarifa aplicada: ${state?.tarifaAplicadaLabel || "—"}
Precio por km: ${state?.precioKmAplicado ? money(state.precioKmAplicado) : "—"}
Descuento aplicado: ${state?.descuentoAplicadoPct ? `${state.descuentoAplicadoPct}%` : "0%"}
Desea bodegaje: ${state?.deseaBodegaje === true ? "Sí" : state?.deseaBodegaje === false ? "No" : "—"}
Días de bodegaje: ${state?.diasBodegaje || "—"}
Origen: ${state?.origenDireccion || "—"}
Destino: ${state?.destinoDireccion || "—"}
KM: ${state?.distanciaKm || "—"}`;
}

function buildClientFinalEmailHTML(customer) {
  return `
  <div style="font-family:Arial,sans-serif;background:#f3f6fb;padding:24px;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
      <div style="background:#071a36;padding:28px 24px;color:#ffffff;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;opacity:.85;">A-Mudar</div>
        <h1 style="margin:10px 0 8px;font-size:30px;line-height:1.2;">Tu cotización ha sido completada</h1>
        <p style="margin:0;font-size:15px;line-height:1.6;opacity:.95;">
          Hola ${escapeHtml(customer.fullName || "cliente")}, estamos encantados de servirte.
        </p>
      </div>

      <div style="padding:24px;font-size:15px;line-height:1.75;color:#334155;">
        <p>En breve nos contactaremos contigo para realizar el pago y proceder con la confirmación del servicio.</p>
        <p>En este correo encontrarás adjunto el PDF con la información completa de tu cotización.</p>
        <p style="margin-top:18px;">Gracias por confiar en <b>A-Mudar</b>.</p>
      </div>
    </div>
  </div>
  `;
}

function buildClientFinalEmailText(customer) {
  return `Hola ${customer.fullName || "cliente"},

Tu cotización ha sido completada.

En breve nos contactaremos contigo para realizar el pago y proceder con la confirmación del servicio.

Estamos encantados de servirte. En este correo encontrarás el PDF con la información completa de la cotización.

A-Mudar`;
}

function buildAdminFinalEmailHTML(customer) {
  return `
  <div style="font-family:Arial,sans-serif;background:#f3f6fb;padding:24px;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
      <div style="background:#071a36;padding:28px 24px;color:#ffffff;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;opacity:.85;">A-Mudar</div>
        <h1 style="margin:10px 0 8px;font-size:30px;line-height:1.2;">Nueva cotización completada</h1>
        <p style="margin:0;font-size:15px;line-height:1.6;opacity:.95;">
          El cliente ${escapeHtml(customer.fullName || "—")} completó su cotización.
        </p>
      </div>

      <div style="padding:24px;font-size:15px;line-height:1.75;color:#334155;">
        <p>Se adjunta el PDF con toda la información detallada de la cotización.</p>

        <div style="margin-top:16px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:16px;">
          <div><b>Nombre:</b> ${escapeHtml(customer.fullName || "—")}</div>
          <div><b>Correo:</b> ${escapeHtml(customer.email || "—")}</div>
          <div><b>Teléfono:</b> ${escapeHtml(customer.phone || "—")}</div>
        </div>
      </div>
    </div>
  </div>
  `;
}

function buildAdminFinalEmailText(customer) {
  return `Nueva cotización completada.

Cliente: ${customer.fullName || "—"}
Correo: ${customer.email || "—"}
Teléfono: ${customer.phone || "—"}

Se adjunta el PDF con toda la información detallada de la cotización.`;
}

function ensurePdfSpace(doc, needed = 80) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

async function buildQuotePdfBuffer(payload) {
  const {
    customer,
    state,
    totals,
    origenEspeciales = [],
    destinoEspeciales = [],
    items = []
  } = payload;

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 36
    });

    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    const totalEspecialesOrigenPrice = origenEspeciales.reduce(
      (acc, it) => acc + Number(it.price || 0),
      0
    );
    const totalEspecialesDestinoPrice = destinoEspeciales.reduce(
      (acc, it) => acc + Number(it.price || 0),
      0
    );
    const totalItemsPrice = items.reduce((acc, it) => acc + Number(it.price || 0), 0);

    const totalEspecialesOrigenM3 = origenEspeciales.reduce(
      (acc, it) => acc + Number(it.m3Total || 0),
      0
    );
    const totalEspecialesDestinoM3 = destinoEspeciales.reduce(
      (acc, it) => acc + Number(it.m3Total || 0),
      0
    );
    const totalItemsM3 = items.reduce((acc, it) => acc + Number(it.m3Total || 0), 0);

    const o = state.origen || {};
    const d = state.destino || {};
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;

    function sectionTitle(title) {
      ensurePdfSpace(doc, 40);
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#071a36").text(title);
      doc.moveDown(0.2);
      doc
        .strokeColor("#dbe5f0")
        .lineWidth(1)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(pageWidth - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.5);
    }

    function infoBox(title, rows = []) {
      ensurePdfSpace(doc, 70 + rows.length * 12);

      const x = doc.page.margins.left;
      const y = doc.y;
      const boxHeight = 34 + rows.length * 16 + 14;

      doc.roundedRect(x, y, contentWidth, boxHeight, 12).fillAndStroke("#f8fafc", "#e5ebf3");
      doc.fillColor("#071a36").font("Helvetica-Bold").fontSize(11).text(title, x + 14, y + 12);

      let rowY = y + 32;
      rows.forEach((row) => {
        doc.fillColor("#334155").font("Helvetica").fontSize(9.8).text(row, x + 14, rowY, {
          width: contentWidth - 28
        });
        rowY += 16;
      });

      doc.y = y + boxHeight + 12;
    }

    function itemCard(title, lines = [], price = "") {
      ensurePdfSpace(doc, 68);

      const x = doc.page.margins.left;
      const y = doc.y;
      const height = 26 + Math.max(lines.length, 1) * 14 + 18;

      doc.roundedRect(x, y, contentWidth, height, 10).fillAndStroke("#ffffff", "#e8edf4");

      doc.fillColor("#071a36").font("Helvetica-Bold").fontSize(10.8).text(title, x + 14, y + 12, {
        width: contentWidth - 140
      });

      let textY = y + 28;
      lines.forEach((line) => {
        doc.fillColor("#64748b").font("Helvetica").fontSize(9.2).text(line, x + 14, textY, {
          width: contentWidth - 150
        });
        textY += 14;
      });

      doc.fillColor("#64748b").font("Helvetica").fontSize(8.8).text("Precio total", x + contentWidth - 100, y + 12, {
        width: 80,
        align: "right"
      });

      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11.5).text(price, x + contentWidth - 100, y + 26, {
        width: 80,
        align: "right"
      });

      doc.y = y + height + 10;
    }

    doc.rect(0, 0, pageWidth, 110).fill("#071a36");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(24).text("Cotización estimada de mudanza", 36, 34);
    doc.fillColor("#dbeafe").font("Helvetica").fontSize(11).text(
      "Resumen detallado del servicio cotizado en A-Mudar",
      36,
      68
    );

    doc.y = 128;

    sectionTitle("Resumen general");
    infoBox("Datos principales", [
      `Cliente: ${customer.fullName || "—"}`,
      `Correo: ${customer.email || "—"}`,
      `Teléfono: ${customer.phone || "—"}`,
      `Fecha programada: ${state.fechaMudanzaLabel || "—"}`,
      `Ruta: ${state.tipoRuta || "—"} · ${state.distanciaKm || "—"} km`,
      `Origen: ${state.origenDireccion || "—"}`,
      `Destino: ${state.destinoDireccion || "—"}`
    ]);

    infoBox("Tarifa aplicada", [
      `Tipo de mudanza: ${state.tipoMudanza || "—"}`,
      `Tarifa aplicada: ${state.tarifaAplicadaLabel || "—"}`,
      `Precio por km: ${state.precioKmAplicado ? money(state.precioKmAplicado) : "—"}`,
      `Descuento aplicado: ${state.descuentoAplicadoPct ? `${state.descuentoAplicadoPct}%` : "0%"}`,
      `Tiempo estimado del servicio: ${state.tiempoEstimadoServicio || "—"}`,
      `Desea bodegaje: ${state.deseaBodegaje === true ? "Sí" : state.deseaBodegaje === false ? "No" : "—"}`,
      `Días de bodegaje: ${state.diasBodegaje || "—"}`
    ]);

    infoBox("Totales de la cotización", [
      `Precio base por ruta: ${money(state.precioBase)}`,
      `Total objetos especiales origen: ${money(totalEspecialesOrigenPrice)}`,
      `Total objetos especiales destino: ${money(totalEspecialesDestinoPrice)}`,
      `Total items generales: ${money(totalItemsPrice)}`,
      `Total estimado: ${money(state.precioFinal)}`
    ]);

    infoBox("Información adicional", [
      `Delicados: ${state.delicados === true ? "Sí" : state.delicados === false ? "No" : "—"}`,
      `Descripción delicados: ${state.delicados === true ? (state.delicadosDescripcion || "—") : "—"}`
    ]);

    sectionTitle("Objetos con carga especial · Origen");
    infoBox("Resumen origen", [
      `Pisos: ${o.pisos ?? "—"}`,
      `Ascensor: ${o.hayAscensor ? "Sí" : o.hayAscensor === false ? "No" : "—"}`,
      `Especiales: ${origenEspeciales.length}`,
      `Camión < 40m: ${
        o.camionMenos40m === true
          ? "Sí"
          : o.camionMenos40m === false
            ? `No (${Number(o.metrosExtra || 0)} m extra)`
            : "—"
      }`,
      `Recargo camión: ${money(totals.oCamionPrice || 0)}`,
      `m³ especiales origen: ${totalEspecialesOrigenM3.toFixed(2)}`,
      `Total especiales origen: ${money(totalEspecialesOrigenPrice)}`
    ]);

    if (!origenEspeciales.length) {
      infoBox("Detalle origen", ["No se registraron objetos especiales en el origen."]);
    } else {
      origenEspeciales.forEach((it) => {
        itemCard(
          it.name || "Objeto especial",
          [
            `Método: ${metodoLabel(it.metodo)}`,
            `Cantidad: ${Number(it.qty || 0)}x`,
            `Volumen: ${Number(it.m3Total || 0).toFixed(2)} m³`
          ],
          money(it.price || 0)
        );
      });
    }

    sectionTitle("Objetos con carga especial · Destino");
    infoBox("Resumen destino", [
      `Pisos: ${d.pisos ?? "—"}`,
      `Ascensor: ${d.hayAscensor ? "Sí" : d.hayAscensor === false ? "No" : "—"}`,
      `Especiales: ${destinoEspeciales.length}`,
      `Camión < 40m: ${
        d.camionMenos40m === true
          ? "Sí"
          : d.camionMenos40m === false
            ? `No (${Number(d.metrosExtra || 0)} m extra)`
            : "—"
      }`,
      `Recargo camión: ${money(totals.dCamionPrice || 0)}`,
      `m³ especiales destino: ${totalEspecialesDestinoM3.toFixed(2)}`,
      `Total especiales destino: ${money(totalEspecialesDestinoPrice)}`
    ]);

    if (!destinoEspeciales.length) {
      infoBox("Detalle destino", ["No se registraron objetos especiales en el destino."]);
    } else {
      destinoEspeciales.forEach((it) => {
        itemCard(
          it.name || "Objeto especial",
          [
            `Método: ${metodoLabel(it.metodo)}`,
            `Cantidad: ${Number(it.qty || 0)}x`,
            `Volumen: ${Number(it.m3Total || 0).toFixed(2)} m³`
          ],
          money(it.price || 0)
        );
      });
    }

    sectionTitle("Items generales de la mudanza");
    infoBox("Resumen items generales", [
      `Items: ${items.length}`,
      `Total m³ items: ${totalItemsM3.toFixed(2)}`,
      `Total items generales: ${money(totalItemsPrice)}`,
      `Recargo escalera origen incluido: ${money(totals.itemsRecargoOrigen || 0)}`,
      `Recargo escalera destino incluido: ${money(totals.itemsRecargoDestino || 0)}`
    ]);

    if (!items.length) {
      infoBox("Detalle items generales", ["No se registraron items generales de mudanza."]);
    } else {
      items.forEach((it) => {
        itemCard(
          it.name || "Item",
          [
            `Cantidad: ${Number(it.qty || 0)}x`,
            `Volumen: ${Number(it.m3Total || 0).toFixed(2)} m³`,
            `Este valor ya incluye recargos aplicables por escalera`
          ],
          money(it.price || 0)
        );
      });
    }

    ensurePdfSpace(doc, 80);
    const noteY = doc.y + 4;

    doc.roundedRect(doc.page.margins.left, noteY, contentWidth, 62, 12).fillAndStroke("#fffdf7", "#f6e7b8");
    doc.fillColor("#7a5d00").font("Helvetica").fontSize(10).text(
      "Esta cotización es estimada y puede ajustarse según validación operativa, accesos reales, volumen final y condiciones del servicio.",
      doc.page.margins.left + 14,
      noteY + 18,
      { width: contentWidth - 28 }
    );

    doc.end();
  });
}

app.post("/api/quote-start", async (req, res) => {
  try {
    const { customer, quoteSessionId } = req.body || {};

    if (!customer?.fullName || !customer?.email || !customer?.phone) {
      return res.status(400).json({ ok: false, error: "Faltan datos del cliente." });
    }

    res.json({ ok: true });

    sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Cotización iniciada por ${customer.fullName}`,
      html: buildAdminStartEmailHTML({ customer, quoteSessionId }),
      text: buildAdminStartEmailText({ customer, quoteSessionId })
    }).catch((error) => {
      console.error("QUOTE START EMAIL ERROR:", error);
    });
  } catch (error) {
    console.error("Error en /api/quote-start:", error);
    return res.status(500).json({ ok: false, error: "No se pudo notificar el inicio de la cotización." });
  }
});

app.post("/api/quote-abandon", async (req, res) => {
  try {
    const { customer, quoteSessionId, state } = req.body || {};

    if (!customer?.fullName || !customer?.email || !customer?.phone) {
      return res.status(400).json({ ok: false, error: "Faltan datos del cliente." });
    }

    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Cotización incompleta: ${customer.fullName}`,
      html: buildAdminAbandonEmailHTML({ customer, quoteSessionId, state }),
      text: buildAdminAbandonEmailText({ customer, quoteSessionId, state })
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Error en /api/quote-abandon:", error);
    return res.status(500).json({ ok: false, error: "No se pudo notificar el abandono de la cotización." });
  }
});

app.post("/api/quote-submit", async (req, res) => {
  try {
    const payload = req.body || {};
    const customer = payload.customer || {};

    if (!customer.email || !customer.fullName || !customer.phone) {
      return res.status(400).json({ ok: false, error: "Faltan datos del cliente." });
    }

    const pdfBuffer = await buildQuotePdfBuffer(payload);
    const safeName = (customer.fullName || "cliente")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");

    const attachment = {
      filename: `cotizacion-${safeName || "cliente"}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf"
    };

    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Nueva cotización completada por ${customer.fullName}`,
      html: buildAdminFinalEmailHTML(customer),
      text: buildAdminFinalEmailText(customer),
      attachments: [attachment]
    });

    await sendEmail({
      to: customer.email,
      subject: "Tu cotización ha sido completada - A-Mudar",
      html: buildClientFinalEmailHTML(customer),
      text: buildClientFinalEmailText(customer),
      attachments: [attachment]
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Error enviando cotización:", error);
    return res.status(500).json({ ok: false, error: "No se pudo enviar la cotización." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${port}`);
});