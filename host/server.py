"""
server.py — serves the browser control app and (optionally) bridges to a real
STM32 arm over serial.

The browser app does all the vision/animation itself. This server only:
  - serves host/web/  (index.html + app.js)
  - relays control commands from the browser to the STM32 over /ws, if a board
    is connected (--port). With no board it runs in mock mode and just echoes
    telemetry so the "STM32 LIVE" badge stays off.

Run:   python server.py                (browser demo only, no hardware)
       python server.py --port COM5    (also drive the real arm)
Open:  http://localhost:8000
"""

import argparse
import asyncio
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import uvicorn

from arm_link import open_arm

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

app = FastAPI()
link = None  # set in main()


@app.websocket("/ws")
async def ws(sock: WebSocket):
    await sock.accept()

    async def push_state():
        while True:
            await sock.send_json({
                "angles": link.state["angles"],
                "estop": link.state["estop"],
                "mock": getattr(link, "mock", False),
            })
            await asyncio.sleep(0.1)

    pusher = asyncio.create_task(push_state())
    try:
        while True:
            _handle(await sock.receive_json())
    except WebSocketDisconnect:
        pass
    finally:
        pusher.cancel()


def _handle(msg):
    cmd = msg.get("cmd")
    if cmd == "A":
        a = msg["angles"]; link.set_all(a[0], a[1], a[2], a[3])
    elif cmd == "S":
        link.set_servo(int(msg["ch"]), int(msg["angle"]))
    elif cmd == "H":
        link.home()
    elif cmd == "E":
        link.estop()
    elif cmd == "R":
        link.release()
    elif cmd == "J":
        link.set_mode(bool(msg.get("on")))
    elif cmd == "RAW":                       # pass a raw protocol line to firmware
        link.send_line(str(msg.get("line", "")))


# static app is mounted last so /ws wins
app.mount("/", StaticFiles(directory=WEB, html=True), name="web")


def main():
    global link
    ap = argparse.ArgumentParser(description="Arm browser app + serial bridge")
    ap.add_argument("--port", default=None, help="serial port (omit for browser-only)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--http-port", type=int, default=8000)
    args = ap.parse_args()
    link = open_arm(args.port, args.baud)
    print(f"Open http://localhost:{args.http_port}")
    uvicorn.run(app, host="0.0.0.0", port=args.http_port, log_level="warning")


if __name__ == "__main__":
    main()
