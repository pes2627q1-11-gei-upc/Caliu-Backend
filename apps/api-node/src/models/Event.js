import mongoose from 'mongoose';

const { Schema } = mongoose;

// Ubicació com a GeoJSON Point. ATENCIÓ: l'ordre és [longitud, latitud].
// (A l'UML era una classe "Ubicació" pertanyent a un únic Esdeveniment -> aquí va embeguda.)
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) =>
          Array.isArray(v) && v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90,
        message: 'coordinates ha de ser [longitud, latitud] amb valors vàlids',
      },
    },
  },
  { _id: false },
);

const eventSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true }, // codi de l'agenda cultural
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    startDate: { type: Date, required: true },
    endDate: { type: Date }, // si falta, es posa igual que startDate
    schedule: { type: String, default: '' }, // horari en text lliure, tal com ve de la font

    venue: { type: String, default: '' }, // nom de l'espai
    address: { type: String, default: '' },
    municipality: { type: String, default: '' },
    comarca: { type: String, default: '' },
    location: { type: pointSchema, default: undefined }, // opcional: hi ha events sense coordenades

    categories: { type: [String], default: [] }, // vegeu domain/eventCategories.js
    tags: { type: [String], default: [] },

    price: { type: Number, min: 0 }, // 0 = gratuït; sense valor = desconegut
    url: { type: String, default: '' },
    images: { type: [String], default: [] },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },

    source: { type: String, default: 'ingest' }, // 'ingest' (dades reals) o 'seed' (dades de prova)
  },
  { timestamps: true },
);

eventSchema.pre('validate', function (next) {
  if (!this.endDate) this.endDate = this.startDate;
  if (this.startDate && this.endDate < this.startDate) {
    this.invalidate('endDate', 'endDate ha de ser >= startDate');
  }
  next();
});

// Índexs: el 2dsphere és imprescindible per al filtre per radi i per al NFR de < 500 ms.
eventSchema.index({ location: '2dsphere' });
eventSchema.index({ startDate: 1, endDate: 1 });
eventSchema.index({ categories: 1 });

// ÚNICA col·lecció de la base de dades: `esdeveniments`. L'omple el trigger d'Atlas
// (docs/atlas/daily_agenda_sync.js) directament amb aquest esquema. Si es canvia aquí, cal canviar-ho allà.
export default mongoose.model('Event', eventSchema, 'esdeveniments');
