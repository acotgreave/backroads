-- Backroads crowd results. No names, emails or IP addresses are stored.

-- One row per finished daily drive. pid is a random id made by the player's browser.
CREATE TABLE runs (
  day     TEXT    NOT NULL,           -- the player's local date, YYYY-MM-DD (same prompts worldwide)
  pid     TEXT    NOT NULL,
  miles   INTEGER NOT NULL,
  tiers   TEXT    NOT NULL,           -- e.g. "0,3,-1,5,2,1,4" (-1 = passed)
  qs      TEXT    NOT NULL,           -- the seven prompt ids, comma separated
  created INTEGER NOT NULL,           -- unix seconds
  PRIMARY KEY (day, pid)              -- one daily drive per player per day
);

-- Running totals, updated as each drive comes in, so reading a day's results stays cheap.
CREATE TABLE day_miles (
  day TEXT NOT NULL, mi INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0,   -- how many drivers ended on exactly mi miles
  PRIMARY KEY (day, mi)
);
CREATE TABLE day_answers (
  day TEXT NOT NULL, prompt TEXT NOT NULL, answer TEXT NOT NULL,          -- answer '' = passed
  tier INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, prompt, answer)
);
-- Wrong guesses ("not on the map"), lower-cased. n counts players, not attempts.
CREATE TABLE day_misses (
  day TEXT NOT NULL, prompt TEXT NOT NULL, guess TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, prompt, guess)
);

-- Short-lived request counts per hashed IP address, cleared daily.
CREATE TABLE rate_limits (
  k TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (k, win)
);
