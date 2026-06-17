type ShieldDebugPayload = {
    profile?: 'long' | 'short';
    detail?: unknown;
};

export function logShieldDebug(_eventName?: string, _payload?: ShieldDebugPayload): void {
    // Debug logging is intentionally disabled in tests/runtime until the dedicated logger lands.
    void _eventName;
    void _payload;
    return undefined;
}

export function logShieldDebugFromShield(
    _eventName?: string,
    _shield?: HTMLElement,
    _payload?: ShieldDebugPayload,
): void {
    // Debug logging is intentionally disabled in tests/runtime until the dedicated logger lands.
    void _eventName;
    void _shield;
    void _payload;
    return undefined;
}
