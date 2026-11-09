import {
    COMMUNITY_ANNOUNCEMENT_ENABLED,
    COMMUNITY_ANNOUNCEMENT_SNOOZE_MS,
    COMMUNITY_ANNOUNCEMENT_VERSION,
    COMMUNITY_DISCORD_URL,
} from "../graphicsQuality.ts";
import type { MenuModal } from "./menuModal.ts";

type Preference = "announcementHideUntil" | "announcementVersionSeen";
type AnnouncementConfig = {
    get(key: Preference): number | undefined;
    set(key: Preference, value: number): void;
};

export function setupCommunityAnnouncement(
    modal: Pick<MenuModal, "onShow" | "onHide" | "show" | "hide">,
    config: AnnouncementConfig,
    isActive: () => boolean,
) {
    document.querySelectorAll<HTMLAnchorElement>("a[data-community-discord]").forEach((link) => {
        link.href = COMMUNITY_DISCORD_URL;
    });
    const dialog = document.getElementById("modal-community-announce");
    if (!dialog) return;

    const sessionKey = `specops_announce_session_${COMMUNITY_ANNOUNCEMENT_VERSION}`;
    let dismissed = false;
    const markSeen = () => {
        dismissed = true;
        try {
            sessionStorage.setItem(sessionKey, "1");
        } catch {}
    };
    document.querySelectorAll<HTMLAnchorElement>("a[data-community-discord]").forEach((link) => {
        link.addEventListener("click", () => {
            markSeen();
            modal.hide();
        });
    });
    const shouldShow = () => {
        if (!COMMUNITY_ANNOUNCEMENT_ENABLED || dismissed) return false;
        try {
            if (sessionStorage.getItem(sessionKey) === "1") return false;
        } catch {}
        const seenVersion = Number(config.get("announcementVersionSeen") || 0);
        const hideUntil = Number(config.get("announcementHideUntil") || 0);
        return !(seenVersion >= COMMUNITY_ANNOUNCEMENT_VERSION && hideUntil > Date.now());
    };

    let previousFocus: HTMLElement | null = null;
    const join = document.getElementById("btn-community-announce-discord");
    document.getElementById("btn-community-announce-close")?.addEventListener("click", () => modal.hide());
    document.getElementById("btn-community-announce-snooze")?.addEventListener("click", () => {
        config.set("announcementHideUntil", Date.now() + COMMUNITY_ANNOUNCEMENT_SNOOZE_MS);
        config.set("announcementVersionSeen", COMMUNITY_ANNOUNCEMENT_VERSION);
        modal.hide();
    });
    modal.onShow(() => {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        join?.focus();
    });
    modal.onHide(() => {
        markSeen();
        previousFocus?.focus();
        previousFocus = null;
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            modal.hide();
        } else if (event.key === "Tab") {
            const controls = dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
    });
    if (shouldShow()) {
        setTimeout(() => {
            if (!isActive() || !shouldShow()) return;
            // Reconnect and other open dialogs take priority over a community invite.
            const overlays = document.querySelectorAll<HTMLElement>(".modal, #match-rejoin-banner");
            if (Array.from(overlays).some((element) => element.getClientRects().length > 0)) return;
            modal.show(true);
        }, 600);
    }
}
