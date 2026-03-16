import { state } from "./state.js";
import {
  calcularPrecioBase,
  recalcAll,
  upsertEspecial,
  removeEspecial,
  upsertItemMudanza,
  removeItemMudanza
} from "./calculator.js";
import { loadCatalog } from "./items.js";
import { getCtxObj, money } from "./utils.js";
import { TARIFAS } from "./config.js";
import {
  waitForGoogleMaps,
  createSingleMap,
  setMapLocation,
  initSingleAutocomplete,
  reverseGeocodeLatLng,
  calculateRouteDistance
} from "./maps.js";

const frameRoot = document.getElementById("frame-root");
const BOGOTA_TZ = "America/Bogota";

/* =========================================================
   SESSION / DATE HELPERS
========================================================= */

function generateSessionId() {
  return `quote_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

if (!state.quoteSessionId) {
  state.quoteSessionId = generateSessionId();
}

function getBogotaTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function parseISODateOnly(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatBogotaDateLabel(iso) {
  const date = parseISODateOnly(iso);
  if (!date) return "—";

  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function isMudanzaDentroDeLaMismaSemana(iso) {
  const todayIso = getBogotaTodayISO();
  const today = parseISODateOnly(todayIso);
  const target = parseISODateOnly(iso);

  if (!today || !target) return false;
  if (target < today) return false;

  const dayIndex = (today.getUTCDay() + 6) % 7;
  const endOfWeek = new Date(today);
  endOfWeek.setUTCDate(today.getUTCDate() + (6 - dayIndex));

  return target <= endOfWeek;
}

function updateFechaMudanzaMeta() {
  state.fechaMudanzaLabel = state.fechaMudanzaISO
    ? formatBogotaDateLabel(state.fechaMudanzaISO)
    : "";

  state.fechaMudanzaEsMismaSemana = state.fechaMudanzaISO
    ? isMudanzaDentroDeLaMismaSemana(state.fechaMudanzaISO)
    : false;
}

/* =========================================================
   REGLA MÍNIMO SERVICIO TOTAL
========================================================= */

function clearAutoSharedFlag() {
  state.autoSharedApplied = false;
  state.autoSharedMessage = "";
}

function resetQuoteState() {
  state.step = "step0-contacto";

  state.quoteSessionId = generateSessionId();

  state.notifications = {
    startedSent: false,
    abandonedSent: false,
    completed: false
  };

  state.customer = {
    fullName: "",
    email: "",
    phone: ""
  };

  state.servicio = null;
  state.servicioPersonalizado = false;
  state.servicioPersonalizadoDescripcion = "";

  state.fechaMudanzaISO = "";
  state.fechaMudanzaLabel = "";
  state.fechaMudanzaEsMismaSemana = false;

  state.tipoRuta = null;
  state.distanciaKm = 0;
  state.tipoMudanza = null;
  state.inmuebleOrigen = null;

  state.precioBase = 0;
  state.precioFinal = 0;

  state.tarifaAplicadaLabel = "";
  state.precioKmAplicado = 0;
  state.descuentoAplicadoPct = 0;
  state.tiempoEstimadoServicio = "";

  state.direccionFase = "origen";

  state.origenDireccion = "";
  state.destinoDireccion = "";
  state.origenPlaceId = "";
  state.destinoPlaceId = "";

  state.origenLatLng = null;
  state.destinoLatLng = null;

  state.routeDistanceMeters = 0;
  state.routeDistanceText = "";
  state.routeDurationText = "";

  state.accessContext = "origen";

  state.delicados = null;
  state.delicadosDescripcion = "";

  state.itemsMudanza = [];

  state.deseaBodegaje = null;
  state.diasBodegaje = 0;

  state.autoSharedApplied = false;
  state.autoSharedMessage = "";

  state.origen = {
    inmueble: null,
    pisos: 1,
    hayAscensor: null,
    noCabe: null,
    descripcion: "",
    especiales: [],
    camionMenos40m: null,
    metrosExtra: 0
  };

  state.destino = {
    inmueble: null,
    pisos: 1,
    hayAscensor: null,
    noCabe: null,
    descripcion: "",
    especiales: [],
    camionMenos40m: null,
    metrosExtra: 0
  };
}

function validateMinimumServiceForCompleta() {
  const minimo = Number(TARIFAS.MINIMO_SERVICIO_TOTAL || 0);

  if (!minimo) {
    clearAutoSharedFlag();
    return false;
  }

  recalcAll();

  if (state.tipoMudanza !== "completa") {
    clearAutoSharedFlag();
    return false;
  }

  if (Number(state.precioFinal || 0) >= minimo) {
    clearAutoSharedFlag();
    return false;
  }

  state.tipoMudanza = "compartida";
  calcularPrecioBase();

  state.autoSharedApplied = true;
  state.autoSharedMessage =
    `Se ha aplicado mudanza compartida y se han reajustado las tarifas, ` +
    `porque el total estimado no alcanza el mínimo de ${money(minimo)} para conservar el servicio completo.`;

  return true;
}

/* =========================================================
   API HELPERS
========================================================= */

async function postJSON(url, payload, useBeacon = false) {
  if (useBeacon && navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json"
    });
    const sent = navigator.sendBeacon(url, blob);
    return { ok: sent };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || "Error en la petición.");
  }

  return data;
}

async function notifyQuoteStarted() {
  if (state.notifications.startedSent) return;

  const payload = {
    quoteSessionId: state.quoteSessionId,
    customer: state.customer
  };

  await postJSON("/api/quote-start", payload);
  state.notifications.startedSent = true;
}

function notifyQuoteAbandoned() {
  if (!state.notifications.startedSent) return;
  if (state.notifications.completed) return;
  if (state.notifications.abandonedSent) return;

  const payload = {
    quoteSessionId: state.quoteSessionId,
    customer: state.customer,
    state: {
      step: state.step,
      servicio: state.servicio,
      servicioPersonalizado: state.servicioPersonalizado,
      servicioPersonalizadoDescripcion: state.servicioPersonalizadoDescripcion,
      autoSharedApplied: state.autoSharedApplied,
      autoSharedMessage: state.autoSharedMessage,
      fechaMudanzaISO: state.fechaMudanzaISO,
      fechaMudanzaLabel: state.fechaMudanzaLabel,
      fechaMudanzaEsMismaSemana: state.fechaMudanzaEsMismaSemana,
      tipoRuta: state.tipoRuta,
      tipoMudanza: state.tipoMudanza,
      tarifaAplicadaLabel: state.tarifaAplicadaLabel,
      precioKmAplicado: state.precioKmAplicado,
      descuentoAplicadoPct: state.descuentoAplicadoPct,
      tiempoEstimadoServicio: state.tiempoEstimadoServicio,
      deseaBodegaje: state.deseaBodegaje,
      diasBodegaje: state.diasBodegaje,
      origenDireccion: state.origenDireccion,
      destinoDireccion: state.destinoDireccion,
      distanciaKm: state.distanciaKm
    }
  };

  try {
    postJSON("/api/quote-abandon", payload, true);
    state.notifications.abandonedSent = true;
  } catch (err) {
    console.error("No se pudo enviar abandono:", err);
  }
}

window.addEventListener("pagehide", () => {
  notifyQuoteAbandoned();
});

window.addEventListener("beforeunload", () => {
  notifyQuoteAbandoned();
});

/* =========================================================
   FRAME LOADING
========================================================= */

async function loadFrame(stepFile) {
  const res = await fetch(`./frames/${stepFile}.html`, { cache: "no-store" });
  if (!res.ok) {
    frameRoot.innerHTML = `
      <div>
        <h2 class="cf-title">Error cargando frame</h2>
        <p class="cf-subtitle">No se encontró: <b>${stepFile}.html</b></p>
      </div>
    `;
    throw new Error(`No se pudo cargar frame: ${stepFile}.html`);
  }

  const html = await res.text();
  frameRoot.innerHTML = html;
  applyCtxTexts();
  injectAdvisorCTA();
}

function applyCtxTexts() {
  const t = frameRoot.querySelector("[data-ctx-title]");
  if (t) {
    const label = state.accessContext === "origen" ? "ORIGEN" : "DESTINO";
    t.textContent = `${t.textContent} (${label})`;
  }
}

function injectAdvisorCTA() {
  if (!frameRoot) return;

  const existing = frameRoot.querySelector(".cf-frame-actions");
  if (existing) existing.remove();

  const wrapper = document.createElement("div");
  wrapper.className = "cf-frame-actions";

  const link = document.createElement("a");
  link.className = "cf-advisor-btn";
  link.href =
    "https://wa.me/573235834378?text=Quiero%20cotizar%20con%20ustedes%20r%C3%A1pidamente";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Hablar con el asesor";

  const note = document.createElement("div");
  note.className = "cf-advisor-note";
  note.textContent =
    "Si prefieres, te atendemos por WhatsApp sin completar el formulario.";

  wrapper.appendChild(link);
  wrapper.appendChild(note);
  frameRoot.appendChild(wrapper);
}

function renderSummary() {
  const kmEl = document.getElementById("sum-km");
  const rutaEl = document.getElementById("sum-ruta");
  const precioEl = document.getElementById("sum-precio");

  if (kmEl) kmEl.textContent = state.distanciaKm ? `${state.distanciaKm} km` : "—";
  if (rutaEl) rutaEl.textContent = state.tipoRuta ? state.tipoRuta : "—";
  if (precioEl) precioEl.textContent = state.precioFinal ? money(state.precioFinal) : "—";
}

async function go(stepFile) {
  state.step = stepFile;
  await loadFrame(stepFile);
  renderSummary();

  if (stepFile === "step0-contacto") initContactoUI();
  if (stepFile === "step1-servicio") initServicioUI();
  if (stepFile === "step1b-fecha-mudanza") initFechaMudanzaUI();
  if (stepFile === "step3-direcciones") await initDireccionesUI();
  if (stepFile === "step4-tipo-mudanza") initTipoMudanzaUI();
  if (stepFile === "step10-objetos") await initEspecialesUI();
  if (stepFile === "step15-items-mudanza") await initItemsMudanzaUI();
  if (stepFile === "step15b-bodegaje") initBodegajeUI();
  if (stepFile === "step16-fin") renderFinal();
}

function initContactoUI() {
  const nameEl = document.getElementById("contact-name");
  const emailEl = document.getElementById("contact-email");
  const phoneEl = document.getElementById("contact-phone");

  if (nameEl) nameEl.value = state.customer.fullName || "";
  if (emailEl) emailEl.value = state.customer.email || "";
  if (phoneEl) phoneEl.value = state.customer.phone || "";
}

function initServicioUI() {
  const mudanzaBtn = document.getElementById("servicio-mudanza-btn");
  const continueBtn = document.getElementById("step1-continue");
  const customCheck = document.getElementById("custom-service-check");
  const customWrap = document.getElementById("custom-service-wrap");
  const customText = document.getElementById("custom-service-text");

  if (!mudanzaBtn || !continueBtn || !customCheck || !customWrap || !customText) return;

  function renderServicioSelection() {
    const selected = state.servicio === "mudanza";

    mudanzaBtn.style.opacity = "1";
    mudanzaBtn.style.background = selected ? "#16a34a" : "#071a36";
    mudanzaBtn.style.borderColor = selected ? "#15803d" : "#071a36";
    mudanzaBtn.style.color = "#ffffff";
    mudanzaBtn.style.boxShadow = selected
      ? "0 0 0 3px rgba(22, 163, 74, 0.18)"
      : "";
    mudanzaBtn.textContent = selected ? "✅ Mudanza seleccionada" : "🚚 Mudanza";

    customCheck.checked = state.servicioPersonalizado === true;
    customWrap.style.display = state.servicioPersonalizado === true ? "block" : "none";
    customText.value = state.servicioPersonalizadoDescripcion || "";
  }

  mudanzaBtn.addEventListener("click", () => {
    state.servicio = "mudanza";
    renderServicioSelection();
  });

  customCheck.addEventListener("change", () => {
    state.servicioPersonalizado = customCheck.checked;

    if (!customCheck.checked) {
      state.servicioPersonalizadoDescripcion = "";
      customText.value = "";
    }

    renderServicioSelection();
  });

  customText.addEventListener("input", () => {
    state.servicioPersonalizadoDescripcion = customText.value.trim();
  });

  continueBtn.addEventListener("click", async () => {
    if (!state.servicio) {
      alert("Por favor selecciona el servicio que deseas cotizar.");
      return;
    }

    if (state.servicioPersonalizado === true) {
      const desc = customText.value.trim();
      if (!desc) {
        alert("Por favor describe el servicio personalizado.");
        return;
      }
      state.servicioPersonalizadoDescripcion = desc;
    } else {
      state.servicioPersonalizadoDescripcion = "";
    }

    await go("step1b-fecha-mudanza");
  });

  renderServicioSelection();
}

function initFechaMudanzaUI() {
  const input = document.getElementById("fecha-mudanza-input");
  const note = document.getElementById("fecha-mudanza-note");
  const continueBtn = document.getElementById("fecha-mudanza-continue");

  if (!input || !note || !continueBtn) return;

  const todayIso = getBogotaTodayISO();
  input.min = todayIso;
  input.value = state.fechaMudanzaISO || "";

  const showError = (msg) => {
    note.className = "cf-note error";
    note.textContent = msg;
  };

  const showNormalNote = () => {
    const iso = input.value?.trim();

    if (!iso) {
      note.className = "cf-note";
      note.innerHTML = `Puedes elegir desde hoy en adelante.`;
      return;
    }

    const label = formatBogotaDateLabel(iso);
    const mismaSemana = isMudanzaDentroDeLaMismaSemana(iso);

    note.className = "cf-note";
    note.innerHTML = `
      <b>Fecha seleccionada:</b> ${escapeHTML(label)}<br>
      ${mismaSemana
        ? `Si luego eliges <b>mudanza compartida</b>, esta fecha podría aplicar <b>tarifa agresiva</b>.`
        : `Si luego eliges <b>mudanza compartida</b>, aplicará la <b>tarifa compartida normal</b>.`
      }
    `;
  };

  input.addEventListener("input", showNormalNote);
  showNormalNote();

  continueBtn.addEventListener("click", async () => {
    const iso = input.value?.trim();

    if (!iso) {
      showError("Por favor ingresa una fecha.");
      return;
    }

    if (iso < todayIso) {
      showError("La fecha de la mudanza debe ser hoy o una fecha futura.");
      return;
    }

    state.fechaMudanzaISO = iso;
    updateFechaMudanzaMeta();

    if (state.tipoMudanza) {
      calcularPrecioBase();
    }

    await go("step2-tipo-ruta");
  });
}

function initTipoMudanzaUI() {
  const minNote = document.getElementById("mudanza-minimo-note");
  const fechaInfo = document.getElementById("mudanza-fecha-info");
  const tarifaNote = document.getElementById("mudanza-tarifa-note");

  if (minNote) {
    minNote.innerHTML = `
      <b>Importante:</b> Para conservar el servicio de <b>mudanza completa</b>,
      el valor total estimado debe ser mínimo de <b>${money(TARIFAS.MINIMO_SERVICIO_TOTAL)}</b>.
      Si al avanzar la cotización el total queda por debajo de ese valor,
      se aplicará automáticamente la modalidad <b>mudanza compartida</b> y se reajustarán las tarifas.
    `;
  }

  if (fechaInfo) {
    fechaInfo.innerHTML = `
      <b>Fecha programada:</b> ${escapeHTML(state.fechaMudanzaLabel || "—")}
    `;
  }

  if (tarifaNote) {
    const rutaTxt =
      state.tipoRuta === "urbano"
        ? "urbana"
        : state.tipoRuta === "nacional"
          ? "nacional"
          : "seleccionada";

    tarifaNote.innerHTML = state.fechaMudanzaEsMismaSemana
      ? `Si eliges <b>mudanza compartida</b>, para esta fecha podría aplicar <b>tarifa agresiva ${escapeHTML(
        rutaTxt
      )}</b>.`
      : `Si eliges <b>mudanza compartida</b>, para esta fecha aplicará <b>tarifa compartida normal ${escapeHTML(
        rutaTxt
      )}</b>.`;
  }
}

function ctx() {
  return getCtxObj(state);
}

function ctxName() {
  return state.accessContext;
}

async function submitQuoteNotifications() {
  const o = state.origen;
  const d = state.destino;

  const calcCamionSurcharge = (ctxObj) => {
    if (ctxObj.camionMenos40m === true) return 0;
    if (ctxObj.camionMenos40m === false) {
      const extra = Math.max(Number(ctxObj.metrosExtra || 0), 0);
      const bloques20 = Math.ceil(extra / 20);
      return bloques20 * TARIFAS.RECARGOS.POR_20M_ADICIONAL;
    }
    return 0;
  };

  const calcItemsEscaleraRecargo = (ctxObj, totalItemsM3) => {
    if (ctxObj?.hayAscensor !== false) return 0;
    const pisos = Math.max(Number(ctxObj?.pisos || 1), 1);
    const pisosCobrar = Math.max(pisos - 1, 0);
    if (pisosCobrar <= 0) return 0;
    return totalItemsM3 * pisosCobrar * TARIFAS.RECARGOS.POR_PISO_ESCALERA;
  };

  const oEspeciales = o.especiales || [];
  const dEspeciales = d.especiales || [];
  const items = state.itemsMudanza || [];

  const totalEspecialesOrigenM3 = oEspeciales.reduce(
    (acc, it) => acc + Number(it.m3Total || 0),
    0
  );
  const totalEspecialesDestinoM3 = dEspeciales.reduce(
    (acc, it) => acc + Number(it.m3Total || 0),
    0
  );
  const totalItemsM3 = items.reduce((acc, it) => acc + Number(it.m3Total || 0), 0);

  const payload = {
    quoteSessionId: state.quoteSessionId,
    customer: state.customer,
    state,
    totals: {
      cubicajeTotal: totalEspecialesOrigenM3 + totalEspecialesDestinoM3 + totalItemsM3,
      itemsRecargoOrigen: calcItemsEscaleraRecargo(o, totalItemsM3),
      itemsRecargoDestino: calcItemsEscaleraRecargo(d, totalItemsM3),
      oCamionPrice: calcCamionSurcharge(o),
      dCamionPrice: calcCamionSurcharge(d)
    },
    origenEspeciales: oEspeciales.map((it) => ({
      ...it,
      price: calcEspecialPrice(o, it)
    })),
    destinoEspeciales: dEspeciales.map((it) => ({
      ...it,
      price: calcEspecialPrice(d, it)
    })),
    items: items.map((it) => ({
      ...it,
      price: calcItemPrice(it)
    }))
  };

  const data = await postJSON("/api/quote-submit", payload);
  state.notifications.completed = true;
  return data;
}

/* =========================================================
   STEP 3: DIRECCIONES + GOOGLE MAPS
========================================================= */

async function initDireccionesUI() {
  const phaseRoot = document.getElementById("direccion-step-phase");
  const statusEl = document.getElementById("route-status");
  const previewEl = document.getElementById("route-preview");
  const continueBtn = document.getElementById("km-continue");

  if (!phaseRoot || !statusEl || !previewEl || !continueBtn) return;

  function showStatus(message, type = "info") {
    statusEl.className = `cf-status ${type}`;
    statusEl.textContent = message;
  }

  function showPreview(html, type = "success") {
    previewEl.className = `cf-route-preview ${type}`;
    previewEl.innerHTML = html;
  }

  function resetPreview() {
    previewEl.className = "cf-route-preview";
    previewEl.innerHTML = "";
  }

  continueBtn.style.display = state.distanciaKm > 0 ? "block" : "none";

  async function renderPhase() {
    resetPreview();

    const isOrigen = state.direccionFase === "origen";
    const currentTitle = isOrigen ? "Origen" : "Destino";
    const currentInputId = "direccion-fase-input";
    const currentMapId = "direccion-fase-map";
    const currentValue = isOrigen
      ? state.origenDireccion || ""
      : state.destinoDireccion || "";

    phaseRoot.innerHTML = `
      <div class="cf-step-card">
        <div class="cf-step-chip">Paso ${isOrigen ? "1" : "2"} de 2</div>

        <h3 class="cf-step-heading">
          ${isOrigen ? "Selecciona el punto de origen" : "Selecciona el punto de destino"}
        </h3>

        <p class="cf-step-copy">
          ${isOrigen
        ? "Escribe la dirección, elige una sugerencia o haz clic directamente sobre el mapa para fijar el origen."
        : "Ahora define el destino. Puedes escribir la dirección, elegir una sugerencia o marcar el punto en el mapa."
      }
        </p>

        <div id="${currentMapId}" class="cf-map"></div>

        <div class="cf-inline-help">
          ${isOrigen
        ? "Consejo: selecciona una sugerencia o un punto exacto en el mapa para mejorar la precisión."
        : "Cuando el destino esté fijado, calcularemos automáticamente la distancia de la ruta."
      }
        </div>

        <input
          id="${currentInputId}"
          class="cf-input"
          type="text"
          placeholder="Escribe la dirección de ${currentTitle.toLowerCase()}"
          autocomplete="off"
          value="${escapeHTML(currentValue)}"
        />

        <button class="cf-btn" id="fase-save-btn">
          ${isOrigen ? "Continuar a destino" : "Calcular distancia"}
        </button>
      </div>
    `;

    showStatus(
      isOrigen
        ? "Marca el punto de origen en el mapa o escribe la dirección para continuar."
        : "Ahora define el destino. Cuando quede fijado, calcularemos la ruta automáticamente.",
      "info"
    );

    const input = document.getElementById(currentInputId);
    const saveBtn = document.getElementById("fase-save-btn");

    await waitForGoogleMaps();

    const fallbackCenter = isOrigen
      ? state.origenLatLng || { lat: 4.711, lng: -74.0721 }
      : state.destinoLatLng || state.origenLatLng || { lat: 4.711, lng: -74.0721 };

    const mapRef = await createSingleMap(currentMapId, fallbackCenter);

    if (isOrigen && state.origenLatLng) {
      setMapLocation({
        map: mapRef.map,
        marker: mapRef.marker,
        latLng: state.origenLatLng
      });
    }

    if (!isOrigen && state.destinoLatLng) {
      setMapLocation({
        map: mapRef.map,
        marker: mapRef.marker,
        latLng: state.destinoLatLng
      });
    }

    await initSingleAutocomplete({
      inputId: currentInputId,
      onSelected: (place) => {
        const formatted = place?.formatted_address || input.value.trim() || "";
        const placeId = place?.place_id || "";
        const latLng = place?.geometry?.location
          ? {
            lat: Number(place.geometry.location.lat()),
            lng: Number(place.geometry.location.lng())
          }
          : null;

        input.value = formatted;

        if (isOrigen) {
          state.origenDireccion = formatted;
          state.origenPlaceId = placeId;
          state.origenLatLng = latLng;
        } else {
          state.destinoDireccion = formatted;
          state.destinoPlaceId = placeId;
          state.destinoLatLng = latLng;
        }

        setMapLocation({
          map: mapRef.map,
          marker: mapRef.marker,
          place
        });

        showStatus(
          `Dirección de ${currentTitle.toLowerCase()} seleccionada correctamente.`,
          "success"
        );
      }
    });

    mapRef.map.addListener("click", async (event) => {
      try {
        const latLng = {
          lat: Number(event.latLng.lat()),
          lng: Number(event.latLng.lng())
        };

        setMapLocation({
          map: mapRef.map,
          marker: mapRef.marker,
          latLng
        });

        showStatus(
          `Buscando dirección para el punto seleccionado en ${currentTitle.toLowerCase()}...`,
          "info"
        );

        const geo = await reverseGeocodeLatLng(latLng);
        input.value = geo.address;

        if (isOrigen) {
          state.origenDireccion = geo.address;
          state.origenPlaceId = geo.placeId;
          state.origenLatLng = geo.latLng;
        } else {
          state.destinoDireccion = geo.address;
          state.destinoPlaceId = geo.placeId;
          state.destinoLatLng = geo.latLng;
        }

        showStatus(
          `Punto de ${currentTitle.toLowerCase()} seleccionado desde el mapa.`,
          "success"
        );
      } catch (err) {
        console.error(err);
        showStatus(
          `No se pudo obtener la dirección desde el mapa: ${err.message}`,
          "error"
        );
      }
    });

    saveBtn.addEventListener("click", async () => {
      const typedValue = input.value.trim();

      if (!typedValue) {
        showStatus(
          `Debes ingresar o seleccionar una dirección de ${currentTitle.toLowerCase()}.`,
          "error"
        );
        return;
      }

      if (isOrigen) {
        state.origenDireccion = typedValue;

        if (!state.origenLatLng && !state.origenPlaceId) {
          showStatus(
            "Selecciona una sugerencia o haz clic en el mapa para fijar el origen.",
            "error"
          );
          return;
        }

        state.direccionFase = "destino";
        await renderPhase();
        return;
      }

      state.destinoDireccion = typedValue;

      if (!state.destinoLatLng && !state.destinoPlaceId) {
        showStatus(
          "Selecciona una sugerencia o haz clic en el mapa para fijar el destino.",
          "error"
        );
        return;
      }

      try {
        saveBtn.disabled = true;
        saveBtn.textContent = "Calculando...";

        showStatus("Calculando ruta y distancia...", "info");

        const routeData = await calculateRouteDistance({
          originPlaceId: state.origenPlaceId,
          destinationPlaceId: state.destinoPlaceId,
          originAddress: state.origenDireccion,
          destinationAddress: state.destinoDireccion,
          originLatLng: state.origenLatLng,
          destinationLatLng: state.destinoLatLng
        });

        state.routeDistanceMeters = routeData.distanceMeters;
        state.routeDistanceText = routeData.distanceText;
        state.routeDurationText = routeData.durationText;
        state.distanciaKm = routeData.distanceKm;

        renderSummary();

        showPreview(
          `
          <b>Ruta calculada correctamente</b><br>
          Origen: ${escapeHTML(state.origenDireccion || "—")}<br>
          Destino: ${escapeHTML(state.destinoDireccion || "—")}<br>
          Distancia: <b>${escapeHTML(routeData.distanceText)}</b><br>
          Distancia usada para la cotización: <b>${routeData.distanceKm} km</b>
          ${routeData.durationText
            ? `<br>Duración estimada: <b>${escapeHTML(routeData.durationText)}</b>`
            : ""
          }
        `,
          "success"
        );

        showStatus("La distancia quedó lista para el cálculo del precio.", "success");
        continueBtn.style.display = "block";
      } catch (err) {
        console.error(err);
        state.routeDistanceMeters = 0;
        state.routeDistanceText = "";
        state.routeDurationText = "";
        state.distanciaKm = 0;
        renderSummary();

        showStatus(`No fue posible calcular la ruta: ${err.message}`, "error");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Calcular distancia";
      }
    });
  }

  await renderPhase();
}

/* =========================================================
   STEP 10: ESPECIALES
========================================================= */

async function initEspecialesUI() {
  const catalog = await loadCatalog();
  const grouped = catalog.grouped;

  const root = document.getElementById("catalog-root");
  const searchInput = document.getElementById("catalog-search");
  if (!root) return;

  root.classList.add("catalog");
  root.innerHTML = renderCatalogHTML(grouped, "");

  refreshEspecialesUI();
  initCustomEspecialUI();
  initEspecialesListUI();

  if (searchInput) {
    searchInput.value = "";
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      root.innerHTML = renderCatalogHTML(grouped, term);
    });
  }

  root.addEventListener("click", (e) => {
    const btn = e.target;
    if (!btn?.dataset) return;

    if (btn.dataset.action === "inc" || btn.dataset.action === "dec") {
      const key = btn.dataset.key;
      const unitM3 = Number(btn.dataset.unitm3 || 0);
      const label = btn.dataset.label || "Item";

      const currentQty = getQtyEspecial(key);
      const nextQty =
        btn.dataset.action === "inc" ? currentQty + 1 : Math.max(currentQty - 1, 0);

      if (nextQty <= 0) {
        removeEspecial(ctxName(), key);
      } else {
        const existing = findEspecial(key);
        const defaultMetodo = ctx().hayAscensor === false ? "escalera" : null;
        const metodo = existing ? existing.metodo : defaultMetodo;

        upsertEspecial(ctxName(), {
          key,
          name: label,
          qty: nextQty,
          unitM3,
          m3Total: unitM3 * nextQty,
          metodo
        });
      }

      updateCatalogQtyUI(root, key, nextQty);
      recalcAll();
      refreshEspecialesUI();
      renderSummary();
      hideMetodoWarningIfOk();
    }
  });

  const cont = document.getElementById("objetos-continue");
  if (cont) {
    cont.addEventListener("click", async () => {
      if (!allEspecialesHaveMetodo()) {
        showMetodoWarning();
        return;
      }
      await go("step11-camion-40m");
    });
  }
}

function allEspecialesHaveMetodo() {
  const especiales = ctx().especiales || [];
  if (!especiales.length) return true;
  return especiales.every((it) => !!it.metodo);
}

function showMetodoWarning() {
  const w = document.getElementById("metodo-warning");
  if (w) {
    w.style.display = "block";
    w.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function hideMetodoWarningIfOk() {
  if (allEspecialesHaveMetodo()) {
    const w = document.getElementById("metodo-warning");
    if (w) w.style.display = "none";
  }
}

function findEspecial(key) {
  return (ctx().especiales || []).find((e) => e.key === key) || null;
}

function getQtyEspecial(key) {
  const f = (ctx().especiales || []).find((e) => e.key === key);
  return f ? Number(f.qty || 0) : 0;
}

function updateCatalogQtyUI(root, key, nextQty) {
  const numEl = root.querySelector(`[data-num="${cssSafe(key)}"]`);
  if (numEl) numEl.textContent = String(nextQty);

  const decBtn = root.querySelector(
    `button[data-action="dec"][data-key="${cssAttrSafe(key)}"]`
  );
  if (decBtn) {
    if (nextQty <= 0) decBtn.setAttribute("disabled", "disabled");
    else decBtn.removeAttribute("disabled");
  }
}

function refreshEspecialesUI() {
  const list = document.getElementById("especiales-list");
  const totalEl = document.getElementById("m3-total-preview");
  const especiales = ctx().especiales || [];

  const totalM3 = especiales.reduce((acc, it) => acc + Number(it.m3Total || 0), 0);
  if (totalEl) {
    totalEl.textContent = `m³ especiales: ${totalM3 > 0 ? totalM3.toFixed(2) : "—"}`;
  }

  if (!list) return;

  if (!especiales.length) {
    list.innerHTML = `<div class="cf-note">Aún no has agregado especiales.</div>`;
    hideMetodoWarningIfOk();
    return;
  }

  const sinAscensor = ctx().hayAscensor === false;

  list.innerHTML = `
    <div class="cf-note">
      <b>Especiales agregados (${especiales.length})</b>
      ${sinAscensor
      ? `<br><span style="font-size:12px;">Como este lugar no tiene ascensor, los ítems quedan por defecto en <b>Escalera</b>. Cámbialos solo si van por fachada o montacarga.</span>`
      : ``
    }
    </div>

    ${especiales
      .map((it) => {
        const metodo = it.metodo || null;
        const qty = Number(it.qty || 0);
        const m3 = Number(it.m3Total || 0);

        return `
        <div class="especial-card" data-especial-key="${escapeHTML(it.key)}">
          <div class="especial-main">
            <div><b>${escapeHTML(it.name)}</b></div>
            <div class="especial-meta">
              Cantidad: <b>${qty}x</b> · Volumen: <b>${m3.toFixed(2)} m³</b>
            </div>

            <div class="especial-meta" style="margin-top:10px;">
              <b>Método por este ítem:</b>
              <div class="method-pills" style="margin-top:8px;">
                <button class="pill ${metodo === "escalera" ? "active" : ""}" data-method="escalera">Escalera</button>
                <button class="pill ${metodo === "fachada_manual" ? "active" : ""}" data-method="fachada_manual">Fachada Manual</button>
                <button class="pill ${metodo === "montacarga" ? "active" : ""}" data-method="montacarga">Montacarga</button>
              </div>

              ${!metodo
            ? `
                <div class="cf-note" style="margin-top:10px;background:#fff3cd;border:1px solid #ffe69c;color:#664d03;">
                  ⚠️ Selecciona un método para este ítem.
                </div>
              `
            : ``
          }
            </div>
          </div>

          <div class="especial-actions">
            <button class="remove-x" title="Quitar" data-remove="1">×</button>
            <div class="small-qty">
              <button data-qty="dec" ${qty <= 1 ? "disabled" : ""}>-</button>
              <span class="num">${qty}</span>
              <button data-qty="inc">+</button>
            </div>
          </div>
        </div>
      `;
      })
      .join("")}
  `;

  hideMetodoWarningIfOk();
}

function initEspecialesListUI() {
  const list = document.getElementById("especiales-list");
  if (!list) return;

  list.addEventListener("click", (e) => {
    const t = e.target;
    const card = t?.closest?.("[data-especial-key]");
    if (!card) return;

    const key = card.getAttribute("data-especial-key");
    if (!key) return;

    if (t.dataset.remove) {
      removeEspecial(ctxName(), key);
      recalcAll();
      refreshEspecialesUI();
      renderSummary();

      const root = document.getElementById("catalog-root");
      if (root) updateCatalogQtyUI(root, key, 0);

      hideMetodoWarningIfOk();
      return;
    }

    if (t.dataset.method) {
      const metodo = t.dataset.method;
      const it = findEspecial(key);
      if (!it) return;

      upsertEspecial(ctxName(), { ...it, metodo });
      recalcAll();
      refreshEspecialesUI();
      renderSummary();
      hideMetodoWarningIfOk();
      return;
    }

    if (t.dataset.qty === "inc" || t.dataset.qty === "dec") {
      const it = findEspecial(key);
      if (!it) return;

      const current = Number(it.qty || 0);
      const next = t.dataset.qty === "inc" ? current + 1 : Math.max(current - 1, 0);

      if (next <= 0) removeEspecial(ctxName(), key);
      else {
        upsertEspecial(ctxName(), {
          ...it,
          qty: next,
          m3Total: Number(it.unitM3 || 0) * next
        });
      }

      recalcAll();
      refreshEspecialesUI();
      renderSummary();

      const root = document.getElementById("catalog-root");
      if (root) updateCatalogQtyUI(root, key, next);

      hideMetodoWarningIfOk();
    }
  });
}

function initCustomEspecialUI() {
  const customName = document.getElementById("custom-name");
  const customL = document.getElementById("custom-l");
  const customA = document.getElementById("custom-a");
  const customH = document.getElementById("custom-h");
  const preview = document.getElementById("custom-m3-preview");
  const addBtn = document.getElementById("add-custom-especial");

  function calcM3() {
    const L = Number(customL?.value || 0);
    const A = Number(customA?.value || 0);
    const H = Number(customH?.value || 0);
    const m3 = L * A * H;
    return Number.isFinite(m3) ? m3 : 0;
  }

  function updatePreview() {
    const m3 = calcM3();
    if (preview) preview.textContent = m3 > 0 ? `m³: ${m3.toFixed(2)}` : `m³: —`;
  }

  customL?.addEventListener("input", updatePreview);
  customA?.addEventListener("input", updatePreview);
  customH?.addEventListener("input", updatePreview);
  updatePreview();

  addBtn?.addEventListener("click", () => {
    const name = (customName?.value || "Objeto personalizado").trim();
    const m3 = calcM3();
    if (!m3 || m3 <= 0) return;

    const key = `custom__${Date.now()}__${Math.random().toString(16).slice(2)}`;
    const defaultMetodo = ctx().hayAscensor === false ? "escalera" : null;

    upsertEspecial(ctxName(), {
      key,
      name,
      qty: 1,
      unitM3: m3,
      m3Total: m3,
      metodo: defaultMetodo
    });

    if (customName) customName.value = "";
    if (customL) customL.value = "";
    if (customA) customA.value = "";
    if (customH) customH.value = "";
    updatePreview();

    recalcAll();
    refreshEspecialesUI();
    renderSummary();

    if (!defaultMetodo) {
      showMetodoWarning();
    }
  });
}

/* =========================================================
   STEP 15: ITEMS GENERALES
========================================================= */

async function initItemsMudanzaUI() {
  const catalog = await loadCatalog();
  const grouped = catalog.grouped;

  const root = document.getElementById("catalog-root");
  const searchInput = document.getElementById("catalog-search");
  if (!root) return;

  root.classList.add("catalog");
  root.innerHTML = renderCatalogHTMLForItems(grouped, "");

  refreshItemsMudanzaUI();
  initCustomItemMudanzaUI();
  initItemsMudanzaListUI();

  if (searchInput) {
    searchInput.value = "";
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      root.innerHTML = renderCatalogHTMLForItems(grouped, term);
    });
  }

  root.addEventListener("click", (e) => {
    const btn = e.target;
    if (!btn?.dataset) return;

    if (btn.dataset.action === "inc" || btn.dataset.action === "dec") {
      const key = btn.dataset.key;
      const unitM3 = Number(btn.dataset.unitm3 || 0);
      const label = btn.dataset.label || "Item";

      const currentQty = getQtyItemMudanza(key);
      const nextQty =
        btn.dataset.action === "inc" ? currentQty + 1 : Math.max(currentQty - 1, 0);

      if (nextQty <= 0) {
        removeItemMudanza(key);
      } else {
        upsertItemMudanza({
          key,
          name: label,
          qty: nextQty,
          unitM3,
          m3Total: unitM3 * nextQty
        });
      }

      updateCatalogQtyUI(root, key, nextQty);
      recalcAll();
      refreshItemsMudanzaUI();
      renderSummary();
    }
  });

  const cont = document.getElementById("items-continue");
  if (cont) {
    cont.addEventListener("click", async () => {
      cont.disabled = true;
      cont.textContent = "Continuando...";

      try {
        validateMinimumServiceForCompleta();
        await go("step15b-bodegaje");
      } catch (err) {
        console.error(err);
        alert(`No se pudo continuar: ${err.message}`);
      } finally {
        cont.disabled = false;
        cont.textContent = "Ver resumen final";
      }
    });
  }
}

function getQtyItemMudanza(key) {
  const f = (state.itemsMudanza || []).find((i) => i.key === key);
  return f ? Number(f.qty || 0) : 0;
}

function refreshItemsMudanzaUI() {
  const list = document.getElementById("items-list");
  const totalEl = document.getElementById("items-m3-total-preview");
  const items = state.itemsMudanza || [];

  const totalM3 = items.reduce((acc, it) => acc + Number(it.m3Total || 0), 0);
  if (totalEl) {
    totalEl.textContent = `m³ items mudanza: ${totalM3 > 0 ? totalM3.toFixed(2) : "—"}`;
  }

  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<div class="cf-note">Aún no has agregado items.</div>`;
    return;
  }

  list.innerHTML = `
    <div class="cf-note"><b>Items agregados (${items.length})</b></div>
    ${items
      .map(
        (it) => `
      <div class="especial-card" data-item-key="${escapeHTML(it.key)}">
        <div class="especial-main">
          <div><b>${escapeHTML(it.name)}</b></div>
          <div class="especial-meta">
            Cantidad: <b>${Number(it.qty || 0)}x</b> · Volumen: <b>${Number(
          it.m3Total || 0
        ).toFixed(2)} m³</b>
          </div>
        </div>
        <div class="especial-actions">
          <button class="remove-x" title="Quitar" data-remove-item="1">×</button>
          <div class="small-qty">
            <button data-qty-item="dec" ${Number(it.qty || 0) <= 1 ? "disabled" : ""}>-</button>
            <span class="num">${Number(it.qty || 0)}</span>
            <button data-qty-item="inc">+</button>
          </div>
        </div>
      </div>
    `
      )
      .join("")}
  `;
}

function initItemsMudanzaListUI() {
  const list = document.getElementById("items-list");
  if (!list) return;

  list.addEventListener("click", (e) => {
    const t = e.target;
    const card = t?.closest?.("[data-item-key]");
    if (!card) return;

    const key = card.getAttribute("data-item-key");
    if (!key) return;

    if (t.dataset.removeItem) {
      removeItemMudanza(key);
      recalcAll();
      refreshItemsMudanzaUI();
      renderSummary();

      const root = document.getElementById("catalog-root");
      if (root) updateCatalogQtyUI(root, key, 0);

      return;
    }

    if (t.dataset.qtyItem === "inc" || t.dataset.qtyItem === "dec") {
      const it = (state.itemsMudanza || []).find((i) => i.key === key);
      if (!it) return;

      const current = Number(it.qty || 0);
      const next = t.dataset.qtyItem === "inc" ? current + 1 : Math.max(current - 1, 0);

      if (next <= 0) removeItemMudanza(key);
      else {
        upsertItemMudanza({
          ...it,
          qty: next,
          m3Total: Number(it.unitM3 || 0) * next
        });
      }

      recalcAll();
      refreshItemsMudanzaUI();
      renderSummary();

      const root = document.getElementById("catalog-root");
      if (root) updateCatalogQtyUI(root, key, next);
    }
  });
}

function initCustomItemMudanzaUI() {
  const customName = document.getElementById("custom-name");
  const customL = document.getElementById("custom-l");
  const customA = document.getElementById("custom-a");
  const customH = document.getElementById("custom-h");
  const preview = document.getElementById("custom-m3-preview");
  const addBtn = document.getElementById("add-custom-item");

  function calcM3() {
    const L = Number(customL?.value || 0);
    const A = Number(customA?.value || 0);
    const H = Number(customH?.value || 0);
    const m3 = L * A * H;
    return Number.isFinite(m3) ? m3 : 0;
  }

  function updatePreview() {
    const m3 = calcM3();
    if (preview) preview.textContent = m3 > 0 ? `m³: ${m3.toFixed(2)}` : `m³: —`;
  }

  customL?.addEventListener("input", updatePreview);
  customA?.addEventListener("input", updatePreview);
  customH?.addEventListener("input", updatePreview);
  updatePreview();

  addBtn?.addEventListener("click", () => {
    const name = (customName?.value || "Objeto personalizado").trim();
    const m3 = calcM3();
    if (!m3 || m3 <= 0) return;

    const key = `custom_item__${Date.now()}__${Math.random().toString(16).slice(2)}`;

    upsertItemMudanza({
      key,
      name,
      qty: 1,
      unitM3: m3,
      m3Total: m3
    });

    if (customName) customName.value = "";
    if (customL) customL.value = "";
    if (customA) customA.value = "";
    if (customH) customH.value = "";
    updatePreview();

    recalcAll();
    refreshItemsMudanzaUI();
    renderSummary();
  });
}

/* =========================================================
   FINAL
========================================================= */

function metodoLabel(m) {
  if (m === "escalera") return "Escalera";
  if (m === "fachada_manual") return "Fachada Manual";
  if (m === "montacarga") return "Montacarga";
  return "—";
}

function calcEspecialPrice(ctxObj, especial) {
  const m3 = Number(especial?.m3Total || 0);
  if (m3 <= 0) return 0;

  const metodo = especial?.metodo;
  if (!metodo) return 0;

  const pisos = Math.max(Number(ctxObj?.pisos || 1), 1);
  const pisosCobrar = Math.max(pisos - 1, 0);

  let recargoM3 = 0;

  if (metodo === "escalera") {
    recargoM3 = pisosCobrar * TARIFAS.RECARGOS.POR_PISO_ESCALERA;
  } else if (metodo === "fachada_manual") {
    recargoM3 = TARIFAS.RECARGOS.FACHADA_MANUAL;
  } else if (metodo === "montacarga") {
    recargoM3 = TARIFAS.RECARGOS.FACHADA_MONTACARGA;
  }

  return m3 * (TARIFAS.M3_ESTANDAR + recargoM3);
}

function calcItemPrice(item) {
  const m3 = Number(item?.m3Total || 0);

  if (m3 <= 0) return 0;

  const base = m3 * TARIFAS.M3_ESTANDAR;

  const oPisosCobrar =
    state.origen?.hayAscensor === false
      ? Math.max(Math.max(Number(state.origen?.pisos || 1), 1) - 1, 0)
      : 0;

  const dPisosCobrar =
    state.destino?.hayAscensor === false
      ? Math.max(Math.max(Number(state.destino?.pisos || 1), 1) - 1, 0)
      : 0;

  const recargoOrigen = m3 * oPisosCobrar * TARIFAS.RECARGOS.POR_PISO_ESCALERA;
  const recargoDestino = m3 * dPisosCobrar * TARIFAS.RECARGOS.POR_PISO_ESCALERA;

  return base + recargoOrigen + recargoDestino;
}

function initBodegajeUI() {
  const yesBtn = document.querySelector('[data-bodegaje="si"]');
  const noBtn = document.querySelector('[data-bodegaje="no"]');
  const diasWrap = document.getElementById("bodegaje-dias-wrap");
  const diasInput = document.getElementById("bodegaje-dias-input");
  const continueBtn = document.getElementById("bodegaje-continue");
  const statusEl = document.getElementById("bodegaje-send-status");

  if (!yesBtn || !noBtn || !diasWrap || !diasInput || !continueBtn || !statusEl) return;

  let submitting = false;

  function renderAutoSharedStatus() {
    if (state.autoSharedApplied && state.autoSharedMessage) {
      statusEl.className = "cf-send-status success";
      statusEl.style.display = "block";
      statusEl.textContent = state.autoSharedMessage;
      return;
    }

    statusEl.style.display = "none";
    statusEl.textContent = "";
    statusEl.className = "cf-send-status";
  }

  function renderSelection() {
    yesBtn.classList.toggle("active", state.deseaBodegaje === true);
    noBtn.classList.toggle("active", state.deseaBodegaje === false);

    diasWrap.style.display = state.deseaBodegaje === true ? "block" : "none";

    if (state.deseaBodegaje === true && state.diasBodegaje > 0) {
      diasInput.value = String(state.diasBodegaje);
    } else if (state.deseaBodegaje !== true) {
      diasInput.value = "";
    }

    renderAutoSharedStatus();
  }

  function setLoading(isLoading, message = "") {
    submitting = isLoading;

    continueBtn.disabled = isLoading;
    yesBtn.disabled = isLoading;
    noBtn.disabled = isLoading;
    diasInput.disabled = isLoading;

    if (isLoading) {
      continueBtn.textContent = "Preparando cotización...";
      statusEl.className = "cf-send-status";
      statusEl.style.display = "block";
      statusEl.innerHTML = `
        <span class="cf-inline-loader" aria-hidden="true"></span>
        ${message || "Estamos preparando tu cotización, por favor espera..."}
      `;
    } else {
      continueBtn.textContent = "Ver resumen final";
      renderAutoSharedStatus();
    }
  }

  yesBtn.addEventListener("click", () => {
    if (submitting) return;
    state.deseaBodegaje = true;
    renderSelection();
  });

  noBtn.addEventListener("click", () => {
    if (submitting) return;
    state.deseaBodegaje = false;
    state.diasBodegaje = 0;
    renderSelection();
  });

  continueBtn.addEventListener("click", async () => {
    if (submitting) return;

    if (state.deseaBodegaje === null) {
      statusEl.className = "cf-send-status error";
      statusEl.style.display = "block";
      statusEl.textContent = "Por favor selecciona si deseas bodegaje o no.";
      return;
    }

    if (state.deseaBodegaje === true) {
      const dias = Number(diasInput.value || 0);
      if (!Number.isFinite(dias) || dias <= 0) {
        statusEl.className = "cf-send-status error";
        statusEl.style.display = "block";
        statusEl.textContent = "Por favor ingresa la cantidad de días de bodegaje.";
        return;
      }
      state.diasBodegaje = dias;
    } else {
      state.diasBodegaje = 0;
    }

    try {
      setLoading(true, "Estamos preparando tu cotización y enviando el correo...");

      await submitQuoteNotifications();
      await go("step16-fin");
    } catch (err) {
      console.error(err);
      statusEl.className = "cf-send-status error";
      statusEl.style.display = "block";
      statusEl.textContent = `No se pudo enviar la cotización: ${err.message}`;
      setLoading(false);
    }
  });

  renderSelection();
}

function renderFinal() {
  const el = document.getElementById("final-summary");
  if (!el) return;

  const o = state.origen;
  const d = state.destino;

  const ceilDivLocal = (a, b) => Math.ceil(Number(a || 0) / Number(b || 1));

  const calcCamionSurcharge = (ctxObj) => {
    if (ctxObj.camionMenos40m === true) return 0;

    if (ctxObj.camionMenos40m === false) {
      const extra = Math.max(Number(ctxObj.metrosExtra || 0), 0);
      const bloques20 = ceilDivLocal(extra, 20);
      return bloques20 * TARIFAS.RECARGOS.POR_20M_ADICIONAL;
    }

    return 0;
  };

  const calcItemsEscaleraRecargo = (ctxObj, totalItemsM3) => {
    if (ctxObj?.hayAscensor !== false) return 0;

    const pisos = Math.max(Number(ctxObj?.pisos || 1), 1);
    const pisosCobrar = Math.max(pisos - 1, 0);
    if (pisosCobrar <= 0) return 0;

    return totalItemsM3 * pisosCobrar * TARIFAS.RECARGOS.POR_PISO_ESCALERA;
  };

  const oCamionPrice = calcCamionSurcharge(o);
  const dCamionPrice = calcCamionSurcharge(d);

  const oCamionTxt =
    o.camionMenos40m === true
      ? `Sí (metros extra: 0)`
      : o.camionMenos40m === false
        ? `No (metros extra: ${Number(o.metrosExtra || 0)} m)`
        : `—`;

  const dCamionTxt =
    d.camionMenos40m === true
      ? `Sí (metros extra: 0)`
      : d.camionMenos40m === false
        ? `No (metros extra: ${Number(d.metrosExtra || 0)} m)`
        : `—`;

  const oEspeciales = o.especiales || [];
  const dEspeciales = d.especiales || [];
  const items = state.itemsMudanza || [];

  const totalEspecialesOrigenM3 = oEspeciales.reduce(
    (acc, it) => acc + Number(it.m3Total || 0),
    0
  );
  const totalEspecialesDestinoM3 = dEspeciales.reduce(
    (acc, it) => acc + Number(it.m3Total || 0),
    0
  );
  const totalItemsM3 = items.reduce((acc, it) => acc + Number(it.m3Total || 0), 0);
  const cubicajeTotal = totalEspecialesOrigenM3 + totalEspecialesDestinoM3 + totalItemsM3;

  const itemsRecargoOrigen = calcItemsEscaleraRecargo(o, totalItemsM3);
  const itemsRecargoDestino = calcItemsEscaleraRecargo(d, totalItemsM3);

  const totalEspecialesOrigenPrice = oEspeciales.reduce(
    (acc, it) => acc + calcEspecialPrice(o, it),
    0
  );
  const totalEspecialesDestinoPrice = dEspeciales.reduce(
    (acc, it) => acc + calcEspecialPrice(d, it),
    0
  );
  const totalItemsPrice = items.reduce((acc, it) => acc + calcItemPrice(it), 0);

  const especialesOrigenHTML = oEspeciales.length
    ? `
      <div class="cf-line-items">
        ${oEspeciales
      .map((it) => {
        const precio = calcEspecialPrice(o, it);
        return `
            <div class="cf-line-item">
              <div class="cf-line-main">
                <div class="cf-line-name">${escapeHTML(it.name)}</div>
                <div class="cf-line-meta">
                  Método: <b>${escapeHTML(metodoLabel(it.metodo))}</b><br>
                  Cantidad: <b>${Number(it.qty || 0)}x</b> · Volumen: <b>${Number(
          it.m3Total || 0
        ).toFixed(2)} m³</b>
                </div>
              </div>
              <div class="cf-line-side">
                <div class="cf-line-price-label">Precio total</div>
                <div class="cf-line-price">${money(precio)}</div>
              </div>
            </div>
          `;
      })
      .join("")}
      </div>
    `
    : `<div class="cf-invoice-empty">No se registraron objetos especiales en el origen.</div>`;

  const especialesDestinoHTML = dEspeciales.length
    ? `
      <div class="cf-line-items">
        ${dEspeciales
      .map((it) => {
        const precio = calcEspecialPrice(d, it);
        return `
            <div class="cf-line-item">
              <div class="cf-line-main">
                <div class="cf-line-name">${escapeHTML(it.name)}</div>
                <div class="cf-line-meta">
                  Método: <b>${escapeHTML(metodoLabel(it.metodo))}</b><br>
                  Cantidad: <b>${Number(it.qty || 0)}x</b> · Volumen: <b>${Number(
          it.m3Total || 0
        ).toFixed(2)} m³</b>
                </div>
              </div>
              <div class="cf-line-side">
                <div class="cf-line-price-label">Precio total</div>
                <div class="cf-line-price">${money(precio)}</div>
              </div>
            </div>
          `;
      })
      .join("")}
      </div>
    `
    : `<div class="cf-invoice-empty">No se registraron objetos especiales en el destino.</div>`;

  const itemsHTML = items.length
    ? `
      <div class="cf-line-items">
        ${items
      .map((it) => {
        const precio = calcItemPrice(it);
        return `
            <div class="cf-line-item">
              <div class="cf-line-main">
                <div class="cf-line-name">${escapeHTML(it.name)}</div>
                <div class="cf-line-meta">
                  Cantidad: <b>${Number(it.qty || 0)}x</b> · Volumen: <b>${Number(
          it.m3Total || 0
        ).toFixed(2)} m³</b><br>
                  <span style="color:#475467;">Este precio ya incluye los recargos aplicables por escalera.</span>
                </div>
              </div>
              <div class="cf-line-side">
                <div class="cf-line-price-label">Precio total</div>
                <div class="cf-line-price">${money(precio)}</div>
              </div>
            </div>
          `;
      })
      .join("")}
      </div>
    `
    : `<div class="cf-invoice-empty">No se registraron items generales de mudanza.</div>`;

  el.innerHTML = `
    <div class="cf-invoice">
      <div class="cf-invoice-card">
        <div class="cf-invoice-head">
          <div class="cf-invoice-kicker">Resumen final</div>
          <h3 class="cf-invoice-title">Cotización estimada de mudanza</h3>
          <div class="cf-invoice-sub">
            Este resumen incluye ruta, fecha programada, tarifa aplicada, cubicaje y totales.
          </div>
        </div>

        <div class="cf-invoice-body">
          ${state.autoSharedApplied && state.autoSharedMessage
      ? `
            <div class="cf-note success" style="margin-bottom:14px;">
              ${escapeHTML(state.autoSharedMessage)}
            </div>
          `
      : ""
    }

          <div class="cf-invoice-grid">
            <div class="cf-summary-tile">
              <div class="cf-summary-label">Ruta</div>
              <div class="cf-summary-value">${escapeHTML(state.tipoRuta || "—")} · ${state.distanciaKm || "—"
    } km</div>
            </div>

            <div class="cf-summary-tile">
              <div class="cf-summary-label">Fecha programada</div>
              <div class="cf-summary-value">${escapeHTML(state.fechaMudanzaLabel || "—")}</div>
            </div>

            <div class="cf-summary-tile">
              <div class="cf-summary-label">Tarifa aplicada</div>
              <div class="cf-summary-value">${escapeHTML(state.tarifaAplicadaLabel || "—")}</div>
            </div>

            <div class="cf-summary-tile">
              <div class="cf-summary-label">Precio por km</div>
              <div class="cf-summary-value">${state.precioKmAplicado ? money(state.precioKmAplicado) : "—"
    }</div>
            </div>

            <div class="cf-summary-tile">
              <div class="cf-summary-label">Descuento aplicado</div>
              <div class="cf-summary-value">${state.descuentoAplicadoPct ? `${state.descuentoAplicadoPct}%` : "0%"
    }</div>
            </div>

            <div class="cf-summary-tile">
              <div class="cf-summary-label">Cubicaje total</div>
              <div class="cf-summary-value is-strong">${cubicajeTotal > 0 ? cubicajeTotal.toFixed(2) : "0.00"
    } m³</div>
            </div>
          </div>

          <div class="cf-route-line">
            <b>Cliente:</b> ${escapeHTML(state.customer.fullName || "—")}<br>
            <b>Correo:</b> ${escapeHTML(state.customer.email || "—")}<br>
            <b>Teléfono:</b> ${escapeHTML(state.customer.phone || "—")}<br>
            <b>Servicio personalizado:</b> ${state.servicioPersonalizado === true ? "Sí" : "No"}
            ${state.servicioPersonalizado === true
      ? `<br><b>Descripción servicio personalizado:</b> ${escapeHTML(
        state.servicioPersonalizadoDescripcion || "—"
      )}`
      : ""
    }
            <br><br>
            <b>Tiempo estimado del servicio:</b> ${escapeHTML(
      state.tiempoEstimadoServicio || "—"
    )}<br><br>
            <b>Bodegaje:</b> ${state.deseaBodegaje === true
      ? `Sí (${Number(state.diasBodegaje || 0)} días)`
      : state.deseaBodegaje === false
        ? "No"
        : "—"
    }<br><br>
            <b>Origen:</b> ${escapeHTML(state.origenDireccion || "—")}<br>
            <b>Destino:</b> ${escapeHTML(state.destinoDireccion || "—")}<br><br>

            <b>Delicados:</b> ${state.delicados === true ? "Sí" : state.delicados === false ? "No" : "—"
    }
            ${state.delicados === true
      ? `<br><b>Descripción:</b> ${escapeHTML(state.delicadosDescripcion || "—")}`
      : ``
    }
          </div>

          <div class="cf-total-box" style="margin-top:14px;">
            <div class="cf-total-row">
              <span>Precio base por ruta</span>
              <strong>${money(state.precioBase)}</strong>
            </div>
            <div class="cf-total-row">
              <span>Total objetos especiales en origen</span>
              <strong>${money(totalEspecialesOrigenPrice)}</strong>
            </div>
            <div class="cf-total-row">
              <span>Total objetos especiales en destino</span>
              <strong>${money(totalEspecialesDestinoPrice)}</strong>
            </div>
            <div class="cf-total-row">
              <span>Total items generales</span>
              <strong>${money(totalItemsPrice)}</strong>
            </div>
            <div class="cf-total-row final">
              <span>Total estimado</span>
              <span class="amount">${money(state.precioFinal)}</span>
            </div>
          </div>

          <div class="cf-detail-note">
            Los recargos por escalera de los items generales ya están incluidos dentro del total de items generales.
            <br><br>
            <b>Recargo informativo escalera origen:</b> ${money(itemsRecargoOrigen)}<br>
            <b>Recargo informativo escalera destino:</b> ${money(itemsRecargoDestino)}
          </div>
        </div>
      </div>

      <div class="cf-invoice-section">
        <div class="cf-invoice-section-head">
          <div class="cf-invoice-section-title">Objetos con carga especial · Origen</div>
          <div class="cf-invoice-section-sub">Detalle de los objetos especiales seleccionados para el punto de origen.</div>
        </div>
        <div class="cf-invoice-section-body">
          <div class="cf-mini-meta">
            <span class="cf-mini-pill">Pisos: ${o.pisos}</span>
            <span class="cf-mini-pill">Ascensor: ${o.hayAscensor ? "Sí" : o.hayAscensor === false ? "No" : "—"
    }</span>
            <span class="cf-mini-pill">Especiales: ${oEspeciales.length}</span>
            <span class="cf-mini-pill">Camión &lt; 40m: ${escapeHTML(oCamionTxt)}</span>
            <span class="cf-mini-pill">Recargo camión: ${money(oCamionPrice)}</span>
            <span class="cf-mini-pill">m³ especiales: ${totalEspecialesOrigenM3 > 0 ? totalEspecialesOrigenM3.toFixed(2) : "0.00"
    }</span>
            <span class="cf-mini-pill">Total especiales origen: ${money(totalEspecialesOrigenPrice)}</span>
          </div>
          ${especialesOrigenHTML}
        </div>
      </div>

      <div class="cf-invoice-section">
        <div class="cf-invoice-section-head">
          <div class="cf-invoice-section-title">Objetos con carga especial · Destino</div>
          <div class="cf-invoice-section-sub">Detalle de los objetos especiales seleccionados para el punto de destino.</div>
        </div>
        <div class="cf-invoice-section-body">
          <div class="cf-mini-meta">
            <span class="cf-mini-pill">Pisos: ${d.pisos}</span>
            <span class="cf-mini-pill">Ascensor: ${d.hayAscensor ? "Sí" : d.hayAscensor === false ? "No" : "—"
    }</span>
            <span class="cf-mini-pill">Especiales: ${dEspeciales.length}</span>
            <span class="cf-mini-pill">Camión &lt; 40m: ${escapeHTML(dCamionTxt)}</span>
            <span class="cf-mini-pill">Recargo camión: ${money(dCamionPrice)}</span>
            <span class="cf-mini-pill">m³ especiales: ${totalEspecialesDestinoM3 > 0 ? totalEspecialesDestinoM3.toFixed(2) : "0.00"
    }</span>
            <span class="cf-mini-pill">Total especiales destino: ${money(totalEspecialesDestinoPrice)}</span>
          </div>
          ${especialesDestinoHTML}
        </div>
      </div>

      <div class="cf-invoice-section">
        <div class="cf-invoice-section-head">
          <div class="cf-invoice-section-title">Items generales de la mudanza</div>
          <div class="cf-invoice-section-sub">Detalle de los objetos generales agregados en la mudanza con su cubicaje y precio.</div>
        </div>
        <div class="cf-invoice-section-body">
          <div class="cf-mini-meta">
            <span class="cf-mini-pill">Items: ${items.length}</span>
            <span class="cf-mini-pill">Total m³ items: ${totalItemsM3 > 0 ? totalItemsM3.toFixed(2) : "0.00"
    }</span>
            <span class="cf-mini-pill">Total items generales: ${money(totalItemsPrice)}</span>
            <span class="cf-mini-pill">Recargo escalera origen incluido: ${money(itemsRecargoOrigen)}</span>
            <span class="cf-mini-pill">Recargo escalera destino incluido: ${money(itemsRecargoDestino)}</span>
          </div>
          ${itemsHTML}
        </div>
      </div>
    </div>
  `;
}

/* =========================================================
   LISTENER GLOBAL
========================================================= */

document.addEventListener("click", async (e) => {
  const t = e.target;

  if (t.dataset.back) {
    if (
      state.step === "step15b-bodegaje" ||
      state.step === "step15-items-mudanza" ||
      state.step === "step14-delicados-desc" ||
      state.step === "step13-delicados" ||
      state.step === "step12-metros-extra" ||
      state.step === "step11-camion-40m" ||
      state.step === "step10-objetos" ||
      state.step === "step8-no-cabe" ||
      state.step === "step7-ascensor" ||
      state.step === "step6-pisos" ||
      state.step === "step5-tipo-inmueble" ||
      state.step === "step4-tipo-mudanza" ||
      state.step === "step3-direcciones" ||
      state.step === "step1b-fecha-mudanza"
    ) {
      clearAutoSharedFlag();
    }

    if (
      t.dataset.back === "step2-tipo-ruta" &&
      state.step === "step3-direcciones" &&
      state.direccionFase === "destino"
    ) {
      state.direccionFase = "origen";
      await go("step3-direcciones");
      return;
    }

    if (
      t.dataset.back === "step4-tipo-mudanza" &&
      state.step === "step5-tipo-inmueble" &&
      state.accessContext === "destino"
    ) {
      state.accessContext = "origen";

      if (state.origen.camionMenos40m === false) {
        await go("step12-metros-extra");
      } else {
        await go("step11-camion-40m");
      }
      return;
    }

    await go(t.dataset.back);
    return;
  }

  if (t.id === "restart-quote-btn") {
    resetQuoteState();
    await go("step0-contacto");
    return;
  }

  if (t.id === "contact-continue") {
    const fullName = (document.getElementById("contact-name")?.value || "").trim();
    const email = (document.getElementById("contact-email")?.value || "").trim();
    const phone = (document.getElementById("contact-phone")?.value || "").trim();

    if (!fullName || !email || !phone) {
      alert("Por favor completa nombre, correo y teléfono.");
      return;
    }

    state.customer.fullName = fullName;
    state.customer.email = email;
    state.customer.phone = phone;

    try {
      await notifyQuoteStarted();
    } catch (err) {
      console.error("No se pudo notificar inicio:", err);
    }

    await go("step1-servicio");
    return;
  }

  if (t.dataset.ruta) {
    state.tipoRuta = t.dataset.ruta;
    state.direccionFase = "origen";
    await go("step3-direcciones");
    return;
  }

  if (t.dataset.mudanza) {
    clearAutoSharedFlag();
    state.tipoMudanza = t.dataset.mudanza;
    calcularPrecioBase();
    await go("step5-tipo-inmueble");
    return;
  }

  const mudanzaCard = t.closest?.("[data-mudanza]");
  if (mudanzaCard && mudanzaCard.dataset?.mudanza && !t.dataset?.mudanza) {
    clearAutoSharedFlag();
    state.tipoMudanza = mudanzaCard.dataset.mudanza;
    calcularPrecioBase();
    await go("step5-tipo-inmueble");
    return;
  }

  if (t.id === "km-continue") {
    if (!state.distanciaKm || state.distanciaKm <= 0) return;
    await go("step4-tipo-mudanza");
    return;
  }

  if (t.dataset.inmueble) {
    if (state.accessContext === "origen") {
      state.inmuebleOrigen = t.dataset.inmueble;
      state.origen.inmueble = t.dataset.inmueble;
      await go("step6-pisos");
      return;
    }
    if (state.accessContext === "destino") {
      state.destino.inmueble = t.dataset.inmueble;
      await go("step6-pisos");
      return;
    }
  }

  const inmuebleCard = t.closest?.("[data-inmueble]");
  if (inmuebleCard && inmuebleCard.dataset?.inmueble && !t.dataset?.inmueble) {
    if (state.accessContext === "origen") {
      state.inmuebleOrigen = inmuebleCard.dataset.inmueble;
      state.origen.inmueble = inmuebleCard.dataset.inmueble;
      await go("step6-pisos");
      return;
    }
    if (state.accessContext === "destino") {
      state.destino.inmueble = inmuebleCard.dataset.inmueble;
      state.destino.inmueble = inmuebleCard.dataset.inmueble;
      await go("step6-pisos");
      return;
    }
  }

  if (t.id === "pisos-continue") {
    const valRaw = document.getElementById("pisos-input")?.value;
    const val = Number(valRaw);

    if (valRaw === "" || !Number.isFinite(val) || val < 1) {
      alert("Por favor ingresa un número de pisos válido.");
      return;
    }

    ctx().pisos = val;
    recalcAll();
    await go("step7-ascensor");
    return;
  }

  if (t.dataset.ascensor) {
    ctx().hayAscensor = t.dataset.ascensor === "si";
    recalcAll();
    await go("step8-no-cabe");
    return;
  }

  if (t.dataset.nocabe) {
    ctx().noCabe = t.dataset.nocabe === "si";
    if (ctx().noCabe) await go("step10-objetos");
    else await go("step11-camion-40m");
    return;
  }

  if (t.dataset.camion40) {
    ctx().camionMenos40m = t.dataset.camion40 === "si";
    if (ctx().camionMenos40m) {
      ctx().metrosExtra = 0;
      recalcAll();
      await goAfterAccesosDone();
    } else {
      await go("step12-metros-extra");
    }
    return;
  }

  if (t.id === "metros-extra-continue") {
    const m = Number(document.getElementById("metros-extra-input")?.value);
    ctx().metrosExtra = Number.isFinite(m) && m >= 0 ? m : 0;
    recalcAll();
    await goAfterAccesosDone();
    return;
  }

  if (t.dataset.delicados) {
    state.delicados = t.dataset.delicados === "si";
    if (state.delicados) {
      await go("step14-delicados-desc");
    } else {
      state.delicadosDescripcion = "";
      await go("step15-items-mudanza");
    }
    return;
  }

  if (t.id === "delicados-continue") {
    const txt = (document.getElementById("delicados-text")?.value || "").trim();
    state.delicadosDescripcion = txt;
    await go("step15-items-mudanza");
    return;
  }
});

async function goAfterAccesosDone() {
  if (state.accessContext === "origen") {
    state.accessContext = "destino";
    await go("step5-tipo-inmueble");
    return;
  }

  if (state.accessContext === "destino") {
    await go("step13-delicados");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  updateFechaMudanzaMeta();
  await go(state.step || "step0-contacto");
});

/* =========================================================
   HTML BUILDERS
========================================================= */

function renderCatalogHTML(grouped, searchTerm = "") {
  const zonas = Object.keys(grouped || {});
  if (!zonas.length) return `<div class="cf-note">No hay datos en el CSV todavía.</div>`;

  const term = String(searchTerm || "").trim().toLowerCase();
  let html = ``;
  let totalMatches = 0;

  for (const zona of zonas) {
    let zonaHtml = ``;

    const espacios = Object.keys(grouped[zona] || {});
    for (const espacio of espacios) {
      let espacioHtml = ``;

      const objetos = Object.keys((grouped[zona] || {})[espacio] || {});
      for (const objeto of objetos) {
        let objetoHtml = ``;
        const variants = ((grouped[zona] || {})[espacio] || {})[objeto] || [];

        for (const v of variants) {
          const key = `${zona}__${espacio}__${objeto}__${v.tipo || ""}__${v.variante || ""}`.toLowerCase();

          const safeKey = cssSafe(key);
          const variantLabel = v.variante ? `${v.tipo} — ${v.variante}` : `${v.tipo}`;
          const fullLabel = `${objeto}: ${variantLabel}`;
          const qty = getQtyEspecial(key);

          const hayMatch =
            !term ||
            zona.toLowerCase().includes(term) ||
            espacio.toLowerCase().includes(term) ||
            objeto.toLowerCase().includes(term) ||
            String(v.tipo || "").toLowerCase().includes(term) ||
            String(v.variante || "").toLowerCase().includes(term) ||
            fullLabel.toLowerCase().includes(term);

          if (!hayMatch) continue;

          totalMatches++;

          objetoHtml += `
            <div class="item-row">
              <div>
                <div class="item-title">
                  <span>${escapeHTML(variantLabel)}</span>
                  <span class="info" tabindex="0" aria-label="Info">
                    ℹ️
                    <span class="tip">
                      <b>${escapeHTML(fullLabel)}</b>
                      Volumen: ${escapeHTML(fmt(v.m3))} m³
                    </span>
                  </span>
                </div>
                <div class="item-sub">${escapeHTML(objeto)} • ${escapeHTML(zona)}</div>
              </div>

              <div class="qty">
                <button data-action="dec" data-key="${escapeHTML(
            key
          )}" data-unitm3="${v.m3}" data-label="${escapeHTML(fullLabel)}" ${qty <= 0 ? "disabled" : ""
            }>-</button>
                <span class="num" data-num="${safeKey}">${qty}</span>
                <button data-action="inc" data-key="${escapeHTML(
              key
            )}" data-unitm3="${v.m3}" data-label="${escapeHTML(fullLabel)}">+</button>
              </div>
            </div>
          `;
        }

        if (objetoHtml) {
          espacioHtml += `
            <div class="cf-note" style="margin:10px 0 6px 0;"><b>${escapeHTML(objeto)}</b></div>
            ${objetoHtml}
          `;
        }
      }

      if (espacioHtml) {
        const isOpen = !!term;
        espacioHtml = `
          <details class="lvl2" ${isOpen ? "open" : ""}>
            <summary>${escapeHTML(espacio)}</summary>
            ${espacioHtml}
          </details>
        `;
        zonaHtml += espacioHtml;
      }
    }

    if (zonaHtml) {
      const isOpen = !!term;
      html += `
        <details ${isOpen ? "open" : ""}>
          <summary>${escapeHTML(zona)}</summary>
          ${zonaHtml}
        </details>
      `;
    }
  }

  if (!totalMatches) {
    return `<div class="catalog-search-empty">No encontramos resultados para tu búsqueda. (Agregalo como objeto personalizado)</div>`;
  }

  return html;
}

function renderCatalogHTMLForItems(grouped, searchTerm = "") {
  const zonas = Object.keys(grouped || {});
  if (!zonas.length) return `<div class="cf-note">No hay datos en el CSV todavía.</div>`;

  const term = String(searchTerm || "").trim().toLowerCase();
  let html = ``;
  let totalMatches = 0;

  for (const zona of zonas) {
    let zonaHtml = ``;

    const espacios = Object.keys(grouped[zona] || {});
    for (const espacio of espacios) {
      let espacioHtml = ``;

      const objetos = Object.keys((grouped[zona] || {})[espacio] || {});
      for (const objeto of objetos) {
        let objetoHtml = ``;
        const variants = ((grouped[zona] || {})[espacio] || {})[objeto] || [];

        for (const v of variants) {
          const key = `item__${zona}__${espacio}__${objeto}__${v.tipo || ""}__${v.variante || ""}`.toLowerCase();

          const safeKey = cssSafe(key);
          const variantLabel = v.variante ? `${v.tipo} — ${v.variante}` : `${v.tipo}`;
          const fullLabel = `${objeto}: ${variantLabel}`;
          const qty = getQtyItemMudanza(key);

          const hayMatch =
            !term ||
            zona.toLowerCase().includes(term) ||
            espacio.toLowerCase().includes(term) ||
            objeto.toLowerCase().includes(term) ||
            String(v.tipo || "").toLowerCase().includes(term) ||
            String(v.variante || "").toLowerCase().includes(term) ||
            fullLabel.toLowerCase().includes(term);

          if (!hayMatch) continue;

          totalMatches++;

          objetoHtml += `
            <div class="item-row">
              <div>
                <div class="item-title">
                  <span>${escapeHTML(variantLabel)}</span>
                  <span class="info" tabindex="0" aria-label="Info">
                    ℹ️
                    <span class="tip">
                      <b>${escapeHTML(fullLabel)}</b>
                      Volumen: ${escapeHTML(fmt(v.m3))} m³
                    </span>
                  </span>
                </div>
                <div class="item-sub">${escapeHTML(objeto)} • ${escapeHTML(zona)}</div>
              </div>

              <div class="qty">
                <button data-action="dec" data-key="${escapeHTML(
            key
          )}" data-unitm3="${v.m3}" data-label="${escapeHTML(fullLabel)}" ${qty <= 0 ? "disabled" : ""
            }>-</button>
                <span class="num" data-num="${safeKey}">${qty}</span>
                <button data-action="inc" data-key="${escapeHTML(
              key
            )}" data-unitm3="${v.m3}" data-label="${escapeHTML(fullLabel)}">+</button>
              </div>
            </div>
          `;
        }

        if (objetoHtml) {
          espacioHtml += `
            <div class="cf-note" style="margin:10px 0 6px 0;"><b>${escapeHTML(objeto)}</b></div>
            ${objetoHtml}
          `;
        }
      }

      if (espacioHtml) {
        const isOpen = !!term;
        espacioHtml = `
          <details class="lvl2" ${isOpen ? "open" : ""}>
            <summary>${escapeHTML(espacio)}</summary>
            ${espacioHtml}
          </details>
        `;
        zonaHtml += espacioHtml;
      }
    }

    if (zonaHtml) {
      const isOpen = !!term;
      html += `
        <details ${isOpen ? "open" : ""}>
          <summary>${escapeHTML(zona)}</summary>
          ${zonaHtml}
        </details>
      `;
    }
  }

  if (!totalMatches) {
    return `<div class="catalog-search-empty">No encontramos resultados para tu búsqueda. (Agregalo como objeto personalizado)</div>`;
  }

  return html;
}

/* =========================================================
   HELPERS
========================================================= */

function escapeHTML(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssSafe(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function cssAttrSafe(str) {
  return String(str).replaceAll('"', '\\"');
}

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(2).replace(/\.00$/, "");
}