# Bundled Microsoft Comic Chat art — attribution

The character sprites and backdrops under `assets/comic-chat/` are derived from
**Microsoft Comic Chat**, released by Microsoft as open source at
[github.com/microsoft/comic-chat](https://github.com/microsoft/comic-chat) under
the **MIT License**. The original art is copyright © Microsoft Corporation.

## What was done to it

The upstream art ships in Comic Chat's binary `.avb` (avatar) and `.bmp`
(backdrop) formats. It was decoded and converted to this project's PNG-sprite +
JSON-manifest format by [`tools/import-avb.py`](../../tools/import-avb.py). The
`.avb` structure was read from Comic Chat's own loader source (`avatario.cpp`,
`avatar.h`) in that repository — not reverse-engineered by guesswork. No artwork
was redrawn or altered beyond format conversion (bitmap → transparent PNG using
the avatars' own transparency and aura masks).

Characters converted (the "complex" avatars, which separate head and body):
Anna, Armando, Bolo, Cro, Dan, Denise, Hugh, Lance, Lynnea, Margaret, Mike,
Susan, Tiki, TongueTyed, Xeno. Backdrops: room, field, pastoral.

## License of the bundled art

The bundled art remains under Microsoft's MIT License. A copy of that license,
as published with the upstream repository, is included alongside this notice as
[`LICENSE.microsoft-comic-chat`](./LICENSE.microsoft-comic-chat). This project's
own code is separately MIT-licensed (see the repository `LICENSE`).

## Not affiliated with Microsoft

`comic-chat-composer` is an **independent, unofficial reimplementation**. It is
not affiliated with, sponsored by, or endorsed by Microsoft. "Microsoft" and
"Comic Chat" and the character names are used only to identify the origin of the
artwork and the algorithm being reimplemented, in the descriptive sense the
upstream MIT license and its trademark note allow — never in a way meant to
imply Microsoft's sponsorship or endorsement.
