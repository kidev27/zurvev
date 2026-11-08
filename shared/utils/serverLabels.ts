/** Prefer a region's geographic translation to its server or game-mode name. */
export function serverDisplayName(
    region: string,
    data: { name?: string; l10n?: string },
    translate: (key: string) => string,
): string {
    const key = data.l10n?.trim();
    return (key ? translate(key).trim() : "") || data.name?.trim() || region;
}
