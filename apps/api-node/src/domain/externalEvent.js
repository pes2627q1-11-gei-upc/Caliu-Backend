// DTO dels esdeveniments per als clients externs (#213), segons el contracte amb Xematrip:
// només títol, dates, horari, ubicació (adreça, municipi, comarca i coordenades), etiquetes
// i enllaç oficial. Llista explícita: no surt la descripció, categories, preu, imatges,
// contacte ni cap camp intern.
//
// És lògica pura (no toca la base de dades): viu a domain/ i no a models/Event.js perquè
// diversos tests substitueixen aquell mòdul sencer per un model simulat.
export function externalEvent(event) {
  return {
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate ?? null,
    schedule: event.schedule ?? '',
    location: {
      address: event.address ?? '',
      municipality: event.municipality ?? '',
      comarca: event.comarca ?? '',
      coordinates: event.location?.coordinates ? [...event.location.coordinates] : null, // [lng, lat]
    },
    tags: [...(event.tags ?? [])],
    url: event.url ?? '',
  };
}
