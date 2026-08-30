/** Place categorization — mirrors build-data.js rules for runtime edits */
window.PlaceCategorize = (() => {
  const RULES = [
    { cat: "museum", re: /\b(museum|gallery|exhibit|memorial|monument)\b/i },
    { cat: "skyscraper", re: /\b(tower|skyscraper|observation deck|observatory|spire)\b/i },
    { cat: "amusement", re: /\b(disney|universal|theme park|amusement|roller|water park|legoland)\b/i },
    { cat: "park", re: /\b(park|garden|botanical|national park|reserve|forest|trail)\b/i },
    { cat: "beach", re: /\b(beach|coast|shore|bay)\b/i },
    { cat: "restaurant", re: /\b(restaurant|bistro|brasserie|steakhouse|diner|eatery|izakaya|ramen|sushi|pizza|burger|grill)\b/i },
    { cat: "street_food", re: /\b(street food|food stall|night market|hawker|food court)\b/i },
    { cat: "cafe", re: /\b(cafe|café|coffee|bakery|patisserie|starbucks|espresso)\b/i },
    { cat: "bar", re: /\b(bar|pub|tavern|cocktail|brewery|winery|distillery)\b/i },
    { cat: "shopping", re: /\b(mall|shopping|outlet|boutique|department store)\b/i },
    { cat: "temple", re: /\b(temple|shrine|mosque|synagogue|church|cathedral|chapel|monastery)\b/i },
    { cat: "landmark", re: /\b(palace|castle|fort|bridge|square|plaza|gate|ruins|historic)\b/i },
    { cat: "zoo", re: /\b(zoo|aquarium|safari|wildlife)\b/i },
    { cat: "stadium", re: /\b(stadium|arena|sports|football|soccer|baseball)\b/i },
    { cat: "hotel", re: /\b(hotel|hostel|resort|inn|ryokan)\b/i },
    { cat: "transport", re: /\b(station|airport|terminal|metro|subway|train)\b/i },
  ];

  const LABELS = {
    place: "Places",
    museum: "Museums",
    skyscraper: "Skyscrapers & Towers",
    amusement: "Amusement Parks",
    park: "Parks & Nature",
    beach: "Beaches",
    restaurant: "Restaurants",
    street_food: "Street Food & Markets",
    cafe: "Cafés & Bakeries",
    bar: "Bars & Nightlife",
    shopping: "Shopping",
    temple: "Temples & Churches",
    landmark: "Landmarks",
    zoo: "Zoos & Aquariums",
    stadium: "Stadiums & Sports",
    hotel: "Hotels",
    transport: "Transport",
  };

  function categorize(name, desc) {
    const text = `${name || ""} ${desc || ""}`;
    for (const { cat, re } of RULES) if (re.test(text)) return cat;
    return "place";
  }

  function label(cat) {
    return LABELS[cat] || cat;
  }

  function parseCity(desc, countryName) {
    const parts = String(desc || "").split("|").map((p) => p.trim());
    if (parts.length >= 1 && parts[0] && parts[0] !== countryName) return parts[0];
    return "Other";
  }

  return { categorize, label, LABELS, parseCity };
})();
