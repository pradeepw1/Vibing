# dataerase

My own version of Incogni: a tool that asks data brokers to delete my info.

So far it does two things:

1. **Keeps my personal details from leaking.** This came first on purpose. A tool that
   handles my name, address and phone number shouldn't exist until it can keep them safe.
2. **Knows the brokers.** 107 of them: where to opt out, what each one asks for, and
   how long it takes. See [The broker list](#the-broker-list).

Sending the requests comes next.

## How the data is protected

| Where it could leak | What stops it |
|---|---|
| **Disk** | Your details are stored encrypted (AES-256-GCM, key from your passphrase via scrypt). The file is `0600` in a `0700` folder. The passphrase is never saved. |
| **Git** | The tool won't store the profile inside any git repo. `.gitignore` blocks profile, `.env`, key, log and screenshot files. A pre-commit hook blocks anything that looks like an email, phone number or SSN. |
| **Screen and logs** | Values are masked when shown (`j***@e***`). `Profile` can't be printed. Logs and error output are scrubbed of your real values. Crash dumps are turned off. |
| **Proof** | `dataerase leak-check` searches the files **and the full git history** for your exact values, including the commit author name and email. It reports where, never what. |

## Setup

Do this on your own computer, not in a cloud or chat session.

```sh
pip install -e ".[dev]"
git config core.hooksPath .githooks     # turns on the pre-commit check

dataerase init          # enter your details, pick a passphrase
dataerase show          # check them (masked)
dataerase leak-check    # scan this repo for your real details
pytest                  # run the tests
```

The profile is saved to `~/.local/share/dataerase/profile.enc`
(change it with `DATAERASE_HOME`).

If a line in the code is fake data on purpose, add `pii-ok` to it so the hook leaves it alone.
Company or government contact details (like a broker's privacy inbox) go in
`.leakcheck-allow`, one per line. Never put your own details there.

## Do this too

- **Use GitHub's private email for commits.** Every commit carries your name and email
  in public. In GitHub: Settings → Emails → turn on *Keep my email addresses private* and
  *Block command line pushes that expose my email*. Then run
  `git config user.email "<id>+<username>@users.noreply.github.com"`.
- **Pick a long passphrase.** It's the only thing between an attacker and your profile
  if they get the file.
- If `leak-check` finds something in history, deleting the line isn't enough. Rewrite the
  history and treat the value as public. Anyone who cloned it already has it.

## What this doesn't cover (yet)

- Malware or someone with access to your logged-in computer. They can read memory or
  watch you type the passphrase.
- Swap files and Python's memory handling. Strings can't be reliably wiped.
- Name formats it doesn't guess, like "Doe, Jane". Very short names and aliases
  (under 5 characters) aren't scanned, and `init` tells you which.
- Giving brokers your details so they can find and delete your record. That's
  the point of the tool, but each request will send only what that broker's form
  asks for (see `asks for` in the broker list).

## The broker list

```sh
dataerase brokers                       # all of them
dataerase brokers --region US-CA        # only ones you can use (US-CA also gets California-only tools)
dataerase brokers --category aggregator
dataerase brokers spokeo                # everything about one: link, steps, gotchas, sources
```

No passphrase needed. The list holds only public company details
(`src/dataerase/data/brokers.json`).

**What's on it** (checked 2026-10-08):

| Group | How many | What they are |
|---|---|---|
| official-tool | 6 | One request, many companies. California's DROP, prescreened-offer opt-out, Do Not Call, email and mail preference lists, Google's "Results about you" |
| people-search | 72 | Sites that show a profile of you: Spokeo, Whitepages, BeenVerified, FastPeopleSearch, TruePeopleSearch and many smaller ones |
| aggregator | 18 | Behind-the-scenes sellers: Acxiom, Epsilon, LexisNexis, LiveRamp, the credit bureaus' marketing arms |
| b2b-contacts | 11 | Work contact databases: ZoomInfo, Apollo, RocketReach, Lusha and others |

**Where to start:**

1. **If you live in California, use DROP first** (`dataerase brokers ca-drop`). One free
   request reaches 600+ registered brokers, and since 2026-08-01 they must act on it.
2. **Google "Results about you"** shows which people-search sites list you, and gets them
   out of search results.
3. Then the big people-search families, then the aggregators.

**How sure each entry is:**

- `checked-live` (66): we loaded the broker's own page on the date shown.
- `recent-guides` (32): the page blocks bots, so this comes from 2025-2026 removal guides that agree.
- `unsure` (9): couldn't confirm the site still works. The list command names these.

**Flags (`!`).** A few brokers want something this tool will never hand over:
- **PeopleWhiz** wants an ID document.
- **The Work Number** wants your full SSN. It's an employment-records freeze, not a deletion.
- **DMAchoice** charges a fee.

You decide those by hand.

**Each broker sends only what it asks for.** `asks for` lists exactly what the opt-out
form needs, and the next step uses it to send nothing more. Where a form takes either
date of birth or street address, the list picks the address.

**Things to know:**

- Sister sites aren't always covered by one request. FastPeopleSearch's owner runs ten
  sites, and each needs its own request. An entry's "also removes" lists only sites
  a request is known to cover.
- About 15 smaller sites (PrivateRecords, PeopleSearch123 and others on the same
  platform) now require your full date of birth. Skip them if you'd rather not give it.
- Ancestry and TruePeopleSearch.net need an account (TruePeopleSearch.net needs a Google
  sign-in). PeopleConnect (Intelius, TruthFinder, Instant Checkmate) needs your date of
  birth, and you must keep your account there or the removal is undone.
- Brokers re-list people. Expect to repeat this every few months.
- `retired` in the file lists 9 sites that shut down or changed hands (Radaris, PeekYou,
  ClustrMaps and others) and why. That way nobody adds them back by mistake.
- `references` lists the state broker registries (California, Vermont, Texas, Oregon) and
  public opt-out lists, for finding brokers that aren't covered yet.

**Not on the list yet:** Bumper.com, PrivateEye.com, Truecaller, LiveIntent, and about 25
Radaris-network sites whose owners couldn't be identified.

**Keeping it fresh.** Opt-out pages move often. Every entry has a `checked` date and its
sources. Re-check anything older than a few months before relying on it.

## Next

1. Send only the fields each broker needs (using `asks for`).
2. Find your listings, send the requests, track replies, and re-check later.
