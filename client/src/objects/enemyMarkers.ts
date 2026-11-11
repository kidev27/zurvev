import type { EnemyMarker } from "../../../shared/net/updateMsg.ts";
import { math } from "../../../shared/utils/math.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";

/** Dots farther apart than this between updates snap: a recycled id or a relocated enemy. */
const SnapDist = 20;

export interface EnemyMarkerState {
    pos: Vec2;
    from: Vec2;
    target: Vec2;
    t: number;
    downed: boolean;
}

/** Spec Ops hostile map dots, keyed by player id. Glides each dot between status updates. */
export class EnemyMarkers {
    markers: Record<number, EnemyMarkerState> = {};

    set(list: EnemyMarker[]) {
        const seen = new Set<number>();
        for (const marker of list) {
            seen.add(marker.playerId);
            const current = this.markers[marker.playerId];
            if (!current || v2.distance(current.pos, marker.pos) > SnapDist) {
                this.markers[marker.playerId] = {
                    pos: v2.copy(marker.pos),
                    from: v2.copy(marker.pos),
                    target: v2.copy(marker.pos),
                    t: 1,
                    downed: marker.downed,
                };
                continue;
            }
            current.from = v2.copy(current.pos);
            current.target = v2.copy(marker.pos);
            current.t = 0;
            current.downed = marker.downed;
        }
        for (const key of Object.keys(this.markers)) {
            const id = Number(key);
            if (!seen.has(id)) delete this.markers[id];
        }
    }

    update(dt: number, updateRate: number) {
        for (const marker of Object.values(this.markers)) {
            marker.t = math.min(1, marker.t + dt / updateRate);
            marker.pos = v2.lerp(marker.t, marker.from, marker.target);
        }
    }
}
