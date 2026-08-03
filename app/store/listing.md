# mComic '96 — Play Store listing

Draft copy and form answers for the Google Play listing. Character limits are
Play's own and are noted per field; the counts in brackets are what the text
below actually uses.

---

## App name

*Limit 30.*

```
mComic '96
```

`[10]` — Leave it exactly this. The apostrophe is a straight `'`, matching the
wordmark, the manifest label, and `BRAND.name`.

---

## Short description

*Limit 80. Shown under the title in search results and on the listing card.*

```
Type a conversation. Get a comic. A 1990s comic-strip chat, for one phone.
```

`[73]` — Opens on the tagline that is already on the feature graphic and in
`branding.ts`, so the graphic and the text say the same thing. "For one phone"
is doing real work: without it people read "chat" as a messenger and arrive
expecting to talk to someone.

---

## Full description

*Limit 4000.*

```
mComic '96 turns a conversation into a comic strip, panel by panel, while you
write it.

Pick a character. Type a line. Send. The app decides who stands where, who is
facing whom, where the speech balloons go and how the shot is framed — and drops
a finished panel onto the page. Write the next line and the story keeps drawing
itself.

It is a comic-strip chat for a single phone: you play every part. Stage an
argument between two people who have never met. Give a cat the last word. Roll
the dice and let it write you something to start from.

WHAT YOU CAN DO

• Write a conversation and watch it become a comic as you go
• Choose from 31 characters, each with their own faces and poses
• Set a mood with the emotion wheel — the angle picks the feeling, the distance
  from the middle picks how strongly
• Say it, whisper it, think it, or shout it, and the balloon changes shape
• Tap any panel to rewrite it; press and hold to drag it somewhere else
• Put several people in one frame and arrange who stands where
• Keep as many comics as you like, and pick up where you left off
• Export a finished strip as a picture, with an optional title and a "starring"
  cast panel

NO ACCOUNT, NO INTERNET, NO ADS

Everything happens on your phone. mComic '96 makes no network requests at all —
there is no sign-in, no tracking, no advertising, and nothing to collect. Your
comics are stored on your device and go nowhere unless you share them yourself.

ABOUT THE ART AND THE NAME

mComic '96 is an homage to Microsoft Comic Chat, the 1996 program that turned
IRC into a comic strip. It is built on an independent, open-source
reimplementation of the panel-composition algorithm from Kurlander, Skelly and
Salesin's 1996 SIGGRAPH paper "Comic Chat" — the same rules for placing
characters, routing balloons and framing the camera, written from the paper.

The character and background art is Microsoft's own, released by Microsoft under
the MIT licence and used here with attribution.

mComic '96 is not affiliated with, endorsed by, or connected to Microsoft.

Made by Onion Madder.
```

`[~1750]` — Comfortably inside 4000, and short enough that the whole thing can be
read. Play truncates after roughly the first 3 lines on mobile until "read more"
is tapped, which is why the first paragraph is a complete description on its own.

Two paragraphs are **not** decoration and should not be trimmed for length: the
MIT-art attribution and the not-affiliated line. They are the same commitments
`NOTICE.md` and the README make, and the listing is the most public place they
appear.

---

## Categorisation

| Field | Answer | Why |
|---|---|---|
| App or game | **App** | No win state, no scoring |
| Category | **Art & Design** | Play's "Comics" category is for comic *readers*; this is a tool that makes them |
| Tags | Comic, Drawing, Creativity | |
| Contains ads | **No** | |
| In-app purchases | **No** | |

---

## Content rating (IARC questionnaire)

The app has no violence, no sexual content, no profanity of its own, no
gambling, no drug references, and no user-to-user communication.

The one question worth answering carefully: **does the app let users interact or
exchange content?** The answer is **no**. Everything is single-device role-play;
there is no server, no accounts and no channel between users. Sharing a finished
picture through the Android share sheet is the OS's doing, at the user's
initiative, and is not in-app communication — but say so plainly if the
questionnaire gives you a free-text box, because "users type their own text" can
otherwise be misread as a chat feature and pull the rating up.

Expected outcome: **Everyone / PEGI 3**.

---

## Target audience

Recommend **13+**.

Not because there is anything unsuitable — there isn't — but because declaring an
audience that includes under-13s puts the app under Play's Families policy, which
brings its own design and disclosure requirements. The app has a free-text field,
which is exactly the surface those rules are written about. 13+ is the honest,
low-friction answer.

---

## Data safety form

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all user data encrypted in transit? | N/A — nothing is transmitted |
| Do you provide a way to request data deletion? | N/A — nothing is collected |

This is not a convenient reading of a grey area. The app bundles every asset at
build time and makes no network requests of any kind; drafts live in the
WebView's local storage and are deleted with the app. If that ever changes — an
analytics SDK, a crash reporter, a sync feature — this form has to change with
it, and it is the kind of thing Play audits.

---

## Assets

| Asset | Status |
|---|---|
| App icon (512×512) | Generate from `make-icon.py` output, or export the adaptive foreground |
| Feature graphic (1024×500) | ✅ `store/feature-graphic.png` |
| Phone screenshots (2–8) | 4 shot at 1080×1920; **an emotion-wheel shot is the missing one** |

---

## Privacy policy

Required for every listing. Text in `store/privacy-policy.md`, page in
`store/privacy-policy.html`. Host it and put the URL in the listing.
