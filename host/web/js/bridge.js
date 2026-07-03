/* Bridge — optional link to the Python server / real STM32 over WebSocket.
 * Angle updates are throttled to ~30 Hz so we never flood the serial link.
 * The app works fully without a server; this just mirrors commands to hardware. */

export class Bridge {
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.ws = null; this.lastSent = 0; this.pending = null;
    this._connect();
  }

  _connect() {
    try {
      this.ws = new WebSocket(`ws://${location.host}/ws`);
      this.ws.onopen = () => this.onStatus("server", "ok");
      this.ws.onclose = () => { this.ws = null; this.onStatus("offline", "off"); setTimeout(() => this._connect(), 2500); };
      this.ws.onerror = () => {};
      this.ws.onmessage = (e) => {
        try { const s = JSON.parse(e.data); if (!s.mock) this.onStatus("STM32 LIVE", "live"); }
        catch (_) {}
      };
    } catch (_) { setTimeout(() => this._connect(), 2500); }
  }

  _ready() { return this.ws && this.ws.readyState === 1; }

  /** Stream target angles [base,grip,shoulder,elbow], throttled. */
  sendAngles(angles) {
    if (!this._ready()) return;
    const now = performance.now();
    this.pending = angles;
    if (now - this.lastSent < 33) return;
    this.lastSent = now;
    this.ws.send(JSON.stringify({ cmd: "A", angles: this.pending }));
  }

  raw(obj) { if (this._ready()) this.ws.send(JSON.stringify(obj)); }
}
