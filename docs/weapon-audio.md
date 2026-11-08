# Conventional weapon audio

The approved PPSh-41 reload is the reference for future ordinary firearms:
`client/public/audio/guns/ppsh41_reload_01.wav`.

- Use dry, physical handling sounds: metal clanks, drum or magazine movement,
  latch engagement, charging handles and bolt release.
- Sequence the actions into one continuous reload. Keep transitions short;
  give each pause a physical reason rather than spacing isolated effects out
  to fill a timer.
- Preserve the weight and texture of steel. Airy swishes, synthesized ringing,
  pneumatic charging and electronic tones belong to weapons designed around
  those effects, such as wonder weapons.
- Match the actions to the firearm: a drum swap, detachable magazine and
  individually loaded shells should have their own handling sequence.

Use this direction when adding or revising a conventional gun. Existing weapon
recordings can be revised separately as needed.

Store the authored sound length in `GunDef.sound.reloadDuration`. It is separate
from the gameplay `reloadTime`; the client adjusts playback to the received
reload action timer, including reload-speed perks. Check decoding and duration
with the browser's audio decoder, which supports both WAV and MP3. Asset paths
must match filename casing on Linux deployments.

Audition the isolated recording and actual in-game playback before delivery.
Keep a note of reused source recordings alongside the weapon documentation.
