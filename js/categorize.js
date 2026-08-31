/** Place categorization — fine-grained rules from name + description */
window.PlaceCategorize = (() => {
  const RULES = [
    { cat: "brunch", re: /\b(brunch|brunch spot|eggs benedict|shakshuka)\b/i },
    { cat: "sandwich", re: /\b(sandwich|deli|sub shop|panini|hoagie|banh mi)\b/i },
    { cat: "fish_chips", re: /\b(fish and chips|fish & chips|chippy)\b/i },
    { cat: "wine_bar", re: /\b(wine bar|enoteca|wine tasting)\b/i },
    { cat: "cocktail_bar", re: /\b(cocktail bar|mixology|martini)\b/i },
    { cat: "pizza", re: /\b(pizza|pizzeria|neapolitan|margherita|pepperoni)\b/i },
    { cat: "burger", re: /\b(burger|hamburger|cheeseburger|smash burger|shake shack|in-n-out|five guys)\b/i },
    { cat: "bagel", re: /\b(bagel|bagels)\b/i },
    { cat: "sushi", re: /\b(sushi|sashimi|nigiri|omakase|maki)\b/i },
    { cat: "ramen", re: /\b(ramen|tonkotsu|shoyu|miso ramen)\b/i },
    { cat: "taco", re: /\b(taco|taqueria|burrito|quesadilla|mexican grill)\b/i },
    { cat: "vegan", re: /\b(vegan|plant[- ]based|vegetarian restaurant)\b/i },
    { cat: "dim_sum", re: /\b(dim sum|dumpling|xiaolongbao|bao bun|gyoza)\b/i },
    { cat: "indian", re: /\b(indian|curry house|tandoori|biryani|masala|naan)\b/i },
    { cat: "asian_restaurant", re: /\b(asian|chinese|japanese|korean|thai|vietnamese|pho|izakaya|yakitori|hotpot|bibimbap|pad thai|udon|soba|wok|teriyaki)\b/i },
    { cat: "italian_restaurant", re: /\b(italian|pasta|trattoria|osteria|risotto)\b/i },
    { cat: "french_restaurant", re: /\b(french|brasserie|bistro|crêperie|creperie)\b/i },
    { cat: "middle_eastern", re: /\b(shawarma|falafel|hummus|kebab|mezze|lebanese|israeli|turkish grill)\b/i },
    { cat: "seafood", re: /\b(seafood|oyster|crab|lobster|fish market)\b/i },
    { cat: "steakhouse", re: /\b(steakhouse|steak house|chophouse|bbq|barbecue|smokehouse)\b/i },
    { cat: "museum", re: /\b(museum|gallery|exhibit|memorial)\b/i },
    { cat: "monument", re: /\b(monument|statue|obelisk|mausoleum)\b/i },
    { cat: "skyscraper", re: /\b(tower|skyscraper|observation deck|observatory|spire)\b/i },
    { cat: "amusement", re: /\b(disney|universal|theme park|amusement|roller|water park|legoland)\b/i },
    { cat: "park", re: /\b(park|garden|botanical|national park|reserve|forest|trail|arboretum)\b/i },
    { cat: "beach", re: /\b(beach|coast|shore|bay|cove)\b/i },
    { cat: "street_food", re: /\b(street food|food stall|night market|hawker|food court)\b/i },
    { cat: "market", re: /\b(farmers market|food market|bazaar|souk|mercado)\b/i },
    { cat: "bakery", re: /\b(bakery|patisserie|pastry|boulangerie|donut|doughnut|croissant)\b/i },
    { cat: "cafe", re: /\b(cafe|café|coffee|espresso|starbucks|tea house)\b/i },
    { cat: "dessert", re: /\b(dessert|ice cream|gelato|sweets|chocolate|cupcake|waffle|macaron)\b/i },
    { cat: "bar", re: /\b(bar|pub|tavern|cocktail|speakeasy|wine bar)\b/i },
    { cat: "nightlife", re: /\b(club|nightclub|disco|lounge|karaoke)\b/i },
    { cat: "brewery", re: /\b(brewery|brewpub|distillery|winery|vineyard)\b/i },
    { cat: "restaurant", re: /\b(restaurant|diner|eatery|grill|kitchen|bistro)\b/i },
    { cat: "shopping", re: /\b(mall|shopping|outlet|boutique|department store)\b/i },
    { cat: "temple", re: /\b(temple|shrine|mosque|synagogue|church|cathedral|chapel|monastery)\b/i },
    { cat: "landmark", re: /\b(palace|castle|fort|bridge|square|plaza|gate|ruins|historic|old town|unesco)\b/i },
    { cat: "viewpoint", re: /\b(viewpoint|lookout|scenic|panorama|overlook)\b/i },
    { cat: "zoo", re: /\b(zoo|aquarium|safari|wildlife)\b/i },
    { cat: "stadium", re: /\b(stadium|arena|sports|football|soccer|baseball)\b/i },
    { cat: "show", re: /\b(theater|theatre|concert|opera|show|performance|cabaret|musical)\b/i },
    { cat: "hotel", re: /\b(hotel|hostel|resort|inn|ryokan|lodging)\b/i },
    { cat: "transport", re: /\b(station|airport|terminal|metro|subway|train|bus stop|ferry)\b/i },
  ];

  const LABELS = {
    place: "Places", brunch: "Brunch", sandwich: "Sandwiches & Delis", fish_chips: "Fish & Chips",
    wine_bar: "Wine Bars", cocktail_bar: "Cocktail Bars",
    pizza: "Pizza", burger: "Burgers", bagel: "Bagels", sushi: "Sushi",
    ramen: "Ramen", taco: "Tacos & Mexican", vegan: "Vegan & Vegetarian", dim_sum: "Dim Sum & Dumplings",
    indian: "Indian", asian_restaurant: "Asian Restaurants", italian_restaurant: "Italian Restaurants",
    french_restaurant: "French Restaurants", middle_eastern: "Middle Eastern", seafood: "Seafood",
    steakhouse: "Steak & BBQ", museum: "Museums", monument: "Monuments", skyscraper: "Skyscrapers & Towers",
    amusement: "Amusement Parks", park: "Parks & Nature", beach: "Beaches", restaurant: "Restaurants",
    street_food: "Street Food", market: "Markets", bakery: "Bakeries", cafe: "Cafés & Coffee",
    dessert: "Desserts & Sweets", bar: "Bars", nightlife: "Nightlife & Clubs", brewery: "Breweries & Wineries",
    shopping: "Shopping", temple: "Temples & Churches", landmark: "Landmarks", viewpoint: "Viewpoints",
    zoo: "Zoos & Aquariums", stadium: "Stadiums & Sports", show: "Shows & Entertainment",
    hotel: "Hotels & Lodging", transport: "Transport",
  };

  const EAT_CATS = new Set([
    "pizza", "burger", "bagel", "sushi", "ramen", "taco", "vegan", "dim_sum", "indian",
    "brunch", "sandwich", "fish_chips", "wine_bar", "cocktail_bar",
    "asian_restaurant", "italian_restaurant", "french_restaurant", "middle_eastern",
    "seafood", "steakhouse", "restaurant", "street_food", "market", "bakery", "cafe", "dessert",
  ]);

  function categorize(name, desc) {
    const text = `${name || ""} ${desc || ""}`;
    for (const { cat, re } of RULES) if (re.test(text)) return cat;
    return "place";
  }

  function label(cat) {
    return LABELS[cat] || String(cat || "place").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function parseCity(desc, countryName) {
    const parts = String(desc || "").split("|").map((p) => p.trim());
    if (parts.length >= 1 && parts[0] && parts[0] !== countryName) return parts[0];
    return "Other";
  }

  function isEatCategory(cat) { return EAT_CATS.has(cat); }

  function defaultSlot(cat) {
    if (["bagel", "bakery", "cafe"].includes(cat)) return "breakfast";
    if (["pizza", "burger", "taco", "ramen", "sushi", "dim_sum", "street_food", "market"].includes(cat)) return "lunch";
    if (EAT_CATS.has(cat)) return "dinner";
    if (["bar", "nightlife", "brewery"].includes(cat)) return "drinks";
    if (cat === "dessert") return "dessert";
    if (cat === "show") return "show";
    if (cat === "hotel") return "hotel";
    if (cat === "transport") return "transport";
    if (["museum", "landmark", "monument", "viewpoint", "temple"].includes(cat)) return "activity";
    if (["park", "beach", "amusement", "zoo"].includes(cat)) return "afternoon";
    return "activity";
  }

  return { categorize, label, LABELS, parseCity, allLabels: () => ({ ...LABELS }), isEatCategory, defaultSlot, RULES };
})();
