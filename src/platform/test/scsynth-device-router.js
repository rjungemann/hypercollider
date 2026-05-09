/**
 * DeviceRouter — audio output device enumeration and hot-swap for scsynth-realtime.
 *
 * Browser requirements:
 *   - Device enumeration: any modern browser with `navigator.mediaDevices.enumerateDevices()`
 *   - Device selection / hot-swap: Chrome 110+ / Edge 110+ (AudioContext.setSinkId)
 *
 * Usage:
 *   // Enumerate available output devices
 *   const devices = await DeviceRouter.enumerateOutputDevices();
 *   // [{ deviceId: 'abc…', label: 'Built-in Output' }, …]
 *
 *   // Check hot-swap support before showing the picker
 *   if (DeviceRouter.isSinkIdSupported()) { … }
 *
 *   // Route an AudioContext to a specific device (hot-swap — no restart needed)
 *   await DeviceRouter.setAudioContextDevice(audioCtx, deviceId);
 */
class DeviceRouter {
    /**
     * Returns true if the browser supports AudioContext.setSinkId().
     * Chrome 110+, Edge 110+. Firefox and Safari do not support it as of 2026.
     */
    static isSinkIdSupported() {
        return typeof AudioContext !== 'undefined' &&
               typeof AudioContext.prototype.setSinkId === 'function';
    }

    /**
     * Enumerate all audio output devices available to the page.
     *
     * Requests microphone access briefly to obtain device labels — this is
     * silently skipped if permission is denied (labels will be generic).
     *
     * @returns {Promise<Array<{deviceId: string, label: string}>>}
     */
    static async enumerateOutputDevices() {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices) return [];
        try {
            // Brief getUserMedia request to unlock device labels.
            // Silently ignored if the user denies or the context is not secure.
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop());
            } catch (_) {}

            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices
                .filter(d => d.kind === 'audiooutput')
                .map(d => ({
                    deviceId: d.deviceId,
                    label: d.label ||
                           (d.deviceId === 'default'    ? 'Default Output' :
                            d.deviceId === 'communications' ? 'Communications Output' :
                            `Output Device (${d.deviceId.slice(0, 8)}…)`),
                }));
        } catch (_) {
            return [];
        }
    }

    /**
     * Route an AudioContext's output to a specific device without restarting it.
     *
     * Uses AudioContext.setSinkId() (Chrome 110+ / Edge 110+).
     * Pass deviceId = '' or 'default' to restore the system default output.
     *
     * @param {AudioContext} audioContext
     * @param {string} deviceId  — from enumerateOutputDevices(), or '' for default
     * @returns {Promise<void>}
     */
    static async setAudioContextDevice(audioContext, deviceId) {
        if (!audioContext) throw new Error('setAudioContextDevice: no AudioContext provided');
        if (!DeviceRouter.isSinkIdSupported()) {
            throw new Error(
                'AudioContext.setSinkId() is not supported in this browser.\n' +
                'Chrome 110+ or Edge 110+ is required for output device selection.'
            );
        }
        await audioContext.setSinkId(deviceId || 'default');
    }
}
