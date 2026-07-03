/* voice.js — hands-free control via the browser Web Speech API (free, no key).
 * Emits recognized phrases; app.js feeds them to the NLP handler. Auto-restarts
 * so it keeps listening. Gracefully reports if the browser lacks support. */

export class Voice {
  constructor(onResult, onStatus) {
    this.onResult = onResult; this.onStatus = onStatus || (() => {});
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.listening = false;
    if (!this.supported) return;
    this.rec = new SR();
    this.rec.lang = "en-US";
    this.rec.continuous = true;
    this.rec.interimResults = false;
    this.rec.onresult = (e) => {
      const phrase = e.results[e.results.length - 1][0].transcript.trim();
      if (phrase) this.onResult(phrase);
    };
    this.rec.onerror = (e) => this.onStatus("voice error: " + e.error);
    this.rec.onend = () => { if (this.listening) { try { this.rec.start(); } catch (_) {} } };
  }

  start() {
    if (!this.supported) { this.onStatus("voice not supported in this browser"); return false; }
    this.listening = true;
    try { this.rec.start(); this.onStatus("listening…"); } catch (_) {}
    return true;
  }

  stop() {
    this.listening = false;
    if (this.supported) { try { this.rec.stop(); } catch (_) {} }
    this.onStatus("voice off");
  }

  toggle() { return this.listening ? (this.stop(), false) : this.start(); }
}
