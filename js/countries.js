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
};
