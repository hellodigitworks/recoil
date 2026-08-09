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

A Shortcut that reads yesterday's numbers each morning and hands them to Recoil.
Fifteen minutes to build, then it runs itself.

**How it works, and the one visible cost.** The Shortcut opens Recoil with the
numbers attached to the link. Safari appears for a second and closes. That
second is the price of the numbers never leaving your phone: the alternative was
posting them to a server and reading them back, which would have made the
promise on the front of this app untrue.

### Build the Shortcut

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

## Getting rid of it

**Settings → Apple Health → Forget Health data.** It removes everything read
from Health and leaves your Whoop history untouched. Nothing was ever anywhere
else to delete.
