export const state = {
  step: "step0-contacto",

  quoteSessionId: "",

  notifications: {
    startedSent: false,
    abandonedSent: false,
    completed: false
  },

  customer: {
    fullName: "",
    email: "",
    phone: ""
  },

  servicio: null,
  servicioPersonalizado: false,
  servicioPersonalizadoDescripcion: "",

  fechaMudanzaISO: "",
  fechaMudanzaLabel: "",
  fechaMudanzaEsMismaSemana: false,

  tipoRuta: null,
  distanciaKm: 0,
  tipoMudanza: null,
  inmuebleOrigen: null,

  precioBase: 0,
  precioFinal: 0,

  tarifaAplicadaLabel: "",
  precioKmAplicado: 0,
  descuentoAplicadoPct: 0,
  tiempoEstimadoServicio: "",

  direccionFase: "origen",

  origenDireccion: "",
  destinoDireccion: "",
  origenPlaceId: "",
  destinoPlaceId: "",

  origenLatLng: null,
  destinoLatLng: null,

  routeDistanceMeters: 0,
  routeDistanceText: "",
  routeDurationText: "",

  accessContext: "origen",

  delicados: null,
  delicadosDescripcion: "",

  itemsMudanza: [],

  deseaBodegaje: null,
  diasBodegaje: 0,

  autoSharedApplied: false,
  autoSharedMessage: "",

  origen: {
    inmueble: null,
    pisos: 1,
    hayAscensor: null,
    noCabe: null,
    descripcion: "",
    especiales: [],
    camionMenos40m: null,
    metrosExtra: 0
  },

  destino: {
    inmueble: null,
    pisos: 1,
    hayAscensor: null,
    noCabe: null,
    descripcion: "",
    especiales: [],
    camionMenos40m: null,
    metrosExtra: 0
  }
};