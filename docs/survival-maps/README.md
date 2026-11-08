# High Water and Dead Air

Two additional selectable Zombie Survival maps. After Hours remains available.

- **High Water** (`zombie_high_water`): curved ferry terminal, freight pier, two
  gangways, pointed ferry hull, evacuation ambulance and an underground engine
  deck with two stairways. See [the route design](high-water.md).
- **Dead Air** (`zombie_dead_air`): cable station, broadcast/control rooms, generator
  switchyard, a bridge across the ridge cleft, broken dish, snow terrace and an
  underground cable tunnel with two stairways. See [the route design](dead-air.md).

Each authored footprint is 220 × 180 game units inside a 252 × 212 map. Indoor
roofs fade independently. Underground spaces use native layer 1 structures,
stair transit layers, visibility masks and the engine's underground renderer.
They do not simulate elevation by tinting the surface or teleporting players.

## Source and generated art

`shared/defs/maps/survival/` contains the layout data, polygon membership and
wall compiler. `shared/defs/survivalObjectDefs.ts` builds walls, collision-backed
custom fixtures, interactive stations, native structures and roof children.
`scripts/survival/buildArt.ts` paints those exact polygons, wall pieces, fixture
footprints, entries and stairways into deterministic SVGs. Custom environment
art is separate from the existing interactive perk/box/upgrade machine art.

Curved and angled walls use overlapping circular collision pieces; the generator
paints the same pieces. All ground wear, footsteps, skid marks and decorative
cliff/water art are nonblocking and stay outside the authored obstacles. The
broken dish's missing mesh sits on a solid foundation: its visible base shows
that the missing wedge is not walkable.

The two maps have separate atlases. Underground floor art is transparent outside
its authored footprint, allowing atlas trimming and avoiding a second full-map
texture allocation. Floors rasterize at 16 pixels per game unit (3776 × 3136
including the apron), below the existing 4096-pixel atlas limit.

## AI and gameplay

Existing gate prices, perk rules, mystery box, power and upgrade rules are used.
Spawns stay on surface entries in opened zones. When those entries are crowded,
the new maps wait instead of falling back to random positions. Enemies follow
operators downstairs through actual stairs; an underground squad still receives
reachable surface spawns. Stair destinations extend past the exit so bodies
leave transit layers. Room caches include floors, and navigation samples both
floors while rejecting polygon voids. Body-clear direct pursuit stops generic
wall avoidance from steering away from a player near a wall.

Stuck-enemy recovery uses the same opened-room surface entries as spawning and
applies the destination position and floor together. It clears the old stair
target so a recovered zombie can route toward operators on either floor.

Mystery-box relocation respects opened rooms and transfers the obstacle's real
layer. Stations and melee check floors, preventing use or attacks through a
ceiling. The original After Hours spawn fallback and all its rules are retained.

## Regenerate and validate

```sh
bun scripts/survival/buildArt.ts
cd tests
bun run test --run survivalMaps lastCall zombieMode
```

The focused suite checks every entry and open doorway, station approaches,
power, closed-zone spawning, spawning while operators are downstairs, both
native player stair transitions, actual zombie down-and-up pursuit at both
stairs, cross-floor melee isolation, recovery from basement and stair transit
layers, and advancing a wave after shooting its recovered last zombie. Type
checks cover shared, server and client code. The new objects, atlases and
generated SVGs have separate asset validation tests.

Generated concept illustrations are art-direction references, not screenshots
or collision plans. The implemented game geometry and SVGs are authoritative.
