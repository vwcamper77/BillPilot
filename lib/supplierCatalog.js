function normaliseText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

const GENERIC_UTILITY_TOKENS = new Set([
  "and",
  "bill",
  "broadband",
  "bundle",
  "data",
  "electric",
  "electricity",
  "energy",
  "fibre",
  "fiber",
  "gas",
  "home",
  "internet",
  "landline",
  "meter",
  "mobile",
  "phone",
  "power",
  "sewer",
  "sewerage",
  "sim",
  "telecom",
  "telecoms",
  "tv",
  "utilities",
  "utility",
  "waste",
  "wastewater",
  "water",
  "wifi",
]);

const COUNTRY_ALIASES = {
  UK: ["uk", "united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  US: ["us", "usa", "united states", "united states of america", "america"],
  CA: ["canada"],
  AU: ["au", "australia"],
  NZ: ["nz", "new zealand", "aotearoa"],
};

const REGION_ALIASES = {
  UK: {
    ENG: ["england"],
    SCT: ["scotland"],
    WLS: ["wales"],
    NIR: ["northern ireland", "ni"],
  },
  US: {
    AL: ["alabama", "al"],
    AK: ["alaska", "ak"],
    AZ: ["arizona", "az"],
    AR: ["arkansas", "ar"],
    CA: ["california", "ca"],
    CO: ["colorado", "co"],
    CT: ["connecticut", "ct"],
    DC: ["district of columbia", "dc", "washington dc"],
    DE: ["delaware", "de"],
    FL: ["florida", "fl"],
    GA: ["georgia", "ga"],
    HI: ["hawaii", "hi"],
    IA: ["iowa", "ia"],
    ID: ["idaho", "id"],
    IL: ["illinois", "il"],
    IN: ["indiana", "in"],
    KS: ["kansas", "ks"],
    KY: ["kentucky", "ky"],
    LA: ["louisiana", "la"],
    MA: ["massachusetts", "ma"],
    MD: ["maryland", "md"],
    ME: ["maine", "me"],
    MI: ["michigan", "mi"],
    MN: ["minnesota", "mn"],
    MO: ["missouri", "mo"],
    MS: ["mississippi", "ms"],
    MT: ["montana", "mt"],
    NC: ["north carolina", "nc"],
    ND: ["north dakota", "nd"],
    NE: ["nebraska", "ne"],
    NH: ["new hampshire", "nh"],
    NJ: ["new jersey", "nj"],
    NM: ["new mexico", "nm"],
    NV: ["nevada", "nv"],
    NY: ["new york", "ny"],
    OH: ["ohio", "oh"],
    OK: ["oklahoma", "ok"],
    OR: ["oregon", "or"],
    PA: ["pennsylvania", "pa"],
    RI: ["rhode island", "ri"],
    SC: ["south carolina", "sc"],
    SD: ["south dakota", "sd"],
    TN: ["tennessee", "tn"],
    TX: ["texas", "tx"],
    UT: ["utah", "ut"],
    VA: ["virginia", "va"],
    VT: ["vermont", "vt"],
    WA: ["washington", "wa"],
    WI: ["wisconsin", "wi"],
    WV: ["west virginia", "wv"],
    WY: ["wyoming", "wy"],
  },
  CA: {
    AB: ["alberta", "ab"],
    BC: ["british columbia", "bc"],
    MB: ["manitoba", "mb"],
    NB: ["new brunswick", "nb"],
    NL: ["newfoundland and labrador", "newfoundland", "labrador", "nl"],
    NS: ["nova scotia", "ns"],
    NT: ["northwest territories", "nt"],
    NU: ["nunavut", "nu"],
    ON: ["ontario", "on"],
    PE: ["prince edward island", "pei", "pe"],
    QC: ["quebec", "québec", "qc"],
    SK: ["saskatchewan", "sk"],
    YT: ["yukon", "yt"],
  },
  AU: {
    ACT: ["australian capital territory", "act", "canberra"],
    NSW: ["new south wales", "nsw", "sydney"],
    NT: ["northern territory", "nt", "darwin"],
    QLD: ["queensland", "qld", "brisbane"],
    SA: ["south australia", "sa", "adelaide"],
    TAS: ["tasmania", "tas", "hobart"],
    VIC: ["victoria", "vic", "melbourne"],
    WA: ["western australia", "wa", "perth"],
  },
  NZ: {
    AUK: ["auckland"],
    WGN: ["wellington"],
    CAN: ["canterbury", "christchurch"],
    OTA: ["otago", "dunedin"],
    WKO: ["waikato", "hamilton"],
    BOP: ["bay of plenty", "tauranga"],
    STL: ["southland", "invercargill"],
    NTL: ["northland", "whangarei"],
    HKB: ["hawkes bay", "napier", "hastings"],
    MWT: ["manawatu", "palmerston north"],
    TKI: ["taranaki", "new plymouth"],
    NSN: ["nelson", "tasman"],
    QTL: ["queenstown", "queenstown lakes"],
  },
};

function normaliseCountryCode(value) {
  if (!value) {
    return "";
  }

  const text = normaliseText(value);

  return Object.entries(COUNTRY_ALIASES).find(([, aliases]) => aliases.includes(text))?.[0] || "";
}

function findRegionCode(value, countryCode = "") {
  const text = normaliseText(value);

  if (!text) {
    return "";
  }

  const countries = countryCode ? [countryCode] : Object.keys(REGION_ALIASES);

  for (const code of countries) {
    const match = Object.entries(REGION_ALIASES[code] || {}).find(([, aliases]) => aliases.includes(text));

    if (match) {
      return match[0];
    }
  }

  return "";
}

function detectCountryHint(value, selectedCountry = "") {
  const explicitCountry = normaliseCountryCode(selectedCountry);

  if (explicitCountry) {
    return explicitCountry;
  }

  const text = ` ${normaliseText(value)} `;

  if (!text.trim()) {
    return "";
  }

  for (const [countryCode, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((alias) => text.includes(` ${alias} `))) {
      return countryCode;
    }
  }

  for (const countryCode of Object.keys(REGION_ALIASES)) {
    const regions = Object.values(REGION_ALIASES[countryCode] || {}).flat();

    if (regions.some((alias) => text.includes(` ${normaliseText(alias)} `))) {
      return countryCode;
    }
  }

  return "";
}

function detectRegionHint(value, countryHint = "", selectedRegion = "") {
  const explicitRegion = findRegionCode(selectedRegion, normaliseCountryCode(countryHint));

  if (explicitRegion) {
    return explicitRegion;
  }

  const text = ` ${normaliseText(value)} `;
  const countryCode = normaliseCountryCode(countryHint) || detectCountryHint(value);

  if (!text.trim() || !countryCode) {
    return "";
  }

  const regions = REGION_ALIASES[countryCode] || {};

  return Object.entries(regions).find(([, aliases]) =>
    aliases.some((alias) => text.includes(` ${normaliseText(alias)} `)))?.[0] || "";
}

function createSupplier({
  name,
  country,
  categories,
  defaultCategory = categories[0] || "",
  aliases = [],
  legacyNames = [],
  regions = [],
}) {
  return {
    name,
    country,
    categories,
    defaultCategory,
    aliases: uniq([name, ...aliases, ...legacyNames].map(normaliseText)),
    regions: uniq(regions.map((region) => findRegionCode(region, country) || String(region).toUpperCase())),
  };
}

function suppliersFromText(country, categories, block, options = {}) {
  return String(block || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [head, ...aliasParts] = line.split("|").map((part) => part.trim()).filter(Boolean);
      const [name, regionPart = ""] = head.split("@").map((part) => part.trim());
      const regions = regionPart ? regionPart.split(",").map((part) => part.trim()) : [];
      return createSupplier({
        name,
        country,
        categories,
        defaultCategory: Object.prototype.hasOwnProperty.call(options, "defaultCategory")
          ? options.defaultCategory
          : categories[0] || "",
        aliases: aliasParts,
        legacyNames: options.legacyNames?.[name] || [],
        regions,
      });
    });
}

function levenshtein(a, b) {
  const left = normaliseText(a);
  const right = normaliseText(b);

  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const rows = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) {
    rows[i][0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    rows[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
    }
  }

  return rows[left.length][right.length];
}

function scoreAliasMatch(candidate, alias) {
  if (!candidate || !alias) {
    return 0;
  }

  if (candidate === alias) {
    return 1;
  }

  const paddedCandidate = ` ${candidate} `;
  const paddedAlias = ` ${alias} `;

  if (paddedCandidate.includes(paddedAlias)) {
    return 0.97;
  }

  if (alias.length >= 6 && paddedAlias.includes(paddedCandidate)) {
    return 0.88;
  }

  const candidateTokens = candidate.split(" ");
  const aliasTokens = alias.split(" ");
  const overlappingTokens = aliasTokens.filter((token) => candidateTokens.includes(token));

  if (overlappingTokens.length === aliasTokens.length && aliasTokens.length >= 2) {
    return 0.91;
  }

  const maxLength = Math.max(candidate.length, alias.length);

  if (maxLength >= 5) {
    const distance = levenshtein(candidate, alias);
    const similarity = 1 - distance / maxLength;

    if (similarity >= 0.9) {
      return 0.9;
    }

    if (similarity >= 0.84) {
      return 0.82;
    }
  }

  return 0;
}

function hasDistinctiveTokens(text) {
  const tokens = normaliseText(text).split(" ").filter(Boolean);
  return tokens.some((token) => token.length >= 3 && !GENERIC_UTILITY_TOKENS.has(token));
}

const UK_SUPPLIERS = [
  ...suppliersFromText("UK", ["gas_electricity"], `
British Gas
Octopus Energy|Octopus
E.ON Next|E.ON|EON|EON Next
EDF Energy|EDF
ScottishPower|Scottish Power
OVO Energy|OVO|Ovo Energy
SSE Energy|SSE
So Energy
Utility Warehouse
Utilita
Ecotricity
Good Energy
100Green
Green Energy UK
Co-operative Energy|Co operative Energy|Coop Energy
Shell Energy
Fuse Energy
Tomato Energy
Rebel Energy
Outfox the Market
Foxglove Energy
E Gas and Electricity
E Energy
Tru Energy
Valda Energy
Yu Energy
Opus Energy
Drax Energy Solutions|Drax
Bryt Energy
Corona Energy
TotalEnergies Gas and Power|Total Energies
SmartestEnergy
SmartestEnergy Business
Engie
Pozitive Energy
Maxen Power
D-ENERGi|D Energi
United Gas and Power
Crown Gas and Power
SEFE Energy
Brook Green Energy
Axpo
Hartree Partners
Evolve Energy
Home Energy Trading
Jellyfish Energy
DGP Energy
Square1 Energy
Toucan Energy
Unify Energy
Voltx Energy
Constellation Energy
NEAS Energy
Electroroute Energy
Eneco
SQE Energy
Flogas
Macquarie Energy
Ceres Energy
Bulb
Avro Energy
Pure Planet
Together Energy
People's Energy|Peoples Energy
Tonik Energy
Green Network Energy
Igloo Energy
Symbio Energy
PFP Energy
Orbit Energy
Neon Reef
GOTO Energy
Hub Energy
Social Energy
MoneyPlus Energy
Entice Energy
Simplicity Energy
Extra Energy
Iresa
Robin Hood Energy
Spark Energy
Breeze Energy
Yorkshire Energy
Nabuh Energy
`, { defaultCategory: "gas_electricity" }),
  ...suppliersFromText("UK", ["gas"], `
Regent Gas
Gas Plus Supply
UK Gas Supply
UK National Gas
OPAL Gas
BP Gas Marketing
Ruby Gas
Economy Gas
Npower Commercial Gas
`, { defaultCategory: "gas" }),
  ...suppliersFromText("UK", ["electricity"], `
Regent Power
Marble Power
Digital Power Energy Supply
Sinq Power
Voltx Power
Tesla Energy
Tesla Energy Ventures
Electricity Plus
Highland Electricity
Flexitricity
Ruby Electricity
Zebra Power
`, { defaultCategory: "electricity" }),
  ...suppliersFromText("UK", ["water"], `
Anglian Water
Dwr Cymru / Welsh Water|Welsh Water|Dwr Cymru
Hafren Dyfrdwy
Northumbrian Water
Essex and Suffolk Water|Essex and Suffolk Water
Severn Trent Water|Severn Trent
South West Water
Bournemouth Water
Bristol Water
Southern Water
Thames Water
United Utilities
Wessex Water
Yorkshire Water
Affinity Water
Portsmouth Water
South East Water
South Staffs Water
Cambridge Water
SES Water
Hartlepool Water
Albion Water
Independent Water Networks|IWNL
SSE Water
Leep Water Networks
Veolia Water Projects
Scottish Water
Northern Ireland Water|NI Water
`, { defaultCategory: "water" }),
  ...suppliersFromText("UK", ["broadband"], `
BT
EE Broadband|EE
Plusnet
Sky Broadband|Sky
NOW Broadband
TalkTalk
Virgin Media
Virgin Media O2
Vodafone Broadband|Vodafone
Utility Warehouse Broadband
Zen Internet
Hyperoptic
Community Fibre
Gigaclear
KCOM
Three Broadband|Three Home Broadband
Cuckoo
Shell Energy Broadband
John Lewis Broadband
Origin Broadband
SSE Broadband
Post Office Broadband
Onestream
Direct Save Telecom
POP Telecom
Andrews and Arnold|AAISP
IDNet
Aquiss
Uno
Freeola
Cerberus Networks
BRSK|Brsk
B4RN
GoFibre
Grain Connect
Truespeed
WightFibre
Ogi
Toob
Lit Fibre
Trooli
G.Network|G Network
Swish Fibre
Jurassic Fibre
Connect Fibre
Lightning Fibre
Quickline
Fibrus
YouFibre
Netomnia
Zzoomm
Voneus
Airband
County Broadband
Wildanet
4th Utility
Hey! Broadband|Hey Broadband
Lightspeed Broadband
Freedom Fibre
Pine Media
Starlink
National Broadband
Kijoma
Boundless Networks
CityFibre
Openreach
Nexfibre
`, { defaultCategory: "broadband" }),
  ...suppliersFromText("UK", ["mobile"], `
EE
O2
Vodafone
Three
VodafoneThree
BT Mobile
Virgin Mobile
giffgaff
Tesco Mobile
Sky Mobile
iD Mobile|ID Mobile
SMARTY
VOXI
Lebara
Lyca Mobile
Asda Mobile
Talkmobile
1pMobile
Utility Warehouse Mobile
Spusu
Superdrug Mobile
Your Co-op Mobile
Ecotalk
1GLOBAL
Truphone
Honest Mobile
CMLink
Talk Home Mobile
RWG Mobile
Anywhere SIM
Mozillion
Plan.com|Plan Com
Gamma Mobile
The Phone Co-op
Plusnet Mobile
Sainsbury's Mobile|Sainsburys Mobile
Post Office Mobile
TalkTalk Mobile
`, { defaultCategory: "mobile" }),
  ...suppliersFromText("UK", ["homecare"], `
British Gas HomeCare
HomeServe
`, { defaultCategory: "homecare" }),
];

const US_SUPPLIERS = [
  ...suppliersFromText("US", ["gas_electricity"], `
American Electric Power|AEP
AEP Ohio@OH
AEP Texas@TX
Appalachian Power
Indiana Michigan Power@IN,MI
Kentucky Power@KY
Public Service Company of Oklahoma@OK
Southwestern Electric Power
Ameren
Ameren Illinois@IL
Ameren Missouri@MO
Alliant Energy
Alabama Power@AL
Alaska Electric Light and Power@AK
Arizona Public Service@AZ|APS
Austin Energy@TX
Avangrid
Central Maine Power@ME
NYSEG@NY
Rochester Gas and Electric@NY
BGE@MD|Baltimore Gas and Electric
Black Hills Energy
CenterPoint Energy
Cleco@LA
ComEd@IL|Commonwealth Edison
Con Edison@NY|Consolidated Edison|ConEd
Consumers Energy@MI
Dominion Energy
DTE Energy@MI
Duke Energy
Duke Energy Carolinas
Duke Energy Progress
Duke Energy Florida@FL
Duke Energy Indiana@IN
Duquesne Light@PA
Entergy
Entergy Arkansas@AR
Entergy Louisiana@LA
Entergy Mississippi@MS
Entergy New Orleans@LA
Entergy Texas@TX
Eversource
Evergy
FirstEnergy
Ohio Edison@OH
The Illuminating Company@OH
Toledo Edison@OH
Penelec@PA
Met-Ed@PA
Penn Power@PA
West Penn Power@PA
Mon Power@WV
Potomac Edison@MD,WV
Jersey Central Power and Light@NJ|JCP&L|JCP and L
Florida Power and Light@FL|FPL
Georgia Power@GA
Green Mountain Energy@TX
Hawaiian Electric@HI|HECO
Idaho Power@ID
AES Indiana@IN|Indianapolis Power and Light|IPL
Liberty Utilities
Los Angeles Department of Water and Power@CA|LADWP
Madison Gas and Electric@WI|MGE
Memphis Light Gas and Water@TN|MLGW
National Grid
New Jersey Natural Gas@NJ
Nicor Gas@IL
NiSource
Columbia Gas
NIPSCO@IN|Northern Indiana Public Service Company
NV Energy@NV
Orange and Rockland@NY
Otter Tail Power
Pacific Gas and Electric@CA|PG&E|PGE
PECO@PA
Peoples Gas
PPL Electric Utilities@PA
PSE&G@NJ|Public Service Electric and Gas|PSEG
Puget Sound Energy@WA
Rocky Mountain Power
Salt River Project@AZ|SRP
San Diego Gas and Electric@CA|SDG&E|SDGE
Seattle City Light@WA
SMUD@CA|Sacramento Municipal Utility District
Southern California Edison@CA|SCE
Southern Company
SoCalGas@CA|Southern California Gas
Southwest Gas
TECO@FL|Tampa Electric
Tucson Electric Power@AZ
Unitil
Washington Gas
We Energies@WI
Wisconsin Public Service@WI
Xcel Energy
CPS Energy@TX
Oncor@TX
TXU Energy@TX
Reliant Energy@TX
Direct Energy
NRG Energy
Constellation
Ambit Energy
Gexa Energy@TX
Rhythm Energy@TX
Just Energy
Spark Energy
Frontier Utilities@TX
Cirro Energy@TX
Champion Energy@TX
4Change Energy@TX
Payless Power@TX
TriEagle Energy@TX
Tomorrow Energy
Energy Harbor@OH
Clearview Energy
IGS Energy
Santanna Energy
Shipley Energy
U.S. Gas and Electric|US Gas and Electric
Stream Energy
`, { defaultCategory: "gas_electricity" }),
  ...suppliersFromText("US", ["water", "wastewater"], `
American Water|California American Water|Illinois American Water|Indiana American Water|Iowa American Water|Kentucky American Water|Maryland American Water|Missouri American Water|New Jersey American Water|Pennsylvania American Water|Tennessee American Water|Virginia American Water|West Virginia American Water
Aqua|Aqua America|Aqua Pennsylvania|Aqua Ohio|Aqua Illinois
Essential Utilities
Veolia Water
SUEZ Water
San Jose Water@CA
California Water Service@CA|Cal Water
Golden State Water@CA
American States Water@CA
Middlesex Water
Artesian Water
York Water
Connecticut Water
SouthWest Water Company
Liberty Water
EPCOR USA
Tampa Bay Water@FL
Denver Water@CO
DC Water@DC
WSSC Water@MD|Washington Suburban Sanitary Commission
Las Vegas Valley Water District@NV
Southern Nevada Water Authority@NV
Metropolitan Water District of Southern California@CA
Los Angeles Department of Water and Power@CA|LADWP
New York City Water@NY|NYC Water
Chicago Water@IL
Boston Water and Sewer Commission@MA
Philadelphia Water Department@PA
Seattle Public Utilities@WA
Portland Water Bureau@OR
Houston Public Works@TX
Dallas Water Utilities@TX
Austin Water@TX
San Antonio Water System@TX|SAWS
Phoenix Water Services@AZ
Atlanta Watershed Management@GA
Miami-Dade Water and Sewer@FL
Orange County Utilities@FL
JEA@FL
Gwinnett County Water Resources@GA
Fairfax Water@VA
Charlotte Water@NC
Raleigh Water@NC
Columbus Water@OH
Cleveland Water@OH
Detroit Water and Sewerage Department@MI
Great Lakes Water Authority@MI
`, { defaultCategory: null }),
  ...suppliersFromText("US", ["broadband"], `
AT&T|AT and T|ATT
AT&T Fiber|AT and T Fiber|ATT Fiber
Xfinity|Comcast
Spectrum|Charter Spectrum
Verizon Fios
Verizon 5G Home
T-Mobile Home Internet|T Mobile Home Internet
Cox
Optimum
Altice
Frontier
CenturyLink
Quantum Fiber
Lumen
Brightspeed
Windstream
Kinetic by Windstream
Mediacom
Astound Broadband
RCN
Grande
Wave Broadband
WOW!|WideOpenWest
Sparklight|Cable One
Ziply Fiber
Google Fiber
Metronet
Consolidated Communications
Fidium Fiber
Hawaiian Telcom
Breezeline|Atlantic Broadband
Shentel
TDS Telecom
US Internet
Sonic
EPB Fiber
C Spire Fiber
Starry
EarthLink
HughesNet
Viasat
Starlink
Rise Broadband
Nextlink Internet
Armstrong
Hargray
Bluepeak
Vyve Broadband
Buckeye Broadband
Midco
GoNetspeed
Greenlight Networks
Hotwire Communications
ALLO Fiber
Pavlov Media
Lumos Fiber
i3 Broadband
Race Communications
`, { defaultCategory: "broadband" }),
  ...suppliersFromText("US", ["mobile"], `
AT&T|AT and T|ATT
Verizon
T-Mobile|T Mobile
UScellular|US Cellular
Cricket Wireless
Metro by T-Mobile|Metro by T Mobile
Visible
Mint Mobile
Ultra Mobile
Boost Mobile
Tracfone
Straight Talk
Total Wireless
Simple Mobile
Walmart Family Mobile
Consumer Cellular
Google Fi Wireless|Google Fi
Xfinity Mobile
Spectrum Mobile
Optimum Mobile
Cox Mobile
Tello
Ting Mobile
Red Pocket Mobile
US Mobile
H2O Wireless
Lycamobile USA
Hello Mobile
TextNow
Republic Wireless
Twigby
Gen Mobile
Good2Go Mobile
Page Plus
PureTalk
Patriot Mobile
Lively
Assurance Wireless
SafeLink Wireless
Q Link Wireless
TruConnect
AirTalk Wireless
Credo Mobile
`, { defaultCategory: "mobile" }),
];

const CA_SUPPLIERS = [
  ...suppliersFromText("CA", ["gas_electricity"], `
BC Hydro@BC
FortisBC@BC
Hydro-Québec@QC|Hydro Quebec
Hydro One@ON
Ontario Power Generation@ON
Toronto Hydro@ON
Alectra Utilities@ON
Enova Power@ON
Elexicon Energy@ON
London Hydro@ON
Hydro Ottawa@ON|Ottawa Hydro
Burlington Hydro@ON
Oakville Hydro@ON
Milton Hydro@ON
Entegrus@ON
ENWIN Utilities@ON
Festival Hydro@ON
Kingston Hydro@ON
Kitchener-Wilmot Hydro@ON
Newmarket-Tay Power@ON
Niagara Peninsula Energy@ON
Oshawa Power@ON
Peterborough Utilities@ON
Waterloo North Hydro@ON
Essex Powerlines@ON
InnPower@ON
Lakefront Utilities@ON
Orangeville Hydro@ON
Wasaga Distribution@ON
Enbridge Gas@ON|Enbridge|Union Gas
EPCOR@AB
EPCOR Energy@AB
EPCOR Natural Gas@AB
ENMAX@AB
ENMAX Energy@AB
ATCO@AB
ATCO Electric@AB
ATCO Gas@AB
ATCOenergy@AB
Direct Energy
Direct Energy Regulated Services@AB
AltaGas@AB
Apex Utilities@AB
FortisAlberta@AB
SaskPower@SK
SaskEnergy@SK
Manitoba Hydro@MB
NB Power@NB
Nova Scotia Power@NS
Eastward Energy@NS
Maritime Electric@PE
Newfoundland Power@NL
Newfoundland and Labrador Hydro@NL|Hydro Newfoundland|Hydro Labrador
Yukon Energy@YT
ATCO Electric Yukon@YT
Northwest Territories Power Corporation@NT|NTPC
Qulliq Energy@NU
Just Energy
Hudson Energy
XOOM Energy
Link Energy
EasyMax
Encor by EPCOR@AB
Bullfrog Power
`, { defaultCategory: "gas_electricity" }),
  ...suppliersFromText("CA", ["water", "wastewater"], `
Toronto Water@ON|City of Toronto Water
Region of Peel Water@ON|Peel Water
York Region Water@ON
Durham Region Water@ON
Halton Region Water@ON
City of Ottawa Water@ON|Ottawa Water
City of Hamilton Water@ON|Hamilton Water
Waterloo Region Water@ON
Niagara Region Water@ON
City of London Water@ON|London Ontario Water
City of Windsor Water@ON|Windsor Water
City of Vancouver Water@BC|Metro Vancouver Water
City of Surrey Water@BC
City of Burnaby Water@BC
City of Richmond Water@BC
City of Calgary Water@AB|Calgary Water Services
EPCOR Water@AB
City of Edmonton Drainage@AB
City of Winnipeg Water and Waste@MB|Winnipeg Water
Ville de Montréal Water@QC|Montreal Water
Québec City Water@QC
Laval Water@QC
Longueuil Water@QC
Halifax Water@NS|Halifax Regional Water Commission
Saint John Water@NB
City of Moncton Water@NB
Fredericton Water@NB
Charlottetown Water@PE
Regina Water@SK
Saskatoon Water@SK
City of Whitehorse Water@YT
City of Yellowknife Water@NT
Iqaluit Water@NU
`, { defaultCategory: null }),
  ...suppliersFromText("CA", ["broadband", "mobile", "telecom_bundle"], `
Bell|Bell Canada|Bell Mobility|Bell Aliant|Bell MTS
Rogers|Rogers Wireless|Rogers Ignite
Shaw|Shaw Internet|Shaw Mobile
TELUS|TELUS Mobility|TELUS PureFibre
Videotron
Fizz|Fizz Mobile
Freedom Mobile|Freedom Internet
Cogeco
Eastlink|Eastlink Mobile
SaskTel
Tbaytel
Northwestel
Xplore|Xplornet
TekSavvy
Start.ca
Distributel
Primus
VMedia
Oxio
EBOX
Beanfield
Acanac
Carry Telecom
Altima Telecom
CIK Telecom
Execulink
Storm Internet
Coextro
CanNet
Lightspeed Internet
Fido|Fido Internet
Virgin Plus|Virgin Plus Internet
Lucky Mobile|Lucky Mobile Internet
Koodo
Chatr
Public Mobile
PC Mobile
Cityfone
SimplyConnect
Zoomer Wireless
7-Eleven SpeakOut
Petro-Canada Mobility
PhoneBox
Starlink
`, { defaultCategory: null }),
];

const AU_SUPPLIERS = [
  ...suppliersFromText("AU", ["gas_electricity"], `
AGL
Origin Energy
EnergyAustralia
Alinta Energy
Red Energy
Lumo Energy
Momentum Energy
Powershop
Dodo Power and Gas
Commander Power and Gas
Simply Energy
ENGIE
Sumo
Tango Energy
GloBird Energy|Globird|GloBird
Nectr
OVO Energy Australia
Amber Electric
CovaU
Kogan Energy
Diamond Energy
Energy Locals
Aurora Energy@TAS
ActewAGL@ACT
Synergy@WA
Horizon Power@WA
Ergon Energy Retail@QLD
Kleenheat@WA
1st Energy
Blue NRG
Discover Energy
Future X Power
Flo Energy
Pacific Blue
Shell Energy
LPE|Locality Planning Energy
Altogether Group
Arc Energy Group
Powerdirect
Mojo Power
ReAmped Energy
Click Energy
amaysim Energy
QEnergy
People Energy
Sanctuary Energy
Energy Trade
Next Business Energy
ERM Power
Simply Energy Business
AGL Business
Origin Business
EnergyAustralia Business
`, { defaultCategory: "gas_electricity" }),
  ...suppliersFromText("AU", ["water", "wastewater"], `
Sydney Water@NSW
Hunter Water@NSW
WaterNSW@NSW
Melbourne Water@VIC
Yarra Valley Water@VIC
South East Water@VIC
Greater Western Water@VIC
City West Water@VIC
Western Water@VIC
Barwon Water@VIC
Central Highlands Water@VIC
Coliban Water@VIC
East Gippsland Water@VIC
Gippsland Water@VIC
Goulburn Valley Water@VIC
Grampians Wimmera Mallee Water@VIC|GWMWater
Lower Murray Water@VIC
North East Water@VIC
South Gippsland Water@VIC
Wannon Water@VIC
Westernport Water@VIC
SA Water@SA
Urban Utilities@QLD
Queensland Urban Utilities@QLD
Unitywater@QLD
Seqwater@QLD
Logan Water@QLD
Gold Coast Water@QLD
Cairns Regional Council Water@QLD
Townsville Water@QLD
TasWater@TAS
Icon Water@ACT
Power and Water Corporation@NT
Water Corporation WA@WA
Busselton Water@WA
Aqwest@WA
City of Darwin Water@NT
City of Perth Water@WA
City of Adelaide Water@SA
`, { defaultCategory: null }),
  ...suppliersFromText("AU", ["broadband", "mobile", "telecom_bundle"], `
Telstra|Telstra Internet|Telstra Prepaid
Optus|Optus Internet|Optus Prepaid
Vodafone|Vodafone Home Internet|Vodafone Prepaid
TPG|TPG NBN|TPG Mobile
iiNet|iiNet NBN|iiNet Mobile
Internode
Dodo|Dodo Mobile
iPrimus
Aussie Broadband|Aussie Broadband NBN|Aussie Broadband Mobile
Superloop|Superloop NBN|Superloop Mobile
Exetel|Exetel NBN|Exetel Mobile
More Telecom|More NBN|More Mobile
Tangerine Telecom|Tangerine NBN|Tangerine Mobile
Belong|Belong NBN|Belong Mobile
MATE|MATE Mobile
Southern Phone|Southern Phone Mobile
SpinTel|SpinTel Mobile
Launtel
Leaptel
Swoop
Kogan Internet|Kogan Mobile
Starlink
NBN Co
Foxtel Broadband
Origin Internet
AGL Internet
Boost Mobile|Boost
amaysim
ALDI Mobile
Everyday Mobile
Woolworths Mobile
Coles Mobile
Lebara
Lycamobile
Felix Mobile
Circles.Life
Moose Mobile
Catch Connect
Vaya
Yomojo
Pennytel
Numobile
Cmobile
`, { defaultCategory: null }),
];

const NZ_SUPPLIERS = [
  ...suppliersFromText("NZ", ["gas_electricity"], `
Contact Energy|Contact Gas
Genesis Energy|Genesis Gas
Mercury|Mercury Gas
Meridian Energy
Frank Energy
Powershop
Electric Kiwi
Flick Electric
Octopus Energy NZ
Nova Energy|Nova Gas
Pulse Energy
Energy Online
Trustpower
2degrees Energy
Ecotricity
Grey Power Electricity
Slingshot Power
Globug
Toast Electric
Bosco Connect
Black Box Power
OurPower
Paua to the People
Lodestone Energy
MegaTEL Energy|Megatel Energy
Hanergy
Vocus Energy
Vector
Firstgas
GasNet
Powerco
Rockgas
Elgas
Ongas
`, { defaultCategory: "gas_electricity" }),
  ...suppliersFromText("NZ", ["water", "wastewater"], `
Watercare@AUK|Watercare Services|Auckland Watercare
Wellington Water@WGN
Christchurch City Council Water@CAN
Dunedin City Council Water@OTA
Tauranga City Council Water@BOP
Hamilton City Council Water@WKO
Auckland Council Water@AUK
Hutt City Council Water@WGN
Upper Hutt City Council Water@WGN
Porirua City Council Water@WGN
Wellington City Council Water@WGN
Kapiti Coast District Council Water@WGN
Waipa District Council Water@WKO
Waikato District Council Water@WKO
Queenstown Lakes District Council Water@QTL
Nelson City Council Water@NSN
Tasman District Council Water@NSN
Napier City Council Water@HKB
Hastings District Council Water@HKB
New Plymouth District Council Water@TKI
Palmerston North City Council Water@MWT
Whangārei District Council Water@NTL|Whangarei District Council Water
Rotorua Lakes Council Water@BOP
Invercargill City Council Water@STL
`, { defaultCategory: null }),
  ...suppliersFromText("NZ", ["broadband", "mobile", "telecom_bundle"], `
Spark
One NZ
Vodafone NZ
2degrees
Skinny|Skinny Broadband
Slingshot|Slingshot Mobile
Orcon|Orcon Mobile
Contact Broadband|Contact Mobile
Mercury Broadband|Mercury Mobile
Nova Broadband
Electric Kiwi Broadband
NOW Broadband
Voyager
Bigpipe
Stuff Fibre
MyRepublic NZ
Rocket Broadband|Rocket Mobile
Trustpower Broadband
Farmside|Farmside Mobile
Primo|Primo Mobile
Lightwire
Devoli
Compass Communications|Compass Mobile
WorldNet
Megatel
Kiwilink
Wireless Nation
Starlink
Chorus
Enable
Tuatahi First Fibre
Northpower Fibre
Unison Fibre
Warehouse Mobile
Mighty Mobile
Digital Island
Kiwi Mobile
Flexiroam
`, { defaultCategory: null }),
];

export const SUPPLIER_CATALOG = [
  ...UK_SUPPLIERS,
  ...US_SUPPLIERS,
  ...CA_SUPPLIERS,
  ...AU_SUPPLIERS,
  ...NZ_SUPPLIERS,
];

function scoreSupplier(candidate, supplier, { countryHint = "", regionHint = "", categoryHint = "" } = {}) {
  const candidateIsGenericOnly = !hasDistinctiveTokens(candidate);

  if (candidateIsGenericOnly) {
    return 0;
  }

  const aliasScore = Math.max(...supplier.aliases.map((alias) => scoreAliasMatch(candidate, alias)), 0);

  if (aliasScore < 0.82) {
    return 0;
  }

  let score = aliasScore;

  if (countryHint) {
    if (supplier.country === countryHint) {
      score += 0.06;
    } else {
      score -= 0.03;
    }
  }

  if (regionHint && supplier.regions.includes(regionHint)) {
    score += 0.06;
  }

  if (categoryHint && supplier.categories.includes(categoryHint)) {
    score += 0.04;
  }

  return score;
}

export function inferSupplierContext(value, { countryHint = "", regionHint = "" } = {}) {
  const inferredCountry = normaliseCountryCode(countryHint) || detectCountryHint(value);
  const inferredRegion = findRegionCode(regionHint, inferredCountry) || detectRegionHint(value, inferredCountry);

  return {
    countryHint: inferredCountry,
    regionHint: inferredRegion,
  };
}

export function findKnownSupplier(value, options = {}) {
  const candidate = normaliseText(value);

  if (!candidate) {
    return null;
  }

  const context = inferSupplierContext(value, options);
  const best = SUPPLIER_CATALOG.reduce((winner, supplier) => {
    const score = scoreSupplier(candidate, supplier, {
      countryHint: context.countryHint,
      regionHint: context.regionHint,
      categoryHint: options.categoryHint || "",
    });

    if (!winner || score > winner.score) {
      return { supplier, score };
    }

    return winner;
  }, null);

  if (!best || best.score < 0.82) {
    return null;
  }

  return {
    ...best.supplier,
    matchConfidence: Number(best.score.toFixed(3)),
    countryCode: best.supplier.country,
    regionCodes: best.supplier.regions,
  };
}

export function getSupplierNames(options = {}) {
  const countryCode = normaliseCountryCode(options.countryHint || "");
  return uniq(SUPPLIER_CATALOG
    .filter((supplier) => !countryCode || supplier.country === countryCode)
    .map((supplier) => supplier.name));
}

export { detectCountryHint, detectRegionHint, normaliseCountryCode, normaliseText };
