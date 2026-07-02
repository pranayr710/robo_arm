"""
server.py — Phase 1 web control + visualization backend.

Bridges the STM32 arm (via arm_link) to a browser over WebSocket:
  - browser -> server: control commands (set angles, home, e-stop)
  - server  -> browser: live arm state at ~20 Hz (drives the visualization)

Run with hardware:   python server.py --port COM5
Run without board:   python server.py            (mock mode, simulated arm)
Then open:           http://localhost:8000

Requires: pip install -r requirements.txt
"""

import argparse
import asyncio
import os
import threading

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import uvicorn

from arm_link import open_arm

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "web", "index.html")

app = FastAPI()
link = None       # set in main()
tracker = None    # HandTracker, lazily created when hand-follow is enabled
mode = "manual"   # "manual" | "hand"


@app.get("/")
async def index():
    with open(INDEX, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.websocket("/ws")
async def ws(sock: WebSocket):
    await sock.accept()

    async def push_state():
        """Stream live arm state to this client ~20 Hz."""
        while True:
            await sock.send_json({
                "angles": link.state["angles"],
                "estop": link.state["estop"],
                "mode": mode,
                "joystick": link.state.get("mode", 0),
                "dist": link.state.get("dist", 999),
                "mock": getattr(link, "mock", False),
            })
            await asyncio.sleep(0.05)

    pusher = asyncio.create_task(push_state())
    try:
        while True:
            msg = await sock.receive_json()
            _handle(msg)
    except WebSocketDisconnect:
        pass
    finally:
        pusher.cancel()


def _set_mode(new_mode):
    """Switch between slider control and live hand-follow."""
    global tracker, mode
    if new_mode == "hand" and mode != "hand":
        from hand_tracker import HandTracker
        link.set_mode(False)                       # ensure firmware is remote
        tracker = HandTracker(on_angles=lambda a: link.set_all(*a))
        tracker.start()
        mode = "hand"
    elif new_mode == "manual" and mode == "hand":
        if tracker:
            tracker.stop()
            tracker = None
        mode = "manual"


def _write_text(text):
    """Run the Morse pen-writer on a background thread (works in mock too)."""
    from writer import PenWriter
    threading.Thread(
        target=lambda: PenWriter(link).write_text(text), daemon=True).start()


def _handle(msg):
    cmd = msg.get("cmd")
    if cmd == "A":
        a = msg["angles"]
        link.set_all(a[0], a[1], a[2], a[3])
    elif cmd == "S":
        link.set_servo(int(msg["ch"]), int(msg["angle"]))
    elif cmd == "H":
        link.home()
    elif cmd == "E":
        link.estop()
    elif cmd == "R":
        link.release()
    elif cmd == "J":
        link.set_mode(bool(msg.get("on")))         # joystick teleop on/off
    elif cmd == "MODE":
        _set_mode(msg.get("mode", "manual"))        # manual | hand
    elif cmd == "WRITE":
        _write_text(str(msg.get("text", "")))


def main():
    global link
    ap = argparse.ArgumentParser(description="Arm web control server")
    ap.add_argument("--port", default=None, help="serial port (omit for mock mode)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--http-port", type=int, default=8000)
    args = ap.parse_args()

    link = open_arm(args.port, args.baud)
    print(f"Open http://localhost:{args.http_port}")
    uvicorn.run(app, host="0.0.0.0", port=args.http_port, log_level="warning")


if __name__ == "__main__":
    main()
