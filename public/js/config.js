export const TARIFAS = {
  M3_ESTANDAR: 40000,

  RECARGOS: {
    POR_PISO_ESCALERA: 5000,       // por piso (si NO hay ascensor)
    FACHADA_MANUAL: 15000,         // recargo por m3 (especiales)
    FACHADA_MONTACARGA: 20000,     // recargo por m3 (especiales)
    POR_20M_ADICIONAL: 8000        // por cada 20m extra
  },

  RUTAS: {
    URBANO: {
      KM_MIN: 12,
      PRECIO_MIN: 60000,
      COSTO_OPERATIVO_KM: 4000,
      UTILIDAD: 0.30,
      COSTO_PUBLICO_KM: 5200,

      COMPARTIDA: {
        DESCUENTO: 0.15,
        PRECIO_KM: 4420,
        AGRESIVA: { DESCUENTO: 0.20, PRECIO_KM: 4160 }
      }
    },

    NACIONAL: {
      KM_MIN: 20,
      PRECIO_MIN: 140000,
      COSTO_OPERATIVO_KM: 5300,
      UTILIDAD: 0.30,
      COSTO_PUBLICO_KM: 7000,

      COMPARTIDA: {
        DESCUENTO: 0.15,
        PRECIO_KM: 5950,
        AGRESIVA: { DESCUENTO: 0.20, PRECIO_KM: 5600 }
      }
    }
  }
};