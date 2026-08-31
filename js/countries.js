/** Country metadata + ISO codes for flags */
window.CountryMeta = {
  byId: {},
  list: [],

  /** Map our display names → Natural Earth / world-atlas country names */
  atlasName: {
    "United States": "United States of America",
    "United Kingdom": "United Kingdom",
    "South Korea": "South Korea",
    "North Korea": "North Korea",
    "Czechia": "Czechia",
    "Russia": "Russia",
    "Hong Kong": "Hong Kong",
    Macao: "Macao",
    Taiwan: "Taiwan",
    Slovenia: "Slovenia",
    Croatia: "Croatia",
    Georgia: "Georgia",
    Argentina: "Argentina",
    Brazil: "Brazil",
    Chile: "Chile",
    Netherlands: "Netherlands",
  },

  /** Manual pin centers where atlas match fails (lat, lng) */
  pinCenter: {
    "hong-kong": { lat: 22.3193, lng: 114.1694 },
    macao: { lat: 22.1987, lng: 113.5439 },
    taiwan: { lat: 23.6978, lng: 120.9605 },
    argentina: { lat: -34.6037, lng: -58.3816 },
    brazil: { lat: -15.7939, lng: -47.8828 },
    chile: { lat: -33.4489, lng: -70.6693 },
    "united-states": { lat: 39.8283, lng: -98.5795 },
    "united-kingdom": { lat: 54.0, lng: -2.5 },
    georgia: { lat: 42.3154, lng: 43.3569 },
    israel: { lat: 31.5, lng: 34.75 },
    iceland: { lat: 64.9631, lng: -19.0208 },
    norway: { lat: 64.5, lng: 11.5 },
    finland: { lat: 64.0, lng: 26.0 },
    japan: { lat: 36.2048, lng: 138.2529 },
    china: { lat: 35.8617, lng: 104.1954 },
    thailand: { lat: 15.87, lng: 100.9925 },
    singapore: { lat: 1.3521, lng: 103.8198 },
    australia: { lat: -25.2744, lng: 133.7751 },
  },

  init(countries) {
    this.list = countries || [];
    this.byId = {};
    for (const c of this.list) this.byId[c.id] = c;
  },

  flagUrl(iso, size = 40) {
    const code = String(iso || "un").toLowerCase();
    return `https://flagcdn.com/w${size}/${code}.png`;
  },

  label(id) {
    return this.byId[id]?.name || id;
  },

  atlasLookupName(countryName) {
    return this.atlasName[countryName] || countryName;
  },

  pinCenterFor(id) {
    return this.pinCenter[id] || null;
  },
};
