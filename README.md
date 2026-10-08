# dataerase

My own version of Incogni: a tool that asks data brokers to delete my info.

Right now it only does step 1: **keep my personal details from leaking**. The broker
part comes next. It's built this way round on purpose. A tool that handles my name,
address and phone number shouldn't exist until it can keep them safe.

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
  the point of the tool, but each request should send only what that broker needs.
  That's the next step.

## Next

1. A list of brokers: where to opt out, what each one asks for, how long it takes.
2. Send only the fields each broker needs.
3. Send the requests, track replies, and re-check later (brokers re-list people).
