# Apple Health in Recoil

Whoop knows how you recovered. It does not know you walked fourteen thousand
steps, what you weighed, or that you had a coffee at nine at night. Apple Health
does. This is how the two get read together.

Everything below happens on your phone. Nothing is uploaded, and there is no
account to make. Apple gives web apps no way at all to read Health directly, so
a file and a Shortcut are the only two doors, and both of them are yours.

---

## What Recoil reads

Only what Whoop cannot see. Recovery, HRV, resting heart rate and sleep are
taken from the Whoop API and never read back out of Health, because Whoop's copy
is the better one.

| Group | Numbers |
|---|---|
| Movement | Steps, walking distance, flights climbed, exercise minutes |
| Body | Weight, body fat, BMI, VO2 max |
| Intake | Caffeine, alcoholic drinks, water, calories eaten, protein |
| Environment and mind | Time in daylight, mindful minutes, headphone volume, logged mood |
| Workouts | Only sessions Whoop has no record of |

Most of these only exist if something writes them. An iPhone with no Apple Watch
records steps, distance and flights on its own and very little else. Recoil
shows you exactly which ones came back and which came back empty, on the
Settings screen, rather than leaving you to guess.

Workouts never double up. Whoop stays the source of truth for every session, and
a Health workout is only added when nothing Whoop recorded covers the same
stretch of time. A ride you logged in Strava without wearing the strap appears.
The same ride recorded by both does not appear twice.

---

## Part one: the full history

Do this once. It brings in everything Health has ever held.

1. On your iPhone, open **Health**.
2. Tap your photo, top right.
3. Scroll to the bottom and tap **Export All Health Data**.
4. Tap **Export**. It takes a few minutes and the phone will look like it is
   doing nothing. Leave it.
5. When the share sheet appears, choose **Save to Files** and put it somewhere
   you can find again. It is called `export.zip`.
6. Open Recoil, go to **Settings**, and under Apple Health tap
   **Choose export.zip**. Pick the file.

Recoil reads it in a trickle rather than swallowing it whole, so a file of a
gigabyte will not run the phone out of memory. On a long history it takes a few
minutes and the progress line moves the whole way. Once it finishes, Settings
tells you how many days were read, which of them line up with your Whoop
history, and what came back empty.

Nothing is kept but one row per day. The millions of individual samples in that
file are read, folded into their day, and dropped.

Repeat this whenever you want to catch up in bulk. Or set up part two and never
think about it again.

---

## Part two: the daily top-up

A Shortcut that reads the day's numbers each morning and hands them to Recoil.
Fifteen minutes to build, then it runs itself.

**How it works, and the one visible cost.** The Shortcut opens Recoil with the
numbers attached to the link. Safari appears for a second and closes. That
second is the price of the numbers never leaving your phone: the alternative was
posting them to a server and reading them back, which would have made the
promise on the front of this app untrue.

Recoil takes what arrives, strips the parameter off the address so a reload
cannot replay it, and stores the day. It does that before anything else on boot,
including the Whoop sign-in check, so a morning where the token has lapsed still
banks the numbers instead of bouncing to a login screen and losing them.

### First, if you run Recoil from your home screen

A web app added to the home screen gets its own storage on iOS, separate from
Safari's. Two jars, not one. And a Shortcut's **Open URLs** action opens Safari,
not your installed web app — iOS does not deep-link into home-screen web apps.

So on that setup the numbers can land in Safari and never reach the app you
actually open. Check before building the automation: open the same address in
Safari and see whether Settings there shows your Health data. If Safari is empty
while the home-screen app is not, the jars are separate and the last step of the
Shortcut has to change from opening a URL to copying to the clipboard, which you
then paste inside the app.

Everything before that last step is identical either way, so build it first and
decide the ending afterwards.

### The quick way: describe it

Shortcuts can build this from a description. Paste this in:

```
Create a shortcut called "Recoil daily".

Steps it should perform, in order:

1. Get the current date and format it as yyyy-MM-dd. Call this DATE.
2. Find all Steps health samples where Start Date is today. Calculate the
   Sum. Call this STEPS.
3. Find all Walking + Running Distance health samples where Start Date is
   today, in kilometres. Calculate the Sum. Call this DISTANCE.
4. Find all Flights Climbed health samples where Start Date is today.
   Calculate the Sum. Call this FLIGHTS.
5. Make a Text value in exactly this shape, on one line, with no spaces:
   {"date":"DATE","steps":STEPS,"walkKm":DISTANCE,"flights":FLIGHTS}
   The date is in quotes. The three numbers are not in quotes. No comma
   before the closing brace.
6. URL encode that text.
7. Open this URL, with the encoded text joined onto the end:
   https://YOUR-RECOIL-DOMAIN/?health=
```

Those three are what an iPhone records on its own with no Apple Watch. Add more
only where something on your phone actually writes them — the table further down
lists the names Recoil accepts.

Check what it built before trusting it. The two things worth looking at are that
the date really is `yyyy-MM-dd` and that the numbers are not wrapped in quotes.

### The careful way: build it by hand

Open **Shortcuts**, tap **+**, and add these actions in order.

**1. Get the numbers.** For each thing you want, add two actions:

- **Find Health Samples**
  - Type: **Steps**
  - Filter: **Start Date** — **is today** — set the relative date to
    **yesterday** if you would rather run it in the morning about the day before
  - Sort by: Start Date, Limit: off
- **Calculate Statistics**
  - Operation: **Sum**
  - Input: the Health Samples from above

Rename the result so you can find it later: tap the variable, then **Rename**,
and call it `steps`.

Repeat that pair for anything else you track. The names Recoil expects:

| What you want | Health sample type | Combine with | Name it |
|---|---|---|---|
| Steps | Steps | Sum | `steps` |
| Walking distance in km | Walking + Running Distance | Sum | `walkKm` |
| Floors | Flights Climbed | Sum | `flights` |
| Exercise minutes | Apple Exercise Time | Sum | `exerciseMin` |
| Weight in kg | Weight | Average | `weightKg` |
| Caffeine in mg | Caffeine | Sum | `caffeineMg` |
| Drinks | Number of Alcoholic Beverages | Sum | `drinks` |
| Water in litres | Water | Sum | `waterL` |
| Calories eaten | Dietary Energy | Sum | `kcalIn` |
| Protein in grams | Protein | Sum | `proteinG` |
| Daylight minutes | Time in Daylight | Sum | `daylightMin` |

Send only what you actually record. Three numbers is a perfectly good Shortcut.

**2. Get the date.** Add a **Text** action containing:

```
{"date":"","steps":,"walkKm":}
```

Then fill it in by tapping between the quotes and inserting variables:

- Between the quotes after `"date":`, insert **Current Date** and set its format
  to **Custom** with the format string `yyyy-MM-dd`. If you are sending
  yesterday's numbers, use an **Adjust Date** action first to subtract 1 day.
- After `"steps":`, insert your `steps` variable.
- After `"walkKm":`, insert your `walkKm` variable.

Add a `"name":value` pair for each thing you collected. No trailing comma before
the closing brace.

It should end up looking like this, with the grey variable bubbles where the
values are:

```
{"date":"2026-08-09","steps":8421,"walkKm":6.12,"caffeineMg":180}
```

**3. Send it.** Add a **URL** action containing:

```
https://YOUR-RECOIL-DOMAIN/?health=
```

and insert the Text variable from step 2 at the end, after the `=`.

Then add **Open URLs** with that URL as its input.

If the numbers do not land, put a **URL Encode** action between the Text and the
URL. Some iOS versions pass the braces through untouched and some do not.

**4. Name it** something like "Recoil daily" and save.

### Tell Recoil what you called it

Open **Settings → The morning Shortcut** and type the name in. Now the
**Refresh from Health** button there, and the small **Refresh** next to the
Apple numbers on Today, will run it for you: Shortcuts opens for a second and
hands the numbers straight back. That is the closest this can get to the way
Whoop refreshes itself, because a web page cannot read Health on its own.

Today also says how far behind those numbers are — "up to date", "a day
behind", "4 days behind" — measured against your newest Whoop day. A stale step
count and this morning's look identical on a tile otherwise.

### Make it run itself

1. In Shortcuts, go to the **Automation** tab.
2. Tap **+**, choose **Time of Day**.
3. Pick a time you are usually awake and holding the phone. Seven in the morning
   works.
4. Choose **Daily**.
5. Action: **Run Shortcut**, and pick "Recoil daily".
6. Turn **Ask Before Running** off, and confirm.

That is it. Each morning Safari flickers open and closes, and the day's numbers
are in Recoil.

### What arrives is checked

Recoil does not trust the link. The date has to be a real calendar date, every
field has to be one it knows, and every value has to be a real number. Anything
else is dropped rather than stored, because a bad row would quietly poison a
correlation months later. A day sent twice simply overwrites itself, and a
Shortcut that only sends steps will not wipe the weight the export brought in.

---

---

## Back it up. Really.

**Settings → Back up your Health data → Save backup.**

Whoop can always be pulled down again from their API, so nothing there is ever
truly lost. This is not like that. Everything read from Apple Health lives in
one browser's storage on one device, and browser storage is not a safe. Clear
your site data, switch phone, or have Safari decide to reclaim space, and it is
another ten-minute export.

The backup is one small JSON file — a few kilobytes for months of days. Save it
to Files or iCloud Drive. **Restore backup** puts it back in a second.

It is also the only way to get the same numbers onto a second device, because
nothing about this app syncs. Save on the phone, restore on the Mac, done.

Restoring is safe to do at any time. The file wins for the days it holds, and
any day the device already had that the file does not is left alone, so
restoring an old backup never throws away this week.

## Getting rid of it

**Settings → Apple Health → Forget Health data.** It removes everything read
from Health and leaves your Whoop history untouched. Nothing was ever anywhere
else to delete, which is also why the backup above matters.
