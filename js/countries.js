/** Country metadata + ISO codes for flags */
window.CountryMeta = {
  byId: {},
  list: [],

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
};
