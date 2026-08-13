// Game definitions voor de Ellemel Crew operaties.
//
// Setup: Michiel, Ellis en Melle runnen Ellemel chocopasta. Kids worden lid van de Crew.
// Per game lossen ze met Michiel als coordinator een operationele uitdaging op.
//
// Per stop:
//   body = terugkoppeling op vorige stop + briefing voor wat je nu gaat doen
//   audio_text = de vraag/situatie die Michiel via walkie aan je stelt na check-in
//   puzzle_type: 'multiple_choice' of 'name_input'
//
// Bandjes per voltooide game: 1 bandje. Ranks gaan om de game omhoog:
//   1 game: Crew Snuffelneus *
//   2 games: Crew Spoorvolger **
//   3 games: Crew Topspeurder ***
//   4 games: Crew Legende ****

const GAMES = {
  "quest-1-hazelnoten": {
    id: "quest-1-hazelnoten",
    name: "Operatie Verloren Noten",
    prize_label: "Bandje Crew Snuffelneus *",
    header_image: "/Images/game-hazelnoten-header.jpg?v=20260616a",
    welcome_audio: "Hé, goed dat je incheckt — ik kan je echt gebruiken! We staan hier in de chocopastafabriek, het is een super drukke dag. Ellis en Melle maken vandaag chocopasta, we moeten 26 potten af. Maar we hebben een groot probleem: onze bezorger is een grote zak hazelnoten kwijt. Ergens hier in de Potgietersbuurt is die zak uit de bus gevallen. Zonder die noten kunnen we geen chocopasta maken en zitten de kids straks zonder. Kun jij de buurt in en die zak hazelnoten voor ons terugvinden? De hele buurt is je dankbaar als je 'm vindt! Ik heb een aanwijzing: de bezorger hoorde gister een harde plof toen hij door de buurt reed. Dat moet die zak zijn. Ik heb de locatie in de app gezet — ga ernaartoe, zoek de QR-code en check met me in. Spreek je zo!",
    welcome_audio_file: "/Sounds/intro-hazelnoten.mp3?v=20260619a", // als gevuld wordt het echte audiobestand afgespeeld i.p.v. TTS
    welcome_title: "Hé {{name}}, paniek! Een grote zak hazelnoten is verdwenen in de Potgietersbuurt. Kun jij hem opsporen?",
    welcome_lead: "Het is je eerste werkdag bij Ellemel. Help de Crew die zak hazelnoten terug te vinden die onze bezorger vanmorgen verloor in de Potgietersbuurt — en je wordt officieel Crew-lid.",
    secret_code: "EHM4QH",
    intro: {
      title: "Hier hoorde de bezorger een harde plof. Zijn het de hazelnoten?",
      mission_image: "/Images/mission-1-header.jpg",
      body: "Onze bezorger hoorde hier een harde plof — dat moet die zak hazelnoten zijn die uit de bus viel. Loop naar het pleintje, vind de QR-code en check bij me in.",
      qr_token: "ELLEMEL-T01",
      audio_text: "Check, check — plein check. Je staat op het plein. Geen hazelnoten gevonden zeker? Daar was ik al een beetje bang voor. Maar wacht: Sophie woont hier. Sophie woont in dat hele hoge appartement aan het plein, zij bestelt vaak chocopasta. Misschien heeft zij iets gezien. Kijk even omhoog naar het hoogste huis dat op het plein uitkijkt. Als je het huisnummer noteert, check ik even ons systeem en bel ik Sophie. Misschien weet zij waar die hazelnoten naartoe zijn gegaan. Geef het juiste antwoord, dan kun je naar de volgende stop.",
      audio_file: "/Sounds/stop1-hazelnoten.mp3?v=20260619a",
      puzzle_type: "name_input",
      puzzle_question: "Wat is het nummer van het hoogste huis dat op het plein neerkijkt?",
      name_template: "___",
      puzzle_keyboard: "text", // antwoord bevat letter (19a) → standaard tekst-toetsenbord
      riddle_answer: "19a",
      lat: 52.377861, lng: 4.652381, place: "Het plein, Potgietersbuurt",
      find_qr_hint: "Op de hoek bij de kleine speeltuin vind je een elektriciteitskastje. Daarop vind je de QR-code.",
    },
    missions: [
      {
        idx: 2,
        title: "De bus reed richting binnenstad. Ga er achteraan (en kijk goed om je heen)",
        mission_image: "/Images/mission-2-header.jpg",
        body: "Goed gespeurd! Ik heb Sophie meteen gebeld. Zij zag de bestelbus voorbij komen — die reed richting het Teylerplein verderop. Loop er naartoe en check bij me in.",
        qr_token: "ELLEMEL-T02",
        audio_text: "Check check, voetbalveld hoog — top, je bent er! Ik check even met je in want ik heb iets nieuws. Je had Sophie helemaal goed doorgezet, ik heb haar net gebeld. Ze heeft de bezorger inderdaad gezien — die reed in deze richting. Maar de reden dat ik je check is: die noten zijn er nog niet. Wel kreeg ik een berichtje van Ellis. Ellis ging vanochtend op de step naar de fabriek en heeft de bezorger gezien — met een hele dikke ijsco. Zes bollen, zegt Ellis! Nou, zes lijkt me wat veel, maar in elk geval een grote ijsco. Misschien zijn die noten uit de bus gevallen toen hij dat ijsje haalde. Vraag is dus: waar kun je hier in de buurt ijsjes halen? Als je dat weet, is dat onze volgende stop. Check snel weer met je in.",
        audio_file: "/Sounds/stop2-hazelnoten.mp3?v=20260619a",
        puzzle_type: "multiple_choice",
        puzzle_question: "Bij welke ijssalon haalde onze bezorger zijn ijsje?",
        puzzle_options: ["Fonshoff", "Etos", "Snellie"],
        riddle_answer: "A",
        lat: 52.378727, lng: 4.649809, place: "Teylerplein, Potgietersbuurt",
        find_qr_hint: "Op het Teylerplein vind je een voetbalveld. De QR-code vind je in een van de hoeken van het veld.",
      },
      {
        idx: 3,
        title: "We weten dat de bezorger hier een tussenstop maakte. Ga op onderzoek uit",
        mission_image: "/Images/mission-3-header.jpg",
        body: "Fonshoff — yes! Ik bel Fons meteen. Loop ondertussen naar Teylerplein speeltuin even verderop en check daar bij me in.",
        qr_token: "ELLEMEL-T03",
        audio_text: "Check, check, bij Fonshoff! Ja, jij had het helemaal goed — het was Fonshoff. Ik heb Fons net gebeld. Goed nieuws en wat minder goed nieuws. Het goede: Fons heeft de zak hazelnoten gezien, gewoon in zijn snackbordje. Minder goed: die zak zat in de bek van een hond. Hele grote hond. En die liep er gewoon mee de zaak uit. Maar er is iets wat kan helpen — die hond en zijn baasje komen elke week twee kaassoufflés halen, één voor zichzelf en één voor de hond. En wat Fons opvalt: die mevrouw heeft altijd een setje van zes zware ballen bij zich, met een klein rozé balletje erbij. Hoe heet dat spelletje ook alweer? Ik deed het wel eens op de camping in Frankrijk. Weet jij hoe het heet? Zes ballen en een klein balletje? Dat moet de aanwijzing zijn voor onze volgende stop — we zijn er bijna!",
        audio_file: "/Sounds/stop3-hazelnoten.mp3?v=20260619a",
        puzzle_type: "multiple_choice",
        puzzle_question: "Hoe heet het spel met zes metalen ballen en een klein balletje?",
        puzzle_options: ["Voetbal", "Jeu de boules", "Bowlen"],
        riddle_answer: "B",
        lat: 52.379948, lng: 4.647690, place: "Teylerplein speeltuin",
        find_qr_hint: "Om de hoek bij Fonshoff heb je iets oranjes waar je brieven in kunt doen. Ga op onderzoek en vind de QR-code.",
      },
      {
        idx: 4,
        title: "Een hond dol op chocopasta. Raad de naam van zijn baasje en vind de zak hazelnoten",
        mission_image: "/Images/mission-4-header.jpg",
        body: "Jeu de boules — bingo! Daar speelt het baasje van de hond regelmatig. Loop naar de jeu de boules baan vlakbij en check daar bij me in voor de laatste aanwijzing.",
        qr_token: "ELLEMEL-T04",
        audio_text: "Check check check, jeu de boules baan — klopt dus helemaal hè! Ik heb echt heel goed nieuws: onze bezorger belde net. Ik vertelde hem over die hond met de noten, en hij zegt: die hond ken ik! Hele grote bruine, hij brengt daar regelmatig chocopasta naartoe. Die noten zijn dus gewoon thuis bij die klant, daar kunnen we ze ophalen. We zijn echt heel dichtbij! Er is alleen één probleem: de bezorger is de naam van die klant even kwijt. Hij weet alleen nog dat 'ie begint met OLI. Puzzel jij even de naam in elkaar? Dan kan ik die mevrouw bellen en dan hebben we die hazelnoten terug. Dit is de laatste stop — puzzelen en fixen!",
        audio_file: "/Sounds/stop4-hazelnoten.mp3?v=20260619a",
        puzzle_type: "name_input",
        puzzle_question: "Maak de naam af — onze bezorger weet dat hij begint met OLI...",
        name_template: "OLI__A",
        riddle_answer: "OLIVIA",
        lat: 52.380890, lng: 4.648365, place: "Jeu de boules baan, Potgietersbuurt",
        find_qr_hint: "Naast de jeu de boules baan staat een houten picknicktafel. Buk even — en vind de QR-code.",
      },
    ],
    final: {
      title: "Bestelling compleet",
      body: "Top Crew, alle vier de check-ins voltooid.",
      audio_text: "",
    },
  },
};

function listGames() {
  return Object.values(GAMES).map(g => ({
    id: g.id,
    name: g.name,
    prize_label: g.prize_label,
    mission_count: g.missions.length,
  }));
}
function getGame(id) {
  return GAMES[id] || null;
}

function stopForIdx(game, idx) {
  if (idx === 1) return game.intro;
  return game.missions.find(m => m.idx === idx) || null;
}

module.exports = { GAMES, listGames, getGame, stopForIdx };
