/* ==========================================================
   LIGHTS OUT — Site Script
   ----------------------------------------------------------
   Contents
     1. Start lights animation
     2. Shared API helpers (fetch + cache)
     3. Next race + countdown
     4. Standings helpers (incl. team colors)
     5. Drivers' standings
     6. Constructors' standings

   Race data comes from the free Jolpica F1 API, the community
   replacement for the old Ergast API:
   https://github.com/jolpica/jolpica-f1

   Loaded with "defer" in the HTML, so the page is fully built
   before any of this runs.
   ========================================================== */


/* ----------------------------------------------------------
   1. START LIGHTS ANIMATION
   Like a real start: lights come on one at a time, hold for
   a random beat, then all go out together.
   ---------------------------------------------------------- */

const gantry = document.querySelector('.start-lights');
const lights = gantry.querySelectorAll('.light');

const STEP_MS = 700;  // gap between each light turning on (ms)

// Pending timeouts, kept so a replay can cancel the old sequence
let timers = [];

// Cancel any timeouts still waiting to fire
function clearTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

// Run the full start sequence once
function runStart() {
  // Reset: cancel the old run and switch every light off
  clearTimers();
  for (const light of lights) light.classList.remove('on');

  // Schedule each light to turn on, one after another
  for (let i = 0; i < lights.length; i++) {
    timers.push(setTimeout(() => lights[i].classList.add('on'), STEP_MS * (i + 1)));
  }

  // After the last light, wait a random 0.8–2.3s, then all out
  const hold = 800 + Math.random() * 1500;
  timers.push(setTimeout(() => {
    for (const light of lights) light.classList.remove('on');
  }, STEP_MS * lights.length + hold));
}

// Play on load, unless the visitor's device asks for reduced motion
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  runStart();
}

// Clicking the lights replays them. preventDefault stops the
// click from also following the home link the lights sit inside.
gantry.addEventListener('click', (e) => {
  e.preventDefault();
  runStart();
});


/* ----------------------------------------------------------
   2. SHARED API HELPERS
   Used by both the next race box and the standings table.
   ---------------------------------------------------------- */

// "current" always means the latest season, so no yearly updates
const API_BASE = 'https://api.jolpi.ca/ergast/f1/current/';

// Reuse a fetched copy for 1 hour to stay well under the API's
// rate limits (results only change after each race anyway)
const CACHE_MS = 60 * 60 * 1000;

// Return a cached copy if it exists and is still fresh, else null.
// try/catch because storage can be blocked (private browsing etc.)
function readCache(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved && Date.now() - saved.time < CACHE_MS) return saved.data;
  } catch (e) {
    // Storage unavailable: just fetch fresh
  }
  return null;
}

// Save data with a timestamp so readCache can check its age
function writeCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ time: Date.now(), data }));
  } catch (e) {
    // Storage unavailable: skip caching
  }
}

// Get JSON from the API, using the cache when possible.
// Throws on failure so each caller can decide what to show.
async function getJSON(path, key) {
  const cached = readCache(key);
  if (cached) return cached;

  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const json = await res.json();
  writeCache(key, json);
  return json;
}

// Put plain text into an element by id.
// textContent (not innerHTML) means API data can never inject HTML.
function setText(id, text) {
  document.getElementById(id).textContent = text;
}


/* ----------------------------------------------------------
   3. NEXT RACE + COUNTDOWN
   Finds the next race in the season schedule, fills in its
   name, circuit, location and date, and runs the countdown.
   ---------------------------------------------------------- */

const SCHEDULE_KEY = 'lightsout-schedule';

// Keep showing a race this long after lights out, so the box
// doesn't flip to the following race in the middle of one
const RACE_LENGTH_MS = 2 * 60 * 60 * 1000;

// Start time of the race being counted down to (set once loaded)
let raceStart = null;

// The four countdown numbers
const cd = {
  days:  document.getElementById('cd-days'),
  hours: document.getElementById('cd-hours'),
  mins:  document.getElementById('cd-mins'),
  secs:  document.getElementById('cd-secs'),
};

// Turn the API's separate date + time into one Date.
// Time is in UTC ("19:00:00Z"); some entries only have a date.
function raceDate(race) {
  return new Date(race.date + 'T' + (race.time || '00:00:00Z'));
}

// Walk the season in order and return the first race that
// hasn't finished yet, or null if the season is over
function findNextRace(races) {
  const now = Date.now();
  for (let i = 0; i < races.length; i++) {
    if (raceDate(races[i]).getTime() + RACE_LENGTH_MS > now) {
      return races[i];
    }
  }
  return null;
}

// Add a leading zero: 7 -> "07"
function pad(n) {
  return String(n).padStart(2, '0');
}

// Redraw the countdown. Runs once a second.
function updateCountdown() {
  let diff = raceStart - Date.now();

  // Past the start time: the race is running
  if (diff <= 0) {
    setText('race-date-label', 'Race in progress');
    diff = 0;
  }

  // Break milliseconds into days / hours / minutes / seconds
  const days = Math.floor(diff / 86400000);
  diff -= days * 86400000;
  const hours = Math.floor(diff / 3600000);
  diff -= hours * 3600000;
  const mins = Math.floor(diff / 60000);
  diff -= mins * 60000;
  const secs = Math.floor(diff / 1000);

  cd.days.textContent  = days;
  cd.hours.textContent = pad(hours);
  cd.mins.textContent  = pad(mins);
  cd.secs.textContent  = pad(secs);
}

// Fill the box with one race's details and start the countdown
function showNextRace(race) {
  raceStart = raceDate(race);
  const loc = race.Circuit.Location;

  setText('race-round', 'Round ' + race.round);
  setText('next-race-name', race.raceName);
  setText('next-race-circuit', race.Circuit.circuitName);
  setText('next-race-location', loc.locality + ', ' + loc.country);

  // Date and time in the visitor's own time zone, e.g. "Sun, Oct 25, 3:00 PM EDT"
  setText('race-date-label', raceStart.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }));

  updateCountdown();
  setInterval(updateCountdown, 1000);
}

// Load the schedule and show the next race.
// On failure the HTML placeholders stay visible.
async function loadNextRace() {
  try {
    const json = await getJSON('races/', SCHEDULE_KEY);
    const races = json.MRData.RaceTable.Races;
    const next = findNextRace(races);

    if (next) {
      showNextRace(next);
    } else {
      // Every race is done for the year
      setText('next-race-name', 'Season complete');
      setText('race-date-label', 'See you next year.');
      document.querySelector('.countdown').hidden = true;
    }
  } catch (err) {
    console.warn('Schedule unavailable:', err);
  }
}

// Only run on pages that actually have a Next Race box
// (post pages don't, and there's nothing to fill in there)
if (document.getElementById('next-race-name')) {
  loadNextRace();
}


/* ----------------------------------------------------------
   4. STANDINGS HELPERS
   Small building blocks shared by both standings tables.
   ---------------------------------------------------------- */

// Build one table cell with an optional class and some text
function makeCell(className, text) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

// TEAM COLORS
// Each entry: [word to look for, color]. The script checks a team's
// id and name (e.g. "red_bull Red Bull") for each word in order and
// uses the first match. Racing Bulls comes before Red Bull so it
// isn't mistaken for the main team.
// These are approximate livery colors you can tweak freely.
// FIXME: double-check against this season's liveries
const TEAM_COLORS = [
  ['racing bulls', '#6692ff'],
  ['rb',           '#6692ff'],  // Racing Bulls' id in the data
  ['red bull',     '#3671c6'],
  ['ferrari',      '#e8002d'],
  ['mercedes',     '#27f4d2'],
  ['mclaren',      '#ff8000'],
  ['aston',        '#229971'],
  ['alpine',       '#ff87bc'],
  ['williams',     '#64c4ff'],
  ['haas',         '#b6babd'],
  ['audi',         '#c4c4c4'],
  ['sauber',       '#c4c4c4'],  // Audi's old team name, just in case
  ['cadillac',     '#ffffff'],
];

// Find the color for a team, or null if it isn't in the list.
// Matches whole words only, so "rb" doesn't match inside other names.
function teamColor(constructor) {
  if (!constructor) return null;
  const words = (constructor.constructorId + ' ' + constructor.name)
    .toLowerCase()
    .replace(/_/g, ' ');
  for (const [key, color] of TEAM_COLORS) {
    const pattern = new RegExp('(^|\\s)' + key.replace(/_/g, ' ') + '(\\s|$)');
    if (pattern.test(words)) return color;
  }
  return null;
}

// Put a colored bar in front of everything already in a cell.
// Builds:  <td><span class="name-wrap">[bar]<span>name…</span></span></td>
// The bar's color comes from the --team-color CSS variable set
// here; styles.css (section 13) draws the bar and lays it out.
function addSwatch(td, color) {
  const swatch = document.createElement('span');
  swatch.className = 'team-swatch';
  swatch.setAttribute('aria-hidden', 'true');  // decoration only
  if (color) swatch.style.setProperty('--team-color', color);

  // Move the cell's existing content into an inner holder
  const text = document.createElement('span');
  text.append(...td.childNodes);

  const wrap = document.createElement('span');
  wrap.className = 'name-wrap';
  wrap.append(swatch, text);
  td.appendChild(wrap);
}

// Rewrite a note under a table: "After round X · Data: Jolpica F1"
function setNote(noteId, round) {
  const note = document.getElementById(noteId);
  if (!note) return;
  note.replaceChildren(document.createTextNode('After round ' + round + ' · Data: '));
  const link = document.createElement('a');
  link.href = 'https://github.com/jolpica/jolpica-f1';
  link.textContent = 'Jolpica F1';
  note.appendChild(link);
}


/* ----------------------------------------------------------
   5. DRIVERS' STANDINGS
   Fills any drivers' table on the current page.
   - Homepage sidebar: top 5, no wins column
   - Standings page:   every driver, with a wins column
                       and team color bars
   ---------------------------------------------------------- */

const DRIVERS_KEY = 'lightsout-standings';

// One entry per drivers' table on the site.
//   body:  id of the table's <tbody> in the HTML
//   note:  id of the "After round X" line under it
//   limit: how many drivers to show (Infinity = all)
//   wins:   whether the table has a Wins column
//   colors: whether to show a team color bar by each driver
const DRIVER_TABLES = [
  { body: 'standings-body',    note: 'standings-note',    limit: 5,        wins: false, colors: false },
  { body: 'drivers-full-body', note: 'drivers-full-note', limit: Infinity, wins: true,  colors: true  },
];

// Fill one drivers' table
function renderDrivers(list, table) {
  const tbody = document.getElementById(table.body);
  const rows = list.DriverStandings;
  tbody.replaceChildren();  // clear placeholders

  for (let i = 0; i < Math.min(table.limit, rows.length); i++) {
    const entry = rows[i];
    const tr = document.createElement('tr');

    // Position (falls back to the row number if missing)
    const pos = makeCell('pos', entry.position ?? entry.positionText ?? i + 1);

    // Driver name, with their current team on a second line.
    // A driver who switched teams lists several; the last is current.
    const driver = makeCell('', entry.Driver.givenName + ' ' + entry.Driver.familyName);
    const current = entry.Constructors && entry.Constructors.length
      ? entry.Constructors[entry.Constructors.length - 1]
      : null;
    if (current) {
      const team = document.createElement('span');
      team.className = 'team';
      team.textContent = current.name;
      driver.appendChild(team);
    }

    // Team color bar in front of the name (standings page only)
    if (table.colors) addSwatch(driver, teamColor(current));

    tr.append(pos, driver);
    if (table.wins) tr.append(makeCell('pts', entry.wins));
    tr.append(makeCell('pts', entry.points));
    tbody.appendChild(tr);
  }

  setNote(table.note, list.round);
}

// Load the standings once, then fill every drivers' table on
// this page. On failure the placeholder rows stay visible.
async function loadDrivers() {
  // Find which of the tables exist on this page
  const present = [];
  for (const table of DRIVER_TABLES) {
    if (document.getElementById(table.body)) present.push(table);
  }
  if (present.length === 0) return;  // no drivers' table here

  try {
    const json = await getJSON('driverstandings/', DRIVERS_KEY);
    const list = json.MRData.StandingsTable.StandingsLists[0];
    if (!list) return;  // season hasn't started yet
    for (const table of present) renderDrivers(list, table);
  } catch (err) {
    console.warn('Driver standings unavailable:', err);
  }
}

loadDrivers();


/* ----------------------------------------------------------
   6. CONSTRUCTORS' STANDINGS
   Only on the standings page: every team, wins and points,
   each with its team color bar.
   ---------------------------------------------------------- */

const CONSTRUCTORS_KEY = 'lightsout-constructors';

// Fill the constructors' table
function renderConstructors(list) {
  const tbody = document.getElementById('constructors-full-body');
  const rows = list.ConstructorStandings;
  tbody.replaceChildren();  // clear placeholders

  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i];
    const tr = document.createElement('tr');
    // Team name with its color bar in front
    const team = makeCell('', entry.Constructor.name);
    addSwatch(team, teamColor(entry.Constructor));

    tr.append(
      makeCell('pos', entry.position ?? entry.positionText ?? i + 1),
      team,
      makeCell('pts', entry.wins),
      makeCell('pts', entry.points)
    );
    tbody.appendChild(tr);
  }

  setNote('constructors-full-note', list.round);
}

// Load and show the constructors' standings.
// On failure the placeholder rows stay visible.
async function loadConstructors() {
  try {
    const json = await getJSON('constructorstandings/', CONSTRUCTORS_KEY);
    const list = json.MRData.StandingsTable.StandingsLists[0];
    if (!list) return;  // season hasn't started yet
    renderConstructors(list);
  } catch (err) {
    console.warn('Constructor standings unavailable:', err);
  }
}

// Only run on the page that has the constructors' table
if (document.getElementById('constructors-full-body')) {
  loadConstructors();
}
